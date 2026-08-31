import type { Observation } from "@/app/lib/evaluation";

export type ActivityEventType = "SCAN" | "SIZE_NOT_DISPLAYED" | "SIZE_RESOLVED";

export type DailyActivityRow = {
  id: string;
  createdAt: string;
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  source: "scanner" | "evaluation";
  eventType: ActivityEventType;
  barcode: string;
  article: string;
  description: string;
  color: string;
  size: string;
  expectedSize: string;
  style: string;
  amount: number;
  brand: string;
  category: string;
  observation: Observation | null;
};

export type ActivityGroup = { label: string; scans: number; incidents: number };

function grouped(rows: DailyActivityRow[], key: (row: DailyActivityRow) => string): ActivityGroup[] {
  const values = new Map<string, ActivityGroup>();
  for (const row of rows) {
    const label = key(row).trim() || "No especificado";
    const current = values.get(label) ?? { label, scans: 0, incidents: 0 };
    if (row.eventType === "SCAN") current.scans += 1;
    if ((row.observation && row.observation !== "SIN INCIDENCIAS") || row.eventType === "SIZE_NOT_DISPLAYED") current.incidents += 1;
    values.set(label, current);
  }
  return Array.from(values.values()).sort((left, right) => right.scans - left.scans || left.label.localeCompare(right.label, "es"));
}

export function summarizeDailyActivity(rows: DailyActivityRow[]) {
  const scans = rows.filter((row) => row.eventType === "SCAN");
  return {
    totalScans: scans.length,
    priceErrors: scans.filter((row) => row.observation === "PRECIO ERRÓNEO").length,
    mislabeled: scans.filter((row) => row.observation === "MAL ETIQUETADO").length,
    withoutLabel: scans.filter((row) => row.observation === "SIN ETIQUETA").length,
    smallerSizeNotDisplayed: rows.filter((row) => row.eventType === "SIZE_NOT_DISPLAYED").length,
    byEmployee: grouped(rows, (row) => row.employeeName),
    byBrand: grouped(rows, (row) => row.brand),
    byCategory: grouped(rows, (row) => row.category),
  };
}

export function dateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
