-- Canaima ScanControl · empleados, supervisores por tienda, descuento y talla menor.
-- PASO MANUAL: ejecutar el archivo completo en Supabase > SQL Editor.
-- Es idempotente: puede ejecutarse nuevamente sin duplicar asignaciones ni datos.
-- No contiene contraseñas y no modifica cámara, lector, catálogos activos ni evaluaciones existentes.

-- Fase 1: columnas nuevas y, si la observación usa un enum, incorporación del valor.
-- El commit intermedio permite usar de forma segura el nuevo valor enum en restricciones posteriores.
begin;

alter table public.products
  add column if not exists discount_percent numeric(5,2) not null default 0;

alter table public.evaluation_items
  add column if not exists expected_size text not null default '';

alter table public.products
  drop constraint if exists products_discount_percent_range;

alter table public.products
  add constraint products_discount_percent_range
  check (discount_percent between 0 and 100);

do $migration$
declare
  target_table text;
  observation_type_schema text;
  observation_type_name text;
  observation_type_kind "char";
begin
  foreach target_table in array array['evaluation_items', 'scan_activity']
  loop
    observation_type_schema := null;
    observation_type_name := null;
    observation_type_kind := null;

    select type_namespace.nspname, column_type.typname, column_type.typtype
      into observation_type_schema, observation_type_name, observation_type_kind
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_type column_type on column_type.oid = attribute.atttypid
    join pg_catalog.pg_namespace type_namespace on type_namespace.oid = column_type.typnamespace
    where relation_namespace.nspname = 'public'
      and relation.relname = target_table
      and attribute.attname = 'observation'
      and not attribute.attisdropped;

    if observation_type_name is null then
      raise exception 'Falta la columna public.%.observation', target_table;
    end if;

    if observation_type_kind = 'e' then
      execute format(
        'alter type %I.%I add value if not exists %L',
        observation_type_schema,
        observation_type_name,
        'TALLA MENOR NO EXHIBIDA'
      );
    end if;
  end loop;
end;
$migration$;

commit;

-- Fase 2: reglas de observación, asignaciones exactas y permisos.
begin;

do $migration$
declare
  target_table text;
  constraint_row record;
begin
  foreach target_table in array array['evaluation_items', 'scan_activity']
  loop
    for constraint_row in
      select constraint_data.conname
      from pg_catalog.pg_constraint constraint_data
      where constraint_data.conrelid = pg_catalog.to_regclass(format('public.%I', target_table))
        and constraint_data.contype = 'c'
        and pg_catalog.pg_get_constraintdef(constraint_data.oid) ilike '%observation%'
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        target_table,
        constraint_row.conname
      );
    end loop;

    execute format(
      'alter table public.%I add constraint %I check (observation is null or observation::text in (%L, %L, %L, %L, %L))',
      target_table,
      target_table || '_observation_allowed',
      'SIN INCIDENCIAS',
      'PRECIO ERRÓNEO',
      'MAL ETIQUETADO',
      'SIN ETIQUETA',
      'TALLA MENOR NO EXHIBIDA'
    );
  end loop;
end;
$migration$;

create table if not exists public.supervisor_store_access (
  supervisor_email text not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  constraint supervisor_store_access_pkey primary key (supervisor_email, store_id),
  constraint supervisor_store_access_email_normalized
    check (supervisor_email = lower(btrim(supervisor_email)) and position('@' in supervisor_email) > 1)
);

create index if not exists supervisor_store_access_store_idx
  on public.supervisor_store_access (store_id);

alter table public.supervisor_store_access enable row level security;
revoke all on table public.supervisor_store_access from public, anon, authenticated;

create temporary table scancontrol_supervisor_import (
  supervisor_email text not null,
  city text not null,
  store_name text not null
) on commit drop;

insert into scancontrol_supervisor_import (supervisor_email, city, store_name) values
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'BB CANDELARIA 2022, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'DD RECREO 2023, C.A.'),
('supervisor.caracas03@grupocanaima.net', 'Caracas', 'AA MEGA CENTER 2026, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'GG CCS 2024, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'CC CANDELARIA 2022, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB CARRIZAL 2024, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'AA CENTER 2024, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'DD CHACAITO CCS 2025, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'AA CCCT 2023, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'BB LIDER 2022, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'CC LIDER 2022, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB CHACAITO CCS 2025, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'HH CCS 2024, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'EE MILLENNIUM 2025, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'CC CCS 2022, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'CC CERRO VERDE 2022, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'BB PARAISO 2024, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'EE CANDELARIA 2025, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'FF CANDELARIA 2025, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'AA CARRIZAL 2024, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'BB MILLENNIUM 2024, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'AA MILLENNIUM 2024, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB CCS OUTLET 2025, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB EXPRESO BARUTA CCS 2025, C.A.'),
('supervisor.caracas03@grupocanaima.net', 'Caracas', 'BB MEGA CENTER 2026, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'JJ CCS 2024, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'AA CCS OUTLET 2025, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'CC RECREO 2023, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'AA CERRO VERDE 2022, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'AA RECREO 2023, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'CC MILLENNIUM 2024, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'DD CANDELARIA 2022, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'GG LIDER 2024, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'CC CARRIZAL 2024, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'DD CCS 2023, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'II CCS 2024, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'EE CARRIZAL 2024, C.A.'),
('supervisor.caracas01@grupocanaima.net', 'Caracas', 'AA PARAISO 2024, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'FF CCS 2024, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'FF LIDER 2024, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'DD MILLENNIUM 2024, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'EE CCS 2024, C.A.'),
('supervisor.caracas02@grupocanaima.net', 'Caracas', 'MM CCS 2024, C.A.'),
('supervisor.caracas04@grupocanaima.net', 'Caracas', 'AA LIDER 2022, C.A.'),
('supervisor.caracas05@grupocanaima.net', 'Caracas', 'DD CERRO VERDE 2022, C.A.'),
('supervisor.oriente01@grupocanaima.net', 'Cumana', 'AB CUMANA 2021, C.A.'),
('supervisor.oriente01@grupocanaima.net', 'Cumana', 'CD CUMANA 2021, C.A.'),
('supervisor.oriente01@grupocanaima.net', 'Cumana', 'CC CUM 2022, C.A.'),
('supervisor.oriente01@grupocanaima.net', 'Cumana', 'AA CUM 2022, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'FF LEC 2026, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'EE LEC 2026, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'CC LEC 2022, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'BB LEC 2022, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'AA LEC 2022, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'AA PLAZA MAYOR 2024, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Lechería', 'DD LEC 2022, C.A.'),
('supervisor.oriente03@grupocanaima.net', 'Maturín', 'BB MUN 2022, C.A.'),
('supervisor.oriente03@grupocanaima.net', 'Maturín', 'AA MUN 2022, C.A.'),
('supervisor.oriente03@grupocanaima.net', 'Maturín', 'CC MUN 2024, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Puerto la Cruz', 'BB PLC 2025, C.A.'),
('supervisor.oriente02@grupocanaima.net', 'Puerto la Cruz', 'AA PLC 2023, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'FF PZO 2026, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'GG PZO 2026, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'EE PZO 2025, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'CC PZO 2022, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'AB PZO 2020, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'BB PZO 2022, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'DD PZO 2022, C.A.'),
('supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'AA PZO 2020, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'AA PF 2022, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'BB PF 2022, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'CC PF 2023, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'DD PF 2023, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'EE PF 2024, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'FF PF 2024, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'GG PF 2024, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'HH PF 2024, C.A.'),
('supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'II PF 2024, C.A.'),
('supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'AA SCI 2023, C.A.'),
('supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'BB SCI 2023, C.A.'),
('supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'CC SCI 2022, C.A.'),
('supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'DD SCI 2024, C.A.'),
('apure@grupocanaima.com', 'Apure', 'BB APU 2022, C.A.'),
('guarico@grupocanaima.com', 'Guarico', 'BB VLP 2024, C.A.');

do $validation$
declare
  issue_list text;
begin
  if (select count(*) from scancontrol_supervisor_import) <> 84 then
    raise exception 'El mapa debe contener exactamente 84 asignaciones';
  end if;

  if (select count(distinct supervisor_email) from scancontrol_supervisor_import) <> 13 then
    raise exception 'El mapa debe contener exactamente 13 supervisores';
  end if;

  if (
    select count(distinct regexp_replace(upper(store_name), '[^A-Z0-9]', '', 'g'))
    from scancontrol_supervisor_import
  ) <> 84 then
    raise exception 'El mapa contiene tiendas repetidas';
  end if;

  if exists (
    select regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
    from public.stores store
    where store.is_active = true
    group by 1
    having count(*) > 1
  ) then
    raise exception 'Hay tiendas activas duplicadas en public.stores; no se aplicaron permisos';
  end if;

  select string_agg(import_row.store_name, ', ' order by import_row.store_name)
    into issue_list
  from scancontrol_supervisor_import import_row
  where not exists (
    select 1
    from public.stores store
    where store.is_active = true
      and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
  );
  if issue_list is not null then
    raise exception 'Faltan tiendas activas: %', issue_list;
  end if;

  select string_agg(import_row.store_name, ', ' order by import_row.store_name)
    into issue_list
  from scancontrol_supervisor_import import_row
  join public.stores store
    on store.is_active = true
   and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
     = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
  where coalesce(store.city, '') is distinct from import_row.city;
  if issue_list is not null then
    raise exception 'La ciudad no coincide para: %', issue_list;
  end if;
end;
$validation$;

insert into public.supervisor_store_access (supervisor_email, store_id)
select lower(btrim(import_row.supervisor_email)), store.id
from scancontrol_supervisor_import import_row
join public.stores store
  on store.is_active = true
 and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
   = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
on conflict (supervisor_email, store_id) do nothing;

-- El Excel es la fuente autorizada: elimina asignaciones anteriores que ya no figuren allí.
delete from public.supervisor_store_access access_row
where not exists (
  select 1
  from scancontrol_supervisor_import import_row
  join public.stores store
    on store.is_active = true
   and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
     = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
  where lower(btrim(import_row.supervisor_email)) = access_row.supervisor_email
    and store.id = access_row.store_id
);

create or replace function public.current_user_can_access_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    left join auth.users auth_user on auth_user.id = profile.id
    where profile.id = (select auth.uid())
      and profile.is_active = true
      and (
        coalesce(profile.is_owner, false)
        or (
          profile.role::text = 'supervisor'
          and exists (
            select 1
            from public.supervisor_store_access assigned_store
            where assigned_store.supervisor_email = lower(btrim(auth_user.email::text))
              and assigned_store.store_id = target_store
          )
        )
        or (
          profile.role::text in ('employee', 'manager')
          and profile.store_id = target_store
        )
      )
  );
$$;

create or replace function public.current_user_can_evaluate_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_can_access_store(target_store);
$$;

revoke all on function public.current_user_can_access_store(uuid) from public, anon, authenticated;
revoke all on function public.current_user_can_evaluate_store(uuid) from public, anon, authenticated;
grant execute on function public.current_user_can_access_store(uuid) to authenticated;
grant execute on function public.current_user_can_evaluate_store(uuid) to authenticated;

-- Sustituye cualquier política SELECT anterior para evitar accesos globales heredados.
do $policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'scan_activity'
      and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on public.scan_activity', policy_row.policyname);
  end loop;
end;
$policies$;

create policy scan_activity_read_assigned
on public.scan_activity
for select
to authenticated
using (public.current_user_can_access_store(store_id));

create or replace function public.daily_activity_rows(target_date date, target_store uuid)
returns table (
  id uuid,
  activity_at timestamptz,
  employee_id uuid,
  employee_name text,
  store_id uuid,
  store_name text,
  source text,
  event_type text,
  barcode text,
  article text,
  description text,
  color text,
  size text,
  expected_size text,
  style text,
  amount numeric,
  brand text,
  category text,
  observation text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester public.profiles%rowtype;
begin
  select profile.*
    into requester
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.is_active = true;

  if requester.id is null then
    raise exception 'Acceso reservado para usuarios activos';
  end if;

  if not public.current_user_can_access_store(target_store) then
    raise exception 'Solo puedes consultar las tiendas asignadas a tu cuenta';
  end if;

  return query
  select activity.id,
         activity.created_at,
         activity.user_id,
         coalesce(employee.full_name, 'Usuario')::text,
         activity.store_id,
         coalesce(store.name, 'Tienda')::text,
         activity.source::text,
         activity.event_type::text,
         activity.barcode::text,
         activity.article::text,
         activity.description::text,
         activity.color::text,
         activity.size::text,
         activity.expected_size::text,
         activity.style::text,
         activity.amount,
         activity.brand::text,
         activity.category::text,
         activity.observation::text
  from public.scan_activity activity
  inner join public.profiles employee on employee.id = activity.user_id
  left join public.stores store on store.id = activity.store_id
  where (activity.created_at at time zone 'America/Caracas')::date = target_date
    and activity.store_id = target_store
  order by activity.created_at desc;
end;
$$;

revoke all on function public.daily_activity_rows(date, uuid) from public, anon, authenticated;
grant execute on function public.daily_activity_rows(date, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

-- Verificación esperada: 13 supervisores y 84 asignaciones.
select count(distinct supervisor_email) as supervisors,
       count(*) as store_assignments
from public.supervisor_store_access;

-- Debe mostrar únicamente las tiendas activas que no fueron incluidas en el Excel.
select store.name, store.city
from public.stores store
where store.is_active = true
  and not exists (
    select 1
    from public.supervisor_store_access assigned_store
    where assigned_store.store_id = store.id
  )
order by store.city, store.name;
