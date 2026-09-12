import { utils, type WorkBook } from "xlsx";

// Article identity is separate from barcode lookup. Preserve case and zeroes.
export const normalizeTransferArticle = (value: unknown) => String(value ?? "").trim();

export function parseTransfersWorkbook(workbook: WorkBook): string[] {
  for (const name of workbook.SheetNames) {
    const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false });
    const header = rows.findIndex((row, i) => i < 30 && row.filter((cell) => String(cell).trim()).length === 1 && row.some((cell) => String(cell).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() === "articulo"));
    if (header < 0) continue;
    const column = rows[header].findIndex((cell) => String(cell).trim());
    const articles = new Set<string>();
    for (const row of rows.slice(header + 1)) {
      if (row.some((cell, i) => i !== column && String(cell).trim())) throw new Error("El Excel de traslados debe tener únicamente la columna Articulo.");
      const article = normalizeTransferArticle(row[column]);
      if (article) articles.add(article);
    }
    if (!articles.size) throw new Error("El Excel de traslados no contiene artículos.");
    if (articles.size > 100000) throw new Error("El archivo supera los 100.000 artículos permitidos por carga.");
    return [...articles];
  }
  throw new Error("El Excel de traslados debe contener una sola columna llamada Articulo.");
}
