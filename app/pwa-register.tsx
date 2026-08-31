"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;
    let refreshing = false;
    let lastCheck = 0;

    const checkForUpdate = async () => {
      if (disposed || document.visibilityState === "hidden") return;
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

    const reloadWithNewWorker = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const onPageShow = () => void checkForUpdate();

    navigator.serviceWorker.addEventListener("controllerchange", reloadWithNewWorker);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onPageShow);

    if (document.readyState === "complete") void checkForUpdate();
    else window.addEventListener("load", onPageShow, { once: true });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", reloadWithNewWorker);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onPageShow);
      window.removeEventListener("load", onPageShow);
    };
  }, []);
  return null;
}
