// Execute the exact additive SQL in an isolated PostgreSQL engine with RLS.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const db = new PGlite();
after(()=>db.close());
const a="00000000-0000-4000-8000-000000000021",b="00000000-0000-4000-8000-000000000022";
const user="00000000-0000-4000-8000-000000000011",v1=crypto.randomUUID(),v2=crypto.randomUUID();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create table public.stores(id uuid primary key);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
  alter table storage.objects enable row level security;
  grant usage on schema public,auth,storage to authenticated;
  grant select,insert,delete on storage.objects to authenticated;
  grant select on public.stores to authenticated;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function public.current_user_can_access_store(id uuid) returns boolean language sql stable
    as $$select auth.uid() = '${user}'::uuid and id = '${a}'::uuid$$;
  insert into auth.users values('${user}'); insert into public.stores values('${a}'),('${b}');
`);
const sql=await readFile(new URL("../ACTIVAR_CATALOGOS_COMPARTIDOS_20261002.sql",import.meta.url),"utf8");

test("additive SQL installs idempotently and returns all three readiness flags",async()=>{
  const results=await db.exec(sql);
  assert.deepEqual(results.at(-1).rows[0],{tabla_lista:true,almacenamiento_privado_listo:true,publicacion_lista:true});
  await db.exec(sql);
  const grants=await db.query("select has_function_privilege('anon','public.publish_store_catalog_file(uuid,uuid,uuid,text,integer,bigint,text)','execute') as anon, has_table_privilege('anon','public.store_catalog_files','select') as readable");
  assert.deepEqual(grants.rows[0],{anon:false,readable:false});
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
});

const upload=version=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('scancontrol-catalogs',$1,$2,'{\"size\":100}')",[`${a}/${version}.json.gz`,user]);
const publish=(version,expected)=>db.query("select public.publish_store_catalog_file($1,$2,$3,'catalog.xlsx',2,100,$4) as result",[a,version,expected,"a".repeat(64)]);

test("publishes only complete assigned-store objects and protects the active object from deletion",async()=>{
  await assert.rejects(publish(v1,null),/no está completo/);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('scancontrol-catalogs',$1,$2,'{\"size\":100}')",[`${b}/${v1}.json.gz`,user]),/row-level security/);
  await upload(v1);
  const result=await publish(v1,null);
  assert.equal(result.rows[0].result.version,v1);
  assert.equal(result.rows[0].result.previous_path,null);
  const deleted=await db.query("delete from storage.objects where name=$1 returning name",[`${a}/${v1}.json.gz`]);
  assert.equal(deleted.rows.length,0);
});

test("concurrent-version conflicts retain the pointer; previous file becomes deletable after replacement",async()=>{
  await upload(v2);
  await assert.rejects(publish(v2,null),/Otra persona/);
  assert.equal((await db.query("select version from public.store_catalog_files")).rows[0].version,v1);
  const result=await publish(v2,v1);
  assert.equal(result.rows[0].result.previous_path,`${a}/${v1}.json.gz`);
  const deleted=await db.query("delete from storage.objects where name=$1 returning name",[`${a}/${v1}.json.gz`]);
  assert.equal(deleted.rows.length,1);
  assert.equal((await publish(v2,v1)).rows[0].result.version,v2,"publication retry is idempotent");
});

test("another account cannot read, upload, publish or delete assigned-store catalogs",async()=>{
  await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',false)");
  assert.equal((await db.query("select * from public.store_catalog_files")).rows.length,0);
  assert.equal((await db.query("select * from storage.objects")).rows.length,0);
  await assert.rejects(publish(crypto.randomUUID(),v2),/No tienes permiso/);
  assert.equal((await db.query("delete from storage.objects returning name")).rows.length,0);
});
