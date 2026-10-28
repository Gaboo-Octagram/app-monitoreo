-- =====================================================================
--  Sistema de Calidad — Esquema para Supabase (PostgreSQL)
--  Archivo: docs/schema.sql
--
--  QUÉ ES ESTO
--    El "plano" de la base de datos: tablas, relaciones, permisos por rol
--    (RLS) y depósitos de archivos. NO se ejecuta solo. Es un archivo para
--    revisar y, cuando decidas migrar, pegar en Supabase.
--
--  CÓMO EJECUTARLO (cuando corresponda)
--    1. Supabase → SQL Editor → New query
--    2. Pegar todo este archivo → Run
--    3. Revisar la sección final "COMPROBACIÓN"
--
--  NOTAS
--    - Pensado para ejecutarse UNA vez en un proyecto vacío.
--    - Se puede volver a ejecutar: usa IF NOT EXISTS y DROP ... IF EXISTS.
--    - No contiene claves, correos ni datos personales.
--    - Las fotos y los archivos NO se guardan como texto en la base:
--      van a Storage (ver sección 8).
-- =====================================================================


-- =====================================================================
--  0. EXTENSIONES
-- =====================================================================

create extension if not exists pgcrypto;


-- =====================================================================
--  1. TIPOS (enumeraciones)
-- =====================================================================

do $$
begin
  create type public.user_role as enum ('administrador', 'monitora', 'jefa_calidad');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.checklist_type as enum ('limpieza', 'orden');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.audit_block_type as enum ('trabajadores', 'limpieza', 'orden');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.entry_status as enum ('ok', 'nok', 'na');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.audit_status as enum ('draft', 'submitted', 'reviewed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.review_decision as enum ('approved', 'rejected');
exception when duplicate_object then null;
end $$;


-- =====================================================================
--  2. LOCALES Y PERSONAS
-- =====================================================================

create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Un perfil por usuario de Supabase Auth.
-- El rol y el local NO los puede cambiar el propio usuario: los asigna
-- un administrador (lo garantiza el trigger de la sección 6).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  store_id    uuid references public.stores (id) on delete set null,
  full_name   text not null default '',
  role        public.user_role not null default 'monitora',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.bosses (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null,
  position    text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.workers (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null,
  position    text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, store_id)           -- permite validar el local en area_workers
);


-- =====================================================================
--  3. CATÁLOGO: ÁREAS, CHECKLISTS Y PARÁMETROS DE HIGIENE
-- =====================================================================

create table if not exists public.areas (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  name        text not null,
  boss_id     uuid references public.bosses (id) on delete set null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (id, store_id)           -- permite validar el local en area_workers
);

create unique index if not exists areas_store_name_uidx
  on public.areas (store_id, lower(name));

-- Trabajadores asignados a un área ("toda el área").
create table if not exists public.area_workers (
  area_id    uuid not null,
  worker_id  uuid not null,
  store_id   uuid not null,
  primary key (area_id, worker_id),
  foreign key (area_id, store_id)   references public.areas (id, store_id)   on delete cascade,
  foreign key (worker_id, store_id) references public.workers (id, store_id) on delete cascade
);

create table if not exists public.checklist_blocks (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas (id) on delete cascade,
  type        public.checklist_type not null,
  sub         text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  block_id    uuid not null references public.checklist_blocks (id) on delete cascade,
  text        text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Parámetros de higiene evaluados por trabajador.
create table if not exists public.hygiene_params (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  text        text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);


-- =====================================================================
--  4. AUDITORÍAS
--
--  Se guardan "copias" (snapshots) de los nombres y textos: si mañana se
--  renombra un área o se borra un trabajador, el historial sigue mostrando
--  lo que realmente se evaluó ese día.
-- =====================================================================

create table if not exists public.audits (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  audit_date      date not null default current_date,
  status          public.audit_status not null default 'draft',
  evaluator_id    uuid references public.profiles (id) on delete set null,
  evaluator_name  text not null default '',
  goal            smallint not null default 90 check (goal between 1 and 100),
  notes           text not null default '',
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  review_decision public.review_decision,
  review_notes    text not null default '',
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Una auditoría por local y día (igual que hace la app hoy: si ya existe
  -- una del mismo día, se fusiona). Si algún día se necesitan varias por
  -- día, basta con quitar este índice.
  unique (store_id, audit_date)
);

create table if not exists public.audit_area_results (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid not null references public.audits (id) on delete cascade,
  area_id         uuid references public.areas (id) on delete set null,
  area_name       text not null,
  boss_name       text not null default '',
  not_evaluated   boolean not null default false,
  total_items     integer not null default 0,
  done_items      integer not null default 0,
  sort_order      integer not null default 0
);

create unique index if not exists audit_area_results_unique_area
  on public.audit_area_results (audit_id, area_id)
  where area_id is not null;

create table if not exists public.audit_blocks (
  id               uuid primary key default gen_random_uuid(),
  area_result_id   uuid not null references public.audit_area_results (id) on delete cascade,
  block_type       public.audit_block_type not null,
  label            text not null default '',
  source_block_id  uuid references public.checklist_blocks (id) on delete set null,
  sort_order       integer not null default 0
);

create table if not exists public.audit_entries (
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null references public.audit_blocks (id) on delete cascade,
  item_id        uuid references public.checklist_items (id) on delete set null,
  param_id       uuid references public.hygiene_params (id) on delete set null,
  worker_id      uuid references public.workers (id) on delete set null,
  worker_name    text not null default '',
  item_text      text not null,
  status         public.entry_status not null,
  observation    text not null default '',
  created_at     timestamptz not null default now()
  -- item_id / param_id / worker_id pueden quedar en null si mañana se borra
  -- el catálogo: el texto y el nombre guardados ("item_text", "worker_name")
  -- mantienen el historial legible.
);

create table if not exists public.audit_absences (
  id               uuid primary key default gen_random_uuid(),
  area_result_id   uuid not null references public.audit_area_results (id) on delete cascade,
  worker_id        uuid references public.workers (id) on delete set null,
  worker_name      text not null
);

create unique index if not exists audit_absences_unique_worker
  on public.audit_absences (area_result_id, worker_id)
  where worker_id is not null;

-- Cada foto es una fila que apunta a un objeto de Storage.
create table if not exists public.audit_photos (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.audit_entries (id) on delete cascade,
  storage_path  text not null,
  uploaded_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);

-- Informes y archivos subidos manualmente (la pestaña "Archivos").
create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,
  name          text not null,
  mime_type     text not null default '',
  size_bytes    bigint not null default 0 check (size_bytes >= 0 and size_bytes <= 1572864),
  storage_path  text not null,
  uploaded_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  uploaded_at   timestamptz not null default now()
);


-- =====================================================================
--  4.1 ÍNDICES (velocidad de consulta)
-- =====================================================================

create index if not exists profiles_store_idx          on public.profiles (store_id);
create index if not exists bosses_store_idx            on public.bosses (store_id);
create index if not exists workers_store_idx           on public.workers (store_id);
create index if not exists areas_store_idx             on public.areas (store_id);
create index if not exists area_workers_worker_idx     on public.area_workers (worker_id);
create index if not exists checklist_blocks_area_idx   on public.checklist_blocks (area_id);
create index if not exists checklist_items_block_idx   on public.checklist_items (block_id);
create index if not exists hygiene_params_store_idx    on public.hygiene_params (store_id);
create index if not exists audits_created_by_idx       on public.audits (created_by);
create index if not exists audit_area_results_audit_idx on public.audit_area_results (audit_id);
create index if not exists audit_blocks_result_idx     on public.audit_blocks (area_result_id);
create index if not exists audit_entries_block_idx     on public.audit_entries (block_id);
create index if not exists audit_absences_result_idx   on public.audit_absences (area_result_id);
create index if not exists audit_photos_entry_idx      on public.audit_photos (entry_id);
create index if not exists attachments_store_idx       on public.attachments (store_id);


-- =====================================================================
--  5. FUNCIONES AUXILIARES DE PERMISOS
--
--  Son SECURITY DEFINER: leen profiles/audits sin pasar por RLS, lo que
--  evita recursión infinita en las políticas.
-- =====================================================================

create or replace function public.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function public.my_store_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.store_id
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'administrador' from public.profiles p where p.id = auth.uid() and p.active),
    false
  )
$$;

create or replace function public.is_quality_head()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'jefa_calidad' from public.profiles p where p.id = auth.uid() and p.active),
    false
  )
$$;

-- ¿Puede este usuario VER esta auditoría?
--   administrador y jefa de calidad: todas las del local
--   monitora: solo las que ella creó o tiene asignadas como evaluadora
create or replace function public.audit_is_visible(p_audit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.audits a
    where a.id = p_audit_id
      and a.store_id = public.my_store_id()
      and (
        public.is_admin()
        or public.is_quality_head()
        or a.created_by = auth.uid()
        or a.evaluator_id = auth.uid()
      )
  )
$$;

-- ¿Puede este usuario EDITAR los datos de esta auditoría?
--   administrador: sí
--   monitora: solo las suyas y solo mientras estén en borrador
--   jefa de calidad: no (ella revisa, no edita)
create or replace function public.audit_is_editable(p_audit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.audits a
    where a.id = p_audit_id
      and a.store_id = public.my_store_id()
      and (
        public.is_admin()
        or (
          public.my_role() = 'monitora'
          and a.created_by = auth.uid()
          and a.status = 'draft'
        )
      )
  )
$$;

-- ¿Puede este usuario ACTUALIZAR la fila de la auditoría (incluida la revisión)?
--   administrador: sí
--   monitora: sus borradores
--   jefa de calidad: las que están enviadas (para aprobar/rechazar)
create or replace function public.audit_can_update(p_audit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.audits a
    where a.id = p_audit_id
      and a.store_id = public.my_store_id()
      and (
        public.is_admin()
        or (
          public.my_role() = 'monitora'
          and a.created_by = auth.uid()
          and a.status = 'draft'
        )
        or (
          public.is_quality_head()
          and a.status = 'submitted'
        )
      )
  )
$$;


-- =====================================================================
--  6. TRIGGERS DE PROTECCIÓN
--
--  Los permisos no dependen del frontend: aunque alguien llame la API
--  directamente, estas reglas se aplican igual.
-- =====================================================================

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists audits_set_updated_at on public.audits;
create trigger audits_set_updated_at
  before update on public.audits
  for each row execute function public.set_updated_at();

-- Al crear una auditoría: una monitora no puede falsear el dueño, el local
-- ni el estado, y una jefa de calidad no puede crearlas.
create or replace function public.guard_audit_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.user_role := public.my_role();
begin
  if r = 'administrador' then
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  if r = 'monitora' then
    new.store_id       := public.my_store_id();
    new.created_by     := auth.uid();
    new.evaluator_id   := coalesce(new.evaluator_id, auth.uid());
    new.status         := 'draft';
    new.submitted_at   := null;
    new.reviewed_at    := null;
    new.reviewed_by    := null;
    new.review_decision := null;
    new.review_notes   := '';
    return new;
  end if;

  raise exception 'Tu rol no puede crear auditorías';
end $$;

drop trigger if exists audits_guard_insert on public.audits;
create trigger audits_guard_insert
  before insert on public.audits
  for each row execute function public.guard_audit_insert();

-- Al editar una auditoría:
--   monitora → solo borradores propios y solo puede enviarlos
--   jefa     → solo las enviadas y solo puede aprobar/rechazar
--   admin    → sin restricción
create or replace function public.guard_audit_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.user_role := public.my_role();
begin
  if r = 'administrador' then
    return new;
  end if;

  if r = 'monitora' then
    if old.created_by <> auth.uid() then
      raise exception 'Solo puedes modificar tus propias auditorías';
    end if;
    if old.status <> 'draft' then
      raise exception 'La auditoría ya fue enviada y no se puede editar';
    end if;

    new.store_id        := old.store_id;
    new.audit_date      := old.audit_date;
    new.created_by      := old.created_by;
    new.evaluator_id    := old.evaluator_id;
    new.reviewed_at     := old.reviewed_at;
    new.reviewed_by     := old.reviewed_by;
    new.review_decision := old.review_decision;
    new.review_notes    := old.review_notes;

    if new.status not in ('draft', 'submitted') then
      raise exception 'Estado no permitido para una monitora';
    end if;
    if new.status = 'submitted' then
      new.submitted_at := now();
    else
      new.submitted_at := old.submitted_at;
    end if;
    return new;
  end if;

  if r = 'jefa_calidad' then
    if old.status <> 'submitted' then
      raise exception 'La auditoría no está pendiente de revisión';
    end if;

    -- La jefa no cambia los datos evaluados: solo la revisión.
    new.store_id        := old.store_id;
    new.audit_date      := old.audit_date;
    new.created_by      := old.created_by;
    new.evaluator_id    := old.evaluator_id;
    new.evaluator_name  := old.evaluator_name;
    new.goal            := old.goal;
    new.notes           := old.notes;
    new.submitted_at    := old.submitted_at;

    if new.status not in ('submitted', 'reviewed') then
      raise exception 'Estado no permitido para la jefa de calidad';
    end if;
    if new.status = 'reviewed' then
      if new.review_decision is null then
        raise exception 'Falta la decisión de revisión (aprobar o rechazar)';
      end if;
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    else
      new.reviewed_at     := old.reviewed_at;
      new.reviewed_by     := old.reviewed_by;
      new.review_decision := old.review_decision;
    end if;
    return new;
  end if;

  raise exception 'Tu rol no puede modificar auditorías';
end $$;

drop trigger if exists audits_guard_update on public.audits;
create trigger audits_guard_update
  before update on public.audits
  for each row execute function public.guard_audit_update();

-- Un usuario puede editar su nombre, pero no su rol, su local ni su estado.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if old.id <> auth.uid() then
    raise exception 'Solo puedes modificar tu propio perfil';
  end if;

  new.id         := old.id;
  new.role       := old.role;
  new.store_id   := old.store_id;
  new.active     := old.active;
  return new;
end $$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();


-- =====================================================================
--  7. PERMISOS A NIVEL DE FILA (RLS)
-- =====================================================================

alter table public.stores              enable row level security;
alter table public.profiles            enable row level security;
alter table public.bosses              enable row level security;
alter table public.workers             enable row level security;
alter table public.areas               enable row level security;
alter table public.area_workers        enable row level security;
alter table public.checklist_blocks    enable row level security;
alter table public.checklist_items     enable row level security;
alter table public.hygiene_params      enable row level security;
alter table public.audits              enable row level security;
alter table public.audit_area_results  enable row level security;
alter table public.audit_blocks        enable row level security;
alter table public.audit_entries       enable row level security;
alter table public.audit_absences      enable row level security;
alter table public.audit_photos        enable row level security;
alter table public.attachments         enable row level security;

-- ---------- Locales ----------
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores
  for select to authenticated
  using (id = public.my_store_id() or public.is_admin());

drop policy if exists stores_insert on public.stores;
create policy stores_insert on public.stores
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists stores_update on public.stores;
create policy stores_update on public.stores
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists stores_delete on public.stores;
create policy stores_delete on public.stores
  for delete to authenticated
  using (public.is_admin());

-- ---------- Perfiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or (public.is_quality_head() and store_id = public.my_store_id())
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ---------- Catálogo ----------
-- Lectura: cualquier usuario activo de ese local.
-- Escritura: solo el administrador de ese local.

drop policy if exists bosses_select on public.bosses;
create policy bosses_select on public.bosses
  for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists bosses_write on public.bosses;
create policy bosses_write on public.bosses
  for all to authenticated
  using (public.is_admin() and store_id = public.my_store_id())
  with check (public.is_admin() and store_id = public.my_store_id());

drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers
  for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists workers_write on public.workers;
create policy workers_write on public.workers
  for all to authenticated
  using (public.is_admin() and store_id = public.my_store_id())
  with check (public.is_admin() and store_id = public.my_store_id());

drop policy if exists areas_select on public.areas;
create policy areas_select on public.areas
  for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists areas_write on public.areas;
create policy areas_write on public.areas
  for all to authenticated
  using (public.is_admin() and store_id = public.my_store_id())
  with check (public.is_admin() and store_id = public.my_store_id());

drop policy if exists area_workers_select on public.area_workers;
create policy area_workers_select on public.area_workers
  for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists area_workers_write on public.area_workers;
create policy area_workers_write on public.area_workers
  for all to authenticated
  using (public.is_admin() and store_id = public.my_store_id())
  with check (public.is_admin() and store_id = public.my_store_id());

drop policy if exists checklist_blocks_select on public.checklist_blocks;
create policy checklist_blocks_select on public.checklist_blocks
  for select to authenticated
  using (
    exists (
      select 1 from public.areas a
      where a.id = checklist_blocks.area_id
        and a.store_id = public.my_store_id()
    )
  );

drop policy if exists checklist_blocks_write on public.checklist_blocks;
create policy checklist_blocks_write on public.checklist_blocks
  for all to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.areas a
      where a.id = checklist_blocks.area_id
        and a.store_id = public.my_store_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1 from public.areas a
      where a.id = checklist_blocks.area_id
        and a.store_id = public.my_store_id()
    )
  );

drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.checklist_blocks b
      join public.areas a on a.id = b.area_id
      where b.id = checklist_items.block_id
        and a.store_id = public.my_store_id()
    )
  );

drop policy if exists checklist_items_write on public.checklist_items;
create policy checklist_items_write on public.checklist_items
  for all to authenticated
  using (
    public.is_admin()
    and exists (
      select 1
      from public.checklist_blocks b
      join public.areas a on a.id = b.area_id
      where b.id = checklist_items.block_id
        and a.store_id = public.my_store_id()
    )
  )
  with check (
    public.is_admin()
    and exists (
      select 1
      from public.checklist_blocks b
      join public.areas a on a.id = b.area_id
      where b.id = checklist_items.block_id
        and a.store_id = public.my_store_id()
    )
  );

drop policy if exists hygiene_params_select on public.hygiene_params;
create policy hygiene_params_select on public.hygiene_params
  for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists hygiene_params_write on public.hygiene_params;
create policy hygiene_params_write on public.hygiene_params
  for all to authenticated
  using (public.is_admin() and store_id = public.my_store_id())
  with check (public.is_admin() and store_id = public.my_store_id());

-- ---------- Auditorías ----------
drop policy if exists audits_select on public.audits;
create policy audits_select on public.audits
  for select to authenticated
  using (public.audit_is_visible(id));

drop policy if exists audits_insert on public.audits;
create policy audits_insert on public.audits
  for insert to authenticated
  with check (
    store_id = public.my_store_id()
    and (public.is_admin() or public.my_role() = 'monitora')
  );

drop policy if exists audits_update on public.audits;
create policy audits_update on public.audits
  for update to authenticated
  using (public.audit_can_update(id))
  -- El "using" decide qué filas puede tocar; el "with check" solo evita que
  -- la fila cambie de local. Los cambios de estado y de campos los vigila
  -- el trigger de la sección 6.
  with check (store_id = public.my_store_id());

drop policy if exists audits_delete on public.audits;
create policy audits_delete on public.audits
  for delete to authenticated
  using (public.audit_is_editable(id));

-- ---------- Resultados por área ----------
drop policy if exists audit_area_results_select on public.audit_area_results;
create policy audit_area_results_select on public.audit_area_results
  for select to authenticated
  using (public.audit_is_visible(audit_id));

drop policy if exists audit_area_results_write on public.audit_area_results;
create policy audit_area_results_write on public.audit_area_results
  for all to authenticated
  using (public.audit_is_editable(audit_id))
  with check (public.audit_is_editable(audit_id));

-- ---------- Bloques evaluados ----------
drop policy if exists audit_blocks_select on public.audit_blocks;
create policy audit_blocks_select on public.audit_blocks
  for select to authenticated
  using (
    exists (
      select 1 from public.audit_area_results r
      where r.id = audit_blocks.area_result_id
        and public.audit_is_visible(r.audit_id)
    )
  );

drop policy if exists audit_blocks_write on public.audit_blocks;
create policy audit_blocks_write on public.audit_blocks
  for all to authenticated
  using (
    exists (
      select 1 from public.audit_area_results r
      where r.id = audit_blocks.area_result_id
        and public.audit_is_editable(r.audit_id)
    )
  )
  with check (
    exists (
      select 1 from public.audit_area_results r
      where r.id = audit_blocks.area_result_id
        and public.audit_is_editable(r.audit_id)
    )
  );

-- ---------- Ítems evaluados ----------
drop policy if exists audit_entries_select on public.audit_entries;
create policy audit_entries_select on public.audit_entries
  for select to authenticated
  using (
    exists (
      select 1
      from public.audit_blocks b
      join public.audit_area_results r on r.id = b.area_result_id
      where b.id = audit_entries.block_id
        and public.audit_is_visible(r.audit_id)
    )
  );

drop policy if exists audit_entries_write on public.audit_entries;
create policy audit_entries_write on public.audit_entries
  for all to authenticated
  using (
    exists (
      select 1
      from public.audit_blocks b
      join public.audit_area_results r on r.id = b.area_result_id
      where b.id = audit_entries.block_id
        and public.audit_is_editable(r.audit_id)
    )
  )
  with check (
    exists (
      select 1
      from public.audit_blocks b
      join public.audit_area_results r on r.id = b.area_result_id
      where b.id = audit_entries.block_id
        and public.audit_is_editable(r.audit_id)
    )
  );

-- ---------- Ausencias ----------
drop policy if exists audit_absences_select on public.audit_absences;
create policy audit_absences_select on public.audit_absences
  for select to authenticated
  using (
    exists (
      select 1 from public.audit_area_results r
      where r.id = audit_absences.area_result_id
        and public.audit_is_visible(r.audit_id)
    )
  );

drop policy if exists audit_absences_write on public.audit_absences;
create policy audit_absences_write on public.audit_absences
  for all to authenticated
  using (
    exists (
      select 1 from public.audit_area_results r
      where r.id = audit_absences.area_result_id
        and public.audit_is_editable(r.audit_id)
    )
  )
  with check (
    exists (
      select 1 from public.audit_area_results r
      where r.id = audit_absences.area_result_id
        and public.audit_is_editable(r.audit_id)
    )
  );

-- ---------- Fotos de ítems ----------
drop policy if exists audit_photos_select on public.audit_photos;
create policy audit_photos_select on public.audit_photos
  for select to authenticated
  using (
    exists (
      select 1
      from public.audit_entries e
      join public.audit_blocks b on b.id = e.block_id
      join public.audit_area_results r on r.id = b.area_result_id
      where e.id = audit_photos.entry_id
        and public.audit_is_visible(r.audit_id)
    )
  );

drop policy if exists audit_photos_write on public.audit_photos;
create policy audit_photos_write on public.audit_photos
  for all to authenticated
  using (
    exists (
      select 1
      from public.audit_entries e
      join public.audit_blocks b on b.id = e.block_id
      join public.audit_area_results r on r.id = b.area_result_id
      where e.id = audit_photos.entry_id
        and public.audit_is_editable(r.audit_id)
    )
  )
  with check (
    exists (
      select 1
      from public.audit_entries e
      join public.audit_blocks b on b.id = e.block_id
      join public.audit_area_results r on r.id = b.area_result_id
      where e.id = audit_photos.entry_id
        and public.audit_is_editable(r.audit_id)
    )
  );

-- ---------- Archivos / informes ----------
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (store_id = public.my_store_id());

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (store_id = public.my_store_id());

drop policy if exists attachments_update on public.attachments;
create policy attachments_update on public.attachments
  for update to authenticated
  using (public.is_admin() or uploaded_by = auth.uid())
  with check (store_id = public.my_store_id());

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (public.is_admin() or uploaded_by = auth.uid());


-- =====================================================================
--  8. STORAGE (fotos e informes)
--
--  Convención de rutas:
--    fotos:       <store_id>/<audit_id>/<archivo>.jpg
--    informes:    <store_id>/<archivo>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audit-photos', 'audit-photos', false, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 1572864,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do nothing;

-- Fotos: leer si la auditoría es visible; escribir si es editable.
drop policy if exists audit_photos_storage_select on storage.objects;
create policy audit_photos_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audit-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
    and (
      public.is_admin()
      or public.is_quality_head()
      or public.audit_is_visible(((storage.foldername(name))[2])::uuid)
    )
  );

drop policy if exists audit_photos_storage_insert on storage.objects;
create policy audit_photos_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audit-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
    and public.audit_is_editable(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists audit_photos_storage_update on storage.objects;
create policy audit_photos_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'audit-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
    and public.audit_is_editable(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists audit_photos_storage_delete on storage.objects;
create policy audit_photos_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audit-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
    and public.audit_is_editable(((storage.foldername(name))[2])::uuid)
  );

-- Informes: todo el local puede leer y subir; borrar solo el autor o admin.
drop policy if exists attachments_storage_select on storage.objects;
create policy attachments_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists attachments_storage_insert on storage.objects;
create policy attachments_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists attachments_storage_delete on storage.objects;
create policy attachments_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.my_store_id()::text
    and (
      public.is_admin()
      or public.is_quality_head()
      or exists (
        select 1
        from public.attachments a
        where a.storage_path = storage.objects.name
          and a.uploaded_by = auth.uid()
      )
    )
  );


-- =====================================================================
--  9. PERMISOS DE TABLA Y FUNCIONES
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Que las tablas futuras tampoco queden expuestas al rol anónimo.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- Funciones internas: que no se puedan llamar desde la API pública.
revoke all on function public.set_updated_at()        from public, anon, authenticated;
revoke all on function public.guard_audit_insert()    from public, anon, authenticated;
revoke all on function public.guard_audit_update()    from public, anon, authenticated;
revoke all on function public.guard_profile_update()  from public, anon, authenticated;

revoke all on function public.my_role()          from public, anon;
revoke all on function public.my_store_id()      from public, anon;
revoke all on function public.is_admin()         from public, anon;
revoke all on function public.is_quality_head()  from public, anon;
revoke all on function public.audit_is_visible(uuid)  from public, anon;
revoke all on function public.audit_is_editable(uuid) from public, anon;
revoke all on function public.audit_can_update(uuid)  from public, anon;

grant execute on function public.my_role()          to authenticated;
grant execute on function public.my_store_id()      to authenticated;
grant execute on function public.is_admin()         to authenticated;
grant execute on function public.is_quality_head()  to authenticated;
grant execute on function public.audit_is_visible(uuid)  to authenticated;
grant execute on function public.audit_is_editable(uuid) to authenticated;
grant execute on function public.audit_can_update(uuid)  to authenticated;


-- =====================================================================
-- 10. ALTA AUTOMÁTICA DE PERFIL
--
--  Cuando se crea un usuario en Supabase Auth, se crea su perfil.
--  El PRIMER usuario queda como administrador; los siguientes, como
--  monitoras (el administrador puede cambiarlo después).
--  Si todavía no existe ningún local, el perfil queda sin local hasta
--  que se cree uno y se asigne.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store uuid;
  v_role  public.user_role;
begin
  select s.id into v_store from public.stores s order by s.created_at limit 1;

  if exists (select 1 from public.profiles) then
    v_role := 'monitora';
  else
    v_role := 'administrador';
  end if;

  insert into public.profiles (id, store_id, full_name, role)
  values (
    new.id,
    v_store,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Es una función de trigger: nadie debe poder llamarla desde la API.
revoke all on function public.handle_new_user() from public, anon, authenticated;


-- =====================================================================
-- 11. DATOS INICIALES
--
--  Crea un local con las 7 áreas, sus checklists y los parámetros de
--  higiene por defecto (los mismos de la app actual).
--  Uso desde SQL Editor:  select public.create_store_with_defaults('Supermercado Centro');
-- =====================================================================

create or replace function public.create_store_with_defaults(
  p_name text,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store  uuid;
  v_area   uuid;
  v_block  uuid;
  v_area_name text;
  v_item   text;
  v_order  integer := 0;
  v_item_order integer;
begin
  -- Se permite desde el SQL Editor (sin sesión) o a un administrador.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo un administrador puede crear locales';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'El nombre del local es obligatorio';
  end if;

  insert into public.stores (name, address)
  values (trim(p_name), nullif(trim(coalesce(p_address, '')), ''))
  returning id into v_store;

  foreach v_area_name in array array[
    'Panadería', 'Pastelería', 'Carnicería', 'Rostisería',
    'Frutería y Verdulería', 'Sala de Ventas', 'Bodega'
  ] loop
    v_order := v_order + 1;

    insert into public.areas (store_id, name, sort_order)
    values (v_store, v_area_name, v_order)
    returning id into v_area;

    insert into public.checklist_blocks (area_id, type, sub, sort_order)
    values (v_area, 'limpieza', '', 1)
    returning id into v_block;

    v_item_order := 0;
    foreach v_item in array array[
      'Pisos limpios y sin residuos',
      'Mesones y superficies sanitizadas',
      'Equipos y utensilios limpios',
      'Basureros vaciados y tapados',
      'Sin señales de plagas'
    ] loop
      v_item_order := v_item_order + 1;
      insert into public.checklist_items (block_id, text, sort_order)
      values (v_block, v_item, v_item_order);
    end loop;

    insert into public.checklist_blocks (area_id, type, sub, sort_order)
    values (v_area, 'orden', '', 2)
    returning id into v_block;

    v_item_order := 0;
    foreach v_item in array array[
      'Productos ordenados y rotulados',
      'Pasillos y salidas despejados',
      'Herramientas en su lugar',
      'Productos sin contacto con el piso',
      'Rotación de productos (FIFO) respetada'
    ] loop
      v_item_order := v_item_order + 1;
      insert into public.checklist_items (block_id, text, sort_order)
      values (v_block, v_item, v_item_order);
    end loop;
  end loop;

  v_item_order := 0;
  foreach v_item in array array[
    'Lavado de manos',
    'Uso de mascarilla',
    'Uso de cofia',
    'Sin joyas',
    'Uniforme',
    'Sin heridas'
  ] loop
    v_item_order := v_item_order + 1;
    insert into public.hygiene_params (store_id, text, sort_order)
    values (v_store, v_item, v_item_order);
  end loop;

  return v_store;
end $$;

revoke all on function public.create_store_with_defaults(text, text) from public, anon;
grant execute on function public.create_store_with_defaults(text, text) to authenticated;


-- =====================================================================
-- 12. COMENTARIOS (ayuda dentro del panel de Supabase)
-- =====================================================================

comment on table public.stores             is 'Locales o sucursales del supermercado.';
comment on table public.profiles           is 'Perfil de cada usuario: rol, local y estado.';
comment on table public.areas              is 'Áreas evaluadas (Panadería, Carnicería, etc.).';
comment on table public.area_workers       is 'Trabajadores que pertenecen a un área.';
comment on table public.checklist_blocks   is 'Bloques de checklist por área: limpieza u orden.';
comment on table public.checklist_items    is 'Ítems de cada bloque de checklist.';
comment on table public.hygiene_params     is 'Parámetros de higiene evaluados por trabajador.';
comment on table public.audits             is 'Cabecera de una auditoría (una por local y día).';
comment on table public.audit_area_results is 'Resultado por área dentro de una auditoría.';
comment on table public.audit_blocks       is 'Bloques evaluados dentro de un área.';
comment on table public.audit_entries      is 'Cada ítem evaluado, con su estado y observación.';
comment on table public.audit_absences     is 'Trabajadores ausentes durante la auditoría.';
comment on table public.audit_photos       is 'Fotos adjuntas a un ítem (archivo en Storage).';
comment on table public.attachments        is 'Informes y archivos subidos manualmente.';

comment on column public.audits.status IS
  'draft = borrador de la monitora; submitted = enviada; reviewed = revisada por la jefa.';
comment on column public.audits.review_decision IS
  'approved = conforme; rejected = rechazada / requiere correcciones.';


-- =====================================================================
-- 13. COMPROBACIÓN (consultas de solo lectura, opcionales)
-- =====================================================================
-- Ejecutar por separado después de crear todo:
--
--   select tablename, rowsecurity
--   from pg_tables where schemaname = 'public' order by 1;
--
--   select tablename, policyname, cmd, roles
--   from pg_policies where schemaname = 'public' order by 1, 2;
--
--   select id, name, active from public.stores;
--
--   select id, full_name, role, store_id from public.profiles;
--
-- Resultado esperado: 16 tablas con rowsecurity = true.
