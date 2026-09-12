-- Canaima ScanControl: PASO MANUAL. Ejecutar completo en SQL Editor.
-- Añade ciudades y traslados. No altera usuarios, roles, inventarios ni escaneo.
-- Usuarios máster pendientes: NO crea cuentas ni concede permisos globales.
begin;

create temporary table scancontrol_profiles_before on commit drop as
select * from public.profiles;
create temporary table scancontrol_stores_before on commit drop as
select id, name, slug, active_catalog_id, is_active from public.stores;

alter table public.stores add column if not exists city text;
create temporary table scancontrol_city_import(city text, name text) on commit drop;
insert into scancontrol_city_import(city, name) values
('Caracas', 'BB CANDELARIA 2022, C.A.'),
('Caracas', 'DD RECREO 2023, C.A.'),
('Caracas', 'AA MEGA CENTER 2026, C.A.'),
('Caracas', 'GG CCS 2024, C.A.'),
('Caracas', 'CC CANDELARIA 2022, C.A.'),
('Caracas', 'BB CARRIZAL 2024, C.A.'),
('Caracas', 'AA CENTER 2024, C.A.'),
('Caracas', 'DD CHACAITO CCS 2025, C.A.'),
('Caracas', 'AA CCCT 2023, C.A.'),
('Caracas', 'BB LIDER 2022, C.A.'),
('Caracas', 'CC LIDER 2022, C.A.'),
('Caracas', 'BB CHACAITO CCS 2025, C.A.'),
('Caracas', 'HH CCS 2024, C.A.'),
('Caracas', 'EE MILLENNIUM 2025, C.A.'),
('Caracas', 'BB MILLENNIUM 2024, C.A.'),
('Caracas', 'CC CCS 2022, C.A.'),
('Caracas', 'CC CERRO VERDE 2022, C.A.'),
('Caracas', 'BB PARAISO 2024, C.A.'),
('Caracas', 'EE CANDELARIA 2025, C.A.'),
('Caracas', 'FF CANDELARIA 2025, C.A.'),
('Caracas', 'AA CARRIZAL 2024, C.A.'),
('Caracas', 'AA MILLENNIUM 2024, C.A.'),
('Caracas', 'BB CCS OUTLET 2025, C.A.'),
('Caracas', 'BB EXPRESO BARUTA CCS 2025, C.A.'),
('Caracas', 'BB MEGA CENTER 2026, C.A.'),
('Caracas', 'JJ CCS 2024, C.A.'),
('Caracas', 'AA CCS OUTLET 2025, C.A.'),
('Caracas', 'CC RECREO 2023, C.A.'),
('Caracas', 'AA CERRO VERDE 2022, C.A.'),
('Caracas', 'AA RECREO 2023, C.A.'),
('Caracas', 'CC MILLENNIUM 2024, C.A.'),
('Caracas', 'DD CANDELARIA 2022, C.A.'),
('Caracas', 'GG LIDER 2024, C.A.'),
('Caracas', 'CC CARRIZAL 2024, C.A.'),
('Caracas', 'DD CCS 2023, C.A.'),
('Caracas', 'II CCS 2024, C.A.'),
('Caracas', 'EE CARRIZAL 2024, C.A.'),
('Caracas', 'AA PARAISO 2024, C.A.'),
('Caracas', 'FF CCS 2024, C.A.'),
('Caracas', 'FF LIDER 2024, C.A.'),
('Caracas', 'DD MILLENNIUM 2024, C.A.'),
('Caracas', 'EE CCS 2024, C.A.'),
('Caracas', 'MM CCS 2024, C.A.'),
('Caracas', 'AA LIDER 2022, C.A.'),
('Caracas', 'DD CERRO VERDE 2022, C.A.'),
('Cumana', 'AB CUMANA 2021, C.A.'),
('Cumana', 'CD CUMANA 2021, C.A.'),
('Cumana', 'CC CUM 2022, C.A.'),
('Cumana', 'AA CUM 2022, C.A.'),
('Lechería', 'FF LEC 2026, C.A.'),
('Lechería', 'EE LEC 2026, C.A.'),
('Lechería', 'CC LEC 2022, C.A.'),
('Lechería', 'BB LEC 2022, C.A.'),
('Lechería', 'AA LEC 2022, C.A.'),
('Lechería', 'AA PLAZA MAYOR 2024, C.A.'),
('Lechería', 'DD LEC 2022, C.A.'),
('Maturín', 'BB MUN 2022, C.A.'),
('Maturín', 'AA MUN 2022, C.A.'),
('Maturín', 'CC MUN 2024, C.A.'),
('Puerto la Cruz', 'BB PLC 2025, C.A.'),
('Puerto la Cruz', 'AA PLC 2023, C.A.'),
('Puerto Ordaz', 'FF PZO 2026, C.A.'),
('Puerto Ordaz', 'GG PZO 2026, C.A.'),
('Puerto Ordaz', 'EE PZO 2025, C.A.'),
('Puerto Ordaz', 'CC PZO 2022, C.A.'),
('Puerto Ordaz', 'AB PZO 2020, C.A.'),
('Puerto Ordaz', 'BB PZO 2022, C.A.'),
('Puerto Ordaz', 'DD PZO 2022, C.A.'),
('Puerto Ordaz', 'AA PZO 2020, C.A.'),
('Punto Fijo', 'AA PF 2022, C.A.'),
('Punto Fijo', 'BB PF 2022, C.A.'),
('Punto Fijo', 'CC PF 2023, C.A.'),
('Punto Fijo', 'DD PF 2023, C.A.'),
('Punto Fijo', 'EE PF 2024, C.A.'),
('Punto Fijo', 'FF PF 2024, C.A.'),
('Punto Fijo', 'GG PF 2024, C.A.'),
('Punto Fijo', 'HH PF 2024, C.A.'),
('Punto Fijo', 'II PF 2024, C.A.'),
('San Cristobal', 'AA SCI 2023, C.A.'),
('San Cristobal', 'BB SCI 2023, C.A.'),
('San Cristobal', 'CC SCI 2022, C.A.'),
('San Cristobal', 'DD SCI 2024, C.A.'),
('Apure', 'BB APU 2022, C.A.'),
('Guarico', 'BB VLP 2024, C.A.');

-- Reconoce la misma empresa aunque el Excel tenga un punto final adicional.
-- Mantiene el UUID y todo el inventario de las 16 tiendas existentes.
do $$
begin
  if exists (
    select regexp_replace(upper(name),'[^A-Z0-9]','','g')
    from public.stores group by 1 having count(*) > 1
  ) then raise exception 'Hay empresas duplicadas en stores. Revisar antes de continuar.'; end if;
end;
$$;
update public.stores s set city = i.city
from scancontrol_city_import i
where regexp_replace(upper(s.name),'[^A-Z0-9]','','g') = regexp_replace(upper(i.name),'[^A-Z0-9]','','g');

insert into public.stores(name, slug, city, is_active)
select i.name, trim(both '-' from regexp_replace(lower(i.name),'[^a-z0-9]+','-','g')), i.city, true
from scancontrol_city_import i
where not exists (
  select 1 from public.stores s
  where regexp_replace(upper(s.name),'[^A-Z0-9]','','g') = regexp_replace(upper(i.name),'[^A-Z0-9]','','g')
);

-- Nueva función: mantiene intacta registration_stores() para versiones instaladas.
-- Solo publica el directorio de tiendas activas, igual que el registro actual.
create or replace function public.registration_stores_by_city()
returns table(id uuid, name text, slug text, city text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.id, s.name::text, s.slug::text, coalesce(nullif(s.city,''),'Otras tiendas')
  from public.stores s where s.is_active = true
  order by coalesce(s.city,'Otras tiendas'), s.name;
$$;
revoke all on function public.registration_stores_by_city() from public;
grant execute on function public.registration_stores_by_city() to anon, authenticated;

-- Un documento vigente por tienda. Reemplazo atómico: no borra el anterior
-- hasta que el nuevo conjunto completo se guarda correctamente.
create table if not exists public.active_transfer_files (
  store_id uuid primary key references public.stores(id),
  file_name text not null,
  articles text[] not null check (cardinality(articles) between 1 and 100000),
  uploaded_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint transfer_articles_no_nulls check (array_position(articles, null) is null)
);
alter table public.active_transfer_files enable row level security;
revoke all on public.active_transfer_files from public, anon, authenticated;
grant select, insert, update, delete on public.active_transfer_files to authenticated;

-- Reutiliza exactamente el alcance por tienda del inventario actual.
drop policy if exists transfers_read_store on public.active_transfer_files;
create policy transfers_read_store on public.active_transfer_files for select to authenticated
using (public.current_user_can_access_store(store_id));
drop policy if exists transfers_insert_store on public.active_transfer_files;
create policy transfers_insert_store on public.active_transfer_files for insert to authenticated
with check (public.current_user_can_access_store(store_id) and uploaded_by = (select auth.uid()));
drop policy if exists transfers_update_store on public.active_transfer_files;
create policy transfers_update_store on public.active_transfer_files for update to authenticated
using (public.current_user_can_access_store(store_id))
with check (public.current_user_can_access_store(store_id) and uploaded_by = (select auth.uid()));
drop policy if exists transfers_delete_store on public.active_transfer_files;
create policy transfers_delete_store on public.active_transfer_files for delete to authenticated
using (public.current_user_can_access_store(store_id));

-- Si alguna cuenta o tienda previa fue modificada, revierte todo este paso.
do $$
begin
  if exists(select * from public.profiles except select * from scancontrol_profiles_before)
    or exists(select * from scancontrol_profiles_before except select * from public.profiles)
  then raise exception 'Se detectó un cambio en perfiles. Actualización cancelada.'; end if;
  if exists(
    select id,name,slug,active_catalog_id,is_active from scancontrol_stores_before
    except select id,name,slug,active_catalog_id,is_active from public.stores
  ) then raise exception 'Se alteró una tienda existente. Actualización cancelada.'; end if;
  if (select count(*) from scancontrol_city_import) <> 84 then
    raise exception 'El directorio debe contener 84 empresas independientes.';
  end if;
end;
$$;
commit;

select (select count(*) from public.stores where is_active) as tiendas_activas,
       (select count(*) from public.stores where city is not null) as tiendas_con_ciudad,
       (select count(*) from public.profiles) as cuentas_conservadas,
       exists(select 1 from pg_class where oid='public.active_transfer_files'::regclass and relrowsecurity) as traslados_rls_activo;
