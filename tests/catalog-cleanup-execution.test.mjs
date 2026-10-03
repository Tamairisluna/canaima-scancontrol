import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const sql = await readFile(new URL('../LIMPIAR_ARCHIVADOS_Y_REVISAR_USO_20261003.sql',import.meta.url),'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,last_sign_in_at timestamptz,created_at timestamptz);
    create table public.stores(id uuid primary key,name text,active_catalog_id uuid);
    create table public.profiles(id uuid primary key,store_id uuid,role text,is_active boolean);
    create table public.catalog_versions(id uuid primary key,store_id uuid references stores(id),status text,created_at timestamptz,activated_at timestamptz,unique(id,store_id));
    alter table stores add constraint stores_active_catalog_fk foreign key(active_catalog_id,id) references catalog_versions(id,store_id);
    create table public.products(id uuid primary key default gen_random_uuid(),catalog_id uuid,store_id uuid,foreign key(catalog_id,store_id) references catalog_versions(id,store_id) on delete cascade);
    create table public.evaluations(id uuid primary key,store_id uuid,status text,created_at timestamptz);
    create table public.evaluation_items(id uuid primary key,store_id uuid,product_id uuid references products(id) on delete set null,article text,scanned_at timestamptz);
    create table public.scan_activity(id uuid primary key,store_id uuid,product_id text,created_at timestamptz,article text);
    create table public.store_catalog_files(store_id uuid,version uuid,updated_at timestamptz,object_path text);
    create table storage.objects(bucket_id text,name text,metadata jsonb);
  `);
  return db;
}

async function store(db,name) {
  const id=crypto.randomUUID();await db.query('insert into stores values($1,$2,null)',[id,name]);return id;
}
async function catalog(db,storeId,status,days=30,point=false) {
  const id=crypto.randomUUID();
  await db.query("insert into catalog_versions values($1,$2,$3,now()-$4::double precision*interval '1 day',null)",[id,storeId,status,days]);
  const p=(await db.query('insert into products(catalog_id,store_id) values($1,$2) returning id',[id,storeId])).rows[0].id;
  if(point)await db.query('update stores set active_catalog_id=$1 where id=$2',[id,storeId]);
  return {id,product:p};
}
function report(results) {
  const rows=results.find(result=>result.rows?.some(row=>row.apartado==='01_lote_archivado')).rows;
  return Object.fromEntries(rows.map(row=>[row.apartado,row.apartado==='03_base_actual'?row.resultado:JSON.parse(row.resultado)]));
}

test('small archived batch preserves inventory, pending uploads and every historical snapshot',async()=>{
  const db=await setup();
  try{
    const s=await store(db,'AA PF 2022');
    const active=await catalog(db,s,'active',30,true);
    const ready=await catalog(db,s,'ready');
    const uploading=await catalog(db,s,'uploading');
    const archived=await catalog(db,s,'archived');
    const recent=await catalog(db,s,'archived',0.1);
    const pinnedStore=await store(db,'BB PF 2022');
    const pinned=await catalog(db,pinnedStore,'archived',30,true);
    const historyId=crypto.randomUUID(),scanId=crypto.randomUUID();
    await db.query("insert into evaluation_items values($1,$2,$3,'ARTICULO HISTORICO',now()-interval '10 days')",[historyId,s,archived.product]);
    await db.query("insert into scan_activity values($1,$2,$3,now(),'ARTICULO HISTORICO')",[scanId,s,archived.product]);
    const snapshot=(await db.query('select to_jsonb(e)-\'product_id\' as snapshot from evaluation_items e')).rows[0].snapshot;
    const scansBefore=(await db.query('select * from scan_activity')).rows;
    const result=report(await db.exec(sql));
    assert.deepEqual(result['01_lote_archivado'],{catalogos_antes:1,productos_antes:1,catalogos_despues:0,productos_despues:0});
    for(const v of [active,ready,uploading,recent,pinned]) assert.equal((await db.query('select id from catalog_versions where id=$1',[v.id])).rows.length,1);
    assert.equal((await db.query('select count(*)::int as n from products')).rows[0].n,5);
    assert.equal((await db.query('select product_id from evaluation_items where id=$1',[historyId])).rows[0].product_id,null);
    assert.deepEqual((await db.query('select to_jsonb(e)-\'product_id\' as snapshot from evaluation_items e')).rows[0].snapshot,snapshot);
    assert.deepEqual((await db.query('select * from scan_activity')).rows,scansBefore);
    assert.deepEqual(report(await db.exec(sql))['01_lote_archivado'],{catalogos_antes:0,productos_antes:0,catalogos_despues:0,productos_despues:0});
  }finally{await db.close();}
});

test('activity review does not classify recent scans, evaluations, logins, new accounts, new uploads or uploading as unused',async()=>{
  const db=await setup();
  try{
    const stores={};for(const name of ['idle','scan','evaluation','login','new-account','upload','uploading','shared'])stores[name]=await store(db,name);
    for(const id of Object.values(stores))await catalog(db,id,'active',30,true);
    await db.query("insert into scan_activity values($1,$2,null,now(),'ARTICULO')",[crypto.randomUUID(),stores.scan]);
    await db.query("insert into evaluation_items values($1,$2,null,'ARTICULO',now()-interval '1 day')",[crypto.randomUUID(),stores.evaluation]);
    const login=crypto.randomUUID(),newAccount=crypto.randomUUID();
    await db.query("insert into auth.users values($1,now(),now()-interval '90 days'),($2,null,now())",[login,newAccount]);
    await db.query("insert into profiles values($1,$2,'employee',true),($3,$4,'manager',true)",[login,stores.login,newAccount,stores['new-account']]);
    await catalog(db,stores.upload,'ready',0.1);
    await catalog(db,stores.uploading,'uploading',30);
    await db.query("insert into store_catalog_files values($1,$2,now(),'shared.json.gz')",[stores.shared,crypto.randomUUID()]);
    const result=report(await db.exec(sql));
    const usage=result['02_uso_por_tienda'];
    assert.deepEqual(usage.filter(row=>row.candidata_sin_uso).map(row=>row.tienda),['idle']);
    assert.equal((await db.query('select count(*)::int as n from products')).rows[0].n,10,'activity review does not delete any unused inventory');
    assert.equal((await db.query('select count(*)::int as n from store_catalog_files')).rows[0].n,1);
  }finally{await db.close();}
});

test('oversized batches roll back without deleting any catalog or product',async()=>{
  const db=await setup();
  try{
    const s=await store(db,'LARGE');const v=await catalog(db,s,'archived');
    await db.query('insert into products(catalog_id,store_id) select $1,$2 from generate_series(1,2000)',[v.id,s]);
    await assert.rejects(db.exec(sql),/supera 2000 productos/);await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as n from products')).rows[0].n,2001);
    assert.equal((await db.query('select count(*)::int as n from catalog_versions')).rows[0].n,1);
  }finally{await db.close();}
});

test('an unexpected dependency stops cleanup before touching historical data',async()=>{
  const db=await setup();
  try{
    const s=await store(db,'DEPENDENCY');const v=await catalog(db,s,'archived');
    await db.exec('create table public.other_history(catalog_id uuid references catalog_versions(id) on delete cascade)');
    await db.query('insert into other_history values($1)',[v.id]);
    await assert.rejects(db.exec(sql),/nuevas dependencias/);await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as n from other_history')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from products')).rows[0].n,1);
  }finally{await db.close();}
});
