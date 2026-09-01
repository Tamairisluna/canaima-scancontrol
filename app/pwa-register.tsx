"use client";

import { useEffect } from "react";

const FILE_ACTIVITY_ATTRIBUTE = "data-scancontrol-file-activity";
const FILE_ACTIVITY_EVENT = "scancontrol:file-activity";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;
    let refreshing = false;
    let pendingRefresh = false;
    let lastCheck = 0;
    let pickerReleaseTimer: number | null = null;

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

    const reloadWithNewWorker = () => {
      if (fileActivity()) {
        pendingRefresh = true;
        return;
      }
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    const finishDeferredUpdate = () => {
      if (fileActivity()) return;
      if (pendingRefresh) {
        pendingRefresh = false;
        reloadWithNewWorker();
        return;
      }
      void checkForUpdate();
    };

    const releaseCancelledPicker = () => {
      if (fileActivity() !== "picking") return;
      if (pickerReleaseTimer !== null) window.clearTimeout(pickerReleaseTimer);
      pickerReleaseTimer = window.setTimeout(() => {
        pickerReleaseTimer = null;
        if (fileActivity() !== "picking") return;
        document.documentElement.removeAttribute(FILE_ACTIVITY_ATTRIBUTE);
        finishDeferredUpdate();
      }, 1200);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (fileActivity() === "picking") releaseCancelledPicker();
      else finishDeferredUpdate();
    };
    const onPageShow = () => {
      if (fileActivity() === "picking") releaseCancelledPicker();
      else finishDeferredUpdate();
    };
    const onFileActivity = () => {
      if (!fileActivity()) finishDeferredUpdate();
    };

    navigator.serviceWorker.addEventListener("controllerchange", reloadWithNewWorker);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onPageShow);
    window.addEventListener(FILE_ACTIVITY_EVENT, onFileActivity);

    if (document.readyState === "complete") void checkForUpdate();
    else window.addEventListener("load", onPageShow, { once: true });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", reloadWithNewWorker);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onPageShow);
      window.removeEventListener(FILE_ACTIVITY_EVENT, onFileActivity);
      window.removeEventListener("load", onPageShow);
      if (pickerReleaseTimer !== null) window.clearTimeout(pickerReleaseTimer);
    };
  }, []);
  return null;
}
