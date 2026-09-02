"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, LogIn, Mail, ShieldCheck, Store, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/app/lib/supabase";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";

type StoreRecord = { id: string; name: string; slug: string };

function postLoginPath() {
  const requestedPath = new URL(window.location.href).searchParams.get("next");
  if (!requestedPath) return "/";

  try {
    const destination = new URL(requestedPath, window.location.origin);
    return destination.origin === window.location.origin
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function LoginScreen({ authCallbackError = false }: { authCallbackError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(()=>typeof window === "undefined" ? "" : (window.localStorage.getItem("canaima-login-email") ?? ""));
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<{ kind: "error" | "success"; text: string } | null>(() => authCallbackError
    ? { kind: "error", text: "El enlace no es válido o ya venció. Solicita uno nuevo e inténtalo otra vez." }
    : null);
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
      router.replace(postLoginPath());
      router.refresh();
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
    const recoveryUrl = new URL("/auth/callback", window.location.origin);
    recoveryUrl.searchParams.set("next", "/update-password");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryUrl.toString() });
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
    const confirmationUrl = new URL("/auth/callback", window.location.origin);
    const {data,error}=await supabase.auth.signUp({
      email:signupEmail,
      password:signupForm.password,
      options:{emailRedirectTo:confirmationUrl.toString(),data:{full_name:fullName,store_id:signupForm.storeId}},
    });
    if(error){
      const text=error.code==="user_already_exists"?"Ya existe una cuenta con este correo.":"No se pudo crear la cuenta. Revisa los datos e inténtalo nuevamente.";
      setSignupMessage({kind:"error",text});
    }else if(data.session){
      setSignupMessage({kind:"success",text:"Cuenta creada como Empleado. Cargando tu tienda…"});
      setSignupOpen(false);
      router.replace(postLoginPath());
      router.refresh();
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
