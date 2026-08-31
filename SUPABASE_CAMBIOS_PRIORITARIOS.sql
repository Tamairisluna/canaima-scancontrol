-- Canaima ScanControl · registro por tienda, control exclusivo de Romer y RLS
-- Ejecutar una sola vez en Supabase > SQL Editor antes de publicar la app.

begin;

alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- La lista de tiendas del registro no expone ninguna otra tabla o dato.
create or replace function public.registration_stores()
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.name::text, s.slug::text
  from public.stores s
  where s.is_active = true
  order by s.name;
$$;

revoke all on function public.registration_stores() from public;
grant execute on function public.registration_stores() to anon, authenticated;

-- Toda cuenta pública nace como Empleado y con una tienda activa obligatoria.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_store uuid;
  employee_role public.profiles.role%type;
begin
  begin
    selected_store := nullif(new.raw_user_meta_data ->> 'store_id', '')::uuid;
  exception when others then
    raise exception 'La tienda seleccionada no es válida';
  end;

  if selected_store is null or not exists (
    select 1 from public.stores s where s.id = selected_store and s.is_active = true
  ) then
    raise exception 'Debes seleccionar una tienda activa';
  end if;

  employee_role := (jsonb_populate_record(
    null::public.profiles,
    jsonb_build_object('role', 'employee')
  )).role;

  insert into public.profiles (id, full_name, role, store_id, is_active, is_owner)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    employee_role,
    selected_store,
    true,
    false
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      role = excluded.role,
      store_id = excluded.store_id,
      is_active = true,
      is_owner = false;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and coalesce(p.is_owner, false)
  );
$$;

create or replace function public.current_user_can_access_store(target_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        coalesce(p.is_owner, false)
        or p.role::text = 'manager'
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
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        coalesce(p.is_owner, false)
        or p.role::text = 'manager'
        or (p.store_id = target_store and p.role::text = 'supervisor')
      )
  );
$$;

revoke all on function public.current_user_is_owner() from public;
revoke all on function public.current_user_can_access_store(uuid) from public;
revoke all on function public.current_user_can_evaluate_store(uuid) from public;
grant execute on function public.current_user_is_owner() to authenticated;
grant execute on function public.current_user_can_access_store(uuid) to authenticated;
grant execute on function public.current_user_can_evaluate_store(uuid) to authenticated;

-- Solo Romer (is_owner=true) puede listar y modificar cuentas.
create or replace function public.owner_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  store_id uuid,
  is_active boolean,
  is_owner boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.current_user_is_owner() then
    raise exception 'Acceso reservado para Romer';
  end if;

  return query
  select p.id, u.email::text, p.full_name::text, p.role::text, p.store_id,
         p.is_active, coalesce(p.is_owner, false), u.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by coalesce(p.full_name, u.email, p.id::text);
end;
$$;

create or replace function public.owner_update_user(
  target_user uuid,
  target_role text,
  target_store uuid,
  target_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_role public.profiles.role%type;
begin
  if not public.current_user_is_owner() then
    raise exception 'Acceso reservado para Romer';
  end if;
  if target_role not in ('employee', 'manager', 'supervisor') then
    raise exception 'Rol no permitido';
  end if;
  if target_store is null or not exists (
    select 1 from public.stores s where s.id = target_store and s.is_active = true
  ) then
    raise exception 'Selecciona una tienda activa';
  end if;
  if exists (select 1 from public.profiles p where p.id = target_user and p.is_owner) then
    raise exception 'La cuenta propietaria no puede modificarse';
  end if;

  normalized_role := (jsonb_populate_record(
    null::public.profiles,
    jsonb_build_object('role', target_role)
  )).role;

  update public.profiles
  set role = normalized_role,
      store_id = target_store,
      is_active = target_active
  where id = target_user;

  if not found then raise exception 'Usuario no encontrado'; end if;
end;
$$;

revoke all on function public.owner_list_users() from public, anon;
revoke all on function public.owner_update_user(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.owner_list_users() to authenticated;
grant execute on function public.owner_update_user(uuid, text, uuid, boolean) to authenticated;

-- Activa una versión sin permitir cambiar catálogos de otra tienda.
create or replace function public.activate_catalog(target_catalog uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  catalog_store uuid;
begin
  select cv.store_id into catalog_store
  from public.catalog_versions cv
  where cv.id = target_catalog and cv.status = 'ready';

  if catalog_store is null then raise exception 'Catálogo no encontrado o incompleto'; end if;
  if not public.current_user_can_access_store(catalog_store) then
    raise exception 'No tienes acceso a esta tienda';
  end if;

  update public.catalog_versions
  set status = 'ready'
  where store_id = catalog_store and status = 'active' and id <> target_catalog;

  update public.catalog_versions
  set status = 'active', activated_at = now()
  where id = target_catalog;
end;
$$;

-- Elimina por completo cualquier subida interrumpida; nunca toca el catálogo activo.
create or replace function public.discard_catalog(target_catalog uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  catalog_store uuid;
  catalog_status text;
begin
  select cv.store_id, cv.status::text into catalog_store, catalog_status
  from public.catalog_versions cv where cv.id = target_catalog;

  if catalog_store is null then return; end if;
  if not public.current_user_can_access_store(catalog_store) then
    raise exception 'No tienes acceso a esta tienda';
  end if;
  if catalog_status = 'active' then
    raise exception 'No se puede eliminar el catálogo activo';
  end if;

  delete from public.products where catalog_id = target_catalog;
  delete from public.catalog_versions where id = target_catalog;
end;
$$;

revoke all on function public.activate_catalog(uuid) from public, anon;
revoke all on function public.discard_catalog(uuid) from public, anon;
grant execute on function public.activate_catalog(uuid) to authenticated;
grant execute on function public.discard_catalog(uuid) to authenticated;

-- Sustituye cualquier política permisiva anterior por el alcance por tienda actual.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'stores', 'catalog_versions', 'products', 'evaluations', 'evaluation_items', 'scan_activity')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.catalog_versions enable row level security;
alter table public.products enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_items enable row level security;
alter table public.scan_activity enable row level security;

grant select on public.profiles, public.stores, public.catalog_versions, public.products,
  public.evaluations, public.evaluation_items, public.scan_activity to authenticated;
grant insert, update, delete on public.catalog_versions, public.products,
  public.evaluations, public.evaluation_items, public.scan_activity to authenticated;

create policy profiles_read_self_or_owner on public.profiles
for select to authenticated
using (id = auth.uid() or public.current_user_is_owner());

create policy stores_read_assigned_or_owner on public.stores
for select to authenticated
using (public.current_user_can_access_store(id));

create policy catalog_versions_store_scope on public.catalog_versions
for all to authenticated
using (public.current_user_can_access_store(store_id))
with check (public.current_user_can_access_store(store_id) and uploaded_by = auth.uid());

create policy products_store_scope on public.products
for all to authenticated
using (public.current_user_can_access_store(store_id))
with check (public.current_user_can_access_store(store_id));

create policy evaluations_store_scope on public.evaluations
for all to authenticated
using (public.current_user_can_evaluate_store(store_id))
with check (public.current_user_can_evaluate_store(store_id) and created_by = auth.uid());

create policy evaluation_items_store_scope on public.evaluation_items
for all to authenticated
using (public.current_user_can_evaluate_store(store_id))
with check (public.current_user_can_evaluate_store(store_id));

create policy scan_activity_insert_assigned on public.scan_activity
for insert to authenticated
with check (user_id = auth.uid() and public.current_user_can_access_store(store_id));

create policy scan_activity_read_management on public.scan_activity
for select to authenticated
using (
  public.current_user_is_owner()
  or (
    public.current_user_can_evaluate_store(store_id)
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text in ('manager', 'supervisor'))
  )
);

create policy scan_activity_update_own on public.scan_activity
for update to authenticated
using (user_id = auth.uid() and public.current_user_can_access_store(store_id))
with check (user_id = auth.uid() and public.current_user_can_access_store(store_id));

create policy scan_activity_delete_own on public.scan_activity
for delete to authenticated
using (user_id = auth.uid() and public.current_user_can_access_store(store_id));

-- Los gerentes consultan todas las tiendas; supervisores solo su tienda; Romer conserva control total.
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
  select * into requester from public.profiles p where p.id = auth.uid() and p.is_active = true;
  if requester.id is null or (
    not coalesce(requester.is_owner, false) and requester.role::text not in ('manager', 'supervisor')
  ) then
    raise exception 'Acceso reservado para gerentes, supervisores y Romer';
  end if;
  if not coalesce(requester.is_owner, false)
     and requester.role::text <> 'manager'
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

revoke all on function public.daily_activity_rows(date, uuid) from public, anon;
grant execute on function public.daily_activity_rows(date, uuid) to authenticated;

commit;
