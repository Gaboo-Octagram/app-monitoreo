-- Migración 005: informes semanales anteriores (Word) guardados en la nube.
-- Guarda el archivo en Storage (bucket weekly-reports, 10 MB) y los porcentajes
-- por categoría/sub-área en una tabla, para los gráficos del Resumen.
-- Se ejecuta después de 001-004. Segura de repetir.

-- 1. Informe de un área para una semana ISO de un año (uno por área y semana).
create table if not exists public.weekly_reports (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  area_id     uuid not null references public.areas(id) on delete cascade,
  year        int  not null check (year between 2000 and 2100),
  week        int  not null check (week between 1 and 53),
  week_start  date not null,
  file_name   text not null,
  file_path   text not null default '',
  file_size   int  not null default 0,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (store_id, area_id, year, week)
);

-- 2. Porcentajes de la semana: una fila por categoría y sub-área ('' = sin sub-área).
create table if not exists public.weekly_report_values (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  store_id  uuid not null references public.stores(id) on delete cascade,
  type      text not null check (type in ('trabajadores', 'limpieza', 'orden')),
  sub       text not null default '',
  pct       numeric not null check (pct between 0 and 100),
  unique (report_id, type, sub)
);

create index if not exists weekly_reports_store_idx on public.weekly_reports (store_id, area_id, year, week);
create index if not exists weekly_report_values_report_idx on public.weekly_report_values (report_id);

alter table public.weekly_reports        enable row level security;
alter table public.weekly_report_values  enable row level security;

-- 3. Leer: cualquier usuario activo del local. Escribir/borrar: solo administrador.
drop policy if exists weekly_reports_select on public.weekly_reports;
create policy weekly_reports_select on public.weekly_reports
  for select to authenticated using (store_id = public.my_store_id());
drop policy if exists weekly_reports_write on public.weekly_reports;
create policy weekly_reports_write on public.weekly_reports
  for all to authenticated
  using (store_id = public.my_store_id() and public.is_admin())
  with check (store_id = public.my_store_id() and public.is_admin());

drop policy if exists weekly_report_values_select on public.weekly_report_values;
create policy weekly_report_values_select on public.weekly_report_values
  for select to authenticated using (store_id = public.my_store_id());
drop policy if exists weekly_report_values_write on public.weekly_report_values;
create policy weekly_report_values_write on public.weekly_report_values
  for all to authenticated
  using (store_id = public.my_store_id() and public.is_admin())
  with check (store_id = public.my_store_id() and public.is_admin());

-- 4. Bucket privado de Word: hasta 10 MB. Ruta: <local>/<área>/<año>-S<semana>-<id>.docx
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'weekly-reports', 'weekly-reports', false, 10485760,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists weekly_reports_storage_select on storage.objects;
create policy weekly_reports_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'weekly-reports' and (storage.foldername(name))[1] = public.my_store_id()::text);
drop policy if exists weekly_reports_storage_insert on storage.objects;
create policy weekly_reports_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'weekly-reports' and (storage.foldername(name))[1] = public.my_store_id()::text and public.is_admin());
drop policy if exists weekly_reports_storage_delete on storage.objects;
create policy weekly_reports_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'weekly-reports' and (storage.foldername(name))[1] = public.my_store_id()::text and public.is_admin());

notify pgrst, 'reload schema';
