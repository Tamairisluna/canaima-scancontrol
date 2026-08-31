import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "./pwa-register";

export const metadata: Metadata = {
  title: "Canaima ScanControl",
  description: "Control multi-tienda de precios y evaluación de productos de Grupo Canaima.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ScanControl",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f8fa",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><head><link rel="preconnect" href="https://wmewkfkriihwaxqpeecs.supabase.co" crossOrigin="anonymous"/><link rel="dns-prefetch" href="https://wmewkfkriihwaxqpeecs.supabase.co"/></head><body>{children}<PwaRegister/></body></html>;
}
