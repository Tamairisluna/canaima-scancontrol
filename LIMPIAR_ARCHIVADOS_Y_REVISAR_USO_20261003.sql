-- Un lote pequeño de restos archivados y una lectura de uso por tienda.
-- Conserva active, ready, uploading, archivos compartidos e historiales.
-- No ejecuta VACUUM FULL ni modifica cuentas, permisos o mantenimiento.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $guard$
begin
  if not exists (select 1 from pg_constraint k where k.contype = 'f'
    and k.conrelid = 'public.evaluation_items'::regclass
    and k.confrelid = 'public.products'::regclass and k.confdeltype = 'n')
    or not exists (select 1 from pg_constraint k where k.contype = 'f'
    and k.conrelid = 'public.products'::regclass
    and k.confrelid = 'public.catalog_versions'::regclass and k.confdeltype = 'c') then
    raise exception 'Las relaciones cambiaron. No se elimina ningún dato.';
  end if;
  if exists (select 1 from pg_constraint k where k.contype = 'f'
    and ((k.confrelid = 'public.products'::regclass
      and not (k.conrelid = 'public.evaluation_items'::regclass and k.confdeltype = 'n'))
    or (k.confrelid = 'public.catalog_versions'::regclass
      and not ((k.conrelid = 'public.products'::regclass and k.confdeltype = 'c')
        or (k.conrelid = 'public.stores'::regclass and k.confdeltype in ('a','r'))))))
    or exists (select 1 from pg_trigger tg where not tg.tgisinternal
      and tg.tgenabled <> 'D'
      and tg.tgrelid in ('public.products'::regclass, 'public.catalog_versions'::regclass)) then
    raise exception 'Hay nuevas dependencias o triggers. Se necesita revisarlos antes de limpiar.';
  end if;
end;
$guard$;

create temporary table scancontrol_archived_batch on commit drop as
select cv.id
from public.catalog_versions cv
where cv.status::text = 'archived'
  and cv.created_at < now() - interval '24 hours'
  and not exists (select 1 from public.stores s where s.active_catalog_id = cv.id)
order by cv.created_at, cv.id
limit 200
for update of cv skip locked;

create temporary table scancontrol_cleanup_result (
  catalogos_antes bigint, productos_antes bigint,
  catalogos_despues bigint, productos_despues bigint
) on commit drop;
insert into scancontrol_cleanup_result (catalogos_antes, productos_antes)
select (select count(*) from scancontrol_archived_batch),
       (select count(*) from public.products p
        join scancontrol_archived_batch b on b.id = p.catalog_id);

do $cleanup$
declare expected bigint; removed bigint;
begin
  if (select r.productos_antes from scancontrol_cleanup_result r) > 2000 then
    raise exception 'El lote supera 2000 productos. No se ha borrado nada; hay que reducirlo.';
  end if;
  select r.catalogos_antes into expected from scancontrol_cleanup_result r;
  delete from public.catalog_versions cv
  using scancontrol_archived_batch b
  where cv.id = b.id and cv.status::text = 'archived'
    and not exists (select 1 from public.stores s where s.active_catalog_id = cv.id);
  get diagnostics removed = row_count;
  if removed <> expected then
    raise exception 'Un catálogo cambió durante la revisión. Se revierte todo el lote.';
  end if;
end;
$cleanup$;

update scancontrol_cleanup_result
set catalogos_despues = (select count(*) from public.catalog_versions cv
                         join scancontrol_archived_batch b on b.id = cv.id),
    productos_despues = (select count(*) from public.products p
                         join scancontrol_archived_batch b on b.id = p.catalog_id);

-- Lectura: "sin uso" significa siete días sin actividad ni cargas recientes.
-- Los accesos de empleados/gerentes y las cuentas nuevas también protegen la tienda.
-- Las tiendas se listan para revisión; sus inventarios todavía NO se eliminan.
with activity as (
  select a.store_id, max(a.created_at) as last_scan,
         count(*) filter (where a.created_at >= now() - interval '7 days') as scans_7d
  from public.scan_activity a group by a.store_id
), items as (
  select ei.store_id, max(ei.scanned_at) as last_evaluation
  from public.evaluation_items ei group by ei.store_id
), evaluations as (
  select e.store_id, max(e.created_at) as last_evaluation_created
  from public.evaluations e group by e.store_id
), logins as (
  select p.store_id, max(greatest(u.last_sign_in_at, u.created_at)) as last_account_access
  from public.profiles p join auth.users u on u.id = p.id
  where p.role::text in ('employee','manager') and p.is_active
  group by p.store_id
), catalogs as (
  select cv.store_id, count(*) as versions,
         count(*) filter (where cv.status::text = 'uploading') as uploading,
         max(greatest(cv.created_at, cv.activated_at)) as last_catalog_change
  from public.catalog_versions cv group by cv.store_id
), products as (
  select p.store_id, count(*) as product_rows
  from public.products p group by p.store_id
), usage as (
  select s.id as tienda_id, s.name as tienda,
         coalesce(p.product_rows,0) as productos_en_base,
         coalesce(c.versions,0) as versiones_en_base,
         coalesce(c.uploading,0) as cargas_en_curso,
         coalesce(a.scans_7d,0) as escaneos_7_dias,
         a.last_scan as ultimo_escaneo, i.last_evaluation as ultima_evaluacion,
         l.last_account_access as ultimo_acceso_empleado,
         c.last_catalog_change as ultimo_catalogo_en_base,
         sc.updated_at as ultimo_catalogo_compartido,
         greatest(a.last_scan,i.last_evaluation,e.last_evaluation_created,
                  l.last_account_access,c.last_catalog_change,sc.updated_at) as ultimo_uso_o_carga
  from public.stores s
  left join activity a on a.store_id = s.id
  left join items i on i.store_id = s.id
  left join evaluations e on e.store_id = s.id
  left join logins l on l.store_id = s.id
  left join catalogs c on c.store_id = s.id
  left join products p on p.store_id = s.id
  left join public.store_catalog_files sc on sc.store_id = s.id
), reviewed as (
  select u.*, (u.productos_en_base > 0 and u.cargas_en_curso = 0
    and (u.ultimo_uso_o_carga is null or u.ultimo_uso_o_carga < now() - interval '7 days'))
      as candidata_sin_uso
  from usage u
)
select '01_lote_archivado' as apartado,
       (select to_jsonb(r)::text from scancontrol_cleanup_result r) as resultado
union all
select '02_uso_por_tienda', coalesce(jsonb_agg(to_jsonb(u)
       order by u.candidata_sin_uso desc, u.productos_en_base desc, u.tienda), '[]'::jsonb)::text
from reviewed u
union all
select '03_base_actual', pg_size_pretty(pg_database_size(current_database()));

commit;
