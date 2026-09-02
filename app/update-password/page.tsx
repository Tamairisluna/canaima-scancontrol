"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/app/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("No se pudo actualizar la contraseña", {
          description: "Solicita un nuevo enlace e inténtalo nuevamente.",
        });
        return;
      }

      toast.success("Contraseña actualizada correctamente.");
      router.replace("/");
      router.refresh();
    } catch {
      toast.error("No fue posible conectar con el servicio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="access-screen">
      <Toaster position="top-center" richColors />
      <section className="access-shell" aria-label="Crear una contraseña nueva">
        <div className="access-brand-lockup" aria-label="Grupo Canaima ScanControl">
          <svg className="access-brand-mark" viewBox="0 0 64 70" aria-hidden="true">
            <path className="access-mark-frame" d="M32 2 61 19v33L32 69 3 52V19L32 2Zm0 8L10 23v25l22 13 22-13V23L32 10Z" />
            <path className="access-mark-c" d="m46 22-14-8-17 10v22l17 10 14-8V38l-14 8-9-5V29l9-5 14 8V22Z" />
          </svg>
          <div><span>GRUPO CANAIMA</span><strong>SCAN<span>CONTROL</span></strong></div>
        </div>

        <div className="access-hero-copy">
          <h1>Nueva contraseña</h1>
          <div className="access-accent" aria-hidden="true" />
          <div className="access-intro"><strong>Enlace verificado</strong><ShieldCheck size={20} /></div>
          <p className="access-description">Escribe y confirma la contraseña que usarás desde ahora.</p>
        </div>

        <form onSubmit={submit} className="access-form-card">
          <label className="access-field" htmlFor="new-password">
            <span className="access-field-icon"><KeyRound size={21} /></span>
            <span className="access-field-content"><strong>Nueva contraseña</strong><Input id="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required type="password" minLength={8} autoComplete="new-password" /></span>
          </label>
          <label className="access-field" htmlFor="confirm-password">
            <span className="access-field-icon"><KeyRound size={21} /></span>
            <span className="access-field-content"><strong>Confirmar contraseña</strong><Input id="confirm-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required type="password" minLength={8} autoComplete="new-password" /></span>
          </label>
          <Button className="access-submit" type="submit" disabled={busy}>
            {busy ? <><LoaderCircle className="spin" size={19} /> Guardando…</> : <><ShieldCheck size={19} /> Guardar contraseña</>}
          </Button>
        </form>
      </section>
    </main>
  );
}
