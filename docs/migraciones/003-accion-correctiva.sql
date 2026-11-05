-- Migración 003: acción correctiva por hallazgo (informe semanal).
-- Segura de repetir. Ejecutar en el SQL Editor de Supabase.
alter table public.audit_entries
  add column if not exists corrective_action text not null default '';
