import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const sql = await readFile(new URL('../LIMPIAR_TIENDAS_SIN_USO_20261003.sql',import.meta.url),'utf8');
const id = () => crypto.randomUUID();

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,last_sign_in_at timestamptz,created_at timestamptz);
    create table public.stores(id uuid primary key,name text,active_catalog_id uuid,is_active boolean default true);
    create table public.profiles(id uuid primary key,store_id uuid,role text,is_active boolean);
    create table public.catalog_versions(id uuid primary key,store_id uuid references stores(id),status text,created_at timestamptz,activated_at timestamptz,unique(id,store_id));
    alter table stores add constraint stores_active_catalog_fk foreign key(active_catalog_id,id) references catalog_versions(id,store_id);
    create table public.products(id uuid primary key default gen_random_uuid(),catalog_id uuid,store_id uuid,foreign key(catalog_id,store_id) references catalog_versions(id,store_id) on delete cascade);
    create index on products(catalog_id);
    create table public.evaluations(id uuid primary key,store_id uuid,status text,created_at timestamptz);
    create table public.evaluation_items(id uuid primary key,store_id uuid,product_id uuid references products(id) on delete set null,article text,scanned_at timestamptz);
    create table public.scan_activity(id uuid primary key,store_id uuid,product_id text,created_at timestamptz,article text);
    create table public.store_catalog_files(store_id uuid,version uuid,updated_at timestamptz,object_path text);
  `);
  await db.exec(sql);
  await db.exec(`insert into stores(id,name) select store_id,tienda from scancontrol_maintenance.tiendas_20261003`);
  const candidates=(await db.query('select * from scancontrol_maintenance.tiendas_20261003 order by store_id')).rows;
  return {db,candidates};
}

async function catalog(db,storeId,{status='active',products=1,recent=false,pointer=true}={}) {
  const catalogId=id();
  await db.query("insert into catalog_versions values($1,$2,$3,$4,null)",
    [catalogId,storeId,status,recent?new Date():new Date('2026-09-01T00:00:00Z')]);
  await db.query('insert into products(catalog_id,store_id) select $1,$2 from generate_series(1,$3::int)',[catalogId,storeId,products]);
  if(pointer)await db.query('update stores set active_catalog_id=$1 where id=$2',[catalogId,storeId]);
  return {catalogId,productId:(await db.query('select id from products where catalog_id=$1 limit 1',[catalogId])).rows[0]?.id};
}
async function run(db,batches=50) {
  // Intentionally execute a single top-level CALL, as required for transaction control.
  return (await db.exec(`call scancontrol_maintenance.limpiar_sin_uso_20261003(null,${batches})`))[0].rows[0].resultado;
}
async function rows(db,table) { return (await db.query(`select * from ${table} order by id`)).rows; }

test('exact allowlist cleanup preserves other stores, accounts and complete historical snapshots',async()=>{
  const {db,candidates}=await setup();
  try {
    const retired=await catalog(db,candidates[0].store_id,{products:3});
    const other=id();await db.query("insert into stores(id,name) values($1,'TIENDA FUERA DEL LISTADO')",[other]);
    const preserved=await catalog(db,other,{products:2});
    const account=id();
    await db.query("insert into auth.users values($1,'2026-09-01','2026-08-01')",[account]);
    await db.query("insert into profiles values($1,$2,'employee',true)",[account,candidates[0].store_id]);
    await db.query("insert into evaluations values($1,$2,'completed','2026-09-01')",[id(),candidates[0].store_id]);
    await db.query("insert into evaluation_items values($1,$2,$3,'ARTICULO HISTORICO','2026-09-01')",[id(),candidates[0].store_id,retired.productId]);
    await db.query("insert into scan_activity values($1,$2,$3,'2026-09-01','ARTICULO HISTORICO')",[id(),candidates[0].store_id,retired.productId]);
    const profiles=await rows(db,'profiles'),accounts=await rows(db,'auth.users');
    const evaluations=await rows(db,'evaluations'),scans=await rows(db,'scan_activity');
    const snapshot=(await db.query("select to_jsonb(e)-'product_id' as snapshot from evaluation_items e")).rows;
    const result=await run(db);
    assert.equal(result.productos_antes,3);assert.equal(result.productos_eliminados,3);
    assert.equal(result.productos_pendientes,0);assert.equal(result.tiendas_completas,10);
    assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,2);
    assert.equal((await db.query('select active_catalog_id from stores where id=$1',[other])).rows[0].active_catalog_id,preserved.catalogId);
    assert.equal((await db.query('select active_catalog_id,is_active from stores where id=$1',[candidates[0].store_id])).rows[0].is_active,true);
    assert.deepEqual(await rows(db,'profiles'),profiles);assert.deepEqual(await rows(db,'auth.users'),accounts);
    assert.deepEqual(await rows(db,'evaluations'),evaluations);assert.deepEqual(await rows(db,'scan_activity'),scans);
    assert.deepEqual((await db.query("select to_jsonb(e)-'product_id' as snapshot from evaluation_items e")).rows,snapshot);
    assert.equal((await db.query('select product_id from evaluation_items')).rows[0].product_id,null);
    await db.exec(sql); // Reinstallation must retain checkpoints.
    assert.equal((await run(db)).productos_eliminados,3);
  } finally {await db.close();}
});

test('recent scans, evaluations, logins, new accounts, catalogs, uploads and shared files protect each candidate',async()=>{
  const {db,candidates}=await setup();
  try {
    for(const c of candidates)await catalog(db,c.store_id);
    await db.query("insert into scan_activity values($1,$2,null,now(),'ARTICULO')",[id(),candidates[0].store_id]);
    await db.query("insert into evaluation_items values($1,$2,null,'ARTICULO',now())",[id(),candidates[1].store_id]);
    await db.query("insert into evaluations values($1,$2,'pending',now())",[id(),candidates[2].store_id]);
    const login=id(),newAccount=id();
    await db.query("insert into auth.users values($1,now(),'2026-08-01'),($2,null,now())",[login,newAccount]);
    await db.query("insert into profiles values($1,$2,'employee',true),($3,$4,'manager',true)",[login,candidates[3].store_id,newAccount,candidates[4].store_id]);
    await catalog(db,candidates[5].store_id,{status:'ready',recent:true,pointer:false});
    await catalog(db,candidates[6].store_id,{status:'uploading',pointer:false});
    await db.query("insert into store_catalog_files values($1,$2,'2026-08-01','shared.json.gz')",[candidates[7].store_id,id()]);
    await db.query('update catalog_versions set activated_at=now() where store_id=$1',[candidates[8].store_id]);
    // Activity after the fixed review cutoff remains protected even months later.
    await db.query("insert into scan_activity values($1,$2,null,'2026-09-27','ARTICULO')",[id(),candidates[9].store_id]);
    const before=await rows(db,'products'),pointers=await rows(db,'stores');
    const result=await run(db);
    assert.equal(result.tiendas_protegidas,10);assert.equal(result.productos_eliminados,0);
    assert.deepEqual(await rows(db,'products'),before);assert.deepEqual(await rows(db,'stores'),pointers);
    assert.equal((await db.query('select count(*)::int n from store_catalog_files')).rows[0].n,1);
  } finally {await db.close();}
});

test('bounded commits resume after one batch and preserve a newly published catalog',async()=>{
  const {db,candidates}=await setup();
  try {
    const old=await catalog(db,candidates[0].store_id,{products:5001});
    const first=await run(db,1);
    assert.equal(first.productos_antes,5001);assert.equal(first.productos_eliminados,5000);assert.equal(first.productos_pendientes,1);
    assert.equal((await db.query('select active_catalog_id from stores where id=$1',[candidates[0].store_id])).rows[0].active_catalog_id,null);
    const fresh=await catalog(db,candidates[0].store_id,{products:2,recent:true});
    await db.query("insert into store_catalog_files values($1,$2,now(),'new.json.gz')",[candidates[0].store_id,id()]);
    const last=await run(db);
    assert.equal(last.productos_eliminados,5001);assert.equal(last.productos_pendientes,0);
    assert.equal((await db.query('select id from catalog_versions where id=$1',[old.catalogId])).rows.length,0);
    assert.equal((await db.query('select active_catalog_id from stores where id=$1',[candidates[0].store_id])).rows[0].active_catalog_id,fresh.catalogId);
    assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,2);
    assert.equal((await run(db)).productos_eliminados,5001);
  } finally {await db.close();}
});

test('reactivating an old catalog pauses its remaining batches',async()=>{
  const {db,candidates}=await setup();
  try {
    const old=await catalog(db,candidates[0].store_id,{products:5001});
    await run(db,1);
    await db.query("update catalog_versions set status='active' where id=$1",[old.catalogId]);
    await db.query('update stores set active_catalog_id=$1 where id=$2',[old.catalogId,candidates[0].store_id]);
    const result=await run(db);
    assert.equal(result.productos_pendientes,1);assert.equal(result.productos_eliminados,5000);
  } finally {await db.close();}
});

test('changed counts protect the store and unexpected dependencies abort before retirement',async()=>{
  const {db,candidates}=await setup();
  try {
    const c=candidates.find(c=>c.max_catalogos===1);
    const old=await catalog(db,c.store_id);
    await catalog(db,c.store_id,{status:'ready',pointer:false});
    let result=await run(db);
    assert.equal(result.tiendas_protegidas,1);
    assert.equal((await db.query('select active_catalog_id from stores where id=$1',[c.store_id])).rows[0].active_catalog_id,old.catalogId);
    await db.exec('create table public.other_history(product_id uuid references products(id) on delete cascade)');
    await assert.rejects(run(db),/dependencias o el índice/);
    assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,2);
  } finally {await db.close();}
});

test('ordinary client roles cannot read the queue or execute cleanup',async()=>{
  const {db}=await setup();
  try {
    for(const role of ['anon','authenticated']){
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from scancontrol_maintenance.tiendas_20261003'),/permission denied/);
      await assert.rejects(run(db),/permission denied/);
      await db.exec('reset role');
    }
  } finally {await db.close();}
});

test('an explicit transaction cannot accidentally run the committing procedure',async()=>{
  const {db,candidates}=await setup();
  try {
    await catalog(db,candidates[0].store_id);
    await db.exec('begin');
    await assert.rejects(run(db),/invalid transaction termination/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from scancontrol_maintenance.tiendas_20261003 where estado='pendiente'")).rows[0].n,10);
  } finally {await db.close();}
});

test('the complete reviewed volume is bounded and reconciles before and after counts',async()=>{
  const {db,candidates}=await setup();
  try {
    for(const c of candidates){
      if(c.max_catalogos===2){
        const half=Math.floor(c.max_productos/2);
        await catalog(db,c.store_id,{products:half});
        await catalog(db,c.store_id,{products:c.max_productos-half,status:'ready',pointer:false});
      }else await catalog(db,c.store_id,{products:c.max_productos});
    }
    const reports=[];
    for(let attempts=0;attempts<5;attempts++){
      const result=await run(db);reports.push(result);
      assert.ok(result.lotes_en_esta_llamada<=50);
      if(result.productos_pendientes===0 && result.tiendas_pendientes_revision===0)break;
    }
    const final=reports.at(-1);
    assert.equal(final.productos_antes,189966);assert.equal(final.productos_eliminados,189966);
    assert.equal(final.productos_pendientes,0);assert.equal(final.tiendas_completas,10);
    assert.equal(final.detalle.reduce((n,c)=>n+c.catalogos_antes,0),18);
    assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from catalog_versions')).rows[0].n,0);
  } finally {await db.close();}
});
