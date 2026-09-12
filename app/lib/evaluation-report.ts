import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
import { summarizeEvaluation, type Observation } from "./evaluation";

export type ReportItem = {
  article: string; barcode: string; description: string; color: string;
  size: string; amount: number; observation: Observation;
};

export function createEvaluationReport(storeName: string, items: ReportItem[], date = new Date()) {
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const summary = summarizeEvaluation(items);
  const incidents = items.filter((item) => item.observation !== "SIN INCIDENCIAS");
  const thin = { style: BorderStyle.SINGLE, size: 4, color: "DCE4E9" };
  const cell = (text: string, width: number, header = false, shaded = false) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 110, bottom: 110, left: 110, right: 110 },
    borders: { bottom: thin },
    shading: { fill: header ? "073F5C" : shaded ? "F4F7F9" : "FFFFFF" },
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text, bold: header, color: header ? "FFFFFF" : "172F3D", size: 20 })] })],
  });
  const table = (labels: string[], widths: number[], rows: string[][]) => new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: labels.map((label, i) => cell(label, widths[i], true)) }),
      ...rows.map((row, index) => new TableRow({ cantSplit: true, children: row.map((value, i) => cell(value, widths[i], false, index % 2 === 1)) })),
    ],
  });
  const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 140 }, keepNext: true });
  return new Document({
    creator: "Grupo Canaima", title: "Informe de evaluación de productos",
    styles: { default: {
      document: { run: { font: "Arial", size: 22, color: "172F3D" }, paragraph: { spacing: { after: 140, line: 276 } } },
      title: { run: { font: "Arial", size: 36, bold: true, color: "000000" } },
      heading1: { run: { font: "Arial", size: 26, bold: true, color: "000000" } },
    } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1000, bottom: 1000, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
        new TextRun({ text: "ScanControl · Página ", size: 18, color: "61717C" }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
        new TextRun({ text: " de ", size: 18 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 }),
      ] })] }) },
      children: [
        new Paragraph({ text: "GRUPO CANAIMA", spacing: { after: 100 } }),
        new Paragraph({ text: "Informe de evaluación de productos", heading: HeadingLevel.TITLE, spacing: { after: 220 } }),
        new Paragraph({ children: [new TextRun({ text: "Tienda evaluada: ", bold: true }), new TextRun(storeName)] }),
        new Paragraph({ children: [new TextRun({ text: "Fecha de emisión: ", bold: true }), new TextRun(new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "America/Caracas" }).format(date))] }),
        new Paragraph("Resultado de la verificación de productos. El resumen incluye todas las piezas evaluadas y el detalle identifica las incidencias registradas."),
        heading("Resumen de la evaluación"),
        table(["Resultado", "Piezas"], [7000, 2360], [
          ["Total evaluado", String(items.length)],
          ...summary.map((item) => [item.observation, String(item.count)]),
        ]),
        heading("Productos con incidencias"),
        ...(incidents.length ? [table(["Artículo y código", "Producto", "Color y talla", "Precio", "Incidencia"], [2100, 2300, 1500, 1160, 2300],
          incidents.map((item) => [
            `${item.article}${item.barcode ? `\n${item.barcode}` : ""}`,
            item.description, `${item.color}\nTalla ${item.size}`, money.format(item.amount), item.observation,
          ]))] : [new Paragraph("No se registraron incidencias en esta evaluación.")]),
        heading("Conformidad de la revisión"),
        new Paragraph({ text: "Nombre y firma de los responsables", spacing: { after: 440 }, keepNext: true }),
        new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [3120, 3120, 3120], layout: TableLayoutType.FIXED,
          rows: [new TableRow({ cantSplit: true, children: ["Responsable 1", "Responsable 2", "Supervisor del área"].map((label) => new TableCell({
            width: { size: 3120, type: WidthType.DXA }, margins: { left: 140, right: 140 }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: [new Paragraph({ text: "____________________", alignment: AlignmentType.CENTER, spacing: { after: 100 } }), new Paragraph({ text: label, alignment: AlignmentType.CENTER, spacing: { after: 0 } })],
          })) })],
        }),
      ],
    }],
  });
}
