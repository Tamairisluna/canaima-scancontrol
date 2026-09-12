import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { Packer } from "docx";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
try {
  const { createEvaluationReport } = await vite.ssrLoadModule("/app/lib/evaluation-report.ts");
  const row = { article: "ZAP-001", barcode: "0012345678901", description: "Calzado deportivo", color: "Negro", size: "36", amount: 59.99, observation: "PRECIO ERRÓNEO" };
  const items = [
    ...Array.from({ length: 14 }, () => ({ ...row, article: "CORRECTO-NO-DEBE-APARECER", observation: "SIN INCIDENCIAS" })),
    row,
    { ...row, article: "CAM-002", description: "Camisa de algodón", observation: "MAL ETIQUETADO" },
    { ...row, article: "SIN CÓDIGO", barcode: "", description: "Producto sin identificar", color: "No especificado", size: "No especificado", amount: 0, observation: "SIN ETIQUETA" },
  ];
  const dir = await mkdtemp(join(tmpdir(), "scancontrol-report-"));
  for (const [name, values] of [["sample", items], ["multipage", [...items, ...Array.from({ length: 22 }, () => row)]]]) {
    const file = join(dir, `${name}.docx`);
    await writeFile(file, await Packer.toBuffer(createEvaluationReport("BB SCI 2023, C.A.", values, new Date("2026-09-11T12:00:00Z"))));
    const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" });
    for (const label of ["Responsable 1", "Responsable 2", "Supervisor del área", "0012345678901", "59.99", "BB SCI 2023, C.A."]) assert.ok(xml.includes(label), label);
    assert.ok(!xml.includes("CORRECTO-NO-DEBE-APARECER"));
    assert.match(xml, /w:tblHeader/);
    assert.match(xml, /w:cantSplit/);
    console.log(file);
  }
} finally {
  await vite.close();
}
