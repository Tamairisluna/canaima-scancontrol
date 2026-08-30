import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canaima ScanControl",
  description: "Control multi-tienda de precios y evaluación de productos de Grupo Canaima.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

const hapticEnhancer = `
(() => {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    const nativeVibrate = navigator.vibrate.bind(navigator);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value(pattern) {
        if (typeof pattern === "number" && pattern > 0 && pattern <= 100) {
          nativeVibrate(0);
          return nativeVibrate(120);
        }
        return nativeVibrate(pattern);
      },
    });
  } catch {
    // Si el navegador no permite reforzar la vibración, conserva el comportamiento nativo.
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><script dangerouslySetInnerHTML={{ __html: hapticEnhancer }}/>{children}</body></html>;
}
