// Isolated IndexedDB regression tests. No requests to Supabase or production.
// npm install --prefix /tmp/scancontrol-local-tests --ignore-scripts fake-indexeddb@6.2.4
// FAKE_INDEXEDDB_PATH=/tmp/scancontrol-local-tests/node_modules/fake-indexeddb/build/esm/index.js node --test tests/local-catalog.test.mjs
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createServer } from "vite";

const { IDBFactory, IDBObjectStore } = await import(pathToFileURL(process.env.FAKE_INDEXEDDB_PATH).href);
globalThis.indexedDB = new IDBFactory();
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType:"custom", configFile:false, root,
  resolve:{alias:{"@":root}}, server:{middlewareMode:true,hmr:false} });
after(() => vite.close());
const { replaceLocalCatalog, readLocalCatalog, localCatalogErrorMessage } = await vite.ssrLoadModule("/app/lib/local-catalog.ts");
const scope = { userId:"user-one", storeId:"store-one" };
const product = { barcode:"0012345678901", article:"ART-01", description:"Producto",
  color:"Azul", size:"36", style:"Deportivo", amount:24.99, discount_percent:15.5,
  brand:"Canaima", category:"Zapatos" };

test("stores the entire catalog and restores identifiers, price and discount on reopening", async () => {
  assert.equal(await readLocalCatalog(scope), null);
  const saved = await replaceLocalCatalog(scope,"primero.xlsx",[product]);
  const restored = await readLocalCatalog(scope);
  assert.equal(restored.id,saved.id);
  assert.equal(restored.fileName,"primero.xlsx");
  assert.deepEqual(restored.products,[product]);
});

test("isolates each store and account on the same device", async () => {
  const otherStore = { ...scope, storeId:"store-two" };
  const otherUser = { ...scope, userId:"user-two" };
  assert.equal(await readLocalCatalog(otherUser),null);
  assert.equal(await readLocalCatalog(otherStore),null);
  await replaceLocalCatalog(otherStore,"otra-tienda.xlsx",[{...product,amount:100}]);
  assert.equal((await readLocalCatalog(scope)).products[0].amount,24.99);
  assert.equal((await readLocalCatalog(otherStore)).products[0].amount,100);
});

test("invalid and duplicate products leave the previous catalog intact", async () => {
  const original = await readLocalCatalog(scope);
  await assert.rejects(replaceLocalCatalog(scope,"vacio.xlsx",[]), /productos válidos/);
  await assert.rejects(replaceLocalCatalog(scope,"repetidos.xlsx",[product,product]), /datos inválidos/);
  await assert.rejects(replaceLocalCatalog(scope,"invalido.xlsx",[{...product,amount:NaN}]), /datos inválidos/);
  assert.deepEqual(await readLocalCatalog(scope),original);
});

test("an abort after put success rolls back the replacement rather than announcing success", async () => {
  const original = await readLocalCatalog(scope);
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args) {
    const request = put.apply(this,args);
    request.addEventListener("success", () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(replaceLocalCatalog(scope,"abortado.xlsx",[{...product,amount:1}]));
  } finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual(await readLocalCatalog(scope),original);
});

test("quota failures retain the old catalog and give a device-specific error", async () => {
  const original = await readLocalCatalog(scope);
  const put = IDBObjectStore.prototype.put;
  const quota = new DOMException("Full","QuotaExceededError");
  IDBObjectStore.prototype.put = () => { throw quota; };
  try {
    await assert.rejects(replaceLocalCatalog(scope,"sin-espacio.xlsx",[product]), {name:"QuotaExceededError"});
  } finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual(await readLocalCatalog(scope),original);
  assert.match(localCatalogErrorMessage(quota), /este dispositivo/);
});

test("a new validated catalog entirely replaces old products only in its own scope", async () => {
  await replaceLocalCatalog(scope,"segundo.xlsx",[{...product,barcode:"0099999999999",amount:10,discount_percent:25}]);
  const restored = await readLocalCatalog(scope);
  assert.equal(restored.fileName,"segundo.xlsx");
  assert.deepEqual(restored.products.map(row=>row.barcode),["0099999999999"]);
  assert.equal((await readLocalCatalog({...scope,storeId:"store-two"})).fileName,"otra-tienda.xlsx");
});

test("large catalogs remain complete across replacement and reopening", async () => {
  const large = Array.from({length:100_000},(_,index)=>({...product,barcode:String(index).padStart(13,"0")}));
  const largeScope = {...scope,storeId:"large-store"};
  await replaceLocalCatalog(largeScope,"grande.xlsx",large);
  const restored = await readLocalCatalog(largeScope);
  assert.equal(restored.products.length,100_000);
  assert.deepEqual(restored.products[99_999],large[99_999]);
});
