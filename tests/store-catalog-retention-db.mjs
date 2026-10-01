// Isolated PostgreSQL test. No connection to Supabase or production.
// npm install --prefix /tmp/canaima-sql-tests --ignore-scripts @electric-sql/pglite@0.5.8
// PGLITE_PATH=/tmp/canaima-sql-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/store-catalog-retention-db.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const db = new PGlite();
const migration = await readFile(new URL("../ACTUALIZAR_TIENDAS_RETENCION_CATALOGOS_20260930.sql", import.meta.url), "utf8");
const ids = {
  centralMaster: "00000000-0000-4000-8000-000000000011",
  centralSupervisor: "00000000-0000-4000-8000-000000000012",
};

const asUser = async (userId) => {
  await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false)`);
};

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;

    create table public.stores(
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text unique not null,
      city text,
      active_catalog_id uuid,
      is_active boolean not null default true
    );
    create table public.profiles(
      id uuid primary key,
      full_name text,
      role text,
      is_owner boolean not null default false,
      is_active boolean not null default true,
      store_id uuid
    );
    create table public.catalog_versions(
      id uuid primary key default gen_random_uuid(),
      store_id uuid not null references public.stores(id),
      file_name text not null,
      row_count integer not null default 0,
      status text not null,
      uploaded_by uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      activated_at timestamptz,
      unique(id, store_id)
    );
    alter table public.stores add constraint stores_active_catalog_fk
      foreign key(active_catalog_id, id) references public.catalog_versions(id, store_id);
    create table public.products(
      id uuid primary key default gen_random_uuid(),
      catalog_id uuid not null,
      store_id uuid not null references public.stores(id),
      barcode text not null,
      article text not null default '',
      constraint products_catalog_store_fk foreign key(catalog_id, store_id)
        references public.catalog_versions(id, store_id) on delete cascade,
      unique(catalog_id, barcode)
    );
    create table public.evaluation_items(
      id uuid primary key default gen_random_uuid(),
      product_id uuid constraint evaluation_items_product_id_fkey references public.products(id) on delete set null,
      article text not null default ''
    );

    insert into public.stores(name, slug, city)
    values ('JJ PF 2026, C.A.', 'jj-pf-2026', null);
    insert into auth.users(id,email) values
      ('${ids.centralMaster}', 'central@grupocanaima.net'),
      ('${ids.centralSupervisor}', 'supervisor.central04@grupocanaima.net');
    insert into public.profiles(id,full_name,role,is_owner,is_active) values
      ('${ids.centralMaster}', 'Master Central', 'employee', false, true),
      ('${ids.centralSupervisor}', 'Supervisor Guacara', 'employee', false, true);
  `);

  await db.exec(migration);
  await db.exec(migration);

  assert.equal((await db.query("select count(*)::int as n from stores")).rows[0].n, 110);
  assert.equal((await db.query("select count(*)::int as n from supervisor_store_access")).rows[0].n, 218);
  assert.deepEqual((await db.query(`
    select city, count(*)::int as stores
    from public.stores
    where city in ('Maracay','Valencia','Guacara')
    group by city order by city
  `)).rows, [
    { city: "Guacara", stores: 2 },
    { city: "Maracay", stores: 10 },
    { city: "Valencia", stores: 13 },
  ]);
  assert.deepEqual((await db.query(`
    select auth_user.email, profile.role, count(access_row.store_id)::int as stores
    from auth.users auth_user
    join profiles profile on profile.id = auth_user.id
    left join supervisor_store_access access_row
      on access_row.supervisor_email = lower(auth_user.email)
    group by auth_user.email, profile.role
    order by auth_user.email
  `)).rows, [
    { email: "central@grupocanaima.net", role: "supervisor", stores: 25 },
    { email: "supervisor.central04@grupocanaima.net", role: "supervisor", stores: 2 },
  ]);
  assert.equal((await db.query("select count(*)::int as n from stores where name='JJ PF 2026, C.A.' and city is null")).rows[0].n, 1);

  const guacaraStore = (await db.query("select id from stores where name='BB GUACARA 2025, C.A.'")).rows[0].id;
  const valenciaStore = (await db.query("select id from stores where name='AA VLC 2022, C.A.'")).rows[0].id;
  await asUser(ids.centralSupervisor);
  assert.equal((await db.query("select current_user_can_access_store($1) as allowed", [guacaraStore])).rows[0].allowed, true);
  assert.equal((await db.query("select current_user_can_access_store($1) as allowed", [valenciaStore])).rows[0].allowed, false);
  assert.equal((await db.query("select allowed from catalog_upload_preflight($1,1)", [guacaraStore])).rows[0].allowed, true);

  await db.exec("reset role");
  const oldCatalog = "10000000-0000-4000-8000-000000000001";
  const newCatalog = "10000000-0000-4000-8000-000000000002";
  const oldProduct = "20000000-0000-4000-8000-000000000001";
  await db.query(`
    insert into catalog_versions(id,store_id,file_name,row_count,status,uploaded_by,created_at,activated_at)
    values
      ($1,$3,'anterior.xlsx',1,'active',$4,'2026-09-01',now()),
      ($2,$3,'nuevo.xlsx',1,'ready',$4,'2026-10-01',null)
  `, [oldCatalog, newCatalog, guacaraStore, ids.centralSupervisor]);
  await db.query(`
    insert into products(id,catalog_id,store_id,barcode,article) values
      ($1,$2,$4,'OLD-1','ARTICULO HISTORICO'),
      (gen_random_uuid(),$3,$4,'NEW-1','ARTICULO NUEVO')
  `, [oldProduct, oldCatalog, newCatalog, guacaraStore]);
  await db.query("insert into evaluation_items(product_id,article) values($1,'ARTICULO HISTORICO')", [oldProduct]);
  await db.query("update stores set active_catalog_id=$1 where id=$2", [oldCatalog, guacaraStore]);

  await asUser(ids.centralSupervisor);
  await db.query("select activate_catalog($1)", [newCatalog]);

  await db.exec("reset role");
  assert.deepEqual((await db.query("select id,status from catalog_versions where store_id=$1", [guacaraStore])).rows, [
    { id: newCatalog, status: "active" },
  ]);
  assert.equal((await db.query("select active_catalog_id from stores where id=$1", [guacaraStore])).rows[0].active_catalog_id, newCatalog);
  assert.equal((await db.query("select count(*)::int as n from products where id=$1", [oldProduct])).rows[0].n, 0);
  assert.deepEqual((await db.query("select product_id,article from evaluation_items")).rows[0], {
    product_id: null,
    article: "ARTICULO HISTORICO",
  });

  const incompleteCatalog = "10000000-0000-4000-8000-000000000003";
  await db.query(`
    insert into catalog_versions(id,store_id,file_name,row_count,status,uploaded_by,created_at)
    values($1,$2,'incompleto.xlsx',2,'ready',$3,'2026-10-02')
  `, [incompleteCatalog, guacaraStore, ids.centralSupervisor]);
  await db.query("insert into products(catalog_id,store_id,barcode,article) values($1,$2,'ONLY-1','UNO')", [incompleteCatalog, guacaraStore]);
  await asUser(ids.centralSupervisor);
  await assert.rejects(db.query("select activate_catalog($1)", [incompleteCatalog]), /Catalogo incompleto/);
  await db.exec("reset role");
  assert.equal((await db.query("select status from catalog_versions where id=$1", [newCatalog])).rows[0].status, "active");

  console.log("PASS: 109 tiendas/218 accesos; catálogos atómicos; historial preservado; JJ PF intacta.");
} finally {
  await db.close();
}
