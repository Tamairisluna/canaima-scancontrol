"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeFormat, BrowserMultiFormatOneDReader, type IScannerControls } from "@zxing/browser";
import { Barcode, Building2, Camera, CheckCircle2, Check, ChevronRight, CircleDollarSign, ClipboardCheck, Clock3, Download, Eye, EyeOff, FileSpreadsheet, Hand, KeyRound, LoaderCircle, LogIn, LogOut, Mail, PackageSearch, Plus, RefreshCw, ScanLine, ShieldCheck, Store, Tags, Upload, UserRound, UserPlus, Users, X } from "lucide-react";
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

type RoleCode = "employee" | "manager" | "supervisor";
type View = "scanner" | "evaluation" | "catalog" | "users";
type StoreRecord = { id: string; name: string; slug: string };
type Profile = { id: string; full_name: string | null; role: RoleCode; store_id: string | null; is_active: boolean; is_owner: boolean };
type ManagedProfile = Profile & { email: string | null; created_at: string | null };
type Product = { id: string | null; storeId: string; barcode: string; article: string; description: string; color: string; size: string; style: string; amount: number };
type EvaluationItem = Product & { rowId: string; observation: Observation; scannedAt: string };
type CatalogMeta = { fileName: string; rowCount: number; activatedAt: string | null } | null;
type UploadStage = "reading" | "parsing" | "preparing" | "uploading" | "activating" | "caching";
type UploadState = { stage: UploadStage; fileName: string; done: number; total: number };
type UploadFeedback = { kind: "success" | "error"; title: string; message: string } | null;
type ScanFeedback = { code: string; storeName: string } | null;

const ROLE_LABELS: Record<RoleCode, string> = { employee: "Empleado", manager: "Gerente", supervisor: "Supervisor" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
};

type ExtendedCameraConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  zoom?: number;
};

function cameraDeviceScore(device: MediaDeviceInfo, index: number) {
  const label = device.label.toLowerCase();
  let score = 0;
  if (/back|rear|environment|traser/.test(label)) score += 100;
  if (/main|principal|standard|1\s?[x×]/.test(label)) score += 45;
  if (/front|user|selfie|frontal/.test(label)) score -= 220;
  if (/ultra[\s-]?wide|ultra gran|0[.,]5\s?[x×]?/.test(label)) score -= 240;
  if (/macro|telephoto|telefoto/.test(label)) score -= 90;
  const camera2Index = label.match(/camera2\s+(\d+)/)?.[1];
  if (camera2Index === "0") score += 55;
  if (!label) score -= 20 + index;
  return score;
}

function selectMainRearCamera(devices: MediaDeviceInfo[]) {
  const candidates = devices.filter((device) => device.kind === "videoinput" && device.label);
  if (!candidates.length) return undefined;
  return candidates
    .map((device, index) => ({ device, score: cameraDeviceScore(device, index) }))
    .sort((left, right) => right.score - left.score)[0]?.device;
}

function cameraConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, min: 20 },
    },
  };
}

async function optimizeCamera(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return { focus: false, zoom: false };
  const capabilities = track.getCapabilities?.() as ExtendedCameraCapabilities | undefined;
  const advanced: ExtendedCameraConstraintSet = {};
  if (capabilities?.focusMode?.includes("continuous")) advanced.focusMode = "continuous";
  if (capabilities?.zoom && capabilities.zoom.min <= 1 && capabilities.zoom.max >= 1) advanced.zoom = 1;
  if (Object.keys(advanced).length) {
    try { await track.applyConstraints({ advanced: [advanced] }); } catch { /* El enfoque automático del dispositivo sigue disponible. */ }
  }
  return { focus: Boolean(advanced.focusMode), zoom: advanced.zoom === 1 };
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: typeof ScanLine; label: string; active: boolean; onClick: () => void }) {
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={onClick} type="button"><Icon size={20}/><span>{label}</span><ChevronRight className="nav-chevron" size={16}/></button>;
}

function ExcelDocumentIcon({ size = "large" }: { size?: "large" | "small" }) {
  return <span className={`excel-document-icon excel-document-icon-${size}`} aria-hidden="true"><span className="excel-document-page"><span className="excel-document-fold"/><span className="excel-document-grid"/></span><span className="excel-document-badge">X</span></span>;
}

function LoginScreen() {
  const [email, setEmail] = useState(()=>typeof window === "undefined" ? "" : (window.localStorage.getItem("canaima-login-email") ?? ""));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

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
          {formMessage && <p className={`auth-message access-message auth-message-${formMessage.kind}`} role={formMessage.kind === "error" ? "alert" : "status"}>{formMessage.text}</p>}
      </form>

      <div className="access-security-note"><span><ShieldCheck size={24}/></span><p><strong>Tus datos están protegidos</strong><small>Usamos cifrado y buenas prácticas<br className="access-note-break"/> de seguridad empresarial.</small></p></div>

      <footer className="access-footer"><div><Store size={17}/><span>GRUPO CANAIMA · OPERACIONES</span></div><small>Versión 2.0.0</small></footer>
    </section>
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const cameraSessionRef = useRef(0);
  const lastScanRef = useRef({ code: "", at: 0 });
  const scanBusyRef = useRef(false);
  const evaluationIdRef = useRef<string | null>(null);
  const evaluationCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const productCacheRef = useRef<Map<string,Product>>(new Map());
  const productCacheStoreRef = useRef("");
  const productCacheReadyRef = useRef(false);

  const currentStore = stores.find((item)=>item.id === storeId) ?? null;
  const isEvaluator = profile?.role === "manager" || profile?.role === "supervisor";
  const isOwner = Boolean(profile?.is_owner);
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
    if (nextProfile.role === "supervisor") setStoreId((current)=>nextStores.some((item)=>item.id === current) ? current : (nextStores[0]?.id ?? ""));
    else setStoreId(nextProfile.store_id ?? "");
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
    const { data } = await supabase.from("catalog_versions").select("file_name,row_count,activated_at").eq("store_id", targetStore).eq("status", "active").order("activated_at", { ascending:false }).limit(1).maybeSingle();
    setCatalogMeta(data ? { fileName:data.file_name, rowCount:data.row_count, activatedAt:data.activated_at } : null);
  }, []);

  const loadProductCache = useCallback(async (targetStore:string) => {
    productCacheStoreRef.current=targetStore;
    productCacheReadyRef.current=false;
    productCacheRef.current=new Map();
    setCachedProductCount(0);
    setCatalogLoading(true);
    const nextCache=new Map<string,Product>();
    let loadedProducts=0;
    const pageSize=1000;
    for(let start=0;;start+=pageSize){
      const {data,error}=await supabase.from("active_products").select("id,store_id,barcode,article,description,color,size,style,amount").eq("store_id",targetStore).order("id",{ascending:true}).range(start,start+pageSize-1);
      if(productCacheStoreRef.current!==targetStore)return;
      if(error){setCatalogLoading(false);return;}
      for(const row of data??[]){const product:Product={id:row.id,storeId:row.store_id,barcode:row.barcode,article:row.article,description:row.description??"",color:row.color||"No especificado",size:row.size||"No especificado",style:row.style||"No especificado",amount:Number(row.amount)};const barcodeKey=normalizeBarcode(product.barcode);if(barcodeKey)nextCache.set(barcodeKey,product);loadedProducts+=1;}
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
    setEvaluationItems((rows ?? []).map((row)=>({ id:row.product_id, storeId:row.store_id, barcode:row.barcode ?? "", article:row.article, description:row.description ?? "", color:row.color ?? "No especificado", size:row.size ?? "No especificado", style:row.style ?? "No especificado", amount:Number(row.amount), rowId:row.id, observation:row.observation as Observation, scannedAt:new Date(row.scanned_at).toLocaleTimeString("es", {hour:"numeric",minute:"2-digit"}) })));
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

  function selectStore(nextStoreId:string){
    stopCamera();
    setLastProduct(null);
    setScanFeedback(null);
    setCatalogMeta(null);
    setCachedProductCount(0);
    productCacheReadyRef.current=false;
    productCacheRef.current=new Map();
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
    const nextStore=nextRole==="supervisor"?null:(patch.store_id!==undefined?patch.store_id:(target.store_id??stores[0]?.id??null));
    const nextActive=patch.is_active??target.is_active;
    if(target.is_owner&&(nextRole!=="supervisor"||!nextActive))return void toast.error("No puedes quitar el acceso del propietario");
    if(nextRole!=="supervisor"&&!nextStore)return void toast.error("Selecciona una tienda para esta cuenta");
    const previous=managedProfiles;
    setSavingUserId(userId);
    setManagedProfiles((items)=>items.map((item)=>item.id===userId?{...item,role:nextRole,store_id:nextStore,is_active:nextActive}:item));
    const {error}=await supabase.from("profiles").update({role:nextRole,store_id:nextStore,is_active:nextActive}).eq("id",userId);
    if(error){setManagedProfiles(previous);toast.error("No se pudo guardar el acceso",{description:error.message});}
    else toast.success("Acceso actualizado",{description:target.full_name||target.email||"Usuario"});
    setSavingUserId(null);
  }

  async function createManagedUser(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!isOwner)return;
    const fullName=newUser.fullName.trim(),email=newUser.email.trim().toLowerCase();
    const assignedStore=newUser.role==="supervisor"?null:(newUser.storeId||stores[0]?.id||null);
    if(!fullName||!email||newUser.password.length<8)return void toast.error("Completa correctamente todos los datos");
    if(newUser.role!=="supervisor"&&!assignedStore)return void toast.error("Selecciona una tienda");
    setCreatingUser(true);
    try{
      const provisioningClient=createProvisioningClient();
      const {data,error}=await provisioningClient.auth.signUp({email,password:newUser.password,options:{data:{full_name:fullName}}});
      if(error)throw error;
      if(!data.user)throw new Error("No se recibió el identificador de la cuenta");
      const {error:profileUpdateError}=await supabase.from("profiles").update({full_name:fullName,role:newUser.role,store_id:assignedStore,is_active:true}).eq("id",data.user.id);
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

  async function saveEvaluationProduct(product: Product) {
    const targetEvaluation = await ensureEvaluation();
    if (!targetEvaluation) return;
    const { data, error } = await supabase.from("evaluation_items").insert({ evaluation_id:targetEvaluation, store_id:storeId, product_id:product.id, barcode:product.barcode || null, article:product.article, description:product.description, color:product.color, size:product.size, style:product.style, amount:product.amount, observation:"SIN INCIDENCIAS" }).select("id,scanned_at").single();
    if (error) return void toast.error("No se pudo guardar el producto evaluado");
    setEvaluationItems((items)=>[{...product,rowId:data.id,observation:"SIN INCIDENCIAS",scannedAt:new Date(data.scanned_at).toLocaleTimeString("es",{hour:"numeric",minute:"2-digit"})},...items]);
  }

  const registerCode = useCallback(async (rawCode: string, evaluation=false) => {
    if (!storeId) return;
    const normalized=normalizeBarcode(rawCode);
    if (!normalized) return;
    let product=productCacheStoreRef.current===storeId?productCacheRef.current.get(normalized):undefined;
    if(!product){
      if(scanBusyRef.current)return;
      scanBusyRef.current=true;
      const { data, error } = await supabase.from("active_products").select("id,store_id,barcode,article,description,color,size,style,amount").eq("store_id",storeId).eq("barcode",normalized).limit(1).maybeSingle();
      scanBusyRef.current=false;
      if(!error&&data){product={id:data.id,storeId:data.store_id,barcode:data.barcode,article:data.article,description:data.description??"",color:data.color||"No especificado",size:data.size||"No especificado",style:data.style||"No especificado",amount:Number(data.amount)};productCacheRef.current.set(normalized,product);}
    }
    if (!product) {
      const storeName=currentStore?.name??"esta tienda";
      setLastProduct(null);
      setScanFeedback({code:normalized,storeName});
      setManualCode("");
      if(navigator.vibrate)navigator.vibrate([70,60,70]);
      return void toast.warning("Código leído correctamente",{id:"scanner-result",description:`${normalized} no está incluido en el Excel activo de ${storeName}.`});
    }
    setScanFeedback(null);toast.dismiss("scanner-result");setLastProduct(product); setManualCode(""); if(navigator.vibrate)navigator.vibrate(80);
    if(evaluation)void saveEvaluationProduct(product);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storeId,currentStore?.name,isEvaluator,sessionUserId]);

  function releaseCameraStream(){
    controlsRef.current?.stop();
    controlsRef.current=null;
    const stream=videoRef.current?.srcObject;
    if(stream instanceof MediaStream)stream.getTracks().forEach((track)=>track.stop());
    if(videoRef.current)videoRef.current.srcObject=null;
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

      let devices=await navigator.mediaDevices.enumerateDevices();
      let preferredCamera=selectMainRearCamera(devices);
      let stream=await navigator.mediaDevices.getUserMedia(cameraConstraints(preferredCamera?.deviceId));

      if(!preferredCamera){
        devices=await navigator.mediaDevices.enumerateDevices();
        preferredCamera=selectMainRearCamera(devices);
        const currentDeviceId=stream.getVideoTracks()[0]?.getSettings().deviceId;
        if(preferredCamera?.deviceId&&preferredCamera.deviceId!==currentDeviceId){
          stream.getTracks().forEach((track)=>track.stop());
          stream=await navigator.mediaDevices.getUserMedia(cameraConstraints(preferredCamera.deviceId));
        }
      }

      if(cameraSession!==cameraSessionRef.current){stream.getTracks().forEach((track)=>track.stop());return;}
      const optimization=await optimizeCamera(stream);
      const reader=new BrowserMultiFormatOneDReader(undefined,{delayBetweenScanAttempts:60,delayBetweenScanSuccess:120});
      reader.possibleFormats=GARMENT_BARCODE_FORMATS;
      setCameraStatus(optimization.focus?"Cámara principal 1× · enfoque continuo":"Cámara trasera principal 1×");
      controlsRef.current=await reader.decodeFromStream(stream,videoElement,(result)=>{
        if(!result)return;
        const scanned=normalizeBarcode(result.getText()),now=Date.now();
        if(!scanned||(scanned===lastScanRef.current.code&&now-lastScanRef.current.at<5000))return;
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
  function goTo(next:View){stopCamera();setView(next);setMobileMenu(false);}

  async function importExcel(file:File){
    if(!sessionUserId||!storeId)return;
    let catalogId:string|null=null;
    const fileName=file.name;
    setUploadFeedback(null);
    setUploading({stage:"reading",fileName,done:0,total:0});
    try{
      if(file.size>20*1024*1024)throw new Error("El archivo supera el máximo permitido de 20 MB.");
      if(!/\.(xlsx|xls)$/i.test(fileName))throw new Error("Selecciona un archivo de Excel con extensión .XLSX o .XLS.");
      await new Promise<void>((resolve)=>requestAnimationFrame(()=>resolve()));
      const [fileBytes,excelModules]=await Promise.all([
        file.arrayBuffer(),
        Promise.all([import("xlsx"),import("@/app/lib/catalog-import")]),
      ]);
      setUploading({stage:"parsing",fileName,done:0,total:0});
      await new Promise<void>((resolve)=>setTimeout(resolve,0));
      const [{read},{parseCatalogWorkbook}]=excelModules;
      const workbook=read(fileBytes,{type:"array",cellDates:false});
      const parsed=parseCatalogWorkbook(workbook);
      const {products}=parsed;
      setUploading({stage:"preparing",fileName,done:0,total:products.length});
      const {data:version,error:versionError}=await supabase.from("catalog_versions").insert({store_id:storeId,file_name:file.name,row_count:0,status:"uploading",uploaded_by:sessionUserId}).select("id").single();
      if(versionError)throw versionError;catalogId=version.id;
      const batchSize=400;
      for(let start=0;start<products.length;start+=batchSize){const batch=products.slice(start,start+batchSize).map((product)=>({...product,catalog_id:catalogId,store_id:storeId}));const {error}=await supabase.from("products").insert(batch);if(error)throw error;setUploading({stage:"uploading",fileName,done:Math.min(start+batch.length,products.length),total:products.length});}
      const {error:readyError}=await supabase.from("catalog_versions").update({status:"ready",row_count:products.length}).eq("id",catalogId);if(readyError)throw readyError;
      setUploading({stage:"activating",fileName,done:products.length,total:products.length});
      const {error:activateError}=await supabase.rpc("activate_catalog",{target_catalog:catalogId});if(activateError)throw activateError;
      setUploading({stage:"caching",fileName,done:products.length,total:products.length});
      await Promise.all([loadCatalogMeta(storeId),loadProductCache(storeId)]);
      const details=[`${products.length.toLocaleString("es-ES")} productos listos para escanear en ${currentStore?.name}.`];
      if(parsed.skippedRows)details.push(`${parsed.skippedRows.toLocaleString("es-ES")} filas sin código fueron omitidas.`);
      if(parsed.duplicateRows)details.push(`${parsed.duplicateRows.toLocaleString("es-ES")} códigos repetidos fueron omitidos.`);
      const message=details.join(" ");
      setUploadFeedback({kind:"success",title:"Excel cargado correctamente",message});
      toast.success("Catálogo activado",{description:message});
    }catch(error){
      if(catalogId)await supabase.from("catalog_versions").update({status:"failed"}).eq("id",catalogId);
      const {getImportErrorMessage}=await import("@/app/lib/catalog-import");
      const message=getImportErrorMessage(error);
      setUploadFeedback({kind:"error",title:"No se pudo cargar el Excel",message});
      toast.error("No se pudo cargar el catálogo",{description:message});
    }
    finally{setUploading(null);}
  }

  const uploadPercent=uploading?uploading.stage==="reading"?8:uploading.stage==="parsing"?18:uploading.stage==="preparing"?25:uploading.stage==="uploading"?25+Math.round((uploading.done/Math.max(uploading.total,1))*60):uploading.stage==="activating"?92:97:0;
  const uploadLabel=uploading?uploading.stage==="reading"?"Leyendo el archivo…":uploading.stage==="parsing"?"Identificando columnas y productos…":uploading.stage==="preparing"?"Preparando el catálogo de la tienda…":uploading.stage==="uploading"?`Cargando ${uploading.done.toLocaleString("es-ES")} de ${uploading.total.toLocaleString("es-ES")}`:uploading.stage==="activating"?"Activando precios y productos…":"Preparando el escaneo instantáneo…":"";

  async function addWithoutLabel(){
    const targetEvaluation=await ensureEvaluation();if(!targetEvaluation)return;
    const {data,error}=await supabase.from("evaluation_items").insert({evaluation_id:targetEvaluation,store_id:storeId,product_id:null,barcode:null,article:"SIN CÓDIGO",description:"Producto sin identificar",color:"No especificado",size:"No especificado",style:"No especificado",amount:0,observation:"SIN ETIQUETA"}).select("id,scanned_at").single();
    if(error)return void toast.error("No se pudo registrar el producto");
    setEvaluationItems((items)=>[{id:null,storeId,barcode:"",article:"SIN CÓDIGO",description:"Producto sin identificar",color:"No especificado",size:"No especificado",style:"No especificado",amount:0,rowId:data.id,observation:"SIN ETIQUETA",scannedAt:new Date(data.scanned_at).toLocaleTimeString("es",{hour:"numeric",minute:"2-digit"})},...items]);
    toast.success("Producto sin etiqueta registrado");
  }
  async function changeObservation(rowId:string,observation:Observation){const previous=evaluationItems;setEvaluationItems((items)=>items.map((item)=>item.rowId===rowId?{...item,observation}:item));const {error}=await supabase.from("evaluation_items").update({observation}).eq("id",rowId);if(error){setEvaluationItems(previous);toast.error("No se guardó la observación");return false;}return true;}
  async function deleteEvaluationItem(rowId:string){const {error}=await supabase.from("evaluation_items").delete().eq("id",rowId);if(error)return void toast.error("No se pudo eliminar");setEvaluationItems((items)=>items.filter((item)=>item.rowId!==rowId));}

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
    pending:managedProfiles.filter((item)=>!item.is_active||(item.role!=="supervisor"&&!item.store_id)).length,
  }),[managedProfiles]);
  async function exportEvaluation(){
    const {AlignmentType,BorderStyle,Document,Packer,Paragraph,Table,TableCell,TableRow,TextRun,WidthType}=await import("docx");
    const borders={top:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"},bottom:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"},left:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"},right:{style:BorderStyle.SINGLE,size:1,color:"B8C7CE"}};const cell=(value:string,bold=false)=>new TableCell({borders,children:[new Paragraph({children:[new TextRun({text:value,bold})]})]});
    const doc=new Document({sections:[{children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"GRUPO CANAIMA",bold:true,size:30,color:"073F5C"})]}),new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:"INFORME DE EVALUACIÓN DE PRODUCTOS",bold:true,size:25})]}),new Paragraph(""),new Paragraph({children:[new TextRun({text:"Nombre de la empresa: ____________________________________",bold:true})]}),new Paragraph({children:[new TextRun({text:"Fecha: ____________________",bold:true})]}),new Paragraph(`Tienda evaluada: ${currentStore?.name??""}`),new Paragraph(""),new Paragraph("El presente documento contiene el resultado obtenido durante la evaluación realizada a los productos de la tienda indicada, conforme a las observaciones registradas durante el proceso de verificación."),new Paragraph(""),new Paragraph({children:[new TextRun({text:"Resumen de observaciones",bold:true,size:24,color:"073F5C"})]}),new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({children:[cell("Observación",true),cell("Cantidad",true)]}),...summary.map((item)=>new TableRow({children:[cell(item.observation),cell(String(item.count))]}))]}),new Paragraph(""),new Paragraph({children:[new TextRun({text:"Detalle de productos evaluados",bold:true,size:24,color:"073F5C"})]}),new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({children:[cell("Artículo",true),cell("Producto",true),cell("Monto",true),cell("Observación",true)]}),...evaluationItems.map((item)=>new TableRow({children:[cell(item.article),cell(item.description),cell(money.format(item.amount)),cell(item.observation)]}))]}),new Paragraph(""),new Paragraph(""),new Paragraph("________________________      ________________________      ________________________"),new Paragraph("Gerente de tienda 1                Gerente de tienda 2                Supervisor")]}]});
    const blob=await Packer.toBlob(doc),href=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=href;anchor.download=`Evaluacion_${(currentStore?.name??"tienda").replace(/[^a-z0-9]+/gi,"_")}.docx`;anchor.click();setTimeout(()=>URL.revokeObjectURL(href),1000);toast.success("Informe editable generado");
  }

  async function signOut(){stopCamera();setLastProduct(null);setScanFeedback(null);setEvaluationItems([]);await supabase.auth.signOut();}

  if(booting)return <main className="loading-screen"><Image src="/canaima-logo.svg" alt="Grupo Canaima" width={480} height={250} priority/><LoaderCircle className="spin" size={26}/><span>Preparando ScanControl…</span></main>;
  if(!sessionUserId)return <LoginScreen/>;
  if(!profile||!profile.is_active||(!storeId&&profile.role!=="supervisor"))return <main className="pending-screen"><Toaster position="top-center" richColors/><section><div className="pending-icon"><UserRound size={34}/></div><h1>Cuenta pendiente de asignación</h1><p>El administrador debe asignar una tienda y un rol antes de que puedas utilizar ScanControl.</p><Button variant="outline" onClick={signOut}><LogOut size={17}/> Cerrar sesión</Button></section></main>;

  return <div className="app-shell"><Toaster position="top-center" richColors/>
    {mobileMenu&&<button className="drawer-backdrop" type="button" aria-label="Cerrar menú" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?"sidebar-open":""}`}><div className="brand-block"><Image src="/canaima-logo-sidebar.svg" alt="Grupo Canaima" className="brand-logo" width={520} height={100}/><button className="mobile-close" onClick={()=>setMobileMenu(false)} aria-label="Cerrar menú"><X size={20}/></button></div><div className="product-name"><span>SCANCONTROL</span><small>Control inteligente de productos</small></div><nav className="nav-list"><NavItem icon={ScanLine} label="Escanear producto" active={view==="scanner"} onClick={()=>goTo("scanner")}/>{isEvaluator&&<NavItem icon={ClipboardCheck} label="Evaluación" active={view==="evaluation"} onClick={()=>goTo("evaluation")}/>}<NavItem icon={FileSpreadsheet} label="Catálogo Excel" active={view==="catalog"} onClick={()=>goTo("catalog")}/>{isOwner&&<NavItem icon={Users} label="Usuarios y permisos" active={view==="users"} onClick={()=>goTo("users")}/>}</nav><div className="sidebar-store"><div className="store-mark"><Building2 size={18}/></div><div><span>Tienda activa</span><strong>{currentStore?.name??"Seleccionar tienda"}</strong></div></div><button className="sidebar-user" type="button" onClick={signOut}><div className="avatar">{initials}</div><div><strong>{displayName}</strong><span>{roleLabel}</span></div><LogOut size={18}/></button></aside>
    <main className="workspace">
      <header className="topbar">
        <div className="topbar-brand" aria-label="Grupo Canaima ScanControl">
          <Image src="/canaima-logo.svg" alt="Grupo Canaima" width={480} height={250}/>
          <strong>ScanControl</strong>
        </div>
        <div className="topbar-controls">
          {profile.role==="supervisor"&&view!=="users"?<>
            <div className="desktop-store-switcher"><Select value={storeId} onValueChange={selectStore}><SelectTrigger className="store-select"><Store size={16}/><SelectValue placeholder="Seleccionar tienda"/></SelectTrigger><SelectContent>{stores.map((item)=><SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <label className="mobile-store-switcher" aria-label="Seleccionar tienda"><Store size={18}/><select value={storeId} onChange={(event)=>selectStore(event.target.value)} aria-label="Seleccionar tienda">{stores.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </>:<div className="topbar-current-store"><Store size={17}/><span>{currentStore?.name??"Seleccionar tienda"}</span></div>}
        </div>
        <button className="profile-menu-button" onClick={()=>setMobileMenu(true)} type="button" aria-label={`Abrir menú de ${displayName}`}><span>{initials}</span><i/></button>
      </header>

      {view==="scanner"&&<section className="page-content scanner-layout"><div className="scan-panel"><div className="section-heading"><div><Badge className="status-badge"><span className={`status-dot ${catalogLoading?"status-dot-loading":""}`}/> {catalogLoading?"Preparando catálogo…":`Lector instantáneo · ${cachedProductCount.toLocaleString("es-ES")} productos`}</Badge><h2>Escaneo continuo</h2><p>Apunta la cámara al código. El resultado aparecerá al instante y el lector seguirá activo.</p></div><div className="store-pill"><Store size={16}/><span>{currentStore?.name}</span></div></div>{cameraOpen?<div className="camera-stage"><video ref={videoRef} className="camera-video" muted playsInline/><div className="camera-mode" aria-live="polite"><Camera size={14}/>{cameraStatus}</div><div className="scan-frame"><span/><span/><span/><span/><i/></div><button className="camera-close" onClick={stopCamera}><X size={18}/> Detener</button></div>:<button className="scanner-target" onClick={()=>startCamera(false)}><div className="scanner-corners"><span/><span/><span/><span/></div><div className="scanner-icon"><Barcode size={48}/></div><strong>Toca para activar la cámara</strong><small>Cámara principal 1× · EAN, UPC y Code 128</small></button>}<div className="manual-entry"><div><i/><span>o introduce el código</span><i/></div><div className="manual-controls"><Input value={manualCode} onChange={(event)=>setManualCode(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&void registerCode(manualCode)} placeholder="Ej. 9880007937124" inputMode="numeric"/><Button onClick={()=>void registerCode(manualCode)}>Verificar</Button></div></div></div>
        <div className={`result-panel ${lastProduct?"":scanFeedback?"result-missing":"result-empty"}`}>{lastProduct?<><div className="result-success"><CheckCircle2 size={20}/><span>Producto encontrado</span><small>Último escaneo</small></div><div className="result-product"><div className="product-icon"><PackageSearch size={36}/></div><div><span>CÓDIGO / ARTÍCULO</span><h2>{lastProduct.article}</h2><p>{lastProduct.description}</p></div></div><div className="product-grid"><div><span>COLOR</span><strong>{lastProduct.color}</strong></div><div><span>TAMAÑO</span><strong>{lastProduct.size}</strong></div><div className="wide"><span>ESTILO</span><strong>{lastProduct.style}</strong></div></div><div className="price-block"><span>MONTO A PAGAR</span><strong>{money.format(lastProduct.amount)}</strong><small>Precio individual en dólares</small></div><div className="auto-note"><Camera size={18}/><p><strong>Listo para el siguiente producto</strong><span>No necesitas presionar ningún botón.</span></p><b/></div></>:scanFeedback?<div className="missing-product"><div className="missing-head"><Barcode size={21}/><div><strong>Código leído correctamente</strong><span>El lector y la cámara están funcionando</span></div></div><div className="missing-code"><span>CÓDIGO CAPTURADO</span><strong>{scanFeedback.code}</strong></div><div className="missing-copy"><h3>Esta prenda no está en el Excel activo</h3><p>No es posible mostrar artículo, color, tamaño, estilo ni precio porque el archivo de <strong>{scanFeedback.storeName}</strong> no contiene este código.</p></div><div className="missing-note"><FileSpreadsheet size={20}/><span>Carga el inventario que incluya esta prenda o comprueba que corresponda a la tienda seleccionada.</span></div></div>:<div className="empty-product"><PackageSearch size={44}/><h3>Esperando un producto</h3><p>El resultado aparecerá aquí después del primer escaneo.</p></div>}</div></section>}

      {view==="evaluation"&&isEvaluator&&<section className="page-content evaluation-page">
        <div className="evaluation-toolbar">
          <div><Badge variant="outline">{evaluationId?"Evaluación en curso":"Lista para iniciar"}</Badge><h2>Registro de verificación</h2><p>Cada lectura se guarda con “Sin incidencias” y puede corregirse al instante.</p></div>
          <div className="toolbar-actions">
            <Button className="without-label-button" variant="outline" onClick={addWithoutLabel}><Hand size={17}/> Registrar sin etiqueta</Button>
            <Button onClick={()=>startCamera(true)}><Camera size={17}/> Escanear continuamente</Button>
          </div>
        </div>
        {cameraOpen&&<div className="evaluation-camera"><video ref={videoRef} muted playsInline/><div><strong>{cameraStatus}</strong><span>Los productos se agregan y guardan automáticamente.</span></div><Button variant="outline" onClick={stopCamera}>Detener</Button></div>}
        <div className="incident-panel">
          <div className="incident-copy"><span>ÚLTIMO PRODUCTO</span>{latestScannedEvaluationItem?<><h3>{latestScannedEvaluationItem.description} · {latestScannedEvaluationItem.article}</h3><strong className="incident-price">{money.format(latestScannedEvaluationItem.amount)}</strong><p>Observación del último escaneo</p></>:<p>Escanea un producto para poder marcar una incidencia.</p>}</div>
          {latestScannedEvaluationItem&&<div className="incident-selector"><span>Observación</span><Select value={latestScannedEvaluationItem.observation} onValueChange={(value)=>void changeObservation(latestScannedEvaluationItem.rowId,value as Observation)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{OBSERVATIONS.map((observation)=><SelectItem key={observation} value={observation}>{observation}</SelectItem>)}</SelectContent></Select></div>}
          <div className="incident-actions">
            <Button className={`incident-button ${latestScannedEvaluationItem?.observation==="PRECIO ERRÓNEO"?"is-active":""}`} variant="outline" disabled={!latestScannedEvaluationItem} aria-pressed={latestScannedEvaluationItem?.observation==="PRECIO ERRÓNEO"} onClick={()=>void markLatestScannedProduct("PRECIO ERRÓNEO")}><CircleDollarSign size={18}/> Precio erróneo</Button>
            <Button className={`incident-button ${latestScannedEvaluationItem?.observation==="MAL ETIQUETADO"?"is-active":""}`} variant="outline" disabled={!latestScannedEvaluationItem} aria-pressed={latestScannedEvaluationItem?.observation==="MAL ETIQUETADO"} onClick={()=>void markLatestScannedProduct("MAL ETIQUETADO")}><Tags size={18}/> Mal etiquetado</Button>
          </div>
        </div>
        <div className="summary-grid"><div className="summary-total"><span>EVALUADOS</span><strong>{evaluationItems.length}</strong></div>{summary.map((item)=><div key={item.observation}><span>{item.observation}</span><strong>{item.count}</strong></div>)}</div>
        <div className="data-card"><div className="data-card-head"><div><strong>Productos evaluados</strong><span>{evaluationItems.length} registros guardados</span></div><Button variant="outline" onClick={exportEvaluation} disabled={!evaluationItems.length}><Download size={17}/> Descargar Word editable</Button></div><div className="evaluation-table-wrap"><table className="evaluation-table"><thead><tr><th>Código / artículo</th><th>Descripción</th><th>Detalles</th><th>Monto</th><th>Observación</th><th/></tr></thead><tbody>{evaluationItems.length?evaluationItems.map((item)=><tr key={item.rowId}><td><strong>{item.article}</strong><span>{item.scannedAt}</span></td><td>{item.description}</td><td>{item.color} · {item.size}</td><td><strong>{money.format(item.amount)}</strong></td><td><Select value={item.observation} onValueChange={(value)=>void changeObservation(item.rowId,value as Observation)}><SelectTrigger className="observation"><SelectValue/></SelectTrigger><SelectContent>{OBSERVATIONS.map((observation)=><SelectItem key={observation} value={observation}>{observation}</SelectItem>)}</SelectContent></Select></td><td><button className="delete-row" onClick={()=>void deleteEvaluationItem(item.rowId)} aria-label={`Eliminar ${item.article}`}><X size={16}/></button></td></tr>):<tr><td colSpan={6} className="empty-table">Aún no hay productos en esta evaluación.</td></tr>}</tbody></table></div></div>
      </section>}

      {view==="catalog"&&<section className="page-content catalog-page"><div className="catalog-intro"><div className="catalog-icon"><FileSpreadsheet size={30}/></div><div><Badge variant="outline">Catálogo independiente</Badge><h2>Excel de {currentStore?.name}</h2><p>Este archivo solo modifica los productos y precios de la tienda activa. Las otras 15 tiendas permanecerán sin cambios.</p></div></div><div className="catalog-grid"><div className={`upload-card ${uploading?"uploading":""}`} aria-live="polite" aria-busy={Boolean(uploading)}><input ref={fileInputRef} type="file" disabled={Boolean(uploading)} accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event)=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void importExcel(file);}}/>{uploading?<><div className="excel-uploading-icon"><ExcelDocumentIcon/><LoaderCircle className="spin" size={22}/></div><strong>{uploadLabel}</strong><span className="upload-file-name">{uploading.fileName}</span><div className="upload-progress-copy"><span>{uploadLabel}</span><strong>{uploadPercent}%</strong></div><div className="upload-progress"><span style={{width:`${uploadPercent}%`}}/></div><small>No cierres esta pantalla hasta que aparezca la confirmación</small></>:<><ExcelDocumentIcon/><strong>Cargar o reemplazar archivo</strong><span className="upload-format">Formato XLSX o XLS · Máximo 20 MB</span><Button className="upload-select-button" type="button" onClick={()=>fileInputRef.current?.click()}><Upload size={19}/> Seleccionar Excel</Button><small className="sr-only">Elige el inventario de esta tienda; la carga comenzará automáticamente.</small></>}</div><div className="catalog-status"><h2>Catálogo activo</h2><div className="catalog-file-row"><ExcelDocumentIcon size="small"/><div><h3>{catalogMeta?.fileName??"No se ha cargado un archivo"}</h3><Badge className={catalogMeta?"active-catalog":"empty-catalog"}>{catalogMeta?<><Check size={13}/> Actualizado</>:"Sin catálogo"}</Badge></div></div><div className="catalog-active-detail"><PackageSearch size={20}/><span>{(catalogMeta?.rowCount??0).toLocaleString("es-ES")} productos</span></div><div className="catalog-active-detail"><Clock3 size={20}/><span>Última actualización: {formatCatalogUpdatedAt(catalogMeta?.activatedAt)}</span></div><div className="catalog-meta" aria-hidden="true"><div><span>Tienda</span><strong>{currentStore?.name}</strong></div><div><span>Alcance</span><strong>Solo esta tienda</strong></div></div></div></div>{uploadFeedback&&<div className={`upload-feedback upload-feedback-${uploadFeedback.kind}`} role={uploadFeedback.kind==="error"?"alert":"status"}>{uploadFeedback.kind==="success"?<CheckCircle2 size={22}/>:<X size={22}/>}<div><strong>{uploadFeedback.title}</strong><p>{uploadFeedback.message}</p></div></div>}<div className="safety-note"><ShieldCheck size={22}/><div><strong>El catálogo de esta tienda no modifica las demás sucursales.</strong><p className="sr-only">Importación segura por tienda. El catálogo de una sucursal nunca modifica el de las demás. La versión anterior queda conservada.</p></div></div></section>}

      {view==="users"&&isOwner&&<section className="page-content users-page"><div className="users-intro"><div><Badge className="status-badge"><ShieldCheck size={14}/> Administración exclusiva</Badge><h2>Usuarios y permisos</h2><p>Solo Romer puede crear cuentas, asignar funciones, elegir tiendas y autorizar el acceso.</p></div><div className="users-actions"><Button variant="outline" onClick={()=>void loadManagedProfiles()} disabled={usersLoading||Boolean(savingUserId)}><RefreshCw className={usersLoading?"spin":""} size={16}/> Actualizar</Button><Button className="primary-action" onClick={()=>{setNewUser((current)=>({...current,storeId:current.storeId||stores[0]?.id||""}));setUserDialogOpen(true);}}><UserPlus size={17}/> Agregar usuario</Button></div></div><div className="user-summary"><div><span>EMPLEADOS</span><strong>{userStats.employees}</strong></div><div><span>GERENTES</span><strong>{userStats.managers}</strong></div><div><span>SUPERVISORES</span><strong>{userStats.supervisors}</strong></div><div><span>PENDIENTES</span><strong>{userStats.pending}</strong></div></div>{usersError?<div className="users-setup"><div className="pending-icon"><Users size={32}/></div><h3>Falta activar el control propietario</h3><p>{usersError} Ejecuta el nuevo SQL de “Control propietario” en Supabase y luego pulsa Actualizar.</p></div>:usersLoading?<div className="users-loading"><LoaderCircle className="spin" size={28}/><span>Cargando cuentas registradas…</span></div>:<div className="users-card"><div className="data-card-head"><div><strong>Cuentas registradas</strong><span>{managedProfiles.length} usuarios bajo el control de Romer</span></div><Badge variant="outline">Asignación por tienda</Badge></div><div className="users-table-wrap"><table className="users-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Tienda asignada</th><th>Acceso</th></tr></thead><tbody>{managedProfiles.length?managedProfiles.map((item)=><tr key={item.id}><td><div className="managed-user"><div className="managed-avatar">{(item.full_name||item.email||"U").split(/\s+/).slice(0,2).map((part)=>part[0]?.toUpperCase()).join("")}</div><div><strong>{item.full_name||"Nombre no indicado"}</strong><span>{item.email||`Cuenta ${item.id.slice(0,8)}`}</span>{item.is_owner&&<Badge className="self-badge">Propietario</Badge>}</div></div></td><td><Select value={item.role} disabled={item.is_owner||Boolean(savingUserId)} onValueChange={(value)=>void updateManagedProfile(item.id,{role:value as RoleCode})}><SelectTrigger className="user-role-select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="employee">Empleado</SelectItem><SelectItem value="manager">Gerente</SelectItem><SelectItem value="supervisor">Supervisor</SelectItem></SelectContent></Select></td><td>{item.role==="supervisor"?<div className="all-stores"><Store size={15}/> Todas las tiendas</div>:<Select value={item.store_id??undefined} disabled={Boolean(savingUserId)} onValueChange={(value)=>void updateManagedProfile(item.id,{store_id:value})}><SelectTrigger className="user-store-select"><SelectValue placeholder="Seleccionar tienda"/></SelectTrigger><SelectContent>{stores.map((store)=><SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent></Select>}</td><td><div className="access-toggle"><Switch checked={item.is_active} disabled={item.is_owner||Boolean(savingUserId)} onCheckedChange={(checked)=>void updateManagedProfile(item.id,{is_active:checked})} aria-label={`Acceso de ${item.full_name||item.email||"usuario"}`}/><span className={item.is_active?"access-active":"access-inactive"}>{savingUserId===item.id?"Guardando…":item.is_active?"Activo":"Desactivado"}</span></div></td></tr>):<tr><td colSpan={4} className="empty-table">Aún no hay cuentas registradas.</td></tr>}</tbody></table></div></div>}
        <Dialog open={userDialogOpen} onOpenChange={(open)=>!creatingUser&&setUserDialogOpen(open)}><DialogContent className="user-dialog"><DialogHeader><div className="dialog-icon"><Plus size={21}/></div><DialogTitle>Agregar nuevo usuario</DialogTitle><DialogDescription>Romer define desde aquí quién puede entrar, su función y la tienda correspondiente.</DialogDescription></DialogHeader><form className="create-user-form" onSubmit={createManagedUser}><label>Nombre completo<Input value={newUser.fullName} onChange={(event)=>setNewUser({...newUser,fullName:event.target.value})} placeholder="Nombre y apellido" required/></label><label>Correo electrónico<Input value={newUser.email} onChange={(event)=>setNewUser({...newUser,email:event.target.value})} type="email" placeholder="empleado@empresa.com" required/></label><label>Contraseña temporal<Input value={newUser.password} onChange={(event)=>setNewUser({...newUser,password:event.target.value})} type="password" minLength={8} placeholder="Mínimo 8 caracteres" required/></label><div className="create-user-grid"><label>Función<Select value={newUser.role} onValueChange={(value)=>setNewUser({...newUser,role:value as RoleCode})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="employee">Empleado</SelectItem><SelectItem value="manager">Gerente</SelectItem><SelectItem value="supervisor">Supervisor</SelectItem></SelectContent></Select></label>{newUser.role!=="supervisor"&&<label>Tienda<Select value={newUser.storeId} onValueChange={(value)=>setNewUser({...newUser,storeId:value})}><SelectTrigger><SelectValue placeholder="Seleccionar tienda"/></SelectTrigger><SelectContent>{stores.map((store)=><SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent></Select></label>}</div><div className="create-user-note"><Mail size={17}/><span>La persona recibirá un correo de confirmación antes de poder iniciar sesión.</span></div><DialogFooter><Button type="button" variant="outline" onClick={()=>setUserDialogOpen(false)} disabled={creatingUser}>Cancelar</Button><Button className="primary-action" type="submit" disabled={creatingUser}>{creatingUser?<><LoaderCircle className="spin" size={17}/> Creando…</>:<><UserPlus size={17}/> Crear usuario</>}</Button></DialogFooter></form></DialogContent></Dialog>
      </section>}
    </main>
    <nav className="mobile-bottom-nav" aria-label="Navegación principal">
      <button className={view==="scanner"?"is-active":""} aria-current={view==="scanner"?"page":undefined} onClick={()=>goTo("scanner")} type="button"><ScanLine size={21}/><span>Escanear</span></button>
      {isEvaluator&&<button className={view==="evaluation"?"is-active":""} aria-current={view==="evaluation"?"page":undefined} onClick={()=>goTo("evaluation")} type="button"><ClipboardCheck size={21}/><span>Evaluación</span></button>}
      <button className={view==="catalog"?"is-active":""} aria-current={view==="catalog"?"page":undefined} onClick={()=>goTo("catalog")} type="button"><FileSpreadsheet size={21}/><span>Catálogo</span></button>
      {isOwner&&<button className={view==="users"?"is-active":""} aria-current={view==="users"?"page":undefined} onClick={()=>goTo("users")} type="button"><Users size={21}/><span>Usuarios</span></button>}
    </nav>
  </div>;
}
