import { gzipSync, Gunzip } from "fflate";
import type { CatalogImportProduct } from "@/app/lib/catalog-import";
import { validateCatalogProducts } from "@/app/lib/local-catalog";

const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 128 * 1024 * 1024;
type CatalogTuple = [string, string, string, string, string, string, number, number, string, string];

export type SharedCatalogMeta = {
  store_id: string;
  version: string;
  object_path: string;
  file_name: string;
  row_count: number;
  compressed_bytes: number;
  sha256: string;
  updated_at: string;
};

export async function catalogChecksum(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function encodeSharedCatalog(storeId: string, version: string, products: CatalogImportProduct[]) {
  validateCatalogProducts(products);
  const rows: CatalogTuple[] = products.map(p => [p.barcode, p.article, p.description, p.color,
    p.size, p.style, p.amount, p.discount_percent, p.brand, p.category]);
  const json = new TextEncoder().encode(JSON.stringify({ schema: 1, store: storeId, version, rows }));
  if (json.byteLength > MAX_JSON_BYTES) throw new Error("El catálogo es demasiado grande para prepararlo en el dispositivo.");
  const bytes = gzipSync(json, { level: 6 });
  if (bytes.byteLength > MAX_COMPRESSED_BYTES) throw new Error("El catálogo comprimido supera el máximo permitido de 20 MB.");
  return { bytes, sha256: await catalogChecksum(bytes) };
}

export async function decodeSharedCatalog(bytes: Uint8Array, meta: SharedCatalogMeta): Promise<CatalogImportProduct[]> {
  if (!bytes.byteLength || bytes.byteLength > MAX_COMPRESSED_BYTES || bytes.byteLength !== meta.compressed_bytes
    || await catalogChecksum(bytes) !== meta.sha256) {
    throw new Error("La descarga del catálogo está incompleta. Se conserva el inventario anterior y se volverá a intentar.");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const unzip = new Gunzip(chunk => {
    length += chunk.byteLength;
    if (length > MAX_JSON_BYTES) throw new Error("El catálogo descargado supera el tamaño permitido.");
    chunks.push(chunk);
  });
  // Limit decompressed output before allocating the final JSON buffer.
  for (let start = 0; start < bytes.length; start += 4096) {
    unzip.push(bytes.subarray(start, start + 4096), start + 4096 >= bytes.length);
  }
  const json = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { json.set(chunk, offset); offset += chunk.length; }
  const payload = JSON.parse(new TextDecoder().decode(json));
  if (payload.schema !== 1 || payload.store !== meta.store_id || payload.version !== meta.version
    || !Array.isArray(payload.rows) || payload.rows.length !== meta.row_count) {
    throw new Error("El catálogo descargado no corresponde a la tienda o versión seleccionada.");
  }
  const products: CatalogImportProduct[] = payload.rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 10 || row.some((value, index) =>
      index === 6 || index === 7 ? typeof value !== "number" : typeof value !== "string")) {
      throw new Error("El catálogo descargado contiene una fila inválida.");
    }
    const [barcode, article, description, color, size, style, amount, discount_percent, brand, category] = row as CatalogTuple;
    return { barcode, article, description, color, size, style, amount, discount_percent, brand, category };
  });
  validateCatalogProducts(products);
  return products;
}
