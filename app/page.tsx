"use client";

import Image from "next/image";
import { type ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatOneDReader, type IScannerControls } from "@zxing/browser";
import { Barcode, Boxes, Building2, CalendarDays, Camera, CheckCircle2, Check, ChevronRight, CircleDollarSign, ClipboardCheck, Clock3, Download, Eye, EyeOff, FileSpreadsheet, Hand, KeyRound, LoaderCircle, LogIn, LogOut, Mail, PackageSearch, Plus, RefreshCw, Ruler, ScanLine, ShieldCheck, Store, Tags, TriangleAlert, Upload, UserRound, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { createProvisioningClient, supabase } from "@/app/lib/supabase";
import { normalizeBarcode } from "@/app/lib/barcode";
import { OBSERVATIONS, summarizeEvaluation, type Observation } from "@/app/lib/evaluation";
import { caracasWeekRange, dateInputValue, isActivityIncident, summarizeActivityByStore, summarizeDailyActivity, type ActivityCountRow, type DailyActivityRow, type StoreActivitySummary } from "@/app/lib/daily-activity";
import { findMinimumSize, matchesExpectedMinimum } from "@/app/lib/size-validation";

type RoleCode = "employee" | "manager" | "supervisor";
type View = "scanner" | "evaluation" | "daily" | "catalog" | "users";
type StoreRecord = { id: string; name: string; slug: string };
type Profile = { id: string; full_name: string | null; role: RoleCode; store_id: string | null; is_active: boolean; is_owner: boolean };
type ManagedProfile = Profile & { email: string | null; created_at: string | null };
type Product = { id: string | null; storeId: string; barcode: string; article: string; description: string; color: string; size: string; style: string; amount: number; brand: string; category: string };
type EvaluationItem = Product & { rowId: string; observation: Observation; scannedAt: string };
type CatalogMeta = { id: string; fileName: string; rowCount: number; activatedAt: string | null } | null;
type UploadStage = "selected" | "reading" | "parsing" | "preparing" | "uploading" | "activating" | "caching";
type UploadState = { stage: UploadStage; fileName: string; done: number; total: number };
type UploadFeedback = { kind: "success" | "error"; title: string; message: string } | null;
type ScanFeedback = { code: string; storeName: string } | null;
type SizeGate = { product: Product; expectedSize: string } | null;

const ROLE_LABELS: Record<RoleCode, string> = { employee: "Empleado", manager: "Gerente", supervisor: "Supervisor" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ProductRow = { id:string; store_id:string; barcode:string; article:string; description:string|null; color:string|null; size:string|null; style:string|null; amount:number|string; brand?:string|null; category?:string|null };

function productFromRow(row: ProductRow): Product {
  return {
    id: row.id,
    storeId: row.store_id,
    barcode: row.barcode,
    article: row.article,
    description: row.description ?? "",
    color: row.color || "No especificado",
    size: row.size || "No especificado",
    style: row.style || "No especificado",
    amount: Number(row.amount),
    brand: row.brand || "No especificado",
    category: row.category || "No especificado",
  };
}

function formatCatalogUpdatedAt(value: string | null | undefined) {
  if (!value) return "Sin información";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin información";
  const today = new Date();
  const isToday = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  const time = new Intl.DateTimeFormat("es-DO", { hour: "numeric", minute: "2-digit" }).format(date);
  if (isToday) return `Hoy, ${time}`;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function dailyRowFromRpc(row: Record<string, unknown>): DailyActivityRow {
  return {
    id:String(row.id),createdAt:String(row.activity_at),employeeId:String(row.employee_id),employeeName:String(row.employee_name??"Usuario"),
    storeId:String(row.store_id),storeName:String(row.store_name??"Tienda"),source:row.source as "scanner"|"evaluation",eventType:row.event_type as DailyActivityRow["eventType"],
    barcode:String(row.barcode??""),article:String(row.article??""),description:String(row.description??""),color:String(row.color??"No especificado"),
    size:String(row.size??"No especificado"),expectedSize:String(row.expected_size??""),style:String(row.style??"No especificado"),amount:Number(row.amount??0),
    brand:String(row.brand??"No especificado"),category:String(row.category??"No especificado"),observation:(row.observation as Observation|null)??null,
  };
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-VE", { day:"numeric", month:"short", timeZone:"UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

const waitForRetry = (milliseconds:number) => new Promise<void>((resolve)=>setTimeout(resolve,milliseconds));
const transientUploadError = (error:{message?:string;code?:string}|null|undefined) => {
  const value=`${error?.code??""} ${error?.message??""}`.toLowerCase();
  return /failed to fetch|network|timeout|timed out|connection|gateway|502|503|504|429/.test(value);
};
const FILE_ACTIVITY_ATTRIBUTE = "data-scancontrol-file-activity";
const FILE_ACTIVITY_EVENT = "scancontrol:file-activity";
function setExcelFileActivity(activity:"picking"|"importing"|null){
  if(typeof document==="undefined")return;
  if(activity)document.documentElement.setAttribute(FILE_ACTIVITY_ATTRIBUTE,activity);
  else document.documentElement.removeAttribute(FILE_ACTIVITY_ATTRIBUTE);
  window.dispatchEvent(new CustomEvent(FILE_ACTIVITY_EVENT,{detail:{activity}}));
}
const GARMENT_BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

type ExtendedCameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  zoom?: { min: number; max: number; step: number };
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

type ExtendedCameraConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  zoom?: number;
  exposureMode?: string;
  whiteBalanceMode?: string;
};

function cameraConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      // Let Android/iOS use the logical rear camera. Selecting a physical
      // camera2 device can bypass the phone's normal autofocus/ISP pipeline.
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, min: 24 },
      advanced: [{ focusMode: "continuous", zoom: 1 } as ExtendedCameraConstraintSet],
    } as ExtendedCameraConstraintSet,
  };
}

async function applyCameraSetting(track:MediaStreamTrack,setting:ExtendedCameraConstraintSet){
  try { await track.applyConstraints({ advanced:[setting] }); return true; }
  catch { return false; }
}

async function focusCameraTrack(track:MediaStreamTrack,forceSingleShot=false){
  const capabilities=track.getCapabilities?.() as ExtendedCameraCapabilities|undefined;
  const modes=capabilities?.focusMode??[];
  let focused=false;
  if(forceSingleShot&&modes.includes("single-shot")){
    focused=await applyCameraSetting(track,{focusMode:"single-shot"});
    if(focused)await new Promise<void>((resolve)=>setTimeout(resolve,700));
  }
  if(modes.includes("continuous"))focused=await applyCameraSetting(track,{focusMode:"continuous"})||focused;
  else if(!focused&&modes.includes("single-shot"))focused=await applyCameraSetting(track,{focusMode:"single-shot"});
  return focused;
}

async function prepareVideoPreview(video:HTMLVideoElement,stream:MediaStream){
  video.srcObject=stream;
  video.muted=true;
  video.playsInline=true;
  if(video.readyState<2){
    await Promise.race([
      new Promise<void>((resolve)=>video.addEventListener("loadeddata",()=>resolve(),{once:true})),
      new Promise<void>((resolve)=>setTimeout(resolve,1200)),
    ]);
  }
  try{await video.play();}catch{/* ZXing volverá a iniciar la reproducción al conectar el lector. */}
}

async function optimizeCamera(stream: MediaStream,video:HTMLVideoElement) {
  const track = stream.getVideoTracks()[0];
  if (!track) return { focus:false,zoom:false,width:0,height:0 };
  track.contentHint="detail";
  const capabilities = track.getCapabilities?.() as ExtendedCameraCapabilities | undefined;
  let zoomed=false;
  if(capabilities?.zoom&&capabilities.zoom.min<=1&&capabilities.zoom.max>=1)zoomed=await applyCameraSetting(track,{zoom:1});
  if(capabilities?.exposureMode?.includes("continuous"))await applyCameraSetting(track,{exposureMode:"continuous"});
  if(capabilities?.whiteBalanceMode?.includes("continuous"))await applyCameraSetting(track,{whiteBalanceMode:"continuous"});
  await prepareVideoPreview(video,stream);
  const focused=await focusCameraTrack(track,false);
  const settings=track.getSettings();
  return {focus:focused,zoom:zoomed,width:settings.width??0,height:settings.height??0};
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: typeof ScanLine; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} type="button"><Icon size={20}/><span>{label}</span><ChevronRight className="nav-chevron" size={16}/></button>;
}

function ExcelDocumentIcon({ size = "large" }: { size?: "large" | "small" }) {
  return <span className={`excel-document-icon excel-document-icon-${size}`} aria-hidden="true">
    <svg className="excel-document-svg" viewBox="0 0 104 112" focusable="false">
      <path className="excel-sheet" d="M27 3h48l22 22v79a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z"/>
      <path className="excel-fold" d="M75 3v18a5 5 0 0 0 5 5h17"/>
      <rect className="excel-grid-panel" x="47" y="38" width="40" height="52" rx="2"/>
      <path className="excel-grid-lines" d="M60.5 39v50M73.5 39v50M48 51.5h38M48 64.5h38M48 77.5h38"/>
      <path className="excel-badge-shadow" d="M7 34h45v48H7a4 4 0 0 1-4-4V38a4 4 0 0 1 4-4Z"/>
      <path className="excel-badge" d="M8 31h43v48H8a5 5 0 0 1-5-5V36a5 5 0 0 1 5-5Z"/>
      <path className="excel-x" d="m15 43 8 12-8.6 13h7.2l5.2-8.2 5.1 8.2h7.4l-8.8-13 8-12h-7.1l-4.6 7.4-4.5-7.4H15Z"/>
    </svg>
  </span>;
}

function EvaluationSummaryIcon({ observation }: { observation?: Observation }) {
  const Icon = observation === "SIN INCIDENCIAS" ? CheckCircle2 : observation === "PRECIO ERRÓNEO" ? CircleDollarSign : observation === "MAL ETIQUETADO" ? Tags : Hand;
  return <span className={`summary-icon summary-icon-${observation === "SIN INCIDENCIAS" ? "success" : "default"}`} aria-hidden="true"><Icon size={20}/></span>;
}

function LoginScreen() {
  const [email, setEmail] = useState(()=>typeof window === "undefined" ? "" : (window.localStorage.getItem("canaima-login-email") ?? ""));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupStoresLoading, setSignupStoresLoading] = useState(false);
  const [signupStores, setSignupStores] = useState<StoreRecord[]>([]);
  const [signupForm, setSignupForm] = useState({ fullName:"", email:"", password:"", storeId:"" });
  const [signupMessage, setSignupMessage] = useState<{ kind:"error"|"success"; text:string }|null>(null);

  useEffect(() => {
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = theme?.content;
    document.documentElement.classList.add("login-active");
    if (theme) theme.content = "#061b31";
    return () => {
      document.documentElement.classList.remove("login-active");
      if (theme) theme.content = previousTheme || "#f7f8fa";
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormMessage(null);
    try {
      if (remember) window.localStorage.setItem("canaima-login-email", email.trim());
      else window.localStorage.removeItem("canaima-login-email");
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const text = error.code === "email_not_confirmed"
          ? "Debes confirmar primero el enlace enviado a tu correo."
          : error.code === "invalid_credentials"
            ? "El correo o la contraseña no son correctos."
            : "No se pudo iniciar sesión. Intenta nuevamente.";
        setFormMessage({ kind: "error", text });
        toast.error("No se pudo iniciar sesión", { description: text });
        return;
      }
      if (!data.session) {
        setFormMessage({ kind: "error", text: "No se recibió una sesión válida. Intenta nuevamente." });
        return;
      }
      setFormMessage({ kind: "success", text: "Acceso correcto. Cargando tu perfil…" });
    } catch {
      const text = "No fue posible conectar con el servicio. Revisa tu conexión e intenta nuevamente.";
      setFormMessage({ kind: "error", text });
      toast.error("Error de conexión", { description: text });
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setFormMessage({ kind: "error", text: "Escribe tu correo electrónico para recuperar la contraseña." });
      return;
    }
    setResetBusy(true);
    setFormMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) setFormMessage({ kind: "error", text: "No se pudo enviar el enlace. Verifica el correo e intenta otra vez." });
    else setFormMessage({ kind: "success", text: "Te enviamos un enlace para restablecer tu contraseña." });
    setResetBusy(false);
  }

  async function openSignup() {
    setSignupOpen(true);
    setSignupMessage(null);
    if (signupStores.length) return;
    setSignupStoresLoading(true);
    const { data, error } = await supabase.rpc("registration_stores");
    if (error) setSignupMessage({ kind:"error", text:"El registro por tienda todavía debe activarse en Supabase." });
    else {
      const availableStores=(data??[]) as StoreRecord[];
      setSignupStores(availableStores);
      setSignupForm((current)=>({...current,storeId:current.storeId||availableStores[0]?.id||""}));
    }
    setSignupStoresLoading(false);
  }

  async function submitSignup(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fullName=signupForm.fullName.trim(),signupEmail=signupForm.email.trim().toLowerCase();
    if(!fullName||!signupEmail||signupForm.password.length<8||!signupForm.storeId){
      setSignupMessage({kind:"error",text:"Completa todos los datos y selecciona obligatoriamente tu tienda."});
      return;
    }
    setSignupBusy(true);
    setSignupMessage(null);
    const {data,error}=await supabase.auth.signUp({
      email:signupEmail,
      password:signupForm.password,
      options:{data:{full_name:fullName,store_id:signupForm.storeId}},
    });
    if(error){
      const text=error.code==="user_already_exists"?"Ya existe una cuenta con este correo.":"No se pudo crear la cuenta. Revisa los datos e inténtalo nuevamente.";
      setSignupMessage({kind:"error",text});
    }else if(data.session){
      setSignupMessage({kind:"success",text:"Cuenta creada como Empleado. Cargando tu tienda…"});
      setSignupOpen(false);
    }else{
      setSignupMessage({kind:"success",text:"Cuenta creada como Empleado. Confirma el enlace enviado a tu correo para iniciar sesión."});
      setSignupForm({fullName:"",email:"",password:"",storeId:signupForm.storeId});
    }
    setSignupBusy(false);
  }

  return <main className="access-screen"><Toaster position="top-center" richColors/>
    <section className="access-shell" aria-label="Acceso a Canaima ScanControl">
      <div className="access-brand-lockup" aria-label="Grupo Canaima ScanControl">
        <svg className="access-brand-mark" viewBox="0 0 64 70" role="img" aria-label="Canaima">
          <path className="access-mark-frame" d="M32 2 61 19v33L32 69 3 52V19L32 2Zm0 8L10 23v25l22 13 22-13V23L32 10Z"/>
          <path className="access-mark-c" d="m46 22-14-8-17 10v22l17 10 14-8V38l-14 8-9-5V29l9-5 14 8V22Z"/>
        </svg>
        <div><span>GRUPO CANAIMA</span><strong>SCAN<span>CONTROL</span></strong></div>
      </div>

      <div className="access-hero-copy">
        <h1>Bienvenido</h1>
        <div className="access-accent" aria-hidden="true"/>
        <div className="access-intro"><strong>Acceso protegido</strong><ShieldCheck size={20}/></div>
        <p className="access-description">Ingresa con tus credenciales para continuar.</p>
      </div>

      <form onSubmit={submit} className="access-form-card">
          <label className="access-field" htmlFor="login-email">
            <span className="access-field-icon"><Mail size={22}/></span>
            <span className="access-field-content"><strong>Correo electrónico</strong><Input id="login-email" value={email} onChange={(event)=>setEmail(event.target.value)} required type="email" inputMode="email" placeholder="ejemplo@empresa.com" autoComplete="email"/></span>
          </label>
          <label className="access-field" htmlFor="login-password">
            <span className="access-field-icon"><KeyRound size={21}/></span>
            <span className="access-field-content"><strong>Contraseña</strong><Input id="login-password" value={password} onChange={(event)=>setPassword(event.target.value)} required type={showPassword ? "text" : "password"} minLength={8} placeholder="Ingresa tu contraseña" autoComplete="current-password"/></span>
            <button className="access-password-toggle" type="button" onClick={()=>setShowPassword((visible)=>!visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={20}/> : <Eye size={20}/>}</button>
          </label>
          <div className="access-form-options">
            <label className="access-remember"><input type="checkbox" checked={remember} onChange={(event)=>setRemember(event.target.checked)}/><span><CheckCircle2 size={17}/> Recordarme en este dispositivo</span></label>
            <button type="button" onClick={resetPassword} disabled={resetBusy}>{resetBusy ? "Enviando…" : "¿Olvidaste tu contraseña?"}</button>
          </div>
          <Button className="access-submit" type="submit" disabled={busy}>{busy?<><LoaderCircle className="spin" size={19}/> Iniciando…</>:<><LogIn size={20}/> Iniciar sesión</>}</Button>
          <button className="access-create-account" type="button" onClick={()=>void openSignup()}>¿Primera vez? Crear una cuenta</button>
          {formMessage && <p className={`auth-message access-message auth-message-${formMessage.kind}`} role={formMessage.kind === "error" ? "alert" : "status"}>{formMessage.text}</p>}
      </form>

      <div className="access-security-note"><span><ShieldCheck size={24}/></span><p><strong>Tus datos están protegidos</strong><small>Usamos cifrado y buenas prácticas<br className="access-note-break"/> de seguridad empresarial.</small></p></div>

      <footer className="access-footer"><div><Store size={17}/><span>GRUPO CANAIMA · OPERACIONES</span></div><small>Versión 2.0.0</small></footer>
    </section>
    <Dialog open={signupOpen} onOpenChange={(open)=>!signupBusy&&setSignupOpen(open)}>
      <DialogContent className="user-dialog signup-dialog">
        <DialogHeader><div className="dialog-icon"><UserPlus size={21}/></div><DialogTitle>Crear cuenta</DialogTitle><DialogDescription>Regístrate como Empleado y selecciona la tienda donde trabajarás.</DialogDescription></DialogHeader>
        <form className="create-user-form" onSubmit={submitSignup}>
          <label>Nombre completo<Input value={signupForm.fullName} onChange={(event)=>setSignupForm({...signupForm,fullName:event.target.value})} placeholder="Nombre y apellido" autoComplete="name" required/></label>
          <label>Correo electrónico<Input value={signupForm.email} onChange={(event)=>setSignupForm({...signupForm,email:event.target.value})} type="email" inputMode="email" placeholder="empleado@empresa.com" autoComplete="email" required/></label>
          <label>Contraseña<Input value={signupForm.password} onChange={(event)=>setSignupForm({...signupForm,password:event.target.value})} type="password" minLength={8} placeholder="Mínimo 8 caracteres" autoComplete="new-password" required/></label>
          <label>Tienda asignada<Select value={signupForm.storeId} disabled={signupStoresLoading||!signupStores.length} onValueChange={(value)=>setSignupForm({...signupForm,storeId:value})}><SelectTrigger><SelectValue placeholder={signupStoresLoading?"Cargando tiendas…":"Seleccionar tienda"}/></SelectTrigger><SelectContent>{signupStores.map((store)=><SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent></Select></label>
          <div className="create-user-note"><ShieldCheck size={17}/><span>La cuenta se creará automáticamente como Empleado y quedará limitada a esta tienda.</span></div>
          {signupMessage&&<p className={`auth-message auth-message-${signupMessage.kind}`} role={signupMessage.kind==="error"?"alert":"status"}>{signupMessage.text}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={()=>setSignupOpen(false)} disabled={signupBusy}>Cancelar</Button><Button className="primary-action" type="submit" disabled={signupBusy||signupStoresLoading||!signupStores.length}>{signupBusy?<><LoaderCircle className="spin" size={17}/> Creando…</>:<><UserPlus size={17}/> Crear cuenta</>}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}

export default function Home() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>("scanner");
  const [lastProduct, setLastProduct] = useState<Product | null>(null);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null);
  const [manualCode, setManualCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Preparando cámara principal 1×…");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [catalogMeta, setCatalogMeta] = useState<CatalogMeta>(null);
  const [uploading, setUploading] = useState<UploadState | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback>(null);
  const [retryUploadFile, setRetryUploadFile] = useState<File|null>(null);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [evaluationItems, setEvaluationItems] = useState<EvaluationItem[]>([]);
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({ fullName:"", email:"", password:"", role:"employee" as RoleCode, storeId:"" });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [cachedProductCount, setCachedProductCount] = useState(0);
  const [validateSmallestSize, setValidateSmallestSize] = useState(false);
  const [sizeGate, setSizeGate] = useState<SizeGate>(null);
  const [dailyDate, setDailyDate] = useState(()=>dateInputValue());
  const [dailyStoreId, setDailyStoreId] = useState("");
  const [dailyRows, setDailyRows] = useState<DailyActivityRow[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [showDailyDetail, setShowDailyDetail] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState<StoreActivitySummary[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInFlightRef = useRef(false);
  const controlsRef = useRef<IScannerControls | null>(null);
  const cameraSessionRef = useRef(0);
  const lastScanRef = useRef({ code: "", at: 0 });
  const productLookupRef = useRef<Map<string, Promise<Product | null>>>(new Map());
  const activitySetupWarningRef = useRef(false);
  const evaluationIdRef = useRef<string | null>(null);
  const evaluationCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const productCacheRef = useRef<Map<string,Product>>(new Map());
  const productCacheStoreRef = useRef("");
  const productCacheReadyRef = useRef(false);
  const activeCatalogIdRef = useRef("");

  const currentStore = stores.find((item)=>item.id === storeId) ?? null;
  const isEvaluator = profile?.role === "manager" || profile?.role === "supervisor";
  const isOwner = Boolean(profile?.is_owner);
  const canSwitchStores = Boolean(isOwner || profile?.role === "manager");
  const canViewDaily = Boolean(isEvaluator || isOwner);
  const canViewAllDailyStores = canSwitchStores;
  const dailyVisibleStores = useMemo(()=>canViewAllDailyStores ? stores : stores.filter((store)=>store.id === (profile?.store_id || storeId)),[canViewAllDailyStores,profile?.store_id,storeId,stores]);
  const roleLabel = isOwner ? "Administrador general" : profile ? ROLE_LABELS[profile.role] : "";
  const displayName = profile?.full_name || "Usuario";
  const initials = displayName.split(/\s+/).slice(0,2).map((part)=>part[0]?.toUpperCase()).join("") || "GC";

  const hydrate = useCallback(async (userId: string) => {
    setBooting(true);
    const storesRequest = Promise.resolve(supabase.from("stores").select("id,name,slug").eq("is_active", true).order("name"));
    const { data: ownerProfileData, error: ownerProfileError } = await supabase.from("profiles").select("id,full_name,role,store_id,is_active,is_owner").eq("id", userId).maybeSingle();
    let profileData=ownerProfileData as Profile|null;
    if(ownerProfileError){
      const {data:fallbackProfile,error:fallbackError}=await supabase.from("profiles").select("id,full_name,role,store_id,is_active").eq("id",userId).maybeSingle();
      if(fallbackError||!fallbackProfile){setProfile(null);setBooting(false);return;}
      profileData={...(fallbackProfile as Omit<Profile,"is_owner">),is_owner:false};
    }
    if(!profileData){setProfile(null);setBooting(false);return;}
    const nextProfile = profileData;
    setProfile(nextProfile);
    const { data: storeData } = await storesRequest;
    const nextStores = (storeData ?? []) as StoreRecord[];
    setStores(nextStores);
    if (nextProfile.is_owner || nextProfile.role === "manager") setStoreId((current)=>nextStores.some((item)=>item.id === current) ? current : (nextProfile.store_id??nextStores[0]?.id??""));
    else setStoreId(nextProfile.store_id ?? "");
    setDailyStoreId(nextProfile.is_owner || nextProfile.role === "manager"?"all":(nextProfile.store_id??""));
    setBooting(false);
  }, []);

  useEffect(()=>{
    let mounted = true;
    let hydrationTimer: number | null = null;
    const applySession = (id: string | null) => {
      if (!mounted) return;
      setSessionUserId(id);
      setBooting(true);
      if (hydrationTimer !== null) window.clearTimeout(hydrationTimer);
      hydrationTimer = window.setTimeout(()=>{
        if (!mounted) return;
        if (id) void hydrate(id);
        else { setProfile(null); setStores([]); setStoreId(""); setBooting(false); }
      }, 0);
    };
    supabase.auth.getSession().then(({ data })=>{
      applySession(data.session?.user.id ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession)=>{
      applySession(nextSession?.user.id ?? null);
    });
    return ()=>{ mounted=false; if (hydrationTimer !== null) window.clearTimeout(hydrationTimer); listener.subscription.unsubscribe(); controlsRef.current?.stop(); };
  }, [hydrate]);

  const loadCatalogMeta = useCallback(async (targetStore: string) => {
    const { data } = await supabase.from("catalog_versions").select("id,file_name,row_count,activated_at").eq("store_id", targetStore).eq("status", "active").order("activated_at", { ascending:false }).limit(1).maybeSingle();
    activeCatalogIdRef.current=data?.id??"";
    setCatalogMeta(data ? { id:data.id, fileName:data.file_name, rowCount:data.row_count, activatedAt:data.activated_at } : null);
  }, []);

  const loadProductCache = useCallback(async (targetStore:string) => {
    productCacheStoreRef.current=targetStore;
    productCacheReadyRef.current=false;
    productCacheRef.current=new Map();
    setCachedProductCount(0);
    setCatalogLoading(true);
    const nextCache=new Map<string,Product>();
    let loadedProducts=0;
    let extendedColumns=true;
    const {data:activeCatalog,error:catalogError}=await supabase.from("catalog_versions").select("id").eq("store_id",targetStore).eq("status","active").order("activated_at",{ascending:false}).limit(1).maybeSingle();
    if(productCacheStoreRef.current!==targetStore)return;
    if(catalogError){setCatalogLoading(false);return;}
    activeCatalogIdRef.current=activeCatalog?.id??"";
    if(!activeCatalog){productCacheReadyRef.current=true;setCatalogLoading(false);return;}
    const pageSize=1000;
    for(let start=0;;start+=pageSize){
      let data:ProductRow[]|null=null;
      let error:{message:string}|null=null;
      if(extendedColumns){
        const primary=await supabase.from("products").select("id,store_id,barcode,article,description,color,size,style,amount,brand,category").eq("catalog_id",activeCatalog.id).eq("store_id",targetStore).order("id",{ascending:true}).range(start,start+pageSize-1);
        data=primary.data as ProductRow[]|null;error=primary.error;
        if(error&&/(brand|category)/i.test(error.message)){extendedColumns=false;const fallback=await supabase.from("products").select("id,store_id,barcode,article,description,color,size,style,amount").eq("catalog_id",activeCatalog.id).eq("store_id",targetStore).order("id",{ascending:true}).range(start,start+pageSize-1);data=fallback.data as ProductRow[]|null;error=fallback.error;}
      }else{
        const fallback=await supabase.from("products").select("id,store_id,barcode,article,description,color,size,style,amount").eq("catalog_id",activeCatalog.id).eq("store_id",targetStore).order("id",{ascending:true}).range(start,start+pageSize-1);data=fallback.data as ProductRow[]|null;error=fallback.error;
      }
      if(productCacheStoreRef.current!==targetStore)return;
      if(error){setCatalogLoading(false);return;}
      for(const row of data??[]){const product=productFromRow(row as ProductRow);const barcodeKey=normalizeBarcode(product.barcode);if(barcodeKey)nextCache.set(barcodeKey,product);loadedProducts+=1;}
      if((data?.length??0)<pageSize)break;
    }
    if(productCacheStoreRef.current!==targetStore)return;
    productCacheRef.current=nextCache;
    productCacheReadyRef.current=true;
    setCachedProductCount(loadedProducts);
    setCatalogLoading(false);
  },[]);

  const loadEvaluation = useCallback(async (targetStore: string, userId: string, enabled: boolean) => {
    if (!enabled) { evaluationIdRef.current=null; setEvaluationId(null); setEvaluationItems([]); return; }
    const { data: evaluation } = await supabase.from("evaluations").select("id").eq("store_id", targetStore).eq("created_by", userId).eq("status", "draft").order("created_at", { ascending:false }).limit(1).maybeSingle();
    if (!evaluation) { evaluationIdRef.current=null; setEvaluationId(null); setEvaluationItems([]); return; }
    evaluationIdRef.current=evaluation.id; setEvaluationId(evaluation.id);
    const { data: rows } = await supabase.from("evaluation_items").select("id,product_id,store_id,barcode,article,description,color,size,style,amount,observation,scanned_at").eq("evaluation_id", evaluation.id).order("scanned_at", { ascending:false });
    setEvaluationItems((rows ?? []).map((row)=>({ id:row.product_id, storeId:row.store_id, barcode:row.barcode ?? "", article:row.article, description:row.description ?? "", color:row.color ?? "No especificado", size:row.size ?? "No especificado", style:row.style ?? "No especificado", amount:Number(row.amount), brand:"No especificado", category:"No especificado", rowId:row.id, observation:row.observation as Observation, scannedAt:new Date(row.scanned_at).toLocaleTimeString("es", {hour:"numeric",minute:"2-digit"}) })));
  }, []);

  const loadManagedProfiles = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    const { data, error } = await supabase.rpc("owner_list_users");
    if (error) {
      setManagedProfiles([]);
      setUsersError("El módulo de usuarios todavía debe activarse en Supabase.");
      setUsersLoading(false);
      return;
    }
    const rows = (data ?? []) as Array<{ id:string; email:string|null; full_name:string|null; role:string; store_id:string|null; is_active:boolean; is_owner:boolean; created_at:string|null }>;
    setManagedProfiles(rows.map((row)=>({ ...row, role:row.role as RoleCode })));
    setUsersLoading(false);
  }, []);

  const loadDailyActivity = useCallback(async (targetDate:string,targetStore:string) => {
    if(!targetStore)return;
    setDailyLoading(true);
    setDailyError(null);
    const targetStores = targetStore === "all" ? dailyVisibleStores.map((store)=>store.id) : [targetStore];
    const responses = await Promise.all(targetStores.map((targetStoreId)=>supabase.rpc("daily_activity_rows",{target_date:targetDate,target_store:targetStoreId})));
    const failed = responses.find((response)=>response.error);
    if(failed?.error){setDailyRows([]);setDailyError("El Registro diario debe activarse en Supabase con el SQL incluido en esta versión.");setDailyLoading(false);return;}
    const rows=responses.flatMap((response)=>(response.data??[]) as Array<Record<string,unknown>>).map(dailyRowFromRpc).sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
    setDailyRows(rows);
    setDailyLoading(false);
  },[dailyVisibleStores]);

  const loadWeeklyActivity = useCallback(async (targetDate:string) => {
    if(!dailyVisibleStores.length)return;
    setWeeklyLoading(true);
    setWeeklyError(null);
    const range=caracasWeekRange(targetDate);
    const rows:ActivityCountRow[]=[];
    const pageSize=1000;
    for(let start=0;;start+=pageSize){
      let query=supabase.from("scan_activity").select("store_id,event_type,observation,created_at").gte("created_at",range.startIso).lt("created_at",range.endIso).order("created_at",{ascending:false}).range(start,start+pageSize-1);
      if(!canViewAllDailyStores&&dailyVisibleStores[0]?.id)query=query.eq("store_id",dailyVisibleStores[0].id);
      const {data,error}=await query;
      if(error){setWeeklySummary([]);setWeeklyError("No se pudo cargar el resumen semanal.");setWeeklyLoading(false);return;}
      for(const row of data??[])rows.push({storeId:String(row.store_id),eventType:row.event_type as DailyActivityRow["eventType"],observation:(row.observation as Observation|null)??null});
      if((data?.length??0)<pageSize)break;
    }
    setWeeklySummary(summarizeActivityByStore(rows,dailyVisibleStores));
    setWeeklyLoading(false);
  },[canViewAllDailyStores,dailyVisibleStores]);

  useEffect(()=>{
    if (!storeId || !sessionUserId) return;
    const task=window.setTimeout(()=>{
      void loadCatalogMeta(storeId);
      void loadProductCache(storeId);
      void loadEvaluation(storeId, sessionUserId, Boolean(isEvaluator));
    },0);
    return()=>window.clearTimeout(task);
  }, [storeId, sessionUserId, isEvaluator, loadCatalogMeta, loadProductCache, loadEvaluation]);

  useEffect(()=>{
    if (view !== "users" || !isOwner) return;
    const task=window.setTimeout(()=>void loadManagedProfiles(),0);
    return()=>window.clearTimeout(task);
  },[view,isOwner,loadManagedProfiles]);

  useEffect(()=>{
    if(view!=="daily"||!canViewDaily||!dailyStoreId)return;
    const task=window.setTimeout(()=>{
      void loadDailyActivity(dailyDate,dailyStoreId);
      void loadWeeklyActivity(dailyDate);
    },0);
    return()=>window.clearTimeout(task);
  },[view,canViewDaily,dailyDate,dailyStoreId,loadDailyActivity,loadWeeklyActivity]);

  useEffect(()=>{
    if(view!=="catalog"||uploading)return;
    const input=fileInputRef.current;
    if(!input)return;

    const recoveryTimers=new Set<number>();
    const receiveNativeFile=()=>consumeExcelInput(input);
    const clearPickingState=()=>{
      if(!importInFlightRef.current&&!input.files?.length)setExcelFileActivity(null);
    };
    const recoverReturnedFile=()=>{
      // Android puede restaurar el FileList uno o varios ciclos después de
      // volver del proveedor de documentos. Revisamos el control nativo sin
      // depender exclusivamente del evento sintético `change` de React.
      for(const delay of [0,120,400,900]){
        const timer=window.setTimeout(()=>{
          recoveryTimers.delete(timer);
          receiveNativeFile();
        },delay);
        recoveryTimers.add(timer);
      }
      const cleanupTimer=window.setTimeout(()=>{
        recoveryTimers.delete(cleanupTimer);
        clearPickingState();
      },1400);
      recoveryTimers.add(cleanupTimer);
    };
    const onVisibilityChange=()=>{
      if(document.visibilityState==="visible")recoverReturnedFile();
    };

    input.addEventListener("input",receiveNativeFile);
    input.addEventListener("change",receiveNativeFile);
    input.addEventListener("cancel",clearPickingState);
    window.addEventListener("focus",recoverReturnedFile);
    window.addEventListener("pageshow",recoverReturnedFile);
    document.addEventListener("visibilitychange",onVisibilityChange);

    return()=>{
      input.removeEventListener("input",receiveNativeFile);
      input.removeEventListener("change",receiveNativeFile);
      input.removeEventListener("cancel",clearPickingState);
      window.removeEventListener("focus",recoverReturnedFile);
      window.removeEventListener("pageshow",recoverReturnedFile);
      document.removeEventListener("visibilitychange",onVisibilityChange);
      recoveryTimers.forEach((timer)=>window.clearTimeout(timer));
    };
  // `consumeExcelInput` is a function declaration bound to the current render.
  // Session/store changes already rebind this effect through these dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view,uploading,sessionUserId,storeId]);

  function selectStore(nextStoreId:string){
    stopCamera();
    setLastProduct(null);
    setScanFeedback(null);
    setSizeGate(null);
    setCatalogMeta(null);
    setCachedProductCount(0);
    productCacheReadyRef.current=false;
    productCacheRef.current=new Map();
    activeCatalogIdRef.current="";
    productLookupRef.current.clear();
    setEvaluationItems([]);
    evaluationIdRef.current=null;
    evaluationCreatePromiseRef.current=null;
    setEvaluationId(null);
    setStoreId(nextStoreId);
  }

  async function updateManagedProfile(userId:string, patch:Partial<Pick<ManagedProfile,"role"|"store_id"|"is_active">>) {
    const target=managedProfiles.find((item)=>item.id===userId);
    if(!target)return;
    const nextRole=patch.role??target.role;
    const nextStore=patch.store_id!==undefined?patch.store_id:(target.store_id??stores[0]?.id??null);
    const nextActive=patch.is_active??target.is_active;
    if(target.is_owner&&(nextRole!=="supervisor"||!nextActive))return void toast.error("No puedes quitar el acceso del propietario");
    if(!nextStore)return void toast.error("Selecciona una tienda para esta cuenta");
    const previous=managedProfiles;
    setSavingUserId(userId);
    setManagedProfiles((items)=>items.map((item)=>item.id===userId?{...item,role:nextRole,store_id:nextStore,is_active:nextActive}:item));
    const {error}=await supabase.rpc("owner_update_user",{target_user:userId,target_role:nextRole,target_store:nextStore,target_active:nextActive});
    if(error){setManagedProfiles(previous);toast.error("No se pudo guardar el acceso",{description:error.message});}
    else toast.success("Acceso actualizado",{description:target.full_name||target.email||"Usuario"});
    setSavingUserId(null);
  }

  async function createManagedUser(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!isOwner)return;
    const fullName=newUser.fullName.trim(),email=newUser.email.trim().toLowerCase();
    const assignedStore=newUser.storeId||stores[0]?.id||null;
    if(!fullName||!email||newUser.password.length<8)return void toast.error("Completa correctamente todos los datos");
    if(!assignedStore)return void toast.error("Selecciona una tienda");
    setCreatingUser(true);
    try{
      const provisioningClient=createProvisioningClient();
      const {data,error}=await provisioningClient.auth.signUp({email,password:newUser.password,options:{data:{full_name:fullName,store_id:assignedStore}}});
      if(error)throw error;
      if(!data.user)throw new Error("No se recibió el identificador de la cuenta");
      const {error:profileUpdateError}=await supabase.rpc("owner_update_user",{target_user:data.user.id,target_role:newUser.role,target_store:assignedStore,target_active:true});
      if(profileUpdateError)throw profileUpdateError;
      setNewUser({fullName:"",email:"",password:"",role:"employee",storeId:""});
      setUserDialogOpen(false);
      await loadManagedProfiles();
      toast.success("Usuario creado",{description:`${fullName} recibirá un correo para confirmar su cuenta.`});
    }catch(error){toast.error("No se pudo crear el usuario",{description:error instanceof Error?error.message:"Intenta nuevamente."});}
    finally{setCreatingUser(false);}
  }

  async function ensureEvaluation() {
    if (evaluationIdRef.current) return evaluationIdRef.current;
    if (evaluationCreatePromiseRef.current) return evaluationCreatePromiseRef.current;
    if (!sessionUserId || !storeId || !isEvaluator) return null;
    evaluationCreatePromiseRef.current=(async()=>{
      const { data, error } = await supabase.from("evaluations").insert({ store_id:storeId, created_by:sessionUserId, status:"draft" }).select("id").single();
      if (error) { toast.error("No se pudo iniciar la evaluación"); return null; }
      evaluationIdRef.current=data.id; setEvaluationId(data.id); return data.id as string;
    })();
    try{return await evaluationCreatePromiseRef.current;}finally{evaluationCreatePromiseRef.current=null;}
  }

  async function logActivity(product:Product,options?:{source?:"scanner"|"evaluation";eventType?:DailyActivityRow["eventType"];evaluationItemId?:string;observation?:Observation|null;expectedSize?:string}){
    if(!sessionUserId||!storeId)return;
    const {error}=await supabase.from("scan_activity").insert({
      user_id:sessionUserId,store_id:storeId,product_id:product.id?String(product.id):null,evaluation_item_id:options?.evaluationItemId??null,
      source:options?.source??"scanner",event_type:options?.eventType??"SCAN",barcode:product.barcode,article:product.article,description:product.description,
      color:product.color,size:product.size,expected_size:options?.expectedSize??"",style:product.style,amount:product.amount,brand:product.brand,category:product.category,
      observation:options?.observation??null,
    });
    if(error&&!activitySetupWarningRef.current){activitySetupWarningRef.current=true;if(canViewDaily)toast.warning("Registro diario pendiente de activación",{description:"Ejecuta el SQL de esta versión en Supabase para conservar la actividad."});}
  }

  async function saveEvaluationProduct(product: Product) {
    const targetEvaluation = await ensureEvaluation();
    if (!targetEvaluation) return;
    const { data, error } = await supabase.from("evaluation_items").insert({ evaluation_id:targetEvaluation, store_id:storeId, product_id:product.id, barcode:product.barcode || null, article:product.article, description:product.description, color:product.color, size:product.size, style:product.style, amount:product.amount, observation:"SIN INCIDENCIAS" }).select("id,scanned_at").single();
    if (error) return void toast.error("No se pudo guardar el producto evaluado");
    setEvaluationItems((items)=>[{...product,rowId:data.id,observation:"SIN INCIDENCIAS",scannedAt:new Date(data.scanned_at).toLocaleTimeString("es",{hour:"numeric",minute:"2-digit"})},...items]);
    void logActivity(product,{source:"evaluation",evaluationItemId:data.id,observation:"SIN INCIDENCIAS"});
  }

  const lookupProduct = useCallback(async (normalized:string) => {
    const cached=productCacheStoreRef.current===storeId?productCacheRef.current.get(normalized):undefined;
    if(cached)return cached;
    const currentLookup=productLookupRef.current.get(normalized);
    if(currentLookup)return currentLookup;
    const request=(async()=>{
      let catalogId=activeCatalogIdRef.current;
      if(!catalogId){
        const {data}=await supabase.from("catalog_versions").select("id").eq("store_id",storeId).eq("status","active").order("activated_at",{ascending:false}).limit(1).maybeSingle();
        if(productCacheStoreRef.current!==storeId)return null;
        catalogId=data?.id??"";
        activeCatalogIdRef.current=catalogId;
      }
      if(!catalogId)return null;
      const primary=await supabase.from("products").select("id,store_id,barcode,article,description,color,size,style,amount,brand,category").eq("catalog_id",catalogId).eq("store_id",storeId).eq("barcode",normalized).limit(1).maybeSingle();
      let data=primary.data as ProductRow|null;let error:{message:string}|null=primary.error;
      if(error&&/(brand|category)/i.test(error.message)){const fallback=await supabase.from("products").select("id,store_id,barcode,article,description,color,size,style,amount").eq("catalog_id",catalogId).eq("store_id",storeId).eq("barcode",normalized).limit(1).maybeSingle();data=fallback.data as ProductRow|null;error=fallback.error;}
      if(error||!data||productCacheStoreRef.current!==storeId)return null;
      const product=productFromRow(data as ProductRow);
      productCacheRef.current.set(normalized,product);
      return product;
    })();
    productLookupRef.current.set(normalized,request);
    try{return await request;}finally{productLookupRef.current.delete(normalized);}
  },[storeId]);

  const registerCode = useCallback(async (rawCode: string, evaluation=false) => {
    if (!storeId) return;
    const normalized=normalizeBarcode(rawCode);
    if (!normalized) return;
    const product=await lookupProduct(normalized);
    if (!product) {
      if(sizeGate&&!evaluation){if(navigator.vibrate)navigator.vibrate([70,60,70]);return void toast.warning("Escáner pausado",{id:"size-gate",description:`Debes escanear primero la talla mínima ${sizeGate.expectedSize} para continuar.`});}
      const storeName=currentStore?.name??"esta tienda";
      setLastProduct(null);
      setScanFeedback({code:normalized,storeName});
      setManualCode("");
      if(navigator.vibrate)navigator.vibrate([70,60,70]);
      return void toast.warning("Código leído correctamente",{id:"scanner-result",description:`${normalized} no está incluido en el Excel activo de ${storeName}.`});
    }

    if(sizeGate&&!evaluation){
      if(!matchesExpectedMinimum(product,sizeGate.product,sizeGate.expectedSize)){if(navigator.vibrate)navigator.vibrate([70,60,70]);return void toast.warning("Escáner pausado",{id:"size-gate",description:`Debes escanear primero la talla mínima ${sizeGate.expectedSize} para continuar.`});}
      setSizeGate(null);setScanFeedback(null);setLastProduct(product);setManualCode("");toast.dismiss("size-gate");if(navigator.vibrate)navigator.vibrate(80);
      void logActivity(product);void logActivity(product,{eventType:"SIZE_RESOLVED",expectedSize:sizeGate.expectedSize});
      return void toast.success("Talla menor validada",{description:`${product.article} · talla ${product.size}`});
    }

    setScanFeedback(null);toast.dismiss("scanner-result");setLastProduct(product);setManualCode("");
    if(!evaluation&&validateSmallestSize){
      const validation=findMinimumSize(product,productCacheRef.current.values());
      if(validation.status==="not-minimum"){
        setSizeGate({product,expectedSize:validation.expectedSize});
        if(navigator.vibrate)navigator.vibrate([70,60,70]);
        void logActivity(product);
        return void toast.warning("Talla menor requerida",{id:"size-gate",description:`La talla esperada para ${product.article} · ${product.color} es ${validation.expectedSize}.`});
      }
      if(validation.status==="unknown")toast.info("Validación de talla no aplicada",{description:validation.reason});
    }
    if(navigator.vibrate)navigator.vibrate(80);
    if(evaluation)void saveEvaluationProduct(product);else void logActivity(product);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storeId,currentStore?.name,lookupProduct,sizeGate,validateSmallestSize,isEvaluator,sessionUserId]);

  function releaseCameraStream(){
    controlsRef.current?.stop();
    controlsRef.current=null;
    const stream=videoRef.current?.srcObject;
    if(stream instanceof MediaStream)stream.getTracks().forEach((track)=>track.stop());
    if(videoRef.current)videoRef.current.srcObject=null;
  }

  async function refocusActiveCamera(){
    const stream=videoRef.current?.srcObject;
    if(!(stream instanceof MediaStream))return;
    const track=stream.getVideoTracks()[0];
    if(!track||track.readyState!=="live")return;
    setCameraStatus("Reenfocando cámara principal 1×…");
    const focused=await focusCameraTrack(track,true);
    if(track.readyState!=="live")return;
    const settings=track.getSettings();
    const quality=settings.width&&settings.height?` · ${settings.width}×${settings.height}`:"";
    setCameraStatus(focused?`Cámara principal 1× · enfoque continuo${quality}`:`Cámara trasera principal 1×${quality}`);
  }

  async function startCamera(evaluation=false){
    const cameraSession=++cameraSessionRef.current;
    releaseCameraStream();
    setCameraStatus("Preparando cámara principal 1×…");
    setCameraOpen(true);
    try{
      let videoElement:HTMLVideoElement|null=null;
      for(let attempt=0;attempt<12&&!videoElement;attempt+=1){
        await new Promise<void>((resolve)=>requestAnimationFrame(()=>resolve()));
        videoElement=videoRef.current;
      }
      if(!videoElement)throw new Error("No se pudo preparar la vista de la cámara");

      const stream=await navigator.mediaDevices.getUserMedia(cameraConstraints());

      if(cameraSession!==cameraSessionRef.current){stream.getTracks().forEach((track)=>track.stop());return;}
      const optimization=await optimizeCamera(stream,videoElement);
      const reader=new BrowserMultiFormatOneDReader(undefined,{delayBetweenScanAttempts:35,delayBetweenScanSuccess:60});
      reader.possibleFormats=GARMENT_BARCODE_FORMATS;
      const quality=optimization.width&&optimization.height?` · ${optimization.width}×${optimization.height}`:"";
      setCameraStatus(optimization.focus?`Cámara principal 1× · enfoque continuo${quality}`:`Cámara trasera principal 1×${quality}`);
      controlsRef.current=await reader.decodeFromStream(stream,videoElement,(result)=>{
        if(!result)return;
        const scanned=normalizeBarcode(result.getText()),now=Date.now();
        if(!scanned)return;
        if(scanned===lastScanRef.current.code&&now-lastScanRef.current.at<900){lastScanRef.current.at=now;return;}
        lastScanRef.current={code:scanned,at:now};
        void registerCode(scanned,evaluation);
      });
    }
    catch(error){
      if(cameraSession!==cameraSessionRef.current)return;
      releaseCameraStream();
      setCameraOpen(false);
      const name=error instanceof DOMException?error.name:"";
      const description=name==="NotAllowedError"
        ? "Permite el acceso a la cámara en el navegador y vuelve a intentarlo."
        : name==="NotFoundError"
          ? "No se encontró una cámara trasera disponible."
          : "Cierra otras aplicaciones que usen la cámara y vuelve a intentarlo.";
      toast.error("No se pudo abrir la cámara",{description});
    }
  }
  function stopCamera(){cameraSessionRef.current+=1;releaseCameraStream();setCameraOpen(false);}
  function goTo(next:View){if(next==="daily"&&!canViewDaily)return;if(next==="users"&&!isOwner)return;stopCamera();setView(next);setMobileMenu(false);}

  async function registerSmallerSizeNotDisplayed(){
    if(!sizeGate)return;
    await logActivity(sizeGate.product,{eventType:"SIZE_NOT_DISPLAYED",expectedSize:sizeGate.expectedSize});
    const article=sizeGate.product.article;
    setSizeGate(null);toast.dismiss("size-gate");if(navigator.vibrate)navigator.vibrate(80);
    toast.success("Incidencia registrada",{description:`${article}: talla menor no exhibida.`});
  }

  function consumeExcelInput(input:HTMLInputElement){
    if(importInFlightRef.current)return;
    const file=input.files?.item(0);
    if(!file)return;
    if(!sessionUserId||!storeId){
      const message=!sessionUserId?"Tu sesión no está disponible. Inicia sesión nuevamente antes de cargar el archivo.":"Selecciona la tienda que recibirá este catálogo.";
      setUploadFeedback({kind:"error",title:"No se pudo iniciar la carga",message});
      toast.error("No se pudo iniciar la carga",{description:message});
      input.value="";
      setExcelFileActivity(null);
      return;
    }
    setRetryUploadFile(file);
    importInFlightRef.current=true;
    void importExcel(file).finally(()=>{
      importInFlightRef.current=false;
      if(fileInputRef.current===input)input.value="";
    });
  }

  function handleExcelSelection(event:ChangeEvent<HTMLInputElement>|FormEvent<HTMLInputElement>){
    consumeExcelInput(event.currentTarget);
  }

  async function importExcel(file:File){
    if(!sessionUserId||!storeId)return;
    setExcelFileActivity("importing");
    const targetUserId=sessionUserId;
    const targetStoreId=storeId;
    const targetStoreName=currentStore?.name??"la tienda seleccionada";
    let catalogId:string|null=null;
    const fileName=file.name;
    setUploadFeedback(null);
    setUploading({stage:"selected",fileName,done:0,total:0});
    try{
      if(file.size>20*1024*1024)throw new Error("El archivo supera el máximo permitido de 20 MB.");
      if(!/\.(xlsx|xls)$/i.test(fileName))throw new Error("Selecciona un archivo de Excel con extensión .XLSX o .XLS.");
      const fileBytesPromise=file.arrayBuffer();
      setUploading({stage:"reading",fileName,done:0,total:0});
      await new Promise<void>((resolve)=>requestAnimationFrame(()=>resolve()));
      const [fileBytes,excelModules]=await Promise.all([
        fileBytesPromise,
        Promise.all([import("xlsx"),import("@/app/lib/catalog-import")]),
      ]);
      setUploading({stage:"parsing",fileName,done:0,total:0});
      await new Promise<void>((resolve)=>setTimeout(resolve,0));
      const [{read},{parseCatalogWorkbook}]=excelModules;
      const workbook=read(fileBytes,{type:"array",cellDates:false});
      const parsed=parseCatalogWorkbook(workbook);
      const {products}=parsed;
      setUploading({stage:"preparing",fileName,done:0,total:products.length});
      const {data:version,error:versionError}=await supabase.from("catalog_versions").insert({store_id:targetStoreId,file_name:file.name,row_count:0,status:"uploading",uploaded_by:targetUserId}).select("id").single();
      if(versionError)throw versionError;catalogId=version.id;
      const batchSize=150;
      for(let start=0;start<products.length;start+=batchSize){
        const batch=products.slice(start,start+batchSize).map((product)=>({...product,catalog_id:catalogId,store_id:targetStoreId}));
        let pending=batch;
        for(let attempt=0;attempt<3&&pending.length;attempt+=1){
          let {error}=await supabase.from("products").insert(pending);
          if(error&&/(brand|category)/i.test(error.message)){
            const compatibleBatch=pending.map((product)=>{
              const compatibleProduct={...product} as Partial<typeof product>;
              delete compatibleProduct.brand;
              delete compatibleProduct.category;
              return compatibleProduct;
            });
            ({error}=await supabase.from("products").insert(compatibleBatch));
          }
          if(!error){pending=[];break;}
          if(!transientUploadError(error)&&error.code!=="23505")throw error;

          const {data:existing,error:verifyError}=await supabase.from("products").select("barcode").eq("catalog_id",catalogId).in("barcode",pending.map((product)=>product.barcode));
          if(!verifyError){
            const uploaded=new Set((existing??[]).map((row)=>normalizeBarcode(row.barcode)));
            pending=pending.filter((product)=>!uploaded.has(product.barcode));
            if(!pending.length)break;
          }
          if(attempt===2)throw error;
          await waitForRetry(450*(attempt+1));
        }
        setUploading({stage:"uploading",fileName,done:Math.min(start+batch.length,products.length),total:products.length});
      }
      const {error:readyError}=await supabase.from("catalog_versions").update({status:"ready",row_count:products.length}).eq("id",catalogId);if(readyError)throw readyError;
      setUploading({stage:"activating",fileName,done:products.length,total:products.length});
      const {error:activateError}=await supabase.rpc("activate_catalog",{target_catalog:catalogId});if(activateError)throw activateError;
      setUploading({stage:"caching",fileName,done:products.length,total:products.length});
      await Promise.all([loadCatalogMeta(targetStoreId),loadProductCache(targetStoreId)]);
      setSizeGate(null);
      setLastProduct(null);
      setScanFeedback(null);
      toast.dismiss("size-gate");
      const details=[`${products.length.toLocaleString("es-ES")} productos listos para escanear en ${targetStoreName}.`];
      if(parsed.skippedRows)details.push(`${parsed.skippedRows.toLocaleString("es-ES")} filas sin código fueron omitidas.`);
      if(parsed.duplicateRows)details.push(`${parsed.duplicateRows.toLocaleString("es-ES")} códigos repetidos fueron omitidos.`);
      if(parsed.unavailableRows)details.push(`${parsed.unavailableRows.toLocaleString("es-ES")} variantes sin existencia fueron excluidas del cálculo de talla menor.`);
      const message=details.join(" ");
      setUploadFeedback({kind:"success",title:"Excel cargado correctamente",message});
      setRetryUploadFile(null);
      toast.success("Catálogo activado",{description:message});
    }catch(error){
      if(catalogId){
        const {error:discardError}=await supabase.rpc("discard_catalog",{target_catalog:catalogId});
        if(discardError)await supabase.from("catalog_versions").update({status:"failed"}).eq("id",catalogId);
      }
      setRetryUploadFile(file);
      const {getImportErrorMessage}=await import("@/app/lib/catalog-import");
      const message=getImportErrorMessage(error);
      setUploadFeedback({kind:"error",title:"No se pudo cargar el Excel",message});
      toast.error("No se pudo cargar el catálogo",{description:message});
    }
    finally{setUploading(null);setExcelFileActivity(null);}
  }

  const uploadPercent=uploading?uploading.stage==="selected"?3:uploading.stage==="reading"?8:uploading.stage==="parsing"?18:uploading.stage==="preparing"?25:uploading.stage==="uploading"?25+Math.round((uploading.done/Math.max(uploading.total,1))*60):uploading.stage==="activating"?92:97:0;
  const uploadLabel=uploading?uploading.stage==="selected"?"Archivo seleccionado":uploading.stage==="reading"?"Leyendo el archivo…":uploading.stage==="parsing"?"Identificando columnas y productos…":uploading.stage==="preparing"?"Preparando el catálogo de la tienda…":uploading.stage==="uploading"?`Subiendo ${uploading.done.toLocaleString("es-ES")} de ${uploading.total.toLocaleString("es-ES")}`:uploading.stage==="activating"?"Activando precios y productos…":"Preparando el escaneo instantáneo…":"";

  async function addWithoutLabel(){
    const targetEvaluation=await ensureEvaluation();if(!targetEvaluation)return;
    const {data,error}=await supabase.from("evaluation_items").insert({evaluation_id:targetEvaluation,store_id:storeId,product_id:null,barcode:null,article:"SIN CÓDIGO",description:"Producto sin identificar",color:"No especificado",size:"No especificado",style:"No especificado",amount:0,observation:"SIN ETIQUETA"}).select("id,scanned_at").single();
    if(error)return void toast.error("No se pudo registrar el producto");
    const product:Product={id:null,storeId,barcode:"",article:"SIN CÓDIGO",description:"Producto sin identificar",color:"No especificado",size:"No especificado",style:"No especificado",amount:0,brand:"No especificado",category:"No especificado"};
    setEvaluationItems((items)=>[{...product,rowId:data.id,observation:"SIN ETIQUETA",scannedAt:new Date(data.scanned_at).toLocaleTimeString("es",{hour:"numeric",minute:"2-digit"})},...items]);
    void logActivity(product,{source:"evaluation",evaluationItemId:data.id,observation:"SIN ETIQUETA"});
    toast.success("Producto sin etiqueta registrado");
  }
  async function changeObservation(rowId:string,observation:Observation){const previous=evaluationItems;setEvaluationItems((items)=>items.map((item)=>item.rowId===rowId?{...item,observation}:item));const {error}=await supabase.from("evaluation_items").update({observation}).eq("id",rowId);if(error){setEvaluationItems(previous);toast.error("No se guardó la observación");return false;}await supabase.from("scan_activity").update({observation}).eq("evaluation_item_id",rowId);return true;}
  async function deleteEvaluationItem(rowId:string){const {error}=await supabase.from("evaluation_items").delete().eq("id",rowId);if(error)return void toast.error("No se pudo eliminar");await supabase.from("scan_activity").delete().eq("evaluation_item_id",rowId);setEvaluationItems((items)=>items.filter((item)=>item.rowId!==rowId));}

  const latestScannedEvaluationItem=useMemo(()=>evaluationItems.find((item)=>item.id!==null)??null,[evaluationItems]);
  async function markLatestScannedProduct(observation:Extract<Observation,"PRECIO ERRÓNEO"|"MAL ETIQUETADO">){
    if(!latestScannedEvaluationItem)return void toast.warning("Escanea un producto primero");
    if(await changeObservation(latestScannedEvaluationItem.rowId,observation))toast.success("Observación actualizada",{description:`${latestScannedEvaluationItem.article}: ${observation.toLocaleLowerCase("es")}.`});
  }

  const summary=useMemo(()=>summarizeEvaluation(evaluationItems),[evaluationItems]);
  const userStats=useMemo(()=>({
    employees:managedProfiles.filter((item)=>item.role==="employee").length,
    managers:managedProfiles.filter((item)=>item.role==="manager").length,
    supervisors:managedProfiles.filter((item)=>item.role==="supervisor").length,
    pending:managedProfiles.filter((item)=>!item.is_active||(!item.is_owner&&!item.store_id)).length,
  }),[managedProfiles]);
  const dailySummary=useMemo(()=>summarizeDailyActivity(dailyRows),[dailyRows]);
  const dailyIncidentRows=useMemo(()=>dailyRows.filter(isActivityIncident),[dailyRows]);
  const displayedDailyRows=showDailyDetail?dailyRows:dailyIncidentRows;
  const dailyScopeName=dailyStoreId==="all"?"Todas las tiendas":(stores.find((store)=>store.id===dailyStoreId)?.name??currentStore?.name??"Tienda");
  const weeklyRange=useMemo(()=>caracasWeekRange(dailyDate),[dailyDate]);
  const weeklyRangeLabel=`${formatShortDate(weeklyRange.startDate)} – ${formatShortDate(new Date(new Date(`${weeklyRange.endDateExclusive}T00:00:00.000Z`).getTime()-86_400_000).toISOString().slice(0,10))}`;
  async function exportEvaluation(){
    const {AlignmentType,BorderStyle,Document,Packer,Paragraph,Table,TableCell,TableRow,TextRun,WidthType}=await import("docx");
    const borders={top:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"},bottom:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"},left:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"},right:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"}};const cell=(value:string,bold=false)=>new TableCell({borders,children:[new Paragraph({children:[new TextRun({text:value,bold})]})]});
    const doc=new Document({sections:[{children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"GRUPO CANAIMA",bold:true,size:30,color:"073F5C"})]}),new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"INFORME DE EVALUACIÓN DE PRODUCTOS",bold:true,size:25})]}),new Paragraph(""),new Paragraph({children:[new TextRun({text:"Nombre de la empresa: ____________________________________",bold:true})]}),new Paragraph({children:[new TextRun({text:"Fecha: ____________________",bold:true})]}),new Paragraph(`Tienda evaluada: ${currentStore?.name??""}`),new Paragraph(""),new Paragraph("El presente documento contiene el resultado obtenido durante la evaluación realizada a los productos de la tienda indicada, conforme a las observaciones registradas durante el proceso de verificación."),new Paragraph(""),new Paragraph({children:[new TextRun({text:"Resumen de observaciones",bold:true,size:24,color:"073F5C"})]}),new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({children:[cell("Observación",true),cell("Cantidad",true)]}),...summary.map((item)=>new TableRow({children:[cell(item.observation),cell(String(item.count))]}))]}),new Paragraph(""),new Paragraph({children:[new TextRun({text:"Detalle de productos evaluados",bold:true,size:24,color:"073F5C"})]}),new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({children:[cell("Artículo",true),cell("Producto",true),cell("Monto",true),cell("Observación",true)]}),...evaluationItems.map((item)=>new TableRow({children:[cell(item.article),cell(item.description),cell(money.format(item.amount)),cell(item.observation)]}))]}),new Paragraph(""),new Paragraph(""),new Paragraph("________________________      ________________________      ________________________"),new Paragraph("Gerente de tienda 1                Gerente de tienda 2                Supervisor")]}]});
    const blob=await Packer.toBlob(doc),href=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=href;anchor.download=`Evaluacion_${(currentStore?.name??"tienda").replace(/[^a-z0-9]+/gi,"_")}.docx`;anchor.click();setTimeout(()=>URL.revokeObjectURL(href),1000);toast.success("Informe editable generado");
  }

  async function signOut(){stopCamera();setLastProduct(null);setScanFeedback(null);setEvaluationItems([]);await supabase.auth.signOut();}

  if(booting)return <main className="loading-screen"><Image src="/canaima-logo.svg" alt="Grupo Canaima" width={480} height={250} priority/><LoaderCircle className="spin" size={26}/><span>Preparando ScanControl…</span></main>;
  if(!sessionUserId)return <LoginScreen/>;
  if(!profile||!profile.is_active||!storeId)return <main className="pending-screen"><Toaster position="top-center" richColors/><section><div className="pending-icon"><UserRound size={34}/></div><h1>Cuenta pendiente de asignación</h1><p>Romer debe asignar una tienda activa antes de que puedas utilizar ScanControl.</p><Button variant="outline" onClick={signOut}><LogOut size={17}/> Cerrar sesión</Button></section></main>;

  return <div className="app-shell"><Toaster position="top-center" richColors/>
    {mobileMenu&&<button className="drawer-backdrop" type="button" aria-label="Cerrar menú" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?"sidebar-open":""}`}>
      <div className="brand-block"><Image src="/canaima-logo-sidebar.svg" alt="Grupo Canaima" className="brand-logo" width={520} height={100}/><button className="mobile-close" onClick={()=>setMobileMenu(false)} aria-label="Cerrar menú"><X size={20}/></button></div>
      <div className="product-name"><span>SCANCONTROL</span><small>Control inteligente de productos</small></div>
      <nav className="nav-list"><NavItem icon={ScanLine} label="Escanear producto" active={view==="scanner"} onClick={()=>goTo("scanner")}/>{isEvaluator&&<NavItem icon={ClipboardCheck} label="Evaluación" active={view==="evaluation"} onClick={()=>goTo("evaluation")}/>} {canViewDaily&&<NavItem icon={CalendarDays} label="Registro diario" active={view==="daily"} onClick={()=>goTo("daily")}/>}<NavItem icon={FileSpreadsheet} label="Catálogo Excel" active={view==="catalog"} onClick={()=>goTo("catalog")}/>{isOwner&&<NavItem icon={Users} label="Usuarios y permisos" active={view==="users"} onClick={()=>goTo("users")}/>}</nav>
      <div className="sidebar-store"><div className="store-mark"><Building2 size={18}/></div><div><span>Tienda activa</span><strong>{currentStore?.name??"Seleccionar tienda"}</strong></div></div><button className="sidebar-user" type="button" onClick={signOut}><div className="avatar">{initials}</div><div><strong>{displayName}</strong><span>{roleLabel}</span></div><LogOut size={18}/></button>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div className="topbar-brand" aria-label="Grupo Canaima ScanControl">
          <Image src="/canaima-logo.svg" alt="Grupo Canaima" width={480} height={250}/>
          <strong>ScanControl</strong>
        </div>
        <div className="topbar-controls">
          {canSwitchStores&&view!=="users"?<>
            <div className="desktop-store-switcher"><Select value={storeId} onValueChange={selectStore}><SelectTrigger className="store-select"><Store size={16}/><SelectValue placeholder="Seleccionar tienda"/></SelectTrigger><SelectContent>{stores.map((item)=><SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <label className="mobile-store-switcher" aria-label="Seleccionar tienda" title={currentStore?.name}><Store size={18}/><span>{currentStore?.name??"Tienda"}</span><select value={storeId} onChange={(event)=>selectStore(event.target.value)} aria-label="Seleccionar tienda">{stores.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </>:<div className="topbar-current-store"><Store size={17}/><span>{currentStore?.name??"Seleccionar tienda"}</span></div>}
        </div>
        <button className="profile-menu-button" onClick={()=>setMobileMenu(true)} type="button" aria-label={`Abrir menú de ${displayName}`}><span>{initials}</span><i/></button>
      </header>

      {view==="scanner"&&<section className="page-content scanner-layout">
        <div className="scan-panel">
          <div className="section-heading"><div><Badge className="status-badge"><span className={`status-dot ${catalogLoading?"status-dot-loading":""}`}/> {catalogLoading?"Preparando catálogo…":`Lector instantáneo · ${cachedProductCount.toLocaleString("es-ES")} productos`}</Badge><h2>Escaneo continuo</h2><p>Apunta la cámara al código. El resultado aparecerá al instante y el lector seguirá activo.</p></div><div className="store-pill"><Store size={16}/><span>{currentStore?.name}</span></div></div>
          <div className={`size-validation-control ${validateSmallestSize?"is-active":""}`}><span><Ruler size={19}/></span><div><strong>Validar talla menor</strong><small>{validateSmallestSize?"Validación activa: el escáner comprobará la talla mínima.":"Comprueba la talla mínima del mismo artículo y color."}</small></div><div className="size-validation-toggle"><b>{validateSmallestSize?"ACTIVA":"INACTIVA"}</b><Switch className="size-validation-switch" checked={validateSmallestSize} disabled={Boolean(sizeGate)} onCheckedChange={setValidateSmallestSize} aria-label="Validar talla menor"/></div></div>
          {cameraOpen?<div className="camera-stage"><video ref={videoRef} className="camera-video" muted playsInline onClick={()=>void refocusActiveCamera()} title="Toca la imagen para reenfocar"/><div className="camera-mode" aria-live="polite"><Camera size={14}/>{cameraStatus}</div><div className="scan-frame"><span/><span/><span/><span/><i/></div><button className="camera-close" onClick={stopCamera}><X size={18}/> Detener</button></div>:<button className="scanner-target" onClick={()=>startCamera(false)}><div className="scanner-corners"><span/><span/><span/><span/></div><div className="scanner-icon"><Barcode size={48}/></div><strong>Toca para activar la cámara</strong><small>Cámara principal 1× · EAN, UPC y Code 128</small></button>}
        </div>
        <div className={`result-panel ${lastProduct?(sizeGate?"result-blocked":""):scanFeedback?"result-missing":"result-empty"}`}>{lastProduct?<><div className="price-block"><span>MONTO A PAGAR</span><strong>{money.format(lastProduct.amount)}</strong><small>Precio individual en dólares</small></div><div className="result-success"><CheckCircle2 size={20}/><span>{sizeGate?"Producto identificado · falta validar talla":"Producto encontrado"}</span><small>Último escaneo</small></div><div className="result-product"><div className="product-icon"><PackageSearch size={36}/></div><div><span>CÓDIGO DE BARRAS · {lastProduct.barcode}</span><h2>{lastProduct.article}</h2><p>{lastProduct.description}</p></div></div><div className="product-grid"><div><span>COLOR</span><strong>{lastProduct.color}</strong></div><div className={sizeGate?"size-alert":""}><span>TALLA</span><strong>{lastProduct.size}</strong>{sizeGate&&<small>Esperada: {sizeGate.expectedSize}</small>}</div><div className="wide"><span>ESTILO</span><strong>{lastProduct.style}</strong></div></div>{sizeGate?<div className="size-gate-card" role="alert"><TriangleAlert size={23}/><div><strong>Escáner pausado por validación de talla</strong><p>Debes escanear primero la talla mínima <b>{sizeGate.expectedSize}</b> para continuar.</p></div><Button onClick={()=>void registerSmallerSizeNotDisplayed()} variant="outline"><Ruler size={17}/> Talla menor no exhibida</Button></div>:<div className="auto-note"><Camera size={18}/><p><strong>Listo para el siguiente producto</strong><span>No necesitas presionar ningún botón.</span></p><b/></div>}</>:scanFeedback?<div className="missing-product"><div className="missing-head"><Barcode size={21}/><div><strong>Código leído correctamente</strong><span>El lector y la cámara están funcionando</span></div></div><div className="missing-code"><span>CÓDIGO CAPTURADO</span><strong>{scanFeedback.code}</strong></div><div className="missing-copy"><h3>Esta prenda no está en el Excel activo</h3><p>No es posible mostrar artículo, color, talla, estilo ni precio porque el archivo de <strong>{scanFeedback.storeName}</strong> no contiene este código.</p></div><div className="missing-note"><FileSpreadsheet size={20}/><span>Carga el inventario que incluya esta prenda o comprueba que corresponda a la tienda seleccionada.</span></div></div>:<div className="empty-product"><PackageSearch size={44}/><h3>Esperando un producto</h3><p>El resultado aparecerá aquí después del primer escaneo.</p></div>}</div>
        <div className="manual-entry scanner-manual"><div><i/><span>o introduce el código</span><i/></div><div className="manual-controls"><Input value={manualCode} onChange={(event)=>setManualCode(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&void registerCode(manualCode)} placeholder="Ej. 9880007937124" inputMode="numeric"/><Button onClick={()=>void registerCode(manualCode)}>Verificar</Button></div></div>
      </section>}

      {view==="evaluation"&&isEvaluator&&<section className="page-content evaluation-page">
        <div className="evaluation-toolbar">
          <div><Badge variant="outline">{evaluationId?"Evaluación en curso":"Lista para iniciar"}</Badge><h2>Registro de verificación</h2><p>Cada lectura se guarda con “Sin incidencias” y puede corregirse al instante.</p></div>
          <div className="toolbar-actions">
            <Button className="without-label-button" variant="outline" onClick={addWithoutLabel}><Hand size={17}/> Registrar sin etiqueta</Button>
            <Button onClick={()=>startCamera(true)}><Camera size={17}/> Escanear continuamente</Button>
          </div>
        </div>
        {cameraOpen&&<div className="evaluation-camera"><video ref={videoRef} muted playsInline onClick={()=>void refocusActiveCamera()} title="Toca la imagen para reenfocar"/><div><strong>{cameraStatus}</strong><span>Los productos se agregan y guardan automáticamente.</span></div><Button variant="outline" onClick={stopCamera}>Detener</Button></div>}
        <div className="incident-panel">
          <div className="incident-copy"><span>ÚLTIMO PRODUCTO</span>{latestScannedEvaluationItem?<><h3>{latestScannedEvaluationItem.description} · {latestScannedEvaluationItem.article}</h3><div className="evaluation-product-details"><span>Color <b>{latestScannedEvaluationItem.color}</b></span><span>Talla <b>{latestScannedEvaluationItem.size}</b></span><span>Estilo <b>{latestScannedEvaluationItem.style}</b></span></div><strong className="incident-price">{money.format(latestScannedEvaluationItem.amount)}</strong><p>Observación del último escaneo</p></>:<p>Escanea un producto para poder marcar una incidencia.</p>}</div>
          {latestScannedEvaluationItem&&<div className="incident-selector"><span>Observación</span><Select value={latestScannedEvaluationItem.observation} onValueChange={(value)=>void changeObservation(latestScannedEvaluationItem.rowId,value as Observation)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{OBSERVATIONS.map((observation)=><SelectItem key={observation} value={observation}>{observation}</SelectItem>)}</SelectContent></Select></div>}
          <div className="incident-actions">
            <Button className={`incident-button ${latestScannedEvaluationItem?.observation==="PRECIO ERRÓNEO"?"is-active":""}`} variant="outline" disabled={!latestScannedEvaluationItem} aria-pressed={latestScannedEvaluationItem?.observation==="PRECIO ERRÓNEO"} onClick={()=>void markLatestScannedProduct("PRECIO ERRÓNEO")}><CircleDollarSign size={18}/> Precio erróneo</Button>
            <Button className={`incident-button ${latestScannedEvaluationItem?.observation==="MAL ETIQUETADO"?"is-active":""}`} variant="outline" disabled={!latestScannedEvaluationItem} aria-pressed={latestScannedEvaluationItem?.observation==="MAL ETIQUETADO"} onClick={()=>void markLatestScannedProduct("MAL ETIQUETADO")}><Tags size={18}/> Mal etiquetado</Button>
          </div>
        </div>
        <div className="summary-grid"><div className="summary-total"><span className="summary-icon" aria-hidden="true"><ClipboardCheck size={20}/></span><span>EVALUADOS</span><strong>{evaluationItems.length}</strong></div>{summary.map((item)=><div key={item.observation}><EvaluationSummaryIcon observation={item.observation}/><span>{item.observation}</span><strong>{item.count}</strong></div>)}</div>
        <div className="data-card"><div className="data-card-head"><div><strong>Productos evaluados</strong><span>{evaluationItems.length} registros guardados</span></div><Button variant="outline" onClick={exportEvaluation} disabled={!evaluationItems.length}><Download size={17}/> Descargar Word editable</Button></div><div className="evaluation-table-wrap"><table className="evaluation-table"><thead><tr><th>Código / artículo</th><th>Descripción</th><th>Detalles</th><th>Monto</th><th>Observación</th><th/></tr></thead><tbody>{evaluationItems.length?evaluationItems.map((item)=><tr key={item.rowId}><td><strong>{item.article}</strong><span>{item.scannedAt}</span></td><td>{item.description}</td><td>{item.color} · {item.size}</td><td><strong>{money.format(item.amount)}</strong></td><td><Select value={item.observation} onValueChange={(value)=>void changeObservation(item.rowId,value as Observation)}><SelectTrigger className="observation"><SelectValue/></SelectTrigger><SelectContent>{OBSERVATIONS.map((observation)=><SelectItem key={observation} value={observation}>{observation}</SelectItem>)}</SelectContent></Select></td><td><button className="delete-row" onClick={()=>void deleteEvaluationItem(item.rowId)} aria-label={`Eliminar ${item.article}`}><X size={16}/></button></td></tr>):<tr><td colSpan={6} className="empty-table">Aún no hay productos en esta evaluación.</td></tr>}</tbody></table></div></div>
      </section>}

      {view==="daily"&&canViewDaily&&<section className="page-content daily-page">
        <div className="daily-header">
          <div><Badge variant="outline"><CalendarDays size={14}/> Control operativo</Badge><h2>Registro diario</h2><p>Resumen de fallos por tienda, con el detalle completo disponible cuando lo necesites.</p></div>
          <div className="daily-filters">
            {canViewAllDailyStores?<label>Tienda<Select value={dailyStoreId} onValueChange={(value)=>{setShowDailyDetail(false);setDailyStoreId(value);}}><SelectTrigger className="daily-store-select"><Store size={16}/><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">Todas las tiendas</SelectItem>{dailyVisibleStores.map((store)=><SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent></Select></label>:<label>Tienda<div className="daily-fixed-store"><Store size={16}/><span>{dailyScopeName}</span></div></label>}
            <label>Fecha<Input type="date" value={dailyDate} onChange={(event)=>{setShowDailyDetail(false);setDailyDate(event.target.value);}}/></label>
            <Button variant="outline" onClick={()=>{void loadDailyActivity(dailyDate,dailyStoreId);void loadWeeklyActivity(dailyDate);}} disabled={dailyLoading||weeklyLoading}><RefreshCw className={dailyLoading||weeklyLoading?"spin":""} size={17}/> Actualizar</Button>
          </div>
        </div>
        {dailyError?<div className="daily-setup"><TriangleAlert size={25}/><div><strong>Registro diario pendiente de activación</strong><p>{dailyError}</p></div></div>:<>
          <div className="daily-summary-grid"><div><span><ScanLine size={20}/></span><small>ESCANEOS</small><strong>{dailySummary.totalScans}</strong></div><div className="daily-summary-incidents"><span><TriangleAlert size={20}/></span><small>FALLOS ENCONTRADOS</small><strong>{dailySummary.incidents}</strong></div><div><span><CircleDollarSign size={20}/></span><small>PRECIO ERRÓNEO</small><strong>{dailySummary.priceErrors}</strong></div><div><span><Tags size={20}/></span><small>MAL ETIQUETADO</small><strong>{dailySummary.mislabeled}</strong></div><div><span><Hand size={20}/></span><small>SIN ETIQUETA</small><strong>{dailySummary.withoutLabel}</strong></div><div><span><Ruler size={20}/></span><small>TALLA MENOR NO EXHIBIDA</small><strong>{dailySummary.smallerSizeNotDisplayed}</strong></div></div>
          {dailyLoading?<div className="daily-loading"><LoaderCircle className="spin" size={28}/><span>Cargando actividad del día…</span></div>:<>
            <div className="daily-detail">
              <div className="data-card-head daily-detail-head"><div><strong>{showDailyDetail?"Detalle completo del día":"Fallos encontrados"}</strong><span>{showDailyDetail?`${dailyRows.length} registros`:`${dailyIncidentRows.length} incidencias`} · {dailyScopeName}</span></div><div className="daily-detail-actions"><Badge variant="outline">{dailyDate}</Badge><Button variant="outline" onClick={()=>setShowDailyDetail((current)=>!current)}>{showDailyDetail?<EyeOff size={17}/>:<Eye size={17}/>} {showDailyDetail?"Ver solo fallos":"Ver todo detallado"}</Button></div></div>
              <div className="daily-list">{displayedDailyRows.length?displayedDailyRows.map((row)=><article key={row.id} className={`daily-row daily-row-${row.eventType.toLowerCase()} ${isActivityIncident(row)?"daily-row-incident":""}`}><div className="daily-row-icon">{row.eventType==="SIZE_NOT_DISPLAYED"?<Ruler size={20}/>:<Barcode size={20}/>}</div><div className="daily-row-product"><strong>{row.eventType==="SIZE_NOT_DISPLAYED"?"Talla menor no exhibida":row.description||row.article}</strong><span>{row.article} · {row.color} · talla {row.size}{row.expectedSize?` · esperada ${row.expectedSize}`:""}</span><small>Marca: {row.brand} · Cat 1: {row.category}</small></div><div className="daily-row-person"><strong>{row.employeeName}</strong><span>{row.storeName} · {new Date(row.createdAt).toLocaleTimeString("es-VE",{hour:"numeric",minute:"2-digit"})}</span><small>{row.observation??(row.eventType==="SCAN"?"Sin incidencias":"Validación de talla")}</small></div></article>):<div className="empty-table">{showDailyDetail?"No hay actividad registrada en esta fecha.":"Excelente: no se encontraron fallos en esta fecha."}</div>}</div>
            </div>
            <div className="daily-groups"><div className="daily-group-card"><h3><Users size={19}/> Por empleado</h3>{dailySummary.byEmployee.length?dailySummary.byEmployee.map((item)=><div key={item.label}><span>{item.label}</span><b>{item.scans} escaneos</b><small>{item.incidents} incidencias</small></div>):<p>Sin actividad para esta fecha.</p>}</div><div className="daily-group-card"><h3><Boxes size={19}/> Por Marca</h3>{dailySummary.byBrand.length?dailySummary.byBrand.map((item)=><div key={item.label}><span>{item.label}</span><b>{item.scans}</b><small>{item.incidents} incidencias</small></div>):<p>Sin datos de Marca.</p>}</div><div className="daily-group-card"><h3><FileSpreadsheet size={19}/> Por Cat 1</h3>{dailySummary.byCategory.length?dailySummary.byCategory.map((item)=><div key={item.label}><span>{item.label}</span><b>{item.scans}</b><small>{item.incidents} incidencias</small></div>):<p>Sin datos de Cat 1.</p>}</div></div>
          </>}
          <div className="weekly-summary-card"><div className="weekly-summary-head"><div><span><CalendarDays size={18}/></span><div><strong>Resumen de la semana</strong><small>{weeklyRangeLabel} · {canViewAllDailyStores?"todas las tiendas":"tienda asignada"}</small></div></div><Badge variant="outline">Semana</Badge></div>{weeklyError?<div className="weekly-error"><TriangleAlert size={18}/>{weeklyError}</div>:weeklyLoading?<div className="weekly-loading"><LoaderCircle className="spin" size={21}/> Calculando semana…</div>:<div className="weekly-store-list"><div className="weekly-store-header"><span>Tienda</span><span>Escaneos</span><span>Fallos</span><span>Precio</span><span>Etiqueta</span><span>Sin etiqueta</span><span>Talla</span></div>{weeklySummary.map((item)=><article key={item.storeId} className="weekly-store-row"><strong>{item.storeName}</strong><span data-label="Escaneos">{item.scans}</span><span className={item.incidents?"has-incidents":""} data-label="Fallos">{item.incidents}</span><span data-label="Precio">{item.priceErrors}</span><span data-label="Etiqueta">{item.mislabeled}</span><span data-label="Sin etiqueta">{item.withoutLabel}</span><span data-label="Talla">{item.smallerSizeNotDisplayed}</span></article>)}</div>}</div>
        </>}
      </section>}

      {view==="catalog"&&<section className="page-content catalog-page"><div className="catalog-intro"><div className="catalog-icon"><FileSpreadsheet size={30}/></div><div><Badge variant="outline">Catálogo independiente</Badge><h2>Excel de {currentStore?.name}</h2><p>Este archivo solo modifica los productos y precios de la tienda activa. Las otras 15 tiendas permanecerán sin cambios.</p></div></div><div className="catalog-grid"><div className={`upload-card ${uploading?"uploading":""}`} aria-live="polite" aria-busy={Boolean(uploading)}>{uploading?<><div className="excel-uploading-icon"><ExcelDocumentIcon/><LoaderCircle className="spin" size={22}/></div><strong>{uploadLabel}</strong><span className="upload-file-name">{uploading.fileName}</span><div className="upload-progress-copy"><span>{uploadLabel}</span><strong>{uploadPercent}%</strong></div><div className="upload-progress"><span style={{width:`${uploadPercent}%`}}/></div><small>No cierres esta pantalla hasta que aparezca la confirmación</small></>:<><ExcelDocumentIcon/><strong>Cargar o reemplazar archivo</strong><span className="upload-format">Formato XLSX o XLS · Máximo 20 MB</span><label className="upload-select-button upload-native-picker"><Upload size={19}/><span>Seleccionar Excel</span><input ref={fileInputRef} type="file" aria-label="Seleccionar archivo Excel" onClick={()=>setExcelFileActivity("picking")} onInput={handleExcelSelection} onChange={handleExcelSelection}/></label><small className="sr-only">Elige el inventario de esta tienda; la carga comenzará automáticamente.</small></>}</div><div className="catalog-status"><h2>Catálogo activo</h2><div className="catalog-file-row"><ExcelDocumentIcon size="small"/><div><h3>{catalogMeta?.fileName??"No se ha cargado un archivo"}</h3><Badge className={catalogMeta?"active-catalog":"empty-catalog"}>{catalogMeta?<><Check size={13}/> Actualizado</>:"Sin catálogo"}</Badge></div></div><div className="catalog-active-detail"><PackageSearch size={20}/><span>{(catalogMeta?.rowCount??0).toLocaleString("es-ES")} productos</span></div><div className="catalog-active-detail"><Clock3 size={20}/><span>Última actualización: {formatCatalogUpdatedAt(catalogMeta?.activatedAt)}</span></div><div className="catalog-meta" aria-hidden="true"><div><span>Tienda</span><strong>{currentStore?.name}</strong></div><div><span>Alcance</span><strong>Solo esta tienda</strong></div></div></div></div>{uploadFeedback&&<div className={`upload-feedback upload-feedback-${uploadFeedback.kind}`} role={uploadFeedback.kind==="error"?"alert":"status"}>{uploadFeedback.kind==="success"?<CheckCircle2 size={22}/>:<X size={22}/>}<div><strong>{uploadFeedback.title}</strong><p>{uploadFeedback.message}</p>{uploadFeedback.kind==="error"&&retryUploadFile&&<Button className="upload-retry-button" type="button" variant="outline" disabled={Boolean(uploading)} onClick={()=>void importExcel(retryUploadFile)}><RefreshCw size={15}/> Reintentar carga</Button>}</div></div>}<div className="safety-note"><ShieldCheck size={22}/><div><strong>El catálogo de esta tienda no modifica las demás sucursales.</strong><p className="sr-only">Importación segura por tienda. El catálogo de una sucursal nunca modifica el de las demás. La versión anterior queda conservada.</p></div></div></section>}

      {view==="users"&&isOwner&&<section className="page-content users-page"><div className="users-intro"><div><Badge className="status-badge"><ShieldCheck size={14}/> Administración exclusiva</Badge><h2>Usuarios y permisos</h2><p>Solo Romer puede asignar funciones, cambiar tiendas y autorizar el acceso.</p></div><div className="users-actions"><Button variant="outline" onClick={()=>void loadManagedProfiles()} disabled={usersLoading||Boolean(savingUserId)}><RefreshCw className={usersLoading?"spin":""} size={16}/> Actualizar</Button><Button className="primary-action" onClick={()=>{setNewUser((current)=>({...current,storeId:current.storeId||stores[0]?.id||""}));setUserDialogOpen(true);}}><UserPlus size={17}/> Agregar usuario</Button></div></div><div className="user-summary"><div><span className="user-summary-icon" aria-hidden="true"><Users size={20}/></span><span>EMPLEADOS</span><strong>{userStats.employees}</strong></div><div><span className="user-summary-icon" aria-hidden="true"><Building2 size={20}/></span><span>GERENTES</span><strong>{userStats.managers}</strong></div><div><span className="user-summary-icon" aria-hidden="true"><ShieldCheck size={20}/></span><span>SUPERVISORES</span><strong>{userStats.supervisors}</strong></div><div><span className="user-summary-icon" aria-hidden="true"><Clock3 size={20}/></span><span>PENDIENTES</span><strong>{userStats.pending}</strong></div></div>{usersError?<div className="users-setup"><div className="pending-icon"><Users size={32}/></div><h3>Falta activar el control propietario</h3><p>{usersError} Ejecuta el nuevo SQL de “Control propietario” en Supabase y luego pulsa Actualizar.</p></div>:usersLoading?<div className="users-loading"><LoaderCircle className="spin" size={28}/><span>Cargando cuentas registradas…</span></div>:<div className="users-card"><div className="data-card-head"><div><strong>Cuentas registradas</strong><span>{managedProfiles.length} usuarios bajo el control de Romer</span></div><Badge variant="outline">Asignación por tienda</Badge></div><div className="users-table-wrap"><table className="users-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Tienda asignada</th><th>Acceso</th></tr></thead><tbody>{managedProfiles.length?managedProfiles.map((item)=><tr key={item.id}><td><div className="managed-user"><div className="managed-avatar">{(item.full_name||item.email||"U").split(/\s+/).slice(0,2).map((part)=>part[0]?.toUpperCase()).join("")}</div><div><strong>{item.full_name||"Nombre no indicado"}</strong><span>{item.email||`Cuenta ${item.id.slice(0,8)}`}</span>{item.is_owner&&<Badge className="self-badge">Propietario</Badge>}</div></div></td><td><Select value={item.role} disabled={item.is_owner||Boolean(savingUserId)} onValueChange={(value)=>void updateManagedProfile(item.id,{role:value as RoleCode})}><SelectTrigger className="user-role-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="employee">Empleado</SelectItem><SelectItem value="manager">Gerente</SelectItem><SelectItem value="supervisor">Supervisor</SelectItem></SelectContent></Select></td><td>{item.is_owner?<div className="all-stores"><Store size={15}/> Control de todas</div>:<Select value={item.store_id??undefined} disabled={Boolean(savingUserId)} onValueChange={(value)=>void updateManagedProfile(item.id,{store_id:value})}><SelectTrigger className="user-store-select"><SelectValue placeholder="Seleccionar tienda"/></SelectTrigger><SelectContent>{stores.map((store)=><SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent></Select>}</td><td><div className="access-toggle"><Switch checked={item.is_active} disabled={item.is_owner||Boolean(savingUserId)} onCheckedChange={(checked)=>void updateManagedProfile(item.id,{is_active:checked})} aria-label={`Acceso de ${item.full_name||item.email||"usuario"}`}/><span className={item.is_active?"access-active":"access-inactive"}>{savingUserId===item.id?"Guardando…":item.is_active?"Activo":"Desactivado"}</span></div></td></tr>):<tr><td colSpan={4} className="empty-table">Aún no hay cuentas registradas.</td></tr>}</tbody></table></div></div>}
        <Dialog open={userDialogOpen} onOpenChange={(open)=>!creatingUser&&setUserDialogOpen(open)}><DialogContent className="user-dialog"><DialogHeader><div className="dialog-icon"><Plus size={21}/></div><DialogTitle>Agregar nuevo usuario</DialogTitle><DialogDescription>Romer define desde aquí quién puede entrar, su función y la tienda correspondiente.</DialogDescription></DialogHeader><form className="create-user-form" onSubmit={createManagedUser}><label>Nombre completo<Input value={newUser.fullName} onChange={(event)=>setNewUser({...newUser,fullName:event.target.value})} placeholder="Nombre y apellido" required/></label><label>Correo electrónico<Input value={newUser.email} onChange={(event)=>setNewUser({...newUser,email:event.target.value})} type="email" placeholder="empleado@empresa.com" required/></label><label>Contraseña temporal<Input value={newUser.password} onChange={(event)=>setNewUser({...newUser,password:event.target.value})} type="password" minLength={8} placeholder="Mínimo 8 caracteres" required/></label><div className="create-user-grid"><label>Función<Select value={newUser.role} onValueChange={(value)=>setNewUser({...newUser,role:value as RoleCode})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="employee">Empleado</SelectItem><SelectItem value="manager">Gerente</SelectItem><SelectItem value="supervisor">Supervisor</SelectItem></SelectContent></Select></label><label>Tienda<Select value={newUser.storeId} onValueChange={(value)=>setNewUser({...newUser,storeId:value})}><SelectTrigger><SelectValue placeholder="Seleccionar tienda"/></SelectTrigger><SelectContent>{stores.map((store)=><SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent></Select></label></div><div className="create-user-note"><Mail size={17}/><span>La persona recibirá un correo de confirmación antes de poder iniciar sesión.</span></div><DialogFooter><Button type="button" variant="outline" onClick={()=>setUserDialogOpen(false)} disabled={creatingUser}>Cancelar</Button><Button className="primary-action" type="submit" disabled={creatingUser}>{creatingUser?<><LoaderCircle className="spin" size={17}/> Creando…</>:<><UserPlus size={17}/> Crear usuario</>}</Button></DialogFooter></form></DialogContent></Dialog>
      </section>}
    </main>
    <nav className="mobile-bottom-nav" aria-label="Navegación principal">
      <button className={view==="scanner"?"is-active":""} aria-current={view==="scanner"?"page":undefined} onClick={()=>goTo("scanner")} type="button"><ScanLine size={21}/><span>Escanear</span></button>
      {isEvaluator&&<button className={view==="evaluation"?"is-active":""} aria-current={view==="evaluation"?"page":undefined} onClick={()=>goTo("evaluation")} type="button"><ClipboardCheck size={21}/><span>Evaluación</span></button>}
      {canViewDaily&&<button className={view==="daily"?"is-active":""} aria-current={view==="daily"?"page":undefined} onClick={()=>goTo("daily")} type="button"><CalendarDays size={21}/><span>Registro</span></button>}
      <button className={view==="catalog"?"is-active":""} aria-current={view==="catalog"?"page":undefined} onClick={()=>goTo("catalog")} type="button"><FileSpreadsheet size={21}/><span>Catálogo</span></button>
      {isOwner&&<button className={view==="users"?"is-active":""} aria-current={view==="users"?"page":undefined} onClick={()=>goTo("users")} type="button"><Users size={21}/><span>Usuarios</span></button>}
    </nav>
  </div>;
}
