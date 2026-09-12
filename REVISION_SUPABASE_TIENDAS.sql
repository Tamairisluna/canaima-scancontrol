-- Canaima ScanControl. SOLO LECTURA: no modifica usuarios, tablas ni permisos.
-- Ejecutar en SQL Editor del proyecto usado por la app publicada.
-- Exportar el resultado como CSV y compartirlo para preparar el cambio manual.
select 'columnas' as apartado, coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) as resultado
from (
  select table_name, column_name, data_type, udt_name, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('stores','profiles','products','catalog_versions','evaluations','evaluation_items','scan_activity')
  order by table_name, ordinal_position
) c
union all
select 'politicas', coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
from (
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname
) p
union all
select 'funciones', coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
from (
  select p.proname as nombre, pg_get_function_identity_arguments(p.oid) as argumentos,
         pg_get_functiondef(p.oid) as definicion
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and (p.proname like 'current_user_%' or p.proname like 'owner_%'
      or p.proname in ('registration_stores','handle_new_user','daily_activity_rows','activate_catalog'))
  order by p.proname
) f
union all
select 'tiendas', coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
from (select id, name, slug, is_active from public.stores order by name) s
union all
select 'resumen_roles', coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
from (select role::text as rol, is_active, count(*) as cantidad from public.profiles group by role, is_active) r;
