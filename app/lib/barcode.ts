export function normalizeBarcode(value: unknown) {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(Math.trunc(value))
    : String(value ?? "");

  return raw
    .trim()
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, "")
    .replace(/\.0$/, "");
}

export function getBarcodeCandidates(value: unknown) {
  const normalized = normalizeBarcode(value);
  if (!normalized) return [];

  const candidates = new Set<string>([normalized]);
  const withoutSymbologyIdentifier = normalized.replace(/^\][A-Za-z][0-9]/, "");
  if (withoutSymbologyIdentifier) candidates.add(withoutSymbologyIdentifier);

  for (const code of [...candidates]) {
    if (!/^\d+$/.test(code)) continue;
    if (code.length === 12) candidates.add(`0${code}`);
    if (code.length === 13 && code.startsWith("0")) candidates.add(code.slice(1));
  }

  return [...candidates];
}
