import { supabase } from "@/app/lib/supabase";
import { readLocalCatalog, replaceLocalCatalog, type CatalogScope, type LocalCatalog } from "@/app/lib/local-catalog";
import { decodeSharedCatalog, encodeSharedCatalog, type SharedCatalogMeta } from "@/app/lib/shared-catalog-codec";
import type { CatalogImportProduct } from "@/app/lib/catalog-import";

const BUCKET = "scancontrol-catalogs";
const COLUMNS = "store_id,version,object_path,file_name,row_count,compressed_bytes,sha256,updated_at";
const setupMessage = "No se pudo acceder al catálogo compartido. El inventario anterior sigue disponible; inténtalo nuevamente o contacta al encargado.";

export async function getSharedCatalog(storeId: string): Promise<{ available: boolean; meta: SharedCatalogMeta | null }> {
  const { data, error } = await supabase.from("store_catalog_files").select(COLUMNS).eq("store_id", storeId).maybeSingle();
  if (error) {
    // The application remains compatible while the additive SQL is installed.
    if (["42P01", "PGRST205"].includes(error.code)) return { available: false, meta: null };
    throw new Error(error.message);
  }
  return { available: true, meta: data as SharedCatalogMeta | null };
}

export async function syncSharedCatalog(scope: CatalogScope, current: LocalCatalog | null,
  canCommit: () => boolean = () => true): Promise<{ available: boolean; catalog: LocalCatalog | null; warning?: string }> {
  const result = await getSharedCatalog(scope.storeId);
  const { meta } = result;
  if (!meta || !canCommit() || current?.sharedVersion === meta.version) return { available: result.available, catalog: current };
  const { data, error } = await supabase.storage.from(BUCKET).download(meta.object_path);
  if (error || !data) throw new Error("No se pudo descargar la actualización. Se conserva el inventario anterior; comprueba la conexión.");
  const products = await decodeSharedCatalog(new Uint8Array(await data.arrayBuffer()), meta);
  if (!canCommit()) return { available: result.available, catalog: current };
  // An import may have committed while the download was in flight. Never let
  // that old response overwrite a newer locally published shared version.
  const latest = await readLocalCatalog(scope).catch(() => null);
  if (latest?.sharedVersion && Date.parse(latest.activatedAt) > Date.parse(meta.updated_at)) {
    return { available: true, catalog: latest };
  }
  if (!canCommit()) return { available: true, catalog: current };
  try {
    const catalog = await replaceLocalCatalog(scope, meta.file_name, products, { version: meta.version, updatedAt: meta.updated_at });
    return { available: true, catalog };
  } catch {
    // Scanning can still use the validated latest products in memory when the
    // phone is out of space. Do not fall back silently to old cloud prices.
    const catalog: LocalCatalog = { key: "", schemaVersion: 1, id: `shared:${meta.version}`,
      userId: scope.userId, storeId: scope.storeId, fileName: meta.file_name, activatedAt: meta.updated_at,
      sharedVersion: meta.version, products };
    return { available: true, catalog, warning: "El catálogo actualizado está listo para escanear. Libera espacio en este dispositivo para conservarlo al cerrar la app." };
  }
}

async function cleanupOldFiles(storeId: string, previousPath: string | null, activePath: string) {
  const storage = supabase.storage.from(BUCKET);
  if (previousPath) await storage.remove([previousPath]);
  // Failed/closed imports can leave staged objects. Clean only stale files;
  // a pending upload is retained and RLS always protects the current pointer.
  const { data } = await storage.list(storeId, { limit: 1000 });
  const threshold = Date.now() - 60 * 60 * 1000;
  const stale = (data ?? []).filter(file => `${storeId}/${file.name}` !== activePath && /^[0-9a-f-]{36}\.json\.gz$/.test(file.name)
    && file.created_at && new Date(file.created_at).getTime() < threshold).map(file => `${storeId}/${file.name}`);
  // Remove independently: an active file rejected by RLS must not prevent
  // cleanup of the other stale objects in the same directory.
  for (const path of stale) await storage.remove([path]);
}

export async function publishSharedCatalog(scope: CatalogScope, fileName: string, products: CatalogImportProduct[],
  onStage: (stage: "preparing" | "uploading" | "activating" | "caching") => void,
  canCommit: () => boolean = () => true) {
  const initial = await getSharedCatalog(scope.storeId);
  if (!initial.available) throw new Error(setupMessage);
  const version = crypto.randomUUID();
  const path = `${scope.storeId}/${version}.json.gz`;
  onStage("preparing");
  const { bytes, sha256 } = await encodeSharedCatalog(scope.storeId, version, products);
  if (!canCommit()) throw new Error("La sesión o tienda cambió. Vuelve a cargar el archivo en la tienda correspondiente.");
  onStage("uploading");
  const storage = supabase.storage.from(BUCKET);
  const { error: uploadError } = await storage.upload(path, new Blob([new Uint8Array(bytes).buffer], { type: "application/gzip" }), {
    contentType: "application/gzip", cacheControl: "31536000", upsert: false,
  });
  if (uploadError) throw new Error(`No se pudo compartir el catálogo: ${uploadError.message}. Se conserva el inventario anterior.`);
  let meta: SharedCatalogMeta;
  let previousPath: string | null = null;
  try {
    if (!canCommit()) throw new Error("La sesión o tienda cambió. Se conserva el catálogo compartido anterior.");
    onStage("activating");
    const { data, error } = await supabase.rpc("publish_store_catalog_file", {
      p_store_id: scope.storeId, p_version: version, p_expected_version: initial.meta?.version ?? null,
      p_file_name: fileName, p_row_count: products.length, p_compressed_bytes: bytes.byteLength, p_sha256: sha256,
    });
    if (error) {
      // A timeout/connection loss can arrive after a successful commit. Read
      // the pointer before reporting a failed publication or cleaning staging.
      const observed = await getSharedCatalog(scope.storeId);
      if (observed.meta?.version !== version) throw new Error(error.message);
      meta = observed.meta;
    } else {
      meta = data as SharedCatalogMeta;
      previousPath = (data as { previous_path?: string | null })?.previous_path ?? null;
    }
    if (!meta || meta.version !== version || meta.store_id !== scope.storeId) throw new Error("No se pudo confirmar el catálogo compartido.");
  } catch (error) {
    // DELETE policy disallows removing an active object, including when a
    // publish succeeded but its response could not reach this phone.
    await storage.remove([path]).catch(() => {});
    throw error;
  }
  onStage("caching");
  let catalog: LocalCatalog | null = null;
  let localWarning = "";
  if (canCommit()) {
    try { catalog = await replaceLocalCatalog(scope, fileName, products, { version, updatedAt: meta.updated_at }); }
    catch { localWarning = "El catálogo ya está compartido. Este dispositivo no pudo guardar la copia local; libera espacio para conservarlo sin conexión."; }
  }
  // Cleanup errors must not disguise a successfully published catalog as a
  // failed upload. The next upload retries stale-object cleanup.
  void cleanupOldFiles(scope.storeId, previousPath, meta.object_path).catch(() => {});
  return { meta, catalog, localWarning };
}
