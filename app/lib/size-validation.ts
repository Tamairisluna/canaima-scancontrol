export type SizeProduct = {
  article: string;
  color: string;
  size: string;
};

export type MinimumSizeResult =
  | { status: "minimum"; expectedSize: string; candidates: number }
  | { status: "not-minimum"; expectedSize: string; candidates: number }
  | { status: "unknown"; reason: string; candidates: number };

const LETTER_SIZES = new Map([
  ["XXXS", 0], ["XXS", 1], ["XS", 2], ["S", 3], ["M", 4],
  ["L", 5], ["XL", 6], ["XXL", 7], ["XXXL", 8],
]);

export const normalizeProductText = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .replace(/\s+/g, " ")
  .toUpperCase();

type ComparableSize = { family: string; order: number };

function parseComparableSize(value: string): ComparableSize | null {
  const normalized = normalizeProductText(value).replace(/\s+/g, "");
  if (!normalized || normalized === "NOESPECIFICADO") return null;
  const letterOrder = LETTER_SIZES.get(normalized);
  if (letterOrder !== undefined) return { family: "letters", order: letterOrder };

  const numeric = normalized.match(/^(\d+(?:[.,]\d+)?)$/);
  if (numeric) return { family: "numeric", order: Number(numeric[1].replace(",", ".")) };

  const prefixed = normalized.match(/^([A-Z]+)(\d+(?:[.,]\d+)?)$/);
  if (prefixed) return { family: `prefix:${prefixed[1]}`, order: Number(prefixed[2].replace(",", ".")) };

  const suffixed = normalized.match(/^(\d+(?:[.,]\d+)?)([A-Z]+)$/);
  if (suffixed) return { family: `suffix:${suffixed[2]}`, order: Number(suffixed[1].replace(",", ".")) };

  return null;
}

export function findMinimumSize(scanned: SizeProduct, products: Iterable<SizeProduct>): MinimumSizeResult {
  const article = normalizeProductText(scanned.article);
  const color = normalizeProductText(scanned.color);
  const candidates = Array.from(products).filter((product) =>
    normalizeProductText(product.article) === article && normalizeProductText(product.color) === color,
  );
  const uniqueSizes = new Map<string, string>();
  for (const candidate of candidates) {
    const normalized = normalizeProductText(candidate.size);
    if (normalized && normalized !== "NO ESPECIFICADO" && !uniqueSizes.has(normalized)) uniqueSizes.set(normalized, candidate.size.trim());
  }
  if (!uniqueSizes.size) return { status: "unknown", reason: "El Excel no contiene tallas comparables para este artículo y color.", candidates: candidates.length };

  const comparable = Array.from(uniqueSizes.entries()).map(([normalized, original]) => ({ normalized, original, parsed: parseComparableSize(original) }));
  if (comparable.some((item) => !item.parsed)) return { status: "unknown", reason: "El formato de talla no permite determinar un orden seguro.", candidates: candidates.length };
  const families = new Set(comparable.map((item) => item.parsed?.family));
  if (families.size !== 1) return { status: "unknown", reason: "El Excel mezcla formatos de talla incompatibles.", candidates: candidates.length };

  const ordered = comparable.sort((left, right) => (left.parsed?.order ?? 0) - (right.parsed?.order ?? 0));
  const expected = ordered[0];
  if (!expected) return { status: "unknown", reason: "No se pudo determinar una talla menor.", candidates: candidates.length };
  return normalizeProductText(scanned.size) === expected.normalized
    ? { status: "minimum", expectedSize: expected.original, candidates: candidates.length }
    : { status: "not-minimum", expectedSize: expected.original, candidates: candidates.length };
}

export function matchesExpectedMinimum(scanned: SizeProduct, blocked: SizeProduct, expectedSize: string) {
  return normalizeProductText(scanned.article) === normalizeProductText(blocked.article)
    && normalizeProductText(scanned.color) === normalizeProductText(blocked.color)
    && normalizeProductText(scanned.size) === normalizeProductText(expectedSize);
}
