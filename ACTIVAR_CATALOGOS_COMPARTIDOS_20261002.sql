-- Ejecutar una sola vez en SQL Editor del proyecto canaima-scancontrol.
-- Es aditivo: no borra productos, catálogos existentes ni registros.
begin;
set local lock_timeout = '3s';

create table if not exists public.store_catalog_files (
  store_id uuid primary key references public.stores(id) on delete cascade,
  version uuid not null,
  object_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 255),
  row_count integer not null check (row_count > 0),
  compressed_bytes bigint not null check (compressed_bytes between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (object_path = store_id::text || '/' || version::text || '.json.gz')
);
alter table public.store_catalog_files enable row level security;
revoke all on public.store_catalog_files from public, anon, authenticated;
grant select, insert, update on public.store_catalog_files to authenticated;

drop policy if exists shared_catalog_read on public.store_catalog_files;
create policy shared_catalog_read on public.store_catalog_files for select to authenticated
using (public.current_user_can_access_store(store_id));

drop policy if exists shared_catalog_insert on public.store_catalog_files;
create policy shared_catalog_insert on public.store_catalog_files for insert to authenticated
with check (public.current_user_can_access_store(store_id) and uploaded_by = (select auth.uid())
  and exists (select 1 from storage.objects o where o.bucket_id = 'scancontrol-catalogs'
    and o.name = object_path and o.owner_id = (select auth.uid())::text
    and (o.metadata->>'size')::bigint = compressed_bytes));

drop policy if exists shared_catalog_update on public.store_catalog_files;
create policy shared_catalog_update on public.store_catalog_files for update to authenticated
using (public.current_user_can_access_store(store_id))
with check (public.current_user_can_access_store(store_id) and uploaded_by = (select auth.uid())
  and exists (select 1 from storage.objects o where o.bucket_id = 'scancontrol-catalogs'
    and o.name = object_path and o.owner_id = (select auth.uid())::text
    and (o.metadata->>'size')::bigint = compressed_bytes));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scancontrol-catalogs', 'scancontrol-catalogs', false, 20971520, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists shared_catalog_object_read on storage.objects;
create policy shared_catalog_object_read on storage.objects for select to authenticated
using (bucket_id = 'scancontrol-catalogs' and exists (
  select 1 from public.stores s where s.id::text = split_part(name, '/', 1)
    and public.current_user_can_access_store(s.id)
));

drop policy if exists shared_catalog_object_upload on storage.objects;
create policy shared_catalog_object_upload on storage.objects for insert to authenticated
with check (bucket_id = 'scancontrol-catalogs' and owner_id = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.json\.gz$' and exists (
    select 1 from public.stores s where s.id::text = split_part(name, '/', 1)
      and public.current_user_can_access_store(s.id)
  ));

-- Archivos actuales protegidos; solo se eliminan versiones ya sustituidas
-- o archivos temporales. No se concede UPDATE: cada carga usa un nombre nuevo.
drop policy if exists shared_catalog_object_delete on storage.objects;
create policy shared_catalog_object_delete on storage.objects for delete to authenticated
using (bucket_id = 'scancontrol-catalogs' and exists (
  select 1 from public.stores s where s.id::text = split_part(name, '/', 1)
    and public.current_user_can_access_store(s.id)
) and not exists (select 1 from public.store_catalog_files c where c.object_path = name));

create or replace function public.publish_store_catalog_file(
  p_store_id uuid, p_version uuid, p_expected_version uuid,
  p_file_name text, p_row_count integer, p_compressed_bytes bigint, p_sha256 text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  prior_catalog public.store_catalog_files%rowtype;
  published public.store_catalog_files%rowtype;
  new_path text := p_store_id::text || '/' || p_version::text || '.json.gz';
begin
  if (select auth.uid()) is null or not public.current_user_can_access_store(p_store_id) then
    raise exception 'No tienes permiso para actualizar el catálogo de esta tienda.';
  end if;
  -- Serializa únicamente publicaciones de la misma tienda; el escaneo sigue.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store_id::text, 0));
  select * into prior_catalog from public.store_catalog_files where store_id = p_store_id;
  if prior_catalog.version = p_version then
    return pg_catalog.to_jsonb(prior_catalog) || pg_catalog.jsonb_build_object('previous_path', null);
  end if;
  if prior_catalog.version is distinct from p_expected_version then
    raise exception 'Otra persona actualizó esta tienda durante la carga. Revisa la versión actual y vuelve a intentarlo.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'scancontrol-catalogs'
    and o.name = new_path and o.owner_id = (select auth.uid())::text
    and (o.metadata->>'size')::bigint = p_compressed_bytes) then
    raise exception 'El archivo compartido no está completo. Se conserva el catálogo anterior.';
  end if;
  insert into public.store_catalog_files (store_id, version, object_path, file_name, row_count,
    compressed_bytes, sha256, uploaded_by, updated_at)
  values (p_store_id, p_version, new_path, p_file_name, p_row_count, p_compressed_bytes,
    p_sha256, (select auth.uid()), pg_catalog.clock_timestamp())
  on conflict (store_id) do update set version = excluded.version, object_path = excluded.object_path,
    file_name = excluded.file_name, row_count = excluded.row_count, compressed_bytes = excluded.compressed_bytes,
    sha256 = excluded.sha256, uploaded_by = excluded.uploaded_by, updated_at = excluded.updated_at
  returning * into published;
  return pg_catalog.to_jsonb(published) || pg_catalog.jsonb_build_object('previous_path', prior_catalog.object_path);
end;
$function$;
revoke all on function public.publish_store_catalog_file(uuid, uuid, uuid, text, integer, bigint, text) from public, anon;
grant execute on function public.publish_store_catalog_file(uuid, uuid, uuid, text, integer, bigint, text) to authenticated;
notify pgrst, 'reload schema';
commit;

-- El resultado esperado es tres valores true.
select
  to_regclass('public.store_catalog_files') is not null as tabla_lista,
  exists (select 1 from storage.buckets where id = 'scancontrol-catalogs' and public = false) as almacenamiento_privado_listo,
  to_regprocedure('public.publish_store_catalog_file(uuid,uuid,uuid,text,integer,bigint,text)') is not null as publicacion_lista;
