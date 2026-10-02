-- Corrige exclusivamente las tres políticas del bucket privado de catálogos.
-- No elimina datos, no cambia roles/asignaciones y no suspende la aplicación.
begin;
set local lock_timeout = '3s';

alter policy shared_catalog_object_read on storage.objects
using (
  storage.objects.bucket_id = 'scancontrol-catalogs'
  and exists (
    select 1 from public.stores s
    where s.id::text = split_part(storage.objects.name, '/', 1)
      and public.current_user_can_access_store(s.id)
  )
);

alter policy shared_catalog_object_upload on storage.objects
with check (
  storage.objects.bucket_id = 'scancontrol-catalogs'
  and storage.objects.owner_id = (select auth.uid())::text
  and storage.objects.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.json\.gz$'
  and exists (
    select 1 from public.stores s
    where s.id::text = split_part(storage.objects.name, '/', 1)
      and public.current_user_can_access_store(s.id)
  )
);

alter policy shared_catalog_object_delete on storage.objects
using (
  storage.objects.bucket_id = 'scancontrol-catalogs'
  and exists (
    select 1 from public.stores s
    where s.id::text = split_part(storage.objects.name, '/', 1)
      and public.current_user_can_access_store(s.id)
  )
  and not exists (
    select 1 from public.store_catalog_files c
    where c.object_path = storage.objects.name
  )
);

commit;
