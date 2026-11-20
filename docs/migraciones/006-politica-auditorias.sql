-- Migración 006: la app guarda una auditoría y pide la fila creada (insert ... returning).
-- La política de lectura antes llamaba a audit_is_visible(), que consulta la misma tabla,
-- y en ese paso la fila recién insertada aún no se ve: Postgres responde
-- "new row violates row-level security policy for table audits".
-- Esta versión compara las columnas de la propia fila. Misma regla de visibilidad:
-- local propio y (administrador, jefa, o quien creó/evaluó la auditoría).
-- Segura de repetir.

drop policy if exists audits_select on public.audits;
create policy audits_select on public.audits
  for select to authenticated
  using (
    store_id = public.my_store_id()
    and (
      public.is_admin()
      or public.is_quality_head()
      or created_by = auth.uid()
      or evaluator_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
