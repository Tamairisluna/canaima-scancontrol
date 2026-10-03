import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Exercise the real memo selection and quick-action handler, including products
// from shared catalogs that intentionally have no products-table foreign key.
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let selection, markLatest;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "latestScannedEvaluationItem") selection=node.initializer.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "markLatestScannedProduct") markLatest=node.getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(selection && markLatest,"The production selector and action must be present");
const source=ts.transpileModule(`const latestScannedEvaluationItem=${selection};\n${markLatest}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const product=(rowId,extra={})=>({id:null,rowId,barcode:"0012345678901",article:"ART-01",observation:"SIN INCIDENCIAS",...extra});
function harness(items){
  const changed=[],warnings=[];
  const context={evaluationItems:items,useMemo:fn=>fn(),changeObservation:async(rowId,observation)=>{changed.push({rowId,observation});return true;},toast:{warning:message=>warnings.push(message),success:()=>{}}};
  vm.runInNewContext(source,context);
  const selected=vm.runInNewContext("latestScannedEvaluationItem",context);
  return {context,selected,changed,warnings};
}

test("shared-catalog barcode is the current product even with a null product foreign key",()=>{
  const current=product("shared-latest"),h=harness([current]);
  assert.equal(h.selected,current);
  assert.equal(h.selected.barcode,"0012345678901");
});

test("new shared product takes priority over an older legacy product",()=>{
  const current=product("shared-latest"),old=product("legacy-old",{id:"legacy-product"});
  assert.equal(harness([current,old]).selected,current);
});

test("an unidentified Sin etiqueta row does not replace the last scanned product",()=>{
  const unidentified=product("without-label",{barcode:"",article:"SIN CÓDIGO",observation:"SIN ETIQUETA"}),current=product("shared-latest");
  assert.equal(harness([unidentified,current]).selected,current);
  assert.equal(harness([unidentified]).selected,null);
});

test("blank barcode rows are not scanned products and legacy barcode products remain supported",()=>{
  const blank=product("blank",{barcode:"   "}),legacy=product("legacy",{id:"legacy-product"});
  assert.equal(harness([blank,legacy]).selected,legacy);
  assert.equal(harness([]).selected,null);
});

test("quick actions target the newly scanned shared item and preserve the chosen incident",async()=>{
  for(const observation of ["PRECIO ERRÓNEO","MAL ETIQUETADO"]){
    const h=harness([product("shared-latest"),product("legacy-old",{id:"legacy-product"})]);
    await h.context.markLatestScannedProduct(observation);
    assert.deepEqual(h.changed,[{rowId:"shared-latest",observation}]);
    assert.deepEqual(h.warnings,[]);
  }
});

test("more than 100 incidents do not block selection or marking the next shared product",async()=>{
  const h=harness([product("item-101"),...Array.from({length:100},(_,i)=>product(`old-${i}`,{id:`legacy-${i}`,observation:"PRECIO ERRÓNEO"}))]);
  await h.context.markLatestScannedProduct("MAL ETIQUETADO");
  assert.equal(h.selected.rowId,"item-101");
  assert.deepEqual(h.changed,[{rowId:"item-101",observation:"MAL ETIQUETADO"}]);
});
