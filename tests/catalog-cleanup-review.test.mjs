// Validate the read-only review against real columns and protected catalog states.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);

test('cleanup review preserves active pointers, latest ready, uploads and recent versions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema storage;
      create table public.stores(id uuid primary key,name text,active_catalog_id uuid);
      create table public.catalog_versions(id uuid primary key,store_id uuid references stores(id),status text,created_at timestamptz);
      create table public.products(id uuid primary key default gen_random_uuid(),catalog_id uuid references catalog_versions(id) on delete cascade);
      create table public.evaluation_items(id uuid primary key,product_id uuid references products(id) on delete set null);
      create table public.store_catalog_files(store_id uuid,version uuid,row_count integer,updated_at timestamptz,compressed_bytes bigint,object_path text);
      create table storage.objects(bucket_id text,name text,metadata jsonb);
      insert into stores values ('00000000-0000-4000-8000-000000000001','AA PF 2022',null),
                               ('00000000-0000-4000-8000-000000000002','BB PF 2022',null);
    `);
    const store='00000000-0000-4000-8000-000000000001';
    const rows=[['active',10],['ready',8],['ready',7],['uploading',30],['archived',9],['failed',5],['archived',12],['failed',0.01]];
    const ids=[];
    for(const [status,days] of rows){
      const id=crypto.randomUUID();ids.push(id);
      await db.query("insert into catalog_versions values($1,$2,$3,now()-$4::double precision*interval '1 day')",[id,store,status,days]);
      await db.query('insert into products(catalog_id) values($1)',[id]);
    }
    await db.query('update stores set active_catalog_id=$1 where id=$2',[ids[6],store]);
    const secondStore='00000000-0000-4000-8000-000000000002';
    await db.query("insert into catalog_versions values($1,$2,'ready',now()-interval '60 days')",[crypto.randomUUID(),secondStore]);
    const version=crypto.randomUUID(),path=`${store}/${version}.json.gz`;
    await db.query('insert into store_catalog_files values($1,$2,100,now(),42,$3)',[store,version,path]);
    await db.query("insert into storage.objects values('scancontrol-catalogs',$1,'{\"size\":42}')",[path]);
    const sql=await readFile(new URL('../REVISAR_LIMPIEZA_CATALOGOS_20261003.sql',import.meta.url),'utf8');
    await db.exec('begin read only');
    const rowsAfter=(await db.query(sql)).rows;
    assert.equal(rowsAfter.length,8);
    const report=Object.fromEntries(rowsAfter.map(row=>[row.apartado,row.resultado]));
    assert.deepEqual(JSON.parse(report['04_candidatos_antiguos']),{catalogos:3,productos:3});
    assert.deepEqual(JSON.parse(report['05_candidatos_por_tienda']).map(row=>[row.tienda,row.catalogos,row.productos]),[['AA PF 2022',3,3]]);
    assert.equal(JSON.parse(report['06_catalogos_compartidos'])[0].archivo_presente,true);
    assert.equal(JSON.parse(report['07_claves_foraneas']).length,2);
    assert.equal((await db.query('select count(*)::int as n from products')).rows[0].n,8);
    assert.equal((await db.query('select count(*)::int as n from catalog_versions')).rows[0].n,9);
    await db.exec('commit');
  } finally { await db.close(); }
});
