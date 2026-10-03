-- PASO 1: ejecutar este archivo completo en SQL Editor, rol postgres.
-- Instala una limpieza privada; NO borra inventarios al instalarla.
-- PASO 2, en una consulta nueva con rol postgres, ejecutar SOLAMENTE:
-- call scancontrol_maintenance.limpiar_sin_uso_20261003(null);
-- Si productos_pendientes o tiendas_pendientes_revision no son cero,
-- repetir la misma llamada. Los lotes ya confirmados no se repiten.
-- No modifica usuarios, permisos, historiales, Storage ni mantenimiento.
-- No ejecuta VACUUM ni VACUUM FULL.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

create schema if not exists scancontrol_maintenance;
revoke all on schema scancontrol_maintenance from public, anon, authenticated;

create table if not exists scancontrol_maintenance.tiendas_20261003 (
  store_id uuid primary key,
  tienda text not null,
  max_productos integer not null,
  max_catalogos integer not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','protegida','retirado','completo')),
  catalog_ids uuid[] not null default '{}',
  productos_antes bigint,
  catalogos_antes integer,
  productos_eliminados bigint not null default 0,
  nota text,
  retirado_at timestamptz,
  terminado_at timestamptz,
  check (productos_eliminados >= 0 and productos_eliminados <= productos_antes)
);
alter table scancontrol_maintenance.tiendas_20261003 enable row level security;
revoke all on scancontrol_maintenance.tiendas_20261003 from public, anon, authenticated;

-- Lista exacta de la lectura confirmada por el usuario; no se amplía sola.
insert into scancontrol_maintenance.tiendas_20261003
  (store_id,tienda,max_productos,max_catalogos) values
('e910cf2b-c585-4d32-a058-5a46a36b61b7','CC CANDELARIA 2022, C.A.',57628,2),
('82b74207-6072-4d76-8c59-2223516aa344','BB CHACAITO CCS 2025, C.A.',30869,2),
('710bdb09-bb20-4111-94aa-4fccd73b5cf7','CC LEC 2022, C.A.',22045,2),
('9cebd7f9-4322-4079-973e-ae27f6abad5a','BB VLP 2024, C.A',19858,2),
('b1523bc5-d464-4e3f-a06c-3666536e71fb','BB APU 2022, C.A',19334,2),
('48da62ba-5fb7-427e-86d2-b9975fc25a1d','BB LIDER 2022, C.A.',18632,2),
('205e9710-70cd-4aa2-a423-ae2e5b9adb68','DD SCI 2024, C.A',8297,2),
('169f8dd2-ad6d-4cf5-837d-5c28c029972d','FF CCS 2024, C.A.',5816,2),
('318c6c89-95c1-4874-97f2-a175e455fd47','EE CANDELARIA 2025, C.A.',5804,1),
('b7c98990-4288-4ff6-9c7e-1016363d1859','DD CCS 2023, C.A.',1683,1)
on conflict (store_id) do nothing;

-- Índice pequeño para evitar revisar todas las incidencias por cada producto.
create index if not exists scancontrol_cleanup_evaluation_product_idx
  on public.evaluation_items(product_id);

create or replace procedure scancontrol_maintenance.limpiar_sin_uso_20261003(
  inout resultado jsonb, in max_lotes integer default 50
)
language plpgsql security invoker
as $procedure$
declare
  v_start timestamptz := clock_timestamp();
  -- El corte queda fijado a esta revisión: una llamada futura no expira tiendas nuevas.
  v_cutoff timestamptz := least(now() - interval '7 days',
                              timestamptz '2026-09-26 03:36:00+00');
  v_store record;
  v_queue record;
  v_ids uuid[];
  v_products bigint;
  v_removed bigint;
  v_batches integer := 0;
  v_limit integer := least(50,greatest(1,coalesce(max_lotes,50)));
  v_ignored uuid[] := '{}';
begin
  if not exists (select 1 from pg_catalog.pg_constraint k where k.contype = 'f'
      and k.conrelid = 'public.evaluation_items'::regclass
      and k.confrelid = 'public.products'::regclass and k.confdeltype = 'n')
    or not exists (select 1 from pg_catalog.pg_constraint k where k.contype = 'f'
      and k.conrelid = 'public.products'::regclass
      and k.confrelid = 'public.catalog_versions'::regclass and k.confdeltype = 'c')
    or exists (select 1 from pg_catalog.pg_constraint k where k.contype = 'f'
      and ((k.confrelid = 'public.products'::regclass
        and not (k.conrelid = 'public.evaluation_items'::regclass and k.confdeltype = 'n'))
      or (k.confrelid = 'public.catalog_versions'::regclass
        and not ((k.conrelid = 'public.products'::regclass and k.confdeltype = 'c')
          or (k.conrelid = 'public.stores'::regclass and k.confdeltype in ('a','r'))))))
    or exists (select 1 from pg_catalog.pg_trigger tg where not tg.tgisinternal
      and tg.tgenabled <> 'D'
      and tg.tgrelid in ('public.products'::regclass,'public.catalog_versions'::regclass))
    or not exists (select 1 from pg_catalog.pg_index ix
      join pg_catalog.pg_attribute a on a.attrelid = ix.indrelid and a.attname = 'product_id'
      where ix.indrelid = 'public.evaluation_items'::regclass
        and ix.indisvalid and ix.indisready and ix.indpred is null
        and ix.indkey[0] = a.attnum) then
    raise exception 'Las dependencias o el índice cambiaron. No se inicia la limpieza.';
  end if;

  -- Retira cada inventario completo de forma atómica antes de borrar sus filas.
  -- Bloquea primero la tienda, como hace el publicador del catálogo.
  for v_store in select q.* from scancontrol_maintenance.tiendas_20261003 q
      where q.estado = 'pendiente' order by q.store_id
  loop
    exit when clock_timestamp() - v_start > interval '40 seconds';
    perform 1 from public.stores s where s.id = v_store.store_id
      and s.name = v_store.tienda for update skip locked;
    if not found then
      update scancontrol_maintenance.tiendas_20261003
        set nota = 'Tienda ocupada, inexistente o renombrada; no se retiró el catálogo.'
        where store_id = v_store.store_id and estado = 'pendiente';
    else
      perform 1 from scancontrol_maintenance.tiendas_20261003 q
        where q.store_id = v_store.store_id and q.estado = 'pendiente'
        for update skip locked;
      if found then
        -- Revalidación después del bloqueo. Cualquier archivo compartido se conserva.
        if exists (select 1 from public.store_catalog_files sc where sc.store_id = v_store.store_id)
          or exists (select 1 from public.catalog_versions cv where cv.store_id = v_store.store_id
            and (cv.status::text = 'uploading'
              or greatest(cv.created_at,cv.activated_at) >= v_cutoff))
          or exists (select 1 from public.scan_activity a where a.store_id = v_store.store_id
            and a.created_at >= v_cutoff)
          or exists (select 1 from public.evaluation_items ei where ei.store_id = v_store.store_id
            and ei.scanned_at >= v_cutoff)
          or exists (select 1 from public.evaluations e where e.store_id = v_store.store_id
            and e.created_at >= v_cutoff)
          or exists (select 1 from public.profiles p join auth.users u on u.id = p.id
            where p.store_id = v_store.store_id and p.is_active
              and p.role::text in ('employee','manager')
              and greatest(u.last_sign_in_at,u.created_at) >= v_cutoff) then
          update scancontrol_maintenance.tiendas_20261003
            set estado = 'protegida', nota = 'Hay actividad, carga o catálogo compartido; se conserva todo.'
            where store_id = v_store.store_id;
        else
          -- NOWAIT evita que una carga que tiene bloqueada una versión se quede esperando.
          begin
            perform cv.id from public.catalog_versions cv where cv.store_id = v_store.store_id
              order by cv.id for update nowait;
            select coalesce(array_agg(cv.id order by cv.id),'{}'::uuid[]) into v_ids
              from public.catalog_versions cv where cv.store_id = v_store.store_id;
            select count(*) into v_products from public.products p where p.store_id = v_store.store_id;
            if exists (select 1 from public.catalog_versions cv where cv.store_id = v_store.store_id
                and (cv.status::text = 'uploading'
                  or greatest(cv.created_at,cv.activated_at) >= v_cutoff))
              or cardinality(v_ids) > v_store.max_catalogos or v_products > v_store.max_productos
              or exists (select 1 from public.products p where p.store_id = v_store.store_id
                and not (p.catalog_id = any(v_ids))) then
              update scancontrol_maintenance.tiendas_20261003
                set estado = 'protegida', nota = 'Los conteos cambiaron; se conserva todo para revisión.'
                where store_id = v_store.store_id;
            else
              update public.stores set active_catalog_id = null where id = v_store.store_id;
              update public.catalog_versions set status = 'archived'
                where id = any(v_ids) and store_id = v_store.store_id;
              update scancontrol_maintenance.tiendas_20261003
                set estado = 'retirado', catalog_ids = v_ids, productos_antes = v_products,
                    catalogos_antes = cardinality(v_ids), retirado_at = clock_timestamp(),
                    nota = 'Inventario antiguo retirado; la tienda puede cargar otro Excel.'
                where store_id = v_store.store_id;
            end if;
          exception when lock_not_available then
            update scancontrol_maintenance.tiendas_20261003
              set nota = 'Una versión está ocupada; no se retiró el catálogo.'
              where store_id = v_store.store_id;
          end;
        end if;
      end if;
    end if;
    commit;
  end loop;

  -- Cada lote tiene su propio COMMIT; la cola conserva el progreso ante un timeout.
  loop
    exit when v_batches >= v_limit or clock_timestamp() - v_start > interval '40 seconds';
    select q.* into v_queue from scancontrol_maintenance.tiendas_20261003 q
      where q.estado = 'retirado' and not (q.store_id = any(v_ignored))
      order by q.store_id limit 1 for update skip locked;
    exit when not found;
    perform 1 from public.stores s where s.id = v_queue.store_id for update skip locked;
    if not found then
      v_ignored := array_append(v_ignored,v_queue.store_id);
    else
      -- No se toca ninguna versión nueva. Si alguien reactivó una antigua, se detiene esa tienda.
      begin
        perform cv.id from public.catalog_versions cv where cv.id = any(v_queue.catalog_ids)
          order by cv.id for update nowait;
        if exists (select 1 from public.stores s where s.active_catalog_id = any(v_queue.catalog_ids))
          or exists (select 1 from public.catalog_versions cv where cv.id = any(v_queue.catalog_ids)
            and (cv.status::text <> 'archived' or cv.store_id <> v_queue.store_id)) then
          v_ignored := array_append(v_ignored,v_queue.store_id);
          update scancontrol_maintenance.tiendas_20261003
            set nota = 'Una versión antigua fue reactivada o cambió; se detiene esta tienda.'
            where store_id = v_queue.store_id;
        else
          with victims as (
            select p.id from public.products p
            where p.catalog_id = any(v_queue.catalog_ids) and p.store_id = v_queue.store_id
            limit 5000 for update skip locked
          )
          delete from public.products p using victims v where p.id = v.id;
          get diagnostics v_removed = row_count;
          update scancontrol_maintenance.tiendas_20261003
            set productos_eliminados = productos_eliminados + v_removed
            where store_id = v_queue.store_id;
          delete from public.catalog_versions cv where cv.id = any(v_queue.catalog_ids)
            and cv.store_id = v_queue.store_id and cv.status::text = 'archived'
            and not exists (select 1 from public.products p where p.catalog_id = cv.id)
            and not exists (select 1 from public.stores s where s.active_catalog_id = cv.id);
          if not exists (select 1 from public.products p where p.catalog_id = any(v_queue.catalog_ids))
            and not exists (select 1 from public.catalog_versions cv where cv.id = any(v_queue.catalog_ids)) then
            update scancontrol_maintenance.tiendas_20261003
              set estado = 'completo', terminado_at = clock_timestamp(), nota = 'Inventario antiguo eliminado.'
              where store_id = v_queue.store_id;
          elsif v_removed = 0 then
            v_ignored := array_append(v_ignored,v_queue.store_id);
          end if;
        end if;
      exception when lock_not_available then
        v_ignored := array_append(v_ignored,v_queue.store_id);
      end;
    end if;
    v_batches := v_batches + 1;
    commit;
  end loop;

  select jsonb_build_object(
    'lotes_en_esta_llamada',v_batches,
    'productos_antes',coalesce(sum(q.productos_antes),0),
    'productos_eliminados',coalesce(sum(q.productos_eliminados),0),
    'productos_pendientes',(select count(*) from public.products p
      where exists (select 1 from scancontrol_maintenance.tiendas_20261003 r
        where p.catalog_id = any(r.catalog_ids))),
    'tiendas_pendientes_revision',count(*) filter (where q.estado = 'pendiente'),
    'tiendas_protegidas',count(*) filter (where q.estado = 'protegida'),
    'tiendas_omitidas_por_bloqueo_o_cambio',cardinality(v_ignored),
    'tiendas_completas',count(*) filter (where q.estado = 'completo'),
    'base_actual',pg_size_pretty(pg_database_size(current_database())),
    'detalle',jsonb_agg(jsonb_build_object(
      'tienda',q.tienda,'estado',q.estado,'productos_antes',q.productos_antes,
      'productos_eliminados',q.productos_eliminados,
      'productos_despues',(select count(*) from public.products p where p.catalog_id = any(q.catalog_ids)),
      'catalogos_antes',q.catalogos_antes,
      'catalogos_despues',(select count(*) from public.catalog_versions cv where cv.id = any(q.catalog_ids)),
      'nota',q.nota) order by q.tienda)
  ) into resultado from scancontrol_maintenance.tiendas_20261003 q;
end;
$procedure$;
revoke all on procedure scancontrol_maintenance.limpiar_sin_uso_20261003(jsonb,integer)
  from public, anon, authenticated;

select true as limpieza_instalada,
       sum(max_productos) as maximo_productos_revisados,
       count(*) as tiendas_del_listado
from scancontrol_maintenance.tiendas_20261003;
commit;
