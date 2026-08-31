-- Canaima ScanControl · catálogo ampliado y Registro diario
-- Ejecutar una sola vez en Supabase > SQL Editor antes de publicar esta versión.

begin;

alter table public.products
  add column if not exists brand text not null default 'No especificado',
  add column if not exists category text not null default 'No especificado';

create table if not exists public.scan_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  store_id uuid not null,
  product_id text,
  evaluation_item_id uuid,
  source text not null default 'scanner' check (source in ('scanner', 'evaluation')),
  event_type text not null default 'SCAN' check (event_type in ('SCAN', 'SIZE_NOT_DISPLAYED', 'SIZE_RESOLVED')),
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
  observation text check (observation is null or observation in ('SIN INCIDENCIAS', 'PRECIO ERRÓNEO', 'MAL ETIQUETADO', 'SIN ETIQUETA')),
  created_at timestamptz not null default now()
);

create index if not exists scan_activity_store_created_idx on public.scan_activity (store_id, created_at desc);
create index if not exists scan_activity_user_created_idx on public.scan_activity (user_id, created_at desc);
create index if not exists scan_activity_evaluation_item_idx on public.scan_activity (evaluation_item_id) where evaluation_item_id is not null;

alter table public.scan_activity enable row level security;
grant select, insert, update, delete on public.scan_activity to authenticated;

drop policy if exists scan_activity_insert_own on public.scan_activity;
create policy scan_activity_insert_own
on public.scan_activity
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        coalesce(p.is_owner, false)
        or p.role::text = 'supervisor'
        or p.store_id = scan_activity.store_id
      )
  )
);

drop policy if exists scan_activity_update_own on public.scan_activity;
create policy scan_activity_update_own
on public.scan_activity
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists scan_activity_delete_own on public.scan_activity;
create policy scan_activity_delete_own
on public.scan_activity
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists scan_activity_management_read on public.scan_activity;
create policy scan_activity_management_read
on public.scan_activity
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        coalesce(p.is_owner, false)
        or p.role::text = 'supervisor'
        or (p.role::text = 'manager' and p.store_id = scan_activity.store_id)
      )
  )
);

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
set search_path = public
as $$
declare
  requester public.profiles%rowtype;
begin
  select * into requester from public.profiles where profiles.id = auth.uid() and profiles.is_active = true;
  if requester.id is null or (not coalesce(requester.is_owner, false) and requester.role::text not in ('manager', 'supervisor')) then
    raise exception 'Acceso reservado para gerentes, supervisores y propietario';
  end if;
  if requester.role::text = 'manager' and target_store is distinct from requester.store_id then
    raise exception 'El gerente solo puede consultar su tienda asignada';
  end if;

  return query
  select
    a.id,
    a.created_at,
    a.user_id,
    coalesce(p.full_name, 'Usuario')::text,
    a.store_id,
    coalesce(s.name, 'Tienda')::text,
    a.source,
    a.event_type,
    a.barcode,
    a.article,
    a.description,
    a.color,
    a.size,
    a.expected_size,
    a.style,
    a.amount,
    a.brand,
    a.category,
    a.observation
  from public.scan_activity a
  inner join public.profiles p on p.id = a.user_id
  left join public.stores s on s.id = a.store_id
  where (a.created_at at time zone 'America/Caracas')::date = target_date
    and a.store_id = target_store
  order by a.created_at desc;
end;
$$;

revoke all on function public.daily_activity_rows(date, uuid) from public;
revoke all on function public.daily_activity_rows(date, uuid) from anon;
grant execute on function public.daily_activity_rows(date, uuid) to authenticated;

commit;
