-- ScanControl · tiendas actualizadas y retención segura de catálogos.
-- PASO MANUAL: ejecutar el archivo completo en Supabase > SQL Editor.
-- Idempotente: se puede ejecutar nuevamente sin duplicar tiendas ni permisos.
-- No contiene contraseñas. No modifica cámara, lector, evaluaciones ni catálogos activos.
-- El Excel es la fuente autorizada para los accesos de usuarios máster y supervisores.

begin;
set local lock_timeout = '8s';
set local statement_timeout = '0';

-- Impide activar la limpieza automática si el historial no está protegido.
do $guard$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.evaluation_items'::regclass
      and conname = 'evaluation_items_product_id_fkey'
      and confdeltype = 'n'
  ) then
    raise exception 'Proteccion faltante: evaluation_items.product_id debe usar ON DELETE SET NULL.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_catalog_store_fk'
      and confdeltype = 'c'
  ) then
    raise exception 'Proteccion faltante: products debe usar ON DELETE CASCADE desde catalog_versions.';
  end if;
end;
$guard$;

alter table public.stores add column if not exists city text;

create temporary table if not exists scancontrol_store_import (
  master_email text not null,
  supervisor_email text not null,
  city text not null,
  store_name text not null
) on commit preserve rows;

truncate table scancontrol_store_import;

insert into scancontrol_store_import (master_email, supervisor_email, city, store_name) values
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'BB CANDELARIA 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'DD RECREO 2023, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas03@grupocanaima.net', 'Caracas', 'AA MEGA CENTER 2026, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'GG CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'CC CANDELARIA 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB CARRIZAL 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'AA CENTER 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'DD CHACAITO CCS 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'AA CCCT 2023, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'BB LIDER 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'CC LIDER 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB CHACAITO CCS 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'HH CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'EE MILLENNIUM 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'CC CCS 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'CC CERRO VERDE 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'BB PARAISO 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'EE CANDELARIA 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'FF CANDELARIA 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'AA CARRIZAL 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'BB MILLENNIUM 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'AA MILLENNIUM 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB CCS OUTLET 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'BB EXPRESO BARUTA CCS 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas03@grupocanaima.net', 'Caracas', 'BB MEGA CENTER 2026, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'JJ CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'AA CCS OUTLET 2025, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'CC RECREO 2023, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'AA CERRO VERDE 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'AA RECREO 2023, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'CC MILLENNIUM 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'DD CANDELARIA 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'GG LIDER 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'CC CARRIZAL 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'DD CCS 2023, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'II CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'EE CARRIZAL 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas01@grupocanaima.net', 'Caracas', 'AA PARAISO 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'FF CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'FF LIDER 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'DD MILLENNIUM 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'EE CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas02@grupocanaima.net', 'Caracas', 'MM CCS 2024, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas04@grupocanaima.net', 'Caracas', 'AA LIDER 2022, C.A.'),
('caracas@grupocanaima.com', 'supervisor.caracas05@grupocanaima.net', 'Caracas', 'DD CERRO VERDE 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente01@grupocanaima.net', 'Cumana', 'AB CUMANA 2021, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente01@grupocanaima.net', 'Cumana', 'CD CUMANA 2021, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente01@grupocanaima.net', 'Cumana', 'CC CUM 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente01@grupocanaima.net', 'Cumana', 'AA CUM 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'FF LEC 2026, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'EE LEC 2026, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'CC LEC 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'BB LEC 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'AA LEC 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'AA PLAZA MAYOR 2024, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Lechería', 'DD LEC 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente03@grupocanaima.net', 'Maturín', 'BB MUN 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente03@grupocanaima.net', 'Maturín', 'AA MUN 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente03@grupocanaima.net', 'Maturín', 'CC MUN 2024, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Puerto la Cruz', 'BB PLC 2025, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente02@grupocanaima.net', 'Puerto la Cruz', 'AA PLC 2023, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'FF PZO 2026, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'GG PZO 2026, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'EE PZO 2025, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'CC PZO 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'AB PZO 2020, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'BB PZO 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'DD PZO 2022, C.A.'),
('oriente@grupocanaima.net', 'supervisor.oriente04@grupocanaima.net', 'Puerto Ordaz', 'AA PZO 2020, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'AA PF 2022, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'BB PF 2022, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'CC PF 2023, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'DD PF 2023, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'EE PF 2024, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'FF PF 2024, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'GG PF 2024, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'HH PF 2024, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente01@grupocanaima.net', 'Punto Fijo', 'II PF 2024, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'AA SCI 2023, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'BB SCI 2023, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'CC SCI 2022, C.A.'),
('occidente@grupocanaima.net', 'supervisor.occidente02@grupocanaima.net', 'San Cristobal', 'DD SCI 2024, C.A.'),
('occidente@grupocanaima.net', 'apure@grupocanaima.com', 'Apure', 'BB APU 2022, C.A.'),
('occidente@grupocanaima.net', 'guarico@grupocanaima.com', 'Guarico', 'BB VLP 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'DD MCY 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'GG MCY 2023, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'BB MCY CENTRO 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'AA MCY 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'BB MCY 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'AA MCY CENTRO 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'EE MCY 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'FF MCY 2023, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'II MCY 2023, C.A.'),
('central@grupocanaima.net', 'supervisor.central03@grupocanaima.net', 'Maracay', 'JJ MCY 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'AA LA GRANJA 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central01@grupocanaima.net', 'Valencia', 'AA METROPOLIS VLC 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'AA VLC 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central01@grupocanaima.net', 'Valencia', 'BB METROPOLIS VLC 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'BB VLC 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central01@grupocanaima.net', 'Valencia', 'CC METROPOLIS VLC 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'CC VLC 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central01@grupocanaima.net', 'Valencia', 'DD METROPOLIS VLC 2024, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'DD VLC 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central01@grupocanaima.net', 'Valencia', 'EE METROPOLIS VLC 2025, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'EE VLC 2022, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'FF VLC 2023, C.A.'),
('central@grupocanaima.net', 'supervisor.central02@grupocanaima.net', 'Valencia', 'GG VLC 2023, C.A.'),
('central@grupocanaima.net', 'supervisor.central04@grupocanaima.net', 'Guacara', 'BB GUACARA 2025, C.A.'),
('central@grupocanaima.net', 'supervisor.central04@grupocanaima.net', 'Guacara', 'CC GUACARA 2025, C.A.');

do $validate$
declare
  invalid_email text;
begin
  if (select count(*) from scancontrol_store_import) <> 109
     or (select count(distinct regexp_replace(upper(store_name), '[^A-Z0-9]', '', 'g')) from scancontrol_store_import) <> 109
     or (select count(distinct master_email) from scancontrol_store_import) <> 4
     or (select count(distinct supervisor_email) from scancontrol_store_import) <> 17
     or (select count(distinct city) from scancontrol_store_import) <> 13
  then
    raise exception 'El directorio debe contener 109 empresas, 4 cuentas master, 17 supervisores y 13 ciudades.';
  end if;

  select email into invalid_email
  from (
    select master_email as email from scancontrol_store_import
    union
    select supervisor_email from scancontrol_store_import
  ) accounts
  where email <> lower(btrim(email))
     or pg_catalog.strpos(email, '@') <= 1
  limit 1;

  if invalid_email is not null then
    raise exception 'Correo invalido en el directorio: %', invalid_email;
  end if;

  if exists (
    select regexp_replace(upper(name), '[^A-Z0-9]', '', 'g')
    from public.stores
    group by 1
    having count(*) > 1
  ) then
    raise exception 'Hay empresas duplicadas en stores. Revisar antes de continuar.';
  end if;
end;
$validate$;

-- Conserva los UUID y catálogos de las tiendas existentes.
update public.stores store
set city = import_row.city,
    is_active = true
from scancontrol_store_import import_row
where regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
    = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
  and (
    coalesce(store.city, '') is distinct from import_row.city
    or store.is_active is distinct from true
  );

-- Inserta solamente las tiendas que todavía no existen.
insert into public.stores (name, slug, city, is_active)
select import_row.store_name,
       case
         when exists (
           select 1 from public.stores existing
           where existing.slug = slug_data.base_slug
         )
         then slug_data.base_slug || '-' || substr(md5(import_row.store_name), 1, 8)
         else slug_data.base_slug
       end,
       import_row.city,
       true
from scancontrol_store_import import_row
cross join lateral (
  select btrim(regexp_replace(lower(import_row.store_name), '[^a-z0-9]+', '-', 'g'), '-') as base_slug
) slug_data
where not exists (
  select 1
  from public.stores existing
  where regexp_replace(upper(existing.name), '[^A-Z0-9]', '', 'g')
      = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
);

do $stores_ready$
declare
  missing_stores text;
begin
  select string_agg(import_row.store_name, ', ' order by import_row.store_name)
    into missing_stores
  from scancontrol_store_import import_row
  where not exists (
    select 1
    from public.stores store
    where store.is_active = true
      and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
        = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
  );

  if missing_stores is not null then
    raise exception 'No se pudieron preparar estas tiendas: %', missing_stores;
  end if;
end;
$stores_ready$;

create table if not exists public.supervisor_store_access (
  supervisor_email text not null,
  store_id uuid not null references public.stores(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  constraint supervisor_store_access_pkey primary key (supervisor_email, store_id),
  constraint supervisor_store_access_email_normalized
    check (
      supervisor_email = lower(btrim(supervisor_email))
      and pg_catalog.strpos(supervisor_email, '@') > 1
    )
);

create index if not exists supervisor_store_access_store_idx
  on public.supervisor_store_access (store_id);

alter table public.supervisor_store_access enable row level security;
revoke all on table public.supervisor_store_access from public, anon, authenticated;

create temporary table if not exists scancontrol_desired_access (
  account_email text not null,
  store_id uuid not null,
  primary key (account_email, store_id)
) on commit preserve rows;

truncate table scancontrol_desired_access;

insert into scancontrol_desired_access (account_email, store_id)
select account.account_email, store.id
from scancontrol_store_import import_row
join public.stores store
  on store.is_active = true
 and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
   = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
cross join lateral (
  values (import_row.master_email), (import_row.supervisor_email)
) account(account_email)
on conflict (account_email, store_id) do nothing;

do $access_ready$
begin
  if (select count(*) from scancontrol_desired_access) <> 218 then
    raise exception 'Se esperaban 218 asignaciones exactas (master y supervisor por cada tienda).';
  end if;
end;
$access_ready$;

insert into public.supervisor_store_access (supervisor_email, store_id)
select account_email, store_id
from scancontrol_desired_access
on conflict (supervisor_email, store_id) do nothing;

delete from public.supervisor_store_access access_row
where not exists (
  select 1
  from scancontrol_desired_access desired
  where desired.account_email = access_row.supervisor_email
    and desired.store_id = access_row.store_id
);

-- Promueve solo cuentas Auth existentes. Las faltantes se informan al final.
update public.profiles profile
set role = (
      pg_catalog.jsonb_populate_record(
        null::public.profiles,
        pg_catalog.jsonb_build_object('role', 'supervisor')
      )
    ).role,
    is_active = true
from auth.users auth_user
where auth_user.id = profile.id
  and lower(btrim(auth_user.email::text)) in (
    select account_email from scancontrol_desired_access
  );

create or replace function public.current_user_can_access_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
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
$function$;

create or replace function public.current_user_can_evaluate_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.current_user_can_access_store(target_store);
$function$;

revoke all on function public.current_user_can_access_store(uuid) from public, anon, authenticated;
revoke all on function public.current_user_can_evaluate_store(uuid) from public, anon, authenticated;
grant execute on function public.current_user_can_access_store(uuid) to authenticated;
grant execute on function public.current_user_can_evaluate_store(uuid) to authenticated;

create or replace function public.registration_stores_by_city()
returns table (id uuid, name text, slug text, city text)
language sql
stable
security definer
set search_path = ''
as $function$
  select store.id,
         store.name::text,
         store.slug::text,
         coalesce(nullif(store.city, ''), 'Otras tiendas')::text
  from public.stores store
  where store.is_active = true
  order by coalesce(nullif(store.city, ''), 'Otras tiendas'), store.name;
$function$;

revoke all on function public.registration_stores_by_city() from public;
grant execute on function public.registration_stores_by_city() to anon, authenticated;

-- Reserva margen antes de duplicar temporalmente un catálogo durante la carga.
create or replace function public.catalog_upload_preflight(
  target_store uuid,
  incoming_rows integer
)
returns table (
  allowed boolean,
  current_bytes bigint,
  estimated_peak_bytes bigint,
  safety_limit_bytes bigint,
  message text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  database_bytes bigint;
  estimated_extra bigint;
  safety_limit constant bigint := 480000000;
begin
  if not public.current_user_can_access_store(target_store) then
    raise exception 'No tienes acceso a esta tienda';
  end if;

  if incoming_rows is null or incoming_rows <= 0 then
    return query
    select false, 0::bigint, 0::bigint, safety_limit,
           'El Excel no contiene productos validos.'::text;
    return;
  end if;

  database_bytes := pg_catalog.pg_database_size(pg_catalog.current_database());
  estimated_extra := incoming_rows::bigint * 1024;

  return query
  select database_bytes + estimated_extra <= safety_limit,
         database_bytes,
         database_bytes + estimated_extra,
         safety_limit,
         case
           when database_bytes + estimated_extra <= safety_limit
             then 'Hay capacidad para cargar y validar el catalogo.'::text
           else 'Carga bloqueada de forma preventiva: el catalogo puede superar la capacidad disponible. Retira catalogos obsoletos o reduce el archivo antes de reintentar.'::text
         end;
end;
$function$;

revoke all on function public.catalog_upload_preflight(uuid, integer) from public, anon;
grant execute on function public.catalog_upload_preflight(uuid, integer) to authenticated;

-- Activa el nuevo catálogo de forma atómica y elimina el anterior solo al final.
create or replace function public.activate_catalog(target_catalog uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  catalog_store uuid;
  expected_rows integer;
  actual_rows bigint;
  target_created_at timestamptz;
begin
  select version.store_id
    into catalog_store
  from public.catalog_versions version
  where version.id = target_catalog;

  if catalog_store is null then
    raise exception 'Catalogo no encontrado';
  end if;

  if not public.current_user_can_access_store(catalog_store) then
    raise exception 'No tienes acceso a esta tienda';
  end if;

  -- Una sola activación por tienda a la vez.
  perform 1
  from public.stores store
  where store.id = catalog_store
  for update;

  select version.row_count, version.created_at
    into expected_rows, target_created_at
  from public.catalog_versions version
  where version.id = target_catalog
    and version.store_id = catalog_store
    and version.status = 'ready'
  for update;

  if not found then
    raise exception 'Catalogo no encontrado o incompleto';
  end if;

  select count(*)
    into actual_rows
  from public.products product
  where product.catalog_id = target_catalog
    and product.store_id = catalog_store;

  if expected_rows is null or expected_rows <= 0 or actual_rows <> expected_rows::bigint then
    raise exception 'Catalogo incompleto: se esperaban % productos y existen %',
      coalesce(expected_rows, 0), actual_rows;
  end if;

  update public.catalog_versions
  set status = 'archived'
  where store_id = catalog_store
    and status = 'active'
    and id <> target_catalog;

  update public.catalog_versions
  set status = 'active',
      activated_at = pg_catalog.now()
  where id = target_catalog
    and store_id = catalog_store;

  update public.stores
  set active_catalog_id = target_catalog
  where id = catalog_store;

  -- Conserva una carga más nueva en progreso/lista; retira todo lo anterior.
  delete from public.catalog_versions obsolete
  where obsolete.store_id = catalog_store
    and obsolete.id <> target_catalog
    and (
      (
        obsolete.status in ('ready', 'archived', 'failed')
        and obsolete.created_at <= target_created_at
      )
      or (
        obsolete.status = 'uploading'
        and obsolete.created_at < pg_catalog.now() - interval '24 hours'
      )
    );
end;
$function$;

revoke all on function public.activate_catalog(uuid) from public, anon;
grant execute on function public.activate_catalog(uuid) to authenticated;

commit;

select
  (select count(*) from scancontrol_store_import) as tiendas_en_excel,
  (
    select count(*)
    from scancontrol_store_import import_row
    join public.stores store
      on store.is_active = true
     and regexp_replace(upper(store.name), '[^A-Z0-9]', '', 'g')
       = regexp_replace(upper(import_row.store_name), '[^A-Z0-9]', '', 'g')
  ) as tiendas_activas_encontradas,
  (select count(*) from public.supervisor_store_access) as asignaciones_activas,
  (
    select count(distinct desired.account_email)
    from scancontrol_desired_access desired
    join auth.users auth_user
      on lower(btrim(auth_user.email::text)) = desired.account_email
  ) as cuentas_existentes,
  (
    select coalesce(
      jsonb_agg(pending.account_email order by pending.account_email),
      '[]'::jsonb
    )
    from (
      select distinct desired.account_email
      from scancontrol_desired_access desired
      where not exists (
        select 1
        from auth.users auth_user
        where lower(btrim(auth_user.email::text)) = desired.account_email
      )
    ) pending
  ) as cuentas_pendientes,
  pg_size_pretty(pg_database_size(current_database())) as tamano_base_actual,
  true as retencion_catalogos_activada;

