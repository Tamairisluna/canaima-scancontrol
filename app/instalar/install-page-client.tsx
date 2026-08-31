"use client";

import Image from "next/image";
import Link from "next/link";
import { Apple, Check, CheckCircle2, Copy, Download, ExternalLink, MoreHorizontal, Share2, ShieldCheck, Smartphone, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./instalar.module.css";

const INSTALL_URL = "https://canaima-scancontrol.vercel.app/instalar";

type Platform = "checking" | "ios" | "android" | "desktop";
type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent;
  const isiPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(userAgent) || isiPad) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function InstallPageClient() {
  const [platform, setPlatform] = useState<Platform>("checking");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [manualHelp, setManualHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const initialTask = window.setTimeout(() => {
      setPlatform(detectPlatform());
      setInstalled(isStandalone());
    }, 0);
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.clearTimeout(initialTask);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
      return;
    }
    setManualHelp(true);
    document.getElementById("install-steps")?.scrollIntoView({ behavior:"smooth", block:"center" });
  }

  async function copyLink() {
    await navigator.clipboard.writeText(INSTALL_URL);
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 2200);
  }

  async function shareInstaller() {
    const shareData = {
      title:"Instalar Canaima ScanControl",
      text:"Instala Canaima ScanControl para escanear productos desde tu teléfono.",
      url:INSTALL_URL,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* El usuario cerró el menú de compartir. */ }
      return;
    }
    await copyLink();
  }

  const platformName = platform === "ios" ? "iPhone o iPad" : platform === "android" ? "Android" : "este dispositivo";
  const primaryLabel = installed ? "Aplicación instalada" : installPrompt ? "Instalar ScanControl ahora" : platform === "ios" ? "Ver cómo instalar en iPhone" : "Instalar ScanControl";

  return <main className={styles.page}>
    <section className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}><Image src="/canaima-logo.svg" alt="Grupo Canaima" width={480} height={250} priority/><div><strong>ScanControl</strong><span>Instalación oficial</span></div></div>
        <Link className={styles.openLink} href="/"><span>Abrir sistema</span><ExternalLink size={17}/></Link>
      </header>

      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><ShieldCheck size={15}/> GRUPO CANAIMA · OPERACIONES</span>
          <h1>Instala ScanControl como una app</h1>
          <p>Comparte esta página con empleados, gerentes y supervisores. Cada persona podrá agregar la aplicación a su teléfono y entrar con las credenciales que le fueron asignadas.</p>
          <div className={styles.detected}><Smartphone size={18}/><span>Instrucciones preparadas para <strong>{platformName}</strong></span></div>
          <div className={styles.actions}>
            {installed?<Link className={styles.primaryAction} href="/"><CheckCircle2 size={20}/> Abrir ScanControl</Link>:<button className={styles.primaryAction} type="button" onClick={()=>void installApp()}><Download size={20}/>{primaryLabel}</button>}
            <button className={styles.shareAction} type="button" onClick={()=>void shareInstaller()}><Share2 size={19}/> Compartir instalación</button>
          </div>
          {installed&&<div className={styles.installedNotice}><CheckCircle2 size={18}/><span>ScanControl ya se está ejecutando como aplicación en este dispositivo.</span></div>}
        </div>

        <aside className={styles.qrCard}>
          <div className={styles.qrFrame}><Image src="/scancontrol-install-qr.png" alt="Código QR para instalar Canaima ScanControl" width={720} height={720} priority/></div>
          <strong>Escanea para instalar</strong>
          <span>Abre la cámara de otro teléfono y apunta a este código.</span>
          <button type="button" onClick={()=>void copyLink()}><Copy size={16}/>{copied?"Enlace copiado":"Copiar enlace"}{copied&&<Check size={15}/>}</button>
        </aside>
      </div>

      <section className={`${styles.steps} ${manualHelp?styles.stepsHighlighted:""}`} id="install-steps">
        <div className={styles.stepsHeading}><div><span>PASOS SEGÚN EL TELÉFONO</span><h2>Instalación rápida y segura</h2></div><div className={styles.security}><ShieldCheck size={18}/><span>No requiere App Store ni Play Store</span></div></div>
        <div className={styles.stepsGrid}>
          <article className={`${styles.platformCard} ${platform==="android"?styles.recommended:""}`}>
            <div className={styles.platformTitle}><span><Smartphone size={23}/></span><div><strong>Android</strong><small>Chrome, Edge o Samsung Internet</small></div>{platform==="android"&&<b>Tu dispositivo</b>}</div>
            <ol><li><span>1</span><p>Pulsa <strong>Instalar ScanControl</strong> en esta página.</p></li><li><span>2</span><p>Confirma pulsando <strong>Instalar</strong>.</p></li><li><span>3</span><p>Abre el icono desde tu pantalla de inicio.</p></li></ol>
            {!installPrompt&&platform==="android"&&<p className={styles.fallback}><MoreHorizontal size={16}/> Si no aparece el aviso, abre el menú del navegador y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.</p>}
          </article>

          <article className={`${styles.platformCard} ${platform==="ios"?styles.recommended:""}`}>
            <div className={styles.platformTitle}><span><Apple size={23}/></span><div><strong>iPhone o iPad</strong><small>Debe abrirse directamente en Safari</small></div>{platform==="ios"&&<b>Tu dispositivo</b>}</div>
            <ol><li><span>1</span><p>Abre esta página en <strong>Safari</strong>.</p></li><li><span>2</span><p>Pulsa el botón <strong>Compartir</strong> del navegador.</p></li><li><span>3</span><p>Elige <strong>Agregar a pantalla de inicio</strong> y confirma.</p></li></ol>
          </article>
        </div>
      </section>

      <footer className={styles.footer}><div><Store size={17}/><span>GRUPO CANAIMA · OPERACIONES</span></div><p>Una vez instalada, la aplicación utiliza el mismo sistema seguro de usuarios, roles y tiendas.</p></footer>
    </section>
  </main>;
}
