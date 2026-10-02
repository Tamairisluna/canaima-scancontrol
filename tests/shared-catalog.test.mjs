// Isolated catalog/file/IndexedDB checks; no production requests.
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
const codec = await vite.ssrLoadModule("/app/lib/shared-catalog-codec.ts");
const local = await vite.ssrLoadModule("/app/lib/local-catalog.ts");
const shared = await vite.ssrLoadModule("/app/lib/shared-catalog.ts");
const { supabase } = await vite.ssrLoadModule("/app/lib/supabase.ts");
const store = "00000000-0000-4000-8000-000000000021";
const scope = { userId:"user-one", storeId:store };
const product = { barcode:"0012345678901", article:"ART-01", description:"Producto",
  color:"Azul", size:"36", style:"Deportivo", amount:24.99, discount_percent:15.5,
  brand:"Canaima", category:"Zapatos" };
const file = async (version = crypto.randomUUID(), products = [product]) => {
  const encoded = await codec.encodeSharedCatalog(store,version,products);
  return { ...encoded, meta:{ store_id:store,version,object_path:`${store}/${version}.json.gz`,file_name:"compartido.xlsx",
    row_count:products.length,compressed_bytes:encoded.bytes.length,sha256:encoded.sha256,updated_at:new Date().toISOString() } };
};

let pointer=null, downloadCount=0, failUpload=false, failDownload=false, conflict=false, ambiguous=false;
const objects = new Map();
const removals=[];
supabase.from = table => {
  assert.equal(table,"store_catalog_files");
  return { select:()=>({eq:()=>({maybeSingle:async()=>({data:pointer,error:null})})}) };
};
supabase.storage.from = bucket => {
  assert.equal(bucket,"scancontrol-catalogs");
  return {
    upload:async(path,blob)=>{if(failUpload)return {error:{message:"upload interrupted"}};objects.set(path,new Uint8Array(await blob.arrayBuffer()));return {error:null};},
    download:async path=>{downloadCount++;return failDownload||!objects.has(path)?{data:null,error:{message:"offline"}}:{data:new Blob([objects.get(path)]),error:null};},
    list:async()=>({data:[],error:null}),
    remove:async paths=>{for(const path of paths) {removals.push(path);if(path!==pointer?.object_path)objects.delete(path);}return {error:null};},
  };
};
supabase.rpc = async(name,args)=>{
  assert.equal(name,"publish_store_catalog_file");
  if(conflict || args.p_expected_version !== (pointer?.version??null))return {error:{message:"Otra persona actualizó esta tienda"}};
  const previous_path=pointer?.object_path??null;
  pointer={store_id:store,version:args.p_version,object_path:`${store}/${args.p_version}.json.gz`,file_name:args.p_file_name,
    row_count:args.p_row_count,compressed_bytes:args.p_compressed_bytes,sha256:args.p_sha256,updated_at:new Date().toISOString()};
  return ambiguous?{error:{message:"statement timeout"}}:{data:{...pointer,previous_path},error:null};
};

test("compact gzip preserves barcode zeros, price, discount and all product fields",async()=>{
  const encoded=await file();
  assert.deepEqual(await codec.decodeSharedCatalog(encoded.bytes,encoded.meta),[product]);
  assert.ok(encoded.bytes.length < JSON.stringify([product]).length);
});

test("incomplete, corrupted or cross-store downloads are rejected before replacing local data",async()=>{
  const encoded=await file();
  await assert.rejects(codec.decodeSharedCatalog(encoded.bytes.subarray(0,20),encoded.meta),/incompleta/);
  const corrupt=encoded.bytes.slice();corrupt[15]^=1;
  await assert.rejects(codec.decodeSharedCatalog(corrupt,encoded.meta),/incompleta/);
  await assert.rejects(codec.decodeSharedCatalog(encoded.bytes,{...encoded.meta,store_id:"different-store"}),/no corresponde/);
  await assert.rejects(codec.decodeSharedCatalog(encoded.bytes,{...encoded.meta,row_count:9}),/no corresponde/);
});

test("large daily catalogs retain every product and compress substantially",async()=>{
  const products=Array.from({length:30000},(_,index)=>({...product,barcode:String(index).padStart(13,"0"),size:String(35+index%10)}));
  const encoded=await file(crypto.randomUUID(),products);
  assert.deepEqual(await codec.decodeSharedCatalog(encoded.bytes,encoded.meta),products);
  assert.ok(encoded.bytes.length < JSON.stringify(products).length/10);
  console.log(`Synthetic 30,000 products: ${encoded.bytes.length} bytes gzip; ${JSON.stringify(products).length} bytes original JSON`);
});

test("one published file reaches a different account/device with no Excel selection",async()=>{
  const result=await shared.publishSharedCatalog(scope,"primero.xlsx",[product],()=>{});
  assert.equal(result.meta.version,pointer.version);
  assert.ok(objects.has(pointer.object_path));
  const otherScope={userId:"user-two",storeId:store};
  assert.equal(await local.readLocalCatalog(otherScope),null);
  const synced=await shared.syncSharedCatalog(otherScope,null);
  assert.deepEqual(synced.catalog.products,[product]);
  assert.equal(synced.catalog.sharedVersion,pointer.version);
  const before=downloadCount;
  await shared.syncSharedCatalog(otherScope,synced.catalog);
  assert.equal(downloadCount,before,"same version must not download twice");
});

test("network or publication conflict retains both the prior pointer and the local catalog",async()=>{
  const before={...pointer};
  const beforeLocal=await local.readLocalCatalog(scope);
  failUpload=true;
  await assert.rejects(shared.publishSharedCatalog(scope,"failed.xlsx",[{...product,amount:1}],()=>{}),/interrupted/);
  failUpload=false;conflict=true;
  await assert.rejects(shared.publishSharedCatalog(scope,"conflict.xlsx",[{...product,amount:2}],()=>{}),/Otra persona/);
  conflict=false;
  assert.deepEqual(pointer,before);
  assert.deepEqual(await local.readLocalCatalog(scope),beforeLocal);
});

test("offline sync and stale responses never overwrite a complete newer local catalog",async()=>{
  const current=await local.readLocalCatalog(scope);
  failDownload=true;
  await assert.rejects(shared.syncSharedCatalog({...scope,userId:"offline-phone"},null),/conexión/);
  failDownload=false;
  assert.deepEqual(await local.readLocalCatalog(scope),current);
  const newest=await local.replaceLocalCatalog(scope,"newer.xlsx",[{...product,amount:88}],
    {version:crypto.randomUUID(),updatedAt:"2099-01-01T00:00:00Z"});
  const older=await local.replaceLocalCatalog(scope,"older.xlsx",[product],
    {version:pointer.version,updatedAt:pointer.updated_at});
  assert.equal(older.id,newest.id);
  assert.equal((await local.readLocalCatalog(scope)).products[0].amount,88);
});

test("an ambiguous RPC response is confirmed by pointer; active file is not discarded",async()=>{
  ambiguous=true;
  const result=await shared.publishSharedCatalog({...scope,userId:"ambiguous-phone"},"confirmed.xlsx",[product],()=>{});
  ambiguous=false;
  assert.equal(result.meta.version,pointer.version);
  assert.ok(objects.has(pointer.object_path));
  assert.ok(!removals.includes(pointer.object_path));
});

test("a phone out of local space still scans the validated latest shared catalog in memory",async()=>{
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(){throw new DOMException("Full","QuotaExceededError");};
  try {
    const result=await shared.syncSharedCatalog({...scope,userId:"full-phone"},null);
    assert.deepEqual(result.catalog.products,[product]);
    assert.match(result.warning,/Libera espacio/);
    const published=await shared.publishSharedCatalog({...scope,userId:"full-phone"},"shared-despite-quota.xlsx",[product],()=>{});
    assert.equal(published.catalog,null);
    assert.match(published.localWarning,/ya está compartido/);
  }finally{IDBObjectStore.prototype.put=put;}
});
