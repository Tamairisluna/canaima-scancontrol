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
export type ActivityCountRow = Pick<DailyActivityRow, "storeId" | "eventType" | "observation">;
export type ActivityStore = { id: string; name: string };
export type StoreActivitySummary = {
  storeId: string;
  storeName: string;
  scans: number;
  incidents: number;
  priceErrors: number;
  mislabeled: number;
  withoutLabel: number;
  smallerSizeNotDisplayed: number;
};

export function isActivityIncident(row: Pick<DailyActivityRow, "eventType" | "observation">) {
  return row.eventType === "SIZE_NOT_DISPLAYED" || Boolean(row.observation && row.observation !== "SIN INCIDENCIAS");
}

function grouped(rows: DailyActivityRow[], key: (row: DailyActivityRow) => string): ActivityGroup[] {
  const values = new Map<string, ActivityGroup>();
  for (const row of rows) {
    const label = key(row).trim() || "No especificado";
    const current = values.get(label) ?? { label, scans: 0, incidents: 0 };
    if (row.eventType === "SCAN") current.scans += 1;
    if (isActivityIncident(row)) current.incidents += 1;
    values.set(label, current);
  }
  return Array.from(values.values()).sort((left, right) => right.scans - left.scans || left.label.localeCompare(right.label, "es"));
}

export function summarizeDailyActivity(rows: DailyActivityRow[]) {
  const scans = rows.filter((row) => row.eventType === "SCAN");
  return {
    totalScans: scans.length,
    incidents: rows.filter(isActivityIncident).length,
    priceErrors: scans.filter((row) => row.observation === "PRECIO ERRÓNEO").length,
    mislabeled: scans.filter((row) => row.observation === "MAL ETIQUETADO").length,
    withoutLabel: scans.filter((row) => row.observation === "SIN ETIQUETA").length,
    smallerSizeNotDisplayed: rows.filter((row) => row.eventType === "SIZE_NOT_DISPLAYED").length,
    byEmployee: grouped(rows, (row) => row.employeeName),
    byBrand: grouped(rows, (row) => row.brand),
    byCategory: grouped(rows, (row) => row.category),
  };
}

export function summarizeActivityByStore(rows: ActivityCountRow[], stores: ActivityStore[]): StoreActivitySummary[] {
  const summaries = new Map(stores.map((store) => [store.id, {
    storeId: store.id,
    storeName: store.name,
    scans: 0,
    incidents: 0,
    priceErrors: 0,
    mislabeled: 0,
    withoutLabel: 0,
    smallerSizeNotDisplayed: 0,
  }]));

  for (const row of rows) {
    const summary = summaries.get(row.storeId);
    if (!summary) continue;
    if (row.eventType === "SCAN") summary.scans += 1;
    if (isActivityIncident(row)) summary.incidents += 1;
    if (row.observation === "PRECIO ERRÓNEO") summary.priceErrors += 1;
    if (row.observation === "MAL ETIQUETADO") summary.mislabeled += 1;
    if (row.observation === "SIN ETIQUETA") summary.withoutLabel += 1;
    if (row.eventType === "SIZE_NOT_DISPLAYED") summary.smallerSizeNotDisplayed += 1;
  }

  return Array.from(summaries.values()).sort((left, right) => right.incidents - left.incidents || right.scans - left.scans || left.storeName.localeCompare(right.storeName, "es"));
}

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function caracasWeekRange(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const selected = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (selected.getUTCDay() + 6) % 7;
  const startDate = shiftIsoDate(value, -mondayOffset);
  const endDateExclusive = shiftIsoDate(startDate, 7);
  return {
    startDate,
    endDateExclusive,
    startIso: `${startDate}T04:00:00.000Z`,
    endIso: `${endDateExclusive}T04:00:00.000Z`,
  };
}

export function dateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
