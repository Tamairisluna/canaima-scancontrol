"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, LogOut, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/app/lib/supabase";

type MaintenanceRole = "employee" | "manager" | "supervisor";

type MaintenanceRow = {
  maintenance_enabled: boolean;
  employee_title: string | null;
  employee_message: string | null;
  leadership_title: string | null;
  leadership_message: string | null;
  updated_at: string | null;
};

export type MaintenanceState = MaintenanceRow & {
  checking: boolean;
  available: boolean;
};

const DEFAULT_STATE: MaintenanceState = {
  maintenance_enabled: false,
  employee_title: "Mantenimiento programado",
  employee_message: "ScanControl se encuentra temporalmente en mantenimiento para realizar mejoras en el servicio. Intenta ingresar nuevamente más tarde.",
  leadership_title: "Renovación del servicio pendiente",
  leadership_message: "El acceso a ScanControl se encuentra temporalmente suspendido mientras se confirma la renovación administrativa correspondiente al período actual. Al completarse, el servicio se restablecerá automáticamente con toda la información disponible.",
  updated_at: null,
  checking: false,
  available: false,
};

export function useMaintenanceMode(userId: string | null) {
  const [state, setState] = useState<MaintenanceState>(DEFAULT_STATE);
  const requestRef = useRef(0);

  const refresh = useCallback(async (showChecking = false) => {
    if (!userId) return;

    const requestId = ++requestRef.current;
    if (showChecking) setState((current) => ({ ...current, checking: true }));

    const { data, error } = await supabase
      .from("app_runtime_settings")
      .select("maintenance_enabled,employee_title,employee_message,leadership_title,leadership_message,updated_at")
      .eq("id", "scancontrol")
      .maybeSingle();

    if (requestId !== requestRef.current) return;
    if (error || !data) {
      setState((current) => ({ ...current, checking: false, available: false }));
      return;
    }

    const row = data as MaintenanceRow;
    setState({
      ...DEFAULT_STATE,
      ...row,
      maintenance_enabled: Boolean(row.maintenance_enabled),
      checking: false,
      available: true,
    });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const initial = window.setTimeout(() => void refresh(true), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    const onFocus = () => void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 30_000);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      requestRef.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, [refresh, userId]);

  return { ...state, refresh: () => refresh(true) };
}

export function MaintenanceScreen({
  role,
  fullName,
  state,
  onRefresh,
  onSignOut,
}: {
  role: MaintenanceRole;
  fullName: string;
  state: MaintenanceState;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const leadership = role === "manager" || role === "supervisor";
  const title = leadership ? state.leadership_title : state.employee_title;
  const message = leadership ? state.leadership_message : state.employee_message;

  return (
    <main className="maintenance-screen">
      <header className="maintenance-header">
        <div className="maintenance-brand">
          <Image src="/canaima-logo.svg" alt="Grupo Canaima" width={480} height={250} priority />
          <div><strong>ScanControl</strong><span>Grupo Canaima · Operaciones</span></div>
        </div>
        <div className="maintenance-secure"><ShieldCheck size={17}/><span>Información protegida</span></div>
      </header>

      <section className="maintenance-card" aria-live="polite">
        <div className="maintenance-symbol"><Wrench size={34}/></div>
        <span className="maintenance-eyebrow">Estado temporal del servicio</span>
        <h1>{title || DEFAULT_STATE.employee_title}</h1>
        <p>{message || DEFAULT_STATE.employee_message}</p>

        <div className="maintenance-assurance">
          <ShieldCheck size={21}/>
          <div><strong>La información permanece protegida</strong><span>Los usuarios, inventarios, evaluaciones y registros conservarán todos sus datos.</span></div>
        </div>

        {leadership && (
          <div className="maintenance-leadership-note">
            <Clock3 size={19}/>
            <span>Para restablecer el servicio, contacte con la administración responsable de la cuenta.</span>
          </div>
        )}

        <div className="maintenance-actions">
          <Button type="button" onClick={onRefresh}><RefreshCw size={17}/> Comprobar disponibilidad</Button>
          <Button type="button" variant="outline" onClick={onSignOut}><LogOut size={17}/> Cerrar sesión</Button>
        </div>
        <small>Sesión de {fullName}</small>
      </section>
    </main>
  );
}
