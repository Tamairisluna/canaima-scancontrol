-- Canaima ScanControl · corrección de acceso por rol
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Supervisores: todas las tiendas. Gerentes: solamente su tienda asignada.
-- Romer conserva acceso total mediante is_owner=true.

begin;

create or replace function public.current_user_can_access_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        coalesce(p.is_owner, false)
        or p.role::text = 'supervisor'
        or p.store_id = target_store
      )
  );
$$;

create or replace function public.current_user_can_evaluate_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        coalesce(p.is_owner, false)
        or p.role::text = 'supervisor'
        or (p.role::text = 'manager' and p.store_id = target_store)
      )
  );
$$;

create or replace function public.daily_activity_rows(target_date date, target_store uuid)
returns table (
  id uuid, activity_at timestamptz, employee_id uuid, employee_name text,
  store_id uuid, store_name text, source text, event_type text, barcode text,
  article text, description text, color text, size text, expected_size text,
  style text, amount numeric, brand text, category text, observation text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare requester public.profiles%rowtype;
begin
  select *
  into requester
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;

  if requester.id is null or (
    not coalesce(requester.is_owner, false)
    and requester.role::text not in ('manager', 'supervisor')
  ) then
    raise exception 'Acceso reservado para gerentes, supervisores y Romer';
  end if;

  if not coalesce(requester.is_owner, false)
     and requester.role::text <> 'supervisor'
     and target_store is distinct from requester.store_id then
    raise exception 'Solo puedes consultar tu tienda asignada';
  end if;

  return query
  select a.id, a.created_at, a.user_id, coalesce(p.full_name, 'Usuario')::text,
         a.store_id, coalesce(s.name, 'Tienda')::text, a.source, a.event_type,
         a.barcode, a.article, a.description, a.color, a.size, a.expected_size,
         a.style, a.amount, a.brand, a.category, a.observation
  from public.scan_activity a
  inner join public.profiles p on p.id = a.user_id
  left join public.stores s on s.id = a.store_id
  where (a.created_at at time zone 'America/Caracas')::date = target_date
    and a.store_id = target_store
  order by a.created_at desc;
end;
$$;

revoke all on function public.current_user_can_access_store(uuid) from public, anon;
revoke all on function public.current_user_can_evaluate_store(uuid) from public, anon;
revoke all on function public.daily_activity_rows(date, uuid) from public, anon;
grant execute on function public.current_user_can_access_store(uuid) to authenticated;
grant execute on function public.current_user_can_evaluate_store(uuid) to authenticated;
grant execute on function public.daily_activity_rows(date, uuid) to authenticated;

commit;
