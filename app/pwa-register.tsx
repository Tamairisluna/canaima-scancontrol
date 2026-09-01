"use client";

import { useEffect } from "react";

const FILE_ACTIVITY_ATTRIBUTE = "data-scancontrol-file-activity";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;
    let lastCheck = 0;

    const fileActivity = () => document.documentElement.getAttribute(FILE_ACTIVITY_ATTRIBUTE);

    const checkForUpdate = async () => {
      if (disposed || document.visibilityState === "hidden" || fileActivity()) return;
      const now = Date.now();
      if (now - lastCheck < 10_000) return;
      lastCheck = now;
      try {
        registration ??= await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await registration.update();
      } catch {
        // La app sigue operativa si la comprobación no tiene conexión.
      }
    };

    if (document.readyState === "complete") void checkForUpdate();
    else window.addEventListener("load", checkForUpdate, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", checkForUpdate);
    };
  }, []);
  return null;
}
