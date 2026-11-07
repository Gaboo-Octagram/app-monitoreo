/* =====================================================================
   Gestión de usuarios (solo administrador)
   ---------------------------------------------------------------------
   Llama a la Edge Function "admin-users" de Supabase, que es la única que
   puede crear cuentas y cambiar contraseñas (usa una llave que nunca llega
   al navegador). Ver supabase/functions/admin-users/index.ts y
   docs/usuarios-admin.md.
   ===================================================================== */
(function () {
  'use strict';

  const ROLE_LABEL = { administrador: 'Administrador', jefa_calidad: 'Jefa de calidad', monitora: 'Monitora de calidad' };
  const ROLES = Object.keys(ROLE_LABEL);

  async function call(action, payload) {
    const client = window.sb;
    if (!client || !client.functions) throw new Error('No hay conexión con Supabase.');
    const { data, error } = await client.functions.invoke('admin-users', { body: { action, ...(payload || {}) } });
    if (error) {
      let msg = '';
      try { const j = await error.context.json(); msg = j && j.error; } catch (e) { /* sin cuerpo */ }
      if (!msg) {
        const raw = String(error.message || '');
        msg = /not found|404/i.test(raw) ? 'La función "admin-users" aún no está publicada en Supabase (ver docs/usuarios-admin.md).'
          : /failed to fetch|network|relay/i.test(raw) ? 'No hay conexión con la nube. Revisa internet e inténtalo de nuevo.'
          : raw || 'No se pudo completar la acción.';
      }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  window.SCUsers = {
    ROLE_LABEL, ROLES,
    list: () => call('list').then(d => d.users || []),
    create: (u) => call('create', u),
    setRole: (id, role) => call('set_role', { id, role }),
    setPassword: (id, password) => call('set_password', { id, password }),
    setActive: (id, active) => call('set_active', { id, active }),
    rename: (id, full_name) => call('rename', { id, full_name })
  };
})();
