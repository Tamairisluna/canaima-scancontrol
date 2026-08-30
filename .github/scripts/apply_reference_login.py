from pathlib import Path
import re

page = Path("app/page.tsx")
s = page.read_text(encoding="utf-8")

# Añade únicamente los iconos requeridos por el login aprobado.
if " Eye," not in s and "Eye," not in s.split("from \"lucide-react\"")[0]:
    s = s.replace("Barcode, Building2, Camera, CheckCircle2, ChevronRight, CircleDollarSign, ClipboardCheck, Download, FileSpreadsheet", "Barcode, Building2, Camera, CheckCircle2, ChevronRight, CircleDollarSign, ClipboardCheck, Download, Eye, EyeOff, FileSpreadsheet")
if "LogIn," not in s.split("from \"lucide-react\"")[0]:
    s = s.replace("LockKeyhole, LogOut, Mail", "LockKeyhole, LogIn, LogOut, Mail")

new_login = r'''function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [formMessage, setFormMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(()=>{
    try {
      const saved = window.localStorage.getItem("scancontrol-login-email");
      if (saved) setEmail(saved);
    } catch {}
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormMessage(null);
    try {
      const normalizedEmail = email.trim();
      try {
        if (remember) window.localStorage.setItem("scancontrol-login-email", normalizedEmail);
        else window.localStorage.removeItem("scancontrol-login-email");
      } catch {}
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
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

  async function recoverPassword() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setFormMessage({ kind: "error", text: "Escribe tu correo electrónico para enviarte el enlace de recuperación." });
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: window.location.origin });
    if (error) {
      const text = "No se pudo enviar el correo de recuperación. Intenta nuevamente.";
      setFormMessage({ kind: "error", text });
      toast.error("No se pudo enviar el enlace", { description: text });
      return;
    }
    const text = "Revisa tu correo. Te enviamos un enlace para restablecer tu contraseña.";
    setFormMessage({ kind: "success", text });
    toast.success("Enlace de recuperación enviado");
  }

  return <main className="login-screen login-reference"><Toaster position="top-center" richColors/>
    <section className="login-reference-shell">
      <div className="login-reference-brand"><Image src="/login-logo-reference.svg" alt="Grupo Canaima ScanControl" width={255} height={175} priority/></div>
      <div className="login-reference-hero" aria-hidden="true"/>

      <div className="login-reference-copy">
        <h1>Bienvenido</h1>
        <span className="login-reference-accent"/>
        <div className="login-reference-secure"><strong>Acceso protegido</strong><ShieldCheck/></div>
        <p>Ingresa con tus credenciales para continuar.</p>
      </div>

      <form onSubmit={submit} className="login-reference-form">
        <label className="login-reference-field">
          <span className="login-reference-field-icon"><Mail/></span>
          <span className="login-reference-field-copy"><span className="login-reference-field-label">Correo electrónico</span><Input value={email} onChange={(event)=>setEmail(event.target.value)} required type="email" placeholder="ejemplo@empresa.com" autoComplete="email"/></span>
        </label>
        <label className="login-reference-field">
          <span className="login-reference-field-icon"><LockKeyhole/></span>
          <span className="login-reference-field-copy"><span className="login-reference-field-label">Contraseña</span><Input value={password} onChange={(event)=>setPassword(event.target.value)} required type={showPassword ? "text" : "password"} minLength={8} placeholder="Ingresa tu contraseña" autoComplete="current-password"/></span>
          <button className="login-reference-eye" type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={()=>setShowPassword((value)=>!value)}>{showPassword ? <EyeOff/> : <Eye/>}</button>
        </label>
        <div className="login-reference-options">
          <label className="login-reference-remember"><input type="checkbox" checked={remember} onChange={(event)=>setRemember(event.target.checked)}/><span>Recordarme en este dispositivo</span></label>
          <button className="login-reference-forgot" type="button" onClick={()=>void recoverPassword()}>¿Olvidaste tu contraseña?</button>
        </div>
        <Button className="login-reference-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin"/> Iniciando…</> : <><LogIn/> Iniciar sesión</>}</Button>
        {formMessage && <p className={`auth-message auth-message-${formMessage.kind}`} role={formMessage.kind === "error" ? "alert" : "status"}>{formMessage.text}</p>}
      </form>

      <div className="login-reference-protected"><span className="login-reference-shield"><ShieldCheck/></span><p><strong>Tus datos están protegidos</strong><span>Usamos cifrado y buenas prácticas<br/>de seguridad empresarial.</span></p></div>
      <footer className="login-reference-footer"><div><Store/><span>GRUPO CANAIMA · OPERACIONES</span></div><small>Versión 2.0.0</small></footer>
    </section>
  </main>;
}

export default function Home() {'''

pattern = r'function LoginScreen\(\) \{.*?\n\}\n\nexport default function Home\(\) \{'
updated, count = re.subn(pattern, new_login, s, flags=re.S)
if count != 1:
    raise SystemExit(f"No se pudo localizar de forma única LoginScreen: {count}")
page.write_text(updated, encoding="utf-8")
