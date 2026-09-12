// Isolated PostgreSQL test. No connection to Supabase or production.
// npm install --prefix /tmp/canaima-sql-tests --ignore-scripts @electric-sql/pglite@0.5.8
// PGLITE_PATH=/tmp/canaima-sql-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/transfers-db.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const db = new PGlite();
const migration = await readFile(new URL("../ACTIVAR_CIUDADES_TRASLADOS.sql", import.meta.url), "utf8");
const ids = { owner: "00000000-0000-4000-8000-000000000001", supervisor: "00000000-0000-4000-8000-000000000002", manager: "00000000-0000-4000-8000-000000000003", employee: "00000000-0000-4000-8000-000000000004", a: "00000000-0000-4000-8000-000000000005", b: "00000000-0000-4000-8000-000000000006" };
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table public.stores(id uuid primary key default gen_random_uuid(),name text not null,slug text unique not null,active_catalog_id uuid,is_active boolean not null default true);
    create table public.profiles(id uuid primary key,role text,is_owner boolean,is_active boolean,store_id uuid);
    create function public.current_user_can_access_store(target_store uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
      select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active=true and (coalesce(p.is_owner,false) or p.role::text='supervisor' or p.store_id=target_store));
    $$;
    insert into stores(id,name,slug) values ('${ids.a}','AA PF 2022, C.A','aa-pf-2022'),('${ids.b}','BB SCI 2023, C.A','bb-sci-2023');
    insert into stores(name,slug) values ('JJ PF 2026, C.A','jj-pf-2026');
  `);
  for (const role of ["owner", "supervisor", "manager", "employee"]) {
    await db.query("insert into auth.users values($1)", [ids[role]]);
    await db.query("insert into profiles values($1,$2,$3,true,$4)", [ids[role], role === "owner" ? "supervisor" : role, role === "owner", ids.a]);
  }
  const before = (await db.query("select * from profiles order by id")).rows;
  await db.exec(migration);
  await db.exec(migration); // Re-running must not duplicate stores or reset data.
  assert.equal((await db.query("select count(*)::int as n from stores")).rows[0].n, 85);
  assert.equal((await db.query("select city from registration_stores_by_city() where slug='jj-pf-2026'")).rows[0].city, "Otras tiendas");
  assert.deepEqual((await db.query("select * from profiles order by id")).rows, before);
  assert.equal((await db.query("select city from stores where id=$1", [ids.a])).rows[0].city, "Punto Fijo");
  const asUser = async (role) => { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${ids[role]}',false)`); };
  const save = (store, user, articles) => db.query("insert into active_transfer_files(store_id,file_name,articles,uploaded_by) values($1,'Traslados.xlsx',$2,$3) on conflict(store_id) do update set articles=excluded.articles,uploaded_by=excluded.uploaded_by returning store_id", [store, articles, user]);
  await asUser("supervisor");
  await save(ids.a, ids.supervisor, ["00125"]); await save(ids.b, ids.supervisor, ["999"]);
  for (const role of ["employee", "manager"]) {
    await asUser(role);
    assert.deepEqual((await db.query("select store_id from active_transfer_files")).rows, [{ store_id: ids.a }]);
    await assert.rejects(save(ids.b, ids[role], ["BAD"]), /row-level security/);
    await assert.rejects(save(ids.a, ids.supervisor, ["BAD"]), /row-level security/);
    assert.equal((await db.query("delete from active_transfer_files where store_id=$1 returning store_id", [ids.b])).rows.length, 0);
  }
  await asUser("employee");
  await save(ids.a, ids.employee, ["00001", "STYLE-2"]);
  await assert.rejects(save(ids.a, ids.employee, []), /check constraint/);
  assert.deepEqual((await db.query("select articles from active_transfer_files where store_id=$1", [ids.a])).rows[0].articles, ["00001", "STYLE-2"]);
  await asUser("owner");
  assert.equal((await db.query("select * from active_transfer_files")).rows.length, 2);
  await db.query("delete from active_transfer_files where store_id=$1", [ids.a]);
  assert.deepEqual((await db.query("select articles from active_transfer_files where store_id=$1", [ids.b])).rows[0].articles, ["999"]);
  await db.exec("reset role; set role anon");
  assert.equal((await db.query("select * from registration_stores_by_city()")).rows.length, 85);
  await assert.rejects(db.query("select * from active_transfer_files"), /permission denied/);
  console.log("PASS: SQL idempotent; profiles and store IDs preserved; city directory; isolated store reads/writes/deletes; owner/supervisor access; atomic replacement; anonymous denial.");
} finally { await db.close(); }
