-- =====================================================================
--  Migración 002 — Permitir asignar roles desde el panel de Supabase
--
--  PROBLEMA: guard_profile_update() restauraba role/store_id/active
--  cuando quien edita no era administrador. En el Table Editor y el SQL
--  Editor no hay usuario conectado (auth.uid() es null), así que el
--  cambio de rol se descartaba en silencio.
--
--  SOLUCIÓN: se permite cuando NO hay usuario de la API (auth.uid() null)
--  y la conexión es del panel/SQL Editor (session_user postgres o
--  supabase_admin). Las llamadas de la API (rol authenticated/anon) siguen
--  igual de restringidas. Se puede repetir sin problema.
-- =====================================================================
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Panel de Supabase / SQL Editor: administración directa de la base.
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

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
