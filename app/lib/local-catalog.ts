import type { CatalogImportProduct } from "@/app/lib/catalog-import";
import { normalizeBarcode } from "@/app/lib/barcode";

const DATABASE = "scancontrol-local-catalogs";
const OBJECT_STORE = "catalogs";
const CHANGE_EVENT = "scancontrol:catalog-changed";
const CHANNEL = "scancontrol-local-catalogs";
const PROJECT = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://wmewkfkriihwaxqpeecs.supabase.co";

export type CatalogScope = { userId: string; storeId: string };
export type LocalCatalog = {
  key: string;
  schemaVersion: 1;
  id: string;
  userId: string;
  storeId: string;
  fileName: string;
  activatedAt: string;
  products: CatalogImportProduct[];
};

function scopeKey(scope: CatalogScope) {
  if (!scope.userId || !scope.storeId) throw new Error("Inicia sesión y selecciona una tienda antes de cargar el Excel.");
  return JSON.stringify([PROJECT, scope.userId, scope.storeId]);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Este navegador no permite guardar el catálogo. Abre ScanControl en un navegador actualizado."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OBJECT_STORE, { keyPath: "key" });
    };
    request.onblocked = () => fail(new Error("Cierra las otras ventanas de ScanControl y vuelve a intentar cargar el Excel."));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (settled) { database.close(); return; }
      settled = true;
      resolve(database);
    };
  });
}

function validateProducts(products: CatalogImportProduct[]) {
  if (!products.length) throw new Error("El Excel no contiene productos válidos. Se conserva el catálogo anterior.");
  const seen = new Set<string>();
  for (const product of products) {
    const barcode = normalizeBarcode(product.barcode);
    if (!barcode || barcode !== product.barcode || seen.has(barcode)
      || !Number.isFinite(product.amount) || !Number.isFinite(product.discount_percent)
      || product.discount_percent < 0 || product.discount_percent > 100) {
      throw new Error("El catálogo contiene datos inválidos. Se conserva el catálogo anterior.");
    }
    seen.add(barcode);
  }
}

export async function readLocalCatalog(scope: CatalogScope): Promise<LocalCatalog | null> {
  const key = scopeKey(scope);
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, "readonly");
    const request = transaction.objectStore(OBJECT_STORE).get(key);
    let catalog: LocalCatalog | null = null;
    request.onsuccess = () => { catalog = request.result ?? null; };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? request.error); };
    transaction.oncomplete = () => {
      database.close();
      if (catalog && (catalog.schemaVersion !== 1 || catalog.key !== key
        || catalog.userId !== scope.userId || catalog.storeId !== scope.storeId
        || !Array.isArray(catalog.products) || !catalog.products.length)) {
        reject(new Error("No se pudo leer el catálogo de este dispositivo. Vuelve a cargar el Excel de esta tienda."));
        return;
      }
      resolve(catalog);
    };
  });
}

export async function replaceLocalCatalog(scope: CatalogScope, fileName: string, products: CatalogImportProduct[]): Promise<LocalCatalog> {
  const key = scopeKey(scope);
  validateProducts(products);
  const catalog: LocalCatalog = {
    key, schemaVersion: 1, id: `local:${crypto.randomUUID()}`,
    userId: scope.userId, storeId: scope.storeId,
    fileName, activatedAt: new Date().toISOString(), products,
  };
  const database = await openDatabase();
  // One transaction replaces the whole store catalog. An aborted write (quota,
  // browser closure, etc.) leaves the previous record untouched. Only completion
  // confirms success; the put request alone is insufficient.
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, "readwrite");
    let request: IDBRequest;
    try {
      request = transaction.objectStore(OBJECT_STORE).put(catalog);
    } catch (error) {
      transaction.abort();
      database.close();
      reject(error);
      return;
    }
    transaction.onabort = () => { database.close(); reject(transaction.error ?? request.error); };
    transaction.oncomplete = () => { database.close(); resolve(); };
  });
  // Persistence is best effort. Denial must not turn a committed write into an
  // apparent import failure, nor prompt before the catalog has been saved.
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => {});
  }
  announceChange(key);
  return catalog;
}

function announceChange(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage(key);
      channel.close();
    } catch { /* The committed catalog is still valid when messaging is unavailable. */ }
  }
}

export function subscribeLocalCatalog(scope: CatalogScope, onChange: () => void) {
  const key = scopeKey(scope);
  const handleEvent = (event: Event) => { if ((event as CustomEvent<string>).detail === key) onChange(); };
  window.addEventListener(CHANGE_EVENT, handleEvent);
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => { if (event.data === key) onChange(); };
    }
  } catch { /* Local imports and subsequent app openings remain available. */ }
  return () => { window.removeEventListener(CHANGE_EVENT, handleEvent); channel?.close(); };
}

export function localCatalogErrorMessage(error: unknown) {
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  if (name === "QuotaExceededError") return "No hay espacio suficiente en este dispositivo. Libera espacio y vuelve a cargar el Excel. Se conserva el catálogo anterior.";
  if (name === "SecurityError" || name === "InvalidStateError") return "El navegador no permite guardar el Excel. Comprueba que el almacenamiento del sitio esté habilitado y vuelve a intentarlo.";
  return error instanceof Error ? error.message : "No se pudo guardar el Excel en este dispositivo. Se conserva el catálogo anterior.";
}
