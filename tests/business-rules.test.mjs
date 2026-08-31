import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { utils } from "xlsx";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

test("keeps barcode identifiers exact, including leading zeroes", async () => {
  const { normalizeBarcode } = await vite.ssrLoadModule("/app/lib/barcode.ts");

  assert.equal(normalizeBarcode("  0012345678901  "), "0012345678901");
  assert.equal(normalizeBarcode("9880011172917.0"), "9880011172917.0");
});

test("imports the physical identifier only from the Código barras column", async () => {
  const { parseCatalogWorkbook } = await vite.ssrLoadModule("/app/lib/catalog-import.ts");
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["Artículo", "Descripción", "Color", "Tamaño", "Estilo", "Código barras", "Monto a Pagar", "Marca", "Cat 1"],
    ["PRENDA-01", "Camisa", "AZUL", "M", "CASUAL", "0012345678901", 19.95, "Canaima", "Camisas"],
  ]);
  utils.book_append_sheet(workbook, sheet, "Inventario");

  const parsed = parseCatalogWorkbook(workbook);
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].barcode, "0012345678901");
  assert.equal(parsed.products[0].article, "PRENDA-01");
  assert.equal(parsed.products[0].brand, "Canaima");
  assert.equal(parsed.products[0].category, "Camisas");
});

test("rejects Código, Artículo and SKU as barcode substitutes", async () => {
  const { parseCatalogWorkbook } = await vite.ssrLoadModule("/app/lib/catalog-import.ts");
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["Código", "Artículo", "SKU", "Monto a Pagar"],
    ["9880011172917", "PRENDA-01", "SKU-01", 19.95],
  ]);
  utils.book_append_sheet(workbook, sheet, "Inventario");

  assert.throws(
    () => parseCatalogWorkbook(workbook),
    /Código barras.*Monto a Pagar/,
  );
});

test("derives Sin incidencias from the complete evaluation total", async () => {
  const { summarizeEvaluation } = await vite.ssrLoadModule("/app/lib/evaluation.ts");
  const items = [
    ...Array.from({ length: 85 }, () => ({ observation: "SIN INCIDENCIAS" })),
    ...Array.from({ length: 8 }, () => ({ observation: "PRECIO ERRÓNEO" })),
    ...Array.from({ length: 5 }, () => ({ observation: "MAL ETIQUETADO" })),
    ...Array.from({ length: 2 }, () => ({ observation: "SIN ETIQUETA" })),
  ];

  assert.deepEqual(summarizeEvaluation(items), [
    { observation: "SIN INCIDENCIAS", count: 85 },
    { observation: "PRECIO ERRÓNEO", count: 8 },
    { observation: "MAL ETIQUETADO", count: 5 },
    { observation: "SIN ETIQUETA", count: 2 },
  ]);
});

test("validates the smallest standard, numeric and cautious alphanumeric size", async () => {
  const { findMinimumSize, matchesExpectedMinimum } = await vite.ssrLoadModule("/app/lib/size-validation.ts");
  const standard = ["S", "M", "L"].map((size, index) => ({ article: "CAM-01", color: "Azul", size, barcode: String(index) }));
  assert.deepEqual(findMinimumSize(standard[1], standard), { status: "not-minimum", expectedSize: "S", candidates: 3 });
  assert.equal(matchesExpectedMinimum(standard[0], standard[1], "S"), true);

  const numeric = ["36", "38", "40"].map((size) => ({ article: "PAN-01", color: "Negro", size }));
  assert.equal(findMinimumSize(numeric[2], numeric).expectedSize, "36");

  const alphanumeric = ["2T", "3T", "4T"].map((size) => ({ article: "NIN-01", color: "Rojo", size }));
  assert.equal(findMinimumSize(alphanumeric[1], alphanumeric).expectedSize, "2T");
});

test("does not block when size formats cannot be ordered safely", async () => {
  const { findMinimumSize } = await vite.ssrLoadModule("/app/lib/size-validation.ts");
  const result = findMinimumSize(
    { article: "CAM-02", color: "Blanco", size: "Única" },
    [{ article: "CAM-02", color: "Blanco", size: "Única" }, { article: "CAM-02", color: "Blanco", size: "Especial" }],
  );
  assert.equal(result.status, "unknown");
});

test("summarizes daily activity by incidents, employee, Marca and Cat 1", async () => {
  const { summarizeActivityByStore, summarizeDailyActivity } = await vite.ssrLoadModule("/app/lib/daily-activity.ts");
  const base = { id:"1",createdAt:"2026-08-31T12:00:00Z",employeeId:"u1",employeeName:"Ana",storeId:"s1",storeName:"Tienda",source:"scanner",barcode:"1",article:"A",description:"Camisa",color:"Azul",size:"M",expectedSize:"",style:"Casual",amount:10,brand:"Canaima",category:"Camisas" };
  const summary = summarizeDailyActivity([
    { ...base, eventType:"SCAN", observation:"PRECIO ERRÓNEO" },
    { ...base, id:"2", eventType:"SCAN", observation:null },
    { ...base, id:"3", eventType:"SIZE_NOT_DISPLAYED", observation:null, expectedSize:"S" },
  ]);
  assert.equal(summary.totalScans, 2);
  assert.equal(summary.incidents, 2);
  assert.equal(summary.priceErrors, 1);
  assert.equal(summary.smallerSizeNotDisplayed, 1);
  assert.deepEqual(summary.byBrand[0], { label:"Canaima", scans:2, incidents:2 });
  assert.deepEqual(summarizeActivityByStore([
    { storeId:"s1", eventType:"SCAN", observation:"PRECIO ERRÓNEO" },
    { storeId:"s1", eventType:"SCAN", observation:null },
  ], [{ id:"s1", name:"Tienda" }])[0], {
    storeId:"s1", storeName:"Tienda", scans:2, incidents:1, priceErrors:1, mislabeled:0, withoutLabel:0, smallerSizeNotDisplayed:0,
  });
});

test("builds a Caracas business week from Monday to Monday", async () => {
  const { caracasWeekRange } = await vite.ssrLoadModule("/app/lib/daily-activity.ts");
  assert.deepEqual(caracasWeekRange("2026-08-31"), {
    startDate:"2026-08-31",
    endDateExclusive:"2026-09-07",
    startIso:"2026-08-31T04:00:00.000Z",
    endIso:"2026-09-07T04:00:00.000Z",
  });
});

test("keeps scanner latency, camera and PWA safeguards explicit", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(page, /now-lastScanRef\.current\.at<900/);
  assert.match(page, /width: \{ ideal: 1920 \}/);
  assert.match(page, /navigator\.vibrate\(80\)/);
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.doesNotMatch(worker, /cache\.put|caches\.open/);
});

test("provides an external installation page with share and device guidance", async () => {
  const installer = await readFile(new URL("../app/instalar/install-page-client.tsx", import.meta.url), "utf8");
  const qr = await readFile(new URL("../public/scancontrol-install-qr.png", import.meta.url));
  assert.match(installer, /canaima-scancontrol\.vercel\.app\/instalar/);
  assert.match(installer, /beforeinstallprompt/);
  assert.match(installer, /Agregar a pantalla de inicio/);
  assert.match(installer, /navigator\.share/);
  assert.ok(qr.length > 1000);
});
