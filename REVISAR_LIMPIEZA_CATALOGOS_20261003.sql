-- Solo lectura. No elimina datos ni modifica el estado de la aplicación.
-- Exportar el resultado como CSV para revisar antes de preparar los lotes.
with latest_ready as (
  select distinct on (cv.store_id) cv.store_id, cv.id
  from public.catalog_versions cv
  where cv.status::text = 'ready'
  order by cv.store_id, cv.created_at desc, cv.id desc
), candidates as (
  select cv.id, cv.store_id, cv.status::text as status, cv.created_at
  from public.catalog_versions cv
  where cv.status::text in ('ready', 'archived', 'failed')
    and cv.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.stores s where s.active_catalog_id = cv.id)
    and not exists (select 1 from latest_ready r where r.id = cv.id)
), product_counts as (
  select p.catalog_id, count(*) as products
  from public.products p group by p.catalog_id
), report as (
  select '01_base_actual' as apartado,
         pg_size_pretty(pg_database_size(current_database())) as resultado
  union all
  select '02_tablas_y_espacio', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text
  from (
    select st.schemaname || '.' || st.relname as tabla,
           pg_size_pretty(pg_total_relation_size(st.relid)) as espacio,
           st.n_live_tup as filas_vivas_estimadas, st.n_dead_tup as filas_borradas_estimadas,
           st.last_autovacuum, st.last_vacuum
    from pg_stat_user_tables st
    where st.schemaname = 'public'
    order by pg_total_relation_size(st.relid) desc limit 10
  ) t
  union all
  select '03_catalogos_por_estado', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text
  from (
    select cv.status::text as estado, count(*) as catalogos,
           coalesce(sum(pc.products), 0) as productos
    from public.catalog_versions cv left join product_counts pc on pc.catalog_id = cv.id
    group by cv.status::text order by cv.status::text
  ) t
  union all
  select '04_candidatos_antiguos', jsonb_build_object(
    'catalogos', (select count(*) from candidates),
    'productos', (select coalesce(sum(pc.products), 0) from candidates c
                 left join product_counts pc on pc.catalog_id = c.id)
  )::text
  union all
  select '05_candidatos_por_tienda', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text
  from (
    select s.id as tienda_id, s.name as tienda, count(*) as catalogos,
           coalesce(sum(pc.products), 0) as productos
    from candidates c join public.stores s on s.id = c.store_id
    left join product_counts pc on pc.catalog_id = c.id
    group by s.id, s.name order by s.name
  ) t
  union all
  select '06_catalogos_compartidos', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text
  from (
    select s.name as tienda, c.version, c.row_count as productos, c.updated_at,
           pg_size_pretty(c.compressed_bytes) as archivo,
           exists (select 1 from storage.objects o
             where o.bucket_id = 'scancontrol-catalogs' and o.name = c.object_path
               and (o.metadata->>'size')::bigint = c.compressed_bytes) as archivo_presente
    from public.store_catalog_files c join public.stores s on s.id = c.store_id
    order by s.name
  ) t
  union all
  select '07_claves_foraneas', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text
  from (
    select k.conrelid::regclass::text as tabla, k.conname as restriccion,
           pg_get_constraintdef(k.oid) as definicion
    from pg_constraint k
    where k.contype = 'f'
      and k.confrelid in ('public.products'::regclass, 'public.catalog_versions'::regclass)
    order by k.conrelid::regclass::text, k.conname
  ) t
  union all
  select '08_triggers_de_productos_y_catalogos', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text
  from (
    select tg.tgrelid::regclass::text as tabla, tg.tgname as nombre,
           pg_get_triggerdef(tg.oid) as definicion
    from pg_trigger tg
    where not tg.tgisinternal
      and tg.tgrelid in ('public.products'::regclass, 'public.catalog_versions'::regclass)
    order by tg.tgname
  ) t
)
select apartado, resultado from report order by apartado;
