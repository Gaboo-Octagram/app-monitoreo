-- =====================================================================
--  Migración 001 — Permisos de la monitora, conformidad de la jefa y
--  borrado total del historial.
--  Se ejecuta DESPUÉS de docs/schema.sql. Se puede repetir sin romper.
--
--  QUÉ CAMBIA
--   1. La monitora puede editar el catálogo (áreas, ítems, trabajadores,
--      jefes y parámetros de higiene), como se decidió.
--   2. Se elimina el flujo "enviada → revisada (aprobar/rechazar)".
--      La monitora edita sus auditorías (una por día, mismo día = fusión)
--      y la jefa solo deja una CONFORMIDAD diaria, opcional, con una
--      sola observación y sin hilo. Nunca bloquea nada.
--   3. Función delete_all_audits(): solo el administrador, con frase de
--      confirmación. El respaldo lo debe bajar la app antes de llamarla.
--   4. El administrador solo ve perfiles de su propio local.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Catálogo editable por administrador y monitora
-- ---------------------------------------------------------------------
create or replace function public.can_edit_catalog()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role in ('administrador', 'monitora')
     from public.profiles p where p.id = auth.uid() and p.active),
    false
  )
$$;
revoke all on function public.can_edit_catalog() from public, anon;
grant execute on function public.can_edit_catalog() to authenticated;

drop policy if exists bosses_write on public.bosses;
create policy bosses_write on public.bosses
  for all to authenticated
  using (public.can_edit_catalog() and store_id = public.my_store_id())
  with check (public.can_edit_catalog() and store_id = public.my_store_id());

drop policy if exists workers_write on public.workers;
create policy workers_write on public.workers
  for all to authenticated
  using (public.can_edit_catalog() and store_id = public.my_store_id())
  with check (public.can_edit_catalog() and store_id = public.my_store_id());

drop policy if exists areas_write on public.areas;
create policy areas_write on public.areas
  for all to authenticated
  using (public.can_edit_catalog() and store_id = public.my_store_id())
  with check (public.can_edit_catalog() and store_id = public.my_store_id());

drop policy if exists area_workers_write on public.area_workers;
create policy area_workers_write on public.area_workers
  for all to authenticated
  using (public.can_edit_catalog() and store_id = public.my_store_id())
  with check (public.can_edit_catalog() and store_id = public.my_store_id());

drop policy if exists hygiene_params_write on public.hygiene_params;
create policy hygiene_params_write on public.hygiene_params
  for all to authenticated
  using (public.can_edit_catalog() and store_id = public.my_store_id())
  with check (public.can_edit_catalog() and store_id = public.my_store_id());

drop policy if exists checklist_blocks_write on public.checklist_blocks;
create policy checklist_blocks_write on public.checklist_blocks
  for all to authenticated
  using (
    public.can_edit_catalog()
    and exists (select 1 from public.areas a
                where a.id = checklist_blocks.area_id and a.store_id = public.my_store_id())
  )
  with check (
    public.can_edit_catalog()
    and exists (select 1 from public.areas a
                where a.id = checklist_blocks.area_id and a.store_id = public.my_store_id())
  );

drop policy if exists checklist_items_write on public.checklist_items;
create policy checklist_items_write on public.checklist_items
  for all to authenticated
  using (
    public.can_edit_catalog()
    and exists (select 1 from public.checklist_blocks b
                join public.areas a on a.id = b.area_id
                where b.id = checklist_items.block_id and a.store_id = public.my_store_id())
  )
  with check (
    public.can_edit_catalog()
    and exists (select 1 from public.checklist_blocks b
                join public.areas a on a.id = b.area_id
                where b.id = checklist_items.block_id and a.store_id = public.my_store_id())
  );


-- ---------------------------------------------------------------------
-- 2. Auditorías sin bloqueo por "envío"; la jefa ya no las modifica
-- ---------------------------------------------------------------------
-- La monitora edita sus propias auditorías sin importar el estado
-- (el Historial es de solo lectura por diseño de la app, no del esquema).
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
        or (public.my_role() = 'monitora' and a.created_by = auth.uid())
      )
  )
$$;

create or replace function public.audit_can_update(p_audit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.audit_is_editable(p_audit_id)
$$;

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
    -- Campos que la monitora no puede cambiar.
    new.store_id        := old.store_id;
    new.audit_date      := old.audit_date;
    new.created_by      := old.created_by;
    new.evaluator_id    := old.evaluator_id;
    new.reviewed_at     := old.reviewed_at;
    new.reviewed_by     := old.reviewed_by;
    new.review_decision := old.review_decision;
    new.review_notes    := old.review_notes;
    new.status          := 'draft';
    new.submitted_at    := old.submitted_at;
    return new;
  end if;

  raise exception 'Tu rol no puede modificar auditorías';
end $$;

-- Un solo nivel de borrado: la monitora puede borrar las suyas desde la
-- app solo si el Historial lo permite; el administrador, todas.

-- Conformidad diaria de la jefa (opcional, una observación, sin hilo).
create table if not exists public.audit_conformity (
  audit_id       uuid primary key references public.audits (id) on delete cascade,
  reviewer_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  reviewer_name  text not null default '',
  note           text not null default '' check (char_length(note) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists audit_conformity_set_updated_at on public.audit_conformity;
create trigger audit_conformity_set_updated_at
  before update on public.audit_conformity
  for each row execute function public.set_updated_at();

alter table public.audit_conformity enable row level security;

drop policy if exists audit_conformity_select on public.audit_conformity;
create policy audit_conformity_select on public.audit_conformity
  for select to authenticated
  using (public.audit_is_visible(audit_id));

-- La jefa de calidad (o el administrador) deja y corrige su conformidad.
drop policy if exists audit_conformity_insert on public.audit_conformity;
create policy audit_conformity_insert on public.audit_conformity
  for insert to authenticated
  with check (
    (public.is_quality_head() or public.is_admin())
    and public.audit_is_visible(audit_id)
  );

drop policy if exists audit_conformity_update on public.audit_conformity;
create policy audit_conformity_update on public.audit_conformity
  for update to authenticated
  using ((public.is_quality_head() or public.is_admin()) and public.audit_is_visible(audit_id))
  with check ((public.is_quality_head() or public.is_admin()) and public.audit_is_visible(audit_id));

drop policy if exists audit_conformity_delete on public.audit_conformity;
create policy audit_conformity_delete on public.audit_conformity
  for delete to authenticated
  using ((public.is_quality_head() or public.is_admin()) and public.audit_is_visible(audit_id));

grant select, insert, update, delete on public.audit_conformity to authenticated;
revoke all on public.audit_conformity from anon;
comment on table public.audit_conformity is
  'Conformidad diaria de la jefa de calidad: opcional, una observación, sin hilo.';


-- ---------------------------------------------------------------------
-- 3. Borrado total del historial (solo administrador)
-- ---------------------------------------------------------------------
-- Borra todas las auditorías del local (y por cascada sus resultados,
-- fotos registradas y conformidades). Los archivos de Storage hay que
-- limpiarlos aparte. Devuelve cuántas auditorías se borraron.
create or replace function public.delete_all_audits(p_confirm text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede borrar el historial';
  end if;
  if p_confirm is distinct from 'BORRAR TODO' then
    raise exception 'Confirmación incorrecta: escribe BORRAR TODO';
  end if;
  delete from public.audits where store_id = public.my_store_id();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.delete_all_audits(text) from public, anon;
grant execute on function public.delete_all_audits(text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. El administrador solo ve perfiles de su local
-- ---------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (
      store_id = public.my_store_id()
      and (public.is_admin() or public.is_quality_head())
    )
  );
