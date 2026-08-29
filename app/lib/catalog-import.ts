import { utils, type WorkBook } from "xlsx";
import { normalizeBarcode } from "@/app/lib/barcode";

export type CatalogImportProduct = {
  barcode: string;
  article: string;
  description: string;
  color: string;
  size: string;
  style: string;
  amount: number;
};

export type ParsedCatalog = {
  products: CatalogImportProduct[];
  sourceSheet: string;
  totalRows: number;
  skippedRows: number;
  duplicateRows: number;
};

type CatalogColumn = "barcode" | "article" | "description" | "color" | "size" | "style" | "amount";
type ColumnMap = Record<CatalogColumn, number>;

const HEADER_ALIASES: Record<CatalogColumn, string[]> = {
  barcode: ["codigo barras", "codigo de barras", "codigo barra", "codigo de barra", "barcode", "ean", "upc", "codigo"],
  article: ["articulo", "codigo articulo", "sku", "referencia", "codigo"],
  description: ["descripcion", "producto", "nombre producto", "nombre"],
  color: ["color"],
  size: ["tamano", "talla", "size"],
  style: ["estilo", "style"],
  amount: ["monto a pagar", "monto pagar", "precio final", "monto neto", "precio venta", "precio"],
};

const normalizeHeader = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const cleanText = (value: unknown, fallback = "No especificado") => String(value ?? "").trim() || fallback;

const parseAmount = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const compact = String(value ?? "").trim().replace(/[^0-9,.-]/g, "");
  if (!compact) return 0;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;
  if (lastComma > lastDot) normalized = compact.replace(/\./g, "").replace(",", ".");
  else if (lastDot > -1) normalized = compact.replace(/,/g, "");
  else normalized = compact.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
};

function resolveColumns(row: unknown[]): ColumnMap {
  const headers = row.map(normalizeHeader);
  const find = (aliases: string[]) => aliases
    .map(normalizeHeader)
    .map((alias) => headers.indexOf(alias))
    .find((index) => index >= 0) ?? -1;
  return {
    barcode: find(HEADER_ALIASES.barcode),
    article: find(HEADER_ALIASES.article),
    description: find(HEADER_ALIASES.description),
    color: find(HEADER_ALIASES.color),
    size: find(HEADER_ALIASES.size),
    style: find(HEADER_ALIASES.style),
    amount: find(HEADER_ALIASES.amount),
  };
}

export function parseCatalogWorkbook(workbook: WorkBook): ParsedCatalog {
  for (const sourceSheet of workbook.SheetNames) {
    const sheet = workbook.Sheets[sourceSheet];
    if (!sheet) continue;
    const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true, blankrows: false });
    const headerLimit = Math.min(rows.length, 30);
    let headerIndex = -1;
    let columns: ColumnMap | null = null;

    for (let index = 0; index < headerLimit; index += 1) {
      const candidate = resolveColumns(rows[index] ?? []);
      if (candidate.barcode >= 0 && candidate.amount >= 0) {
        headerIndex = index;
        columns = candidate;
        break;
      }
    }

    if (!columns || headerIndex < 0) continue;

    const seen = new Set<string>();
    const products: CatalogImportProduct[] = [];
    let skippedRows = 0;
    let duplicateRows = 0;
    const dataRows = rows.slice(headerIndex + 1);

    for (const row of dataRows) {
      const barcode = normalizeBarcode(row[columns.barcode]);
      if (!barcode) {
        skippedRows += 1;
        continue;
      }
      if (seen.has(barcode)) {
        duplicateRows += 1;
        continue;
      }
      seen.add(barcode);
      products.push({
        barcode,
        article: columns.article >= 0 ? cleanText(row[columns.article], barcode) : barcode,
        description: columns.description >= 0 ? cleanText(row[columns.description], "") : "",
        color: columns.color >= 0 ? cleanText(row[columns.color]) : "No especificado",
        size: columns.size >= 0 ? cleanText(row[columns.size]) : "No especificado",
        style: columns.style >= 0 ? cleanText(row[columns.style]) : "No especificado",
        amount: parseAmount(row[columns.amount]),
      });
    }

    if (products.length) {
      return { products, sourceSheet, totalRows: dataRows.length, skippedRows, duplicateRows };
    }
  }

  throw new Error("No se encontraron las columnas ‘Código barras’ y ‘Monto a Pagar’ ni productos válidos en el Excel.");
}

export function getImportErrorMessage(error: unknown) {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "No fue posible completar la importación.";
  const normalized = raw.toLowerCase();
  if (normalized.includes("row-level security") || normalized.includes("permission denied")) {
    return "Esta cuenta no tiene permiso para cargar el catálogo de la tienda seleccionada.";
  }
  if (normalized.includes("variant") && normalized.includes("column")) {
    return "La estructura de productos de Supabase está desactualizada. Actualiza la base de datos e inténtalo de nuevo.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "Se perdió la conexión durante la carga. Comprueba internet e inténtalo nuevamente.";
  }
  return raw;
}
