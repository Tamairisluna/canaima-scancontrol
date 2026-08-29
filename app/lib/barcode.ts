export function normalizeBarcode(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, "");
}
