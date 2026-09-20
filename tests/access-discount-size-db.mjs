// Isolated PostgreSQL test. No connection to Supabase or production.
// npm install --prefix /tmp/canaima-sql-tests --ignore-scripts @electric-sql/pglite@0.5.8
// PGLITE_PATH=/tmp/canaima-sql-tests/node_modules/@electric-sql/pglite/dist/index.js node tests/access-discount-size-db.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
const db = new PGlite();
const storesMigration = await readFile(new URL("../ACTIVAR_CIUDADES_TRASLADOS.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../CONFIGURAR_ACCESOS_DESCUENTO_TALLA_20260920.sql", import.meta.url), "utf8");
const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  supervisor: "00000000-0000-4000-8000-000000000002",
  unmappedSupervisor: "00000000-0000-4000-8000-000000000003",
  manager: "00000000-0000-4000-8000-000000000004",
  employee: "00000000-0000-4000-8000-000000000005",
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
    create table public.products(id uuid primary key default gen_random_uuid());
    create type public.evaluation_observation as enum (
      'SIN INCIDENCIAS', 'PRECIO ERRÓNEO', 'MAL ETIQUETADO', 'SIN ETIQUETA'
    );
    create table public.evaluation_items(
      id uuid primary key default gen_random_uuid(),
      observation public.evaluation_observation not null default 'SIN INCIDENCIAS'
    );
    create table public.scan_activity(
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      store_id uuid not null,
      source text not null default 'scanner',
      event_type text not null default 'SCAN',
      barcode text not null default '',
      article text not null default '',
      description text not null default '',
      color text not null default 'No especificado',
      size text not null default 'No especificado',
      expected_size text not null default '',
      style text not null default 'No especificado',
      amount numeric(12,2) not null default 0,
      brand text not null default 'No especificado',
      category text not null default 'No especificado',
      observation text check (
        observation is null or observation in ('SIN INCIDENCIAS', 'PRECIO ERRÓNEO', 'MAL ETIQUETADO', 'SIN ETIQUETA')
      ),
      created_at timestamptz not null default now()
    );
    alter table public.scan_activity enable row level security;
    grant select, insert, update, delete on public.scan_activity to authenticated;
    grant select on public.stores to authenticated;

    create function public.current_user_can_access_store(target_store uuid)
    returns boolean language sql stable security definer set search_path = public, pg_temp
    as $$ select exists(
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.is_active
        and (profile.is_owner or profile.role = 'supervisor' or profile.store_id = target_store)
    ) $$;

    insert into public.stores(name, slug) values ('JJ PF 2026, C.A', 'jj-pf-2026');
  `);

  await db.exec(storesMigration);
  const store = async (name) => (await db.query("select id from stores where name=$1", [name])).rows[0].id;
  const assignedStore = await store("BB CANDELARIA 2022, C.A.");
  const otherSupervisorStore = await store("GG CCS 2024, C.A.");
  const employeeStore = await store("BB SCI 2023, C.A.");
  const unassignedStore = await store("JJ PF 2026, C.A");

  const users = [
    [ids.owner, "owner@example.com", "supervisor", true, assignedStore],
    [ids.supervisor, "Supervisor.Caracas01@grupocanaima.net", "supervisor", false, otherSupervisorStore],
    [ids.unmappedSupervisor, "sin.mapa@example.com", "supervisor", false, assignedStore],
    [ids.manager, "manager@example.com", "manager", false, employeeStore],
    [ids.employee, "employee@example.com", "employee", false, employeeStore],
  ];
  for (const [id, email, role, isOwner, storeId] of users) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
    await db.query("insert into profiles(id,full_name,role,is_owner,is_active,store_id) values($1,$2,$3,$4,true,$5)", [id, email, role, isOwner, storeId]);
  }

  await db.exec(migration);
  await db.exec(migration);

  assert.deepEqual((await db.query(`
    select count(distinct supervisor_email)::int as supervisors, count(*)::int as assignments
    from supervisor_store_access
  `)).rows[0], { supervisors: 13, assignments: 84 });
  assert.deepEqual((await db.query(`
    select name from stores store
    where store.is_active and not exists (
      select 1 from supervisor_store_access access_row where access_row.store_id = store.id
    )
  `)).rows, [{ name: "JJ PF 2026, C.A" }]);

  const canAccess = async (storeId) => (await db.query(
    "select current_user_can_access_store($1) as allowed",
    [storeId],
  )).rows[0].allowed;

  await asUser(ids.supervisor);
  assert.equal(await canAccess(assignedStore), true);
  assert.equal(await canAccess(otherSupervisorStore), false);
  assert.equal(await canAccess(unassignedStore), false);
  await assert.rejects(db.query("select * from supervisor_store_access"), /permission denied/);

  await asUser(ids.unmappedSupervisor);
  assert.equal(await canAccess(assignedStore), false);

  for (const userId of [ids.employee, ids.manager]) {
    await asUser(userId);
    assert.equal(await canAccess(employeeStore), true);
    assert.equal(await canAccess(assignedStore), false);
    assert.equal((await db.query("select current_user_can_evaluate_store($1) as allowed", [employeeStore])).rows[0].allowed, true);
  }

  await db.exec("reset role");
  await db.query(`
    insert into scan_activity(user_id,store_id,article,observation)
    values($1,$2,'PRUEBA','TALLA MENOR NO EXHIBIDA')
  `, [ids.manager, employeeStore]);
  await asUser(ids.employee);
  assert.equal((await db.query("select count(*)::int as n from daily_activity_rows(current_date,$1)", [employeeStore])).rows[0].n, 1);
  await assert.rejects(db.query("select * from daily_activity_rows(current_date,$1)", [assignedStore]), /tiendas asignadas/);

  await asUser(ids.owner);
  assert.equal(await canAccess(unassignedStore), true);

  await db.exec("reset role");
  await db.query("insert into products(discount_percent) values(25.5)");
  await assert.rejects(db.query("insert into products(discount_percent) values(101)"), /check constraint/);
  await db.query("insert into evaluation_items(observation,expected_size) values('TALLA MENOR NO EXHIBIDA','S')");
  assert.deepEqual((await db.query("select observation::text as observation, expected_size from evaluation_items")).rows[0], {
    observation: "TALLA MENOR NO EXHIBIDA",
    expected_size: "S",
  });

  console.log("PASS: SQL idempotente; 13 supervisores/84 tiendas; correo normalizado; roles aislados; empleados con Evaluación/Registro; descuento y talla menor válidos.");
} finally {
  await db.close();
}
