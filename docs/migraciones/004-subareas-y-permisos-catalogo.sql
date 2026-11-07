-- Migración 004: sub-áreas con trabajadores, y catálogo editable por administrador y jefa.
-- Se ejecuta después de 001-003. Segura de repetir.

-- 1. Cada trabajador de un área pertenece a una sub-área (texto vacío = sin sub-área).
alter table public.area_workers
  add column if not exists sub text not null default '';

-- 2. Quien edita el catálogo: administrador y jefa de calidad (la monitora ya no).
create or replace function public.can_edit_catalog()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role in ('administrador', 'jefa_calidad')
       from public.profiles p
      where p.id = auth.uid() and p.active),
    false
  )
$$;
revoke all on function public.can_edit_catalog() from public, anon;
grant execute on function public.can_edit_catalog() to authenticated;
