begin;

create table if not exists public.app_runtime_settings (
  id text primary key,
  maintenance_enabled boolean not null default false,
  employee_title text not null,
  employee_message text not null,
  leadership_title text not null,
  leadership_message text not null,
  updated_at timestamptz not null default now(),
  constraint app_runtime_settings_scancontrol_id check (id = 'scancontrol')
);

alter table public.app_runtime_settings enable row level security;

revoke all on table public.app_runtime_settings from anon, authenticated;
grant select on table public.app_runtime_settings to authenticated;

drop policy if exists "authenticated_read_runtime_settings" on public.app_runtime_settings;
create policy "authenticated_read_runtime_settings"
on public.app_runtime_settings
for select
to authenticated
using (id = 'scancontrol');

insert into public.app_runtime_settings (
  id,
  maintenance_enabled,
  employee_title,
  employee_message,
  leadership_title,
  leadership_message,
  updated_at
) values (
  'scancontrol',
  true,
  'Mantenimiento programado',
  'ScanControl se encuentra temporalmente en mantenimiento para realizar mejoras en el servicio. Intenta ingresar nuevamente más tarde.',
  'Renovación del servicio pendiente',
  'El acceso a ScanControl se encuentra temporalmente suspendido mientras se confirma la renovación administrativa correspondiente al período actual. Al completarse, el servicio se restablecerá automáticamente con toda la información disponible.',
  now()
)
on conflict (id) do update set
  maintenance_enabled = excluded.maintenance_enabled,
  employee_title = excluded.employee_title,
  employee_message = excluded.employee_message,
  leadership_title = excluded.leadership_title,
  leadership_message = excluded.leadership_message,
  updated_at = now();

commit;

select id, maintenance_enabled, employee_title, leadership_title, updated_at
from public.app_runtime_settings
where id = 'scancontrol';

-- Cuando corresponda restablecer el servicio, ejecutar únicamente:
-- update public.app_runtime_settings
-- set maintenance_enabled = false, updated_at = now()
-- where id = 'scancontrol';
