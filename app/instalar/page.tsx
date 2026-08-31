import type { Metadata } from "next";
import { InstallPageClient } from "./install-page-client";

export const metadata: Metadata = {
  title: "Instalar ScanControl | Grupo Canaima",
  description: "Instala Canaima ScanControl en tu teléfono como una aplicación independiente.",
};

export default function InstallPage() {
  return <InstallPageClient/>;
}
