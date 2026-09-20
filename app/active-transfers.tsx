"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Trash2, Upload } from "lucide-react";
import { supabase } from "@/app/lib/supabase";
import { TechnicalIcon } from "@/app/technical-icon";
import { Button } from "@/components/ui/button";

type TransferFile = { store_id: string; file_name: string; articles: string[]; updated_at: string };
const activity = (value: "picking" | "importing" | null) => {
  if (value) document.documentElement.setAttribute("data-scancontrol-file-activity", value);
  else document.documentElement.removeAttribute("data-scancontrol-file-activity");
  window.dispatchEvent(new CustomEvent("scancontrol:file-activity", { detail: { activity: value } }));
};

export function useActiveTransfers(storeId: string, userId: string | null) {
  const [record, setRecord] = useState<TransferFile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const scope = useRef(`${storeId}:${userId}`);
  const refresh = useCallback(async () => {
    if (scope.current !== `${storeId}:${userId}`) return;
    const version = ++revision.current;
    if (!storeId || !userId) { setRecord(null); return; }
    setLoading(true);
    try {
      const result = await supabase.from("active_transfer_files").select("store_id,file_name,articles,updated_at").eq("store_id", storeId).maybeSingle();
      if (version !== revision.current || scope.current !== `${storeId}:${userId}`) return;
      setRecord(result.error ? null : result.data as TransferFile | null);
      setError(result.error ? "No se pudieron consultar los traslados. Comprueba la conexión y que estén activados en Supabase." : "");
    } catch {
      if (version === revision.current && scope.current === `${storeId}:${userId}`) { setRecord(null); setError("No se pudieron consultar los traslados. Comprueba la conexión."); }
    } finally { if (version === revision.current && scope.current === `${storeId}:${userId}`) setLoading(false); }
  }, [storeId, userId]);
  useEffect(() => {
    scope.current = `${storeId}:${userId}`;
    const initial = window.setTimeout(() => void refresh(), 0);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    // Refresh independently: never place a network request in the scanner path.
    const timer = window.setInterval(visible, 60000);
    return () => { scope.current = ""; window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh, storeId, userId]);
  const current = record?.store_id === storeId ? record : null;
  const articles = useMemo(() => new Set(current?.articles ?? []), [current]);
  return { record: current, articles, error, loading, refresh };
}

export function ActiveTransfers({ storeId, userId, storeName, state, inventoryBusy, onBusyChange }: {
  storeId: string; userId: string | null; storeName: string; state: ReturnType<typeof useActiveTransfers>; inventoryBusy: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  const consume = useCallback(async () => {
    const input = inputRef.current;
    const file = input?.files?.item(0);
    if (!input || !file || busyRef.current || inventoryBusy) return;
    busyRef.current = true;
    setBusy(true); setFailed(false); setMessage("Leyendo Excel de traslados…"); activity("importing");
    try {
      if (!storeId || !userId) throw new Error("Selecciona tu tienda e inicia sesión.");
      if (file.size > 20 * 1024 * 1024) throw new Error("El archivo supera los 20 MB.");
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Selecciona un archivo XLSX o XLS.");
      // Read the native File immediately on Android, before any deferred imports.
      const bytesPromise = file.arrayBuffer();
      const [bytes, { read }, { parseTransfersWorkbook }] = await Promise.all([bytesPromise, import("xlsx"), import("@/app/lib/transfers")]);
      const articles = parseTransfersWorkbook(read(bytes, { type: "array" }));
      setMessage("Guardando traslados…");
      const { error } = await supabase.from("active_transfer_files").upsert({ store_id: storeId, file_name: file.name, articles, uploaded_by: userId, updated_at: new Date().toISOString() }, { onConflict: "store_id" }).select("store_id").single();
      if (error) throw new Error(error.message);
      await state.refresh();
      setMessage(`${articles.length.toLocaleString("es")} artículos de traslado guardados en ${storeName}.`);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "No se pudo cargar el Excel. Inténtalo nuevamente."); }
    finally { input.value = ""; busyRef.current = false; setBusy(false); activity(null); }
  }, [storeId, userId, storeName, inventoryBusy, state]);
  const consumeRef = useRef(consume);
  useEffect(() => { consumeRef.current = consume; }, [consume]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const timers = new Set<number>();
    const receive = () => { void consumeRef.current(); };
    const cancel = () => { if (!busyRef.current && !input.files?.length) activity(null); };
    const recover = () => {
      if (document.visibilityState === "hidden") return;
      for (const delay of [0, 120, 400, 900]) {
        const timer = window.setTimeout(() => { timers.delete(timer); receive(); }, delay); timers.add(timer);
      }
      const timer = window.setTimeout(() => { timers.delete(timer); cancel(); }, 1400); timers.add(timer);
    };
    input.addEventListener("change", receive); input.addEventListener("input", receive); input.addEventListener("cancel", cancel);
    window.addEventListener("focus", recover); window.addEventListener("pageshow", recover); document.addEventListener("visibilitychange", recover);
    return () => {
      input.removeEventListener("change", receive); input.removeEventListener("input", receive); input.removeEventListener("cancel", cancel);
      window.removeEventListener("focus", recover); window.removeEventListener("pageshow", recover); document.removeEventListener("visibilitychange", recover);
      timers.forEach(window.clearTimeout);
    };
  }, []);
  async function remove() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setFailed(false);
    try {
      const { data, error } = await supabase.from("active_transfer_files").delete().eq("store_id", storeId).select("store_id");
      if (error || !data?.length) throw new Error(error?.message || "No se pudo eliminar. Actualiza la lista e inténtalo otra vez.");
      await state.refresh(); setMessage("Excel de traslados eliminado de esta tienda."); setConfirmDelete(false);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "No se pudo eliminar."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section className="transfers-card" aria-busy={busy}>
    <div className="transfers-heading"><span className="transfers-heading-icon" aria-hidden="true"><TechnicalIcon kind="transfer" size={24}/></span><div><h2>Traslados activos</h2><p>Excel independiente de {storeName}. Una columna: Articulo.</p></div></div>
    <label className="upload-select-button upload-native-picker"><Upload size={19}/><span>{busy ? "Procesando…" : "Seleccionar Excel de traslados"}</span><input ref={inputRef} type="file" disabled={busy || inventoryBusy || !storeId} aria-label="Seleccionar Excel de traslados" onClick={() => activity("picking")} onInput={() => void consume()} onChange={() => void consume()}/></label>
    <small>Formato XLSX o XLS · Máximo 20 MB</small>
    {state.record && <div className="transfers-file"><strong>{state.record.file_name}</strong><span>{state.record.articles.length.toLocaleString("es")} artículos · {new Date(state.record.updated_at).toLocaleString("es-VE")}</span></div>}
    {!state.record && !state.loading && !state.error && <p>No hay un Excel de traslados cargado.</p>}
    {state.loading && <p><LoaderCircle size={16} className="spin"/> Consultando traslados…</p>}
    {(message || state.error) && <p className={failed || state.error ? "transfers-error" : "transfers-message"} role={failed || state.error ? "alert" : "status"}>{message || state.error}</p>}
    {state.error && <Button variant="outline" onClick={() => void state.refresh()} disabled={busy}>Reintentar consulta</Button>}
    {state.record && (confirmDelete ? <div className="transfers-delete"><p>¿Eliminar los traslados de {storeName}?</p><Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</Button><Button disabled={busy || inventoryBusy} onClick={() => void remove()}>Confirmar eliminación</Button></div> : <Button variant="outline" disabled={busy || inventoryBusy} onClick={() => setConfirmDelete(true)}><Trash2 size={16}/> Eliminar Excel de traslados</Button>)}
  </section>;
}
