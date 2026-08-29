import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canaima ScanControl",
  description: "Control multi-tienda de precios y evaluación de productos de Grupo Canaima.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
