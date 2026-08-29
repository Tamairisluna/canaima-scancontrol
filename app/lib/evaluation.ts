export const OBSERVATIONS = ["SIN INCIDENCIAS", "PRECIO ERRÓNEO", "MAL ETIQUETADO", "SIN ETIQUETA"] as const;

export type Observation = typeof OBSERVATIONS[number];

export function summarizeEvaluation(items: ReadonlyArray<{ observation: Observation }>) {
  const total = items.length;
  const incorrectPrice = items.filter((item) => item.observation === "PRECIO ERRÓNEO").length;
  const mislabeled = items.filter((item) => item.observation === "MAL ETIQUETADO").length;
  const withoutLabel = items.filter((item) => item.observation === "SIN ETIQUETA").length;
  const withoutIncidents = Math.max(0, total - incorrectPrice - mislabeled - withoutLabel);

  return [
    { observation: "SIN INCIDENCIAS" as const, count: withoutIncidents },
    { observation: "PRECIO ERRÓNEO" as const, count: incorrectPrice },
    { observation: "MAL ETIQUETADO" as const, count: mislabeled },
    { observation: "SIN ETIQUETA" as const, count: withoutLabel },
  ];
}
