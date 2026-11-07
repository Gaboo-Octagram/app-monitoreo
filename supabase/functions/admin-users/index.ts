// Edge Function "admin-users": gestión de usuarios para el administrador.
//
// La app NO puede crear cuentas ni cambiar contraseñas con la llave pública (anon).
// Esta función guarda la llave maestra (SUPABASE_SERVICE_ROLE_KEY, la pone Supabase sola)
// y solo actúa si quien la llama es un administrador activo. Los cambios de perfil
// (rol, nombre, estado) se hacen con la sesión del propio administrador, así que los
// permisos de la base de datos (RLS y triggers) siguen aplicándose.
//
// Acciones (POST JSON { action, ... }):
//   list
//   create       { username, full_name, role, password }
//   set_role     { id, role }
//   set_password { id, password }
//   set_active   { id, active }
//   rename       { id, full_name }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const DOMAIN = 'sistema-calidad.app';
const ROLES = ['administrador', 'jefa_calidad', 'monitora'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => json({ error }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Método no permitido.', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return fail('Inicia sesión.', 401);

  // Cliente con la sesión de quien llama: respeta RLS y triggers.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  // Cliente con llave maestra: solo para crear cuentas, cambiar claves y bloquear accesos.
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: u, error: uErr } = await caller.auth.getUser();
  if (uErr || !u?.user) return fail('La sesión no es válida. Vuelve a entrar.', 401);
  const me = u.user.id;

  const { data: mine, error: pErr } = await caller.from('profiles').select('id, role, store_id, active').eq('id', me).maybeSingle();
  if (pErr || !mine) return fail('No se encontró tu perfil.', 403);
  if (mine.role !== 'administrador' || !mine.active) return fail('Solo el administrador puede gestionar usuarios.', 403);

  let body: any;
  try { body = await req.json(); } catch { return fail('Solicitud inválida.'); }
  const action = String(body.action || '');

  // Verifica que el usuario objetivo sea del mismo local (RLS ya filtra los perfiles del local).
  const target = async (id: string) => {
    const { data } = await caller.from('profiles').select('id, role, full_name, active, store_id').eq('id', String(id || '')).maybeSingle();
    return data && data.store_id === mine.store_id ? data : null;
  };
  const passwordOk = (p: unknown) => typeof p === 'string' && p.length >= 8 && p.length <= 72;

  try {
    if (action === 'list') {
      const { data: profiles, error } = await caller.from('profiles').select('id, full_name, role, active, created_at').eq('store_id', mine.store_id).order('created_at');
      if (error) return fail(error.message, 500);
      const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (lErr) return fail(lErr.message, 500);
      const byId = new Map(list.users.map((x) => [x.id, x]));
      const users = (profiles || []).map((p) => {
        const email = byId.get(p.id)?.email || '';
        return {
          id: p.id, full_name: p.full_name, role: p.role, active: p.active,
          username: email.endsWith('@' + DOMAIN) ? email.slice(0, -(DOMAIN.length + 1)) : email,
          last_sign_in_at: byId.get(p.id)?.last_sign_in_at || null,
          is_me: p.id === me,
        };
      });
      return json({ users });
    }

    if (action === 'create') {
      const username = String(body.username || '').trim().toLowerCase();
      const full_name = String(body.full_name || '').trim();
      const role = String(body.role || '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return fail('El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo (sin espacios).');
      if (!full_name) return fail('Escribe el nombre completo.');
      if (!ROLES.includes(role)) return fail('Rol no válido.');
      if (!passwordOk(body.password)) return fail('La contraseña debe tener al menos 8 caracteres.');

      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${username}@${DOMAIN}`, password: body.password, email_confirm: true, user_metadata: { full_name },
      });
      if (error || !created?.user) {
        const m = error?.message || '';
        return fail(/already|registered|exists/i.test(m) ? 'Ya existe un usuario con ese nombre.' : 'No se pudo crear: ' + m);
      }
      const id = created.user.id;
      // El trigger crea el perfil como monitora; el administrador fija rol, nombre y local.
      const { error: upErr } = await caller.from('profiles').update({ role, full_name, store_id: mine.store_id, active: true }).eq('id', id);
      if (upErr) {
        await admin.auth.admin.deleteUser(id);   // sin perfil correcto no dejamos una cuenta a medias
        return fail('No se pudo asignar el rol: ' + upErr.message, 500);
      }
      return json({ ok: true, id });
    }

    if (action === 'set_role') {
      const t = await target(body.id);
      if (!t) return fail('Usuario no encontrado.', 404);
      if (t.id === me) return fail('No puedes cambiar tu propio rol.');
      if (!ROLES.includes(String(body.role))) return fail('Rol no válido.');
      const { error } = await caller.from('profiles').update({ role: body.role }).eq('id', t.id);
      return error ? fail(error.message, 500) : json({ ok: true });
    }

    if (action === 'rename') {
      const t = await target(body.id);
      const name = String(body.full_name || '').trim();
      if (!t) return fail('Usuario no encontrado.', 404);
      if (!name) return fail('Escribe el nombre completo.');
      const { error } = await caller.from('profiles').update({ full_name: name }).eq('id', t.id);
      return error ? fail(error.message, 500) : json({ ok: true });
    }

    if (action === 'set_password') {
      const t = await target(body.id);
      if (!t) return fail('Usuario no encontrado.', 404);
      if (!passwordOk(body.password)) return fail('La contraseña debe tener al menos 8 caracteres.');
      const { error } = await admin.auth.admin.updateUserById(t.id, { password: body.password });
      return error ? fail(error.message, 500) : json({ ok: true });
    }

    if (action === 'set_active') {
      const t = await target(body.id);
      if (!t) return fail('Usuario no encontrado.', 404);
      if (t.id === me) return fail('No puedes desactivar tu propia cuenta.');
      const active = body.active === true;
      const { error } = await caller.from('profiles').update({ active }).eq('id', t.id);
      if (error) return fail(error.message, 500);
      // Además se bloquea (o libera) el acceso a la cuenta.
      const { error: bErr } = await admin.auth.admin.updateUserById(t.id, { ban_duration: active ? 'none' : '876000h' });
      return bErr ? fail(bErr.message, 500) : json({ ok: true });
    }

    return fail('Acción desconocida.');
  } catch (e) {
    return fail('Error inesperado: ' + (e instanceof Error ? e.message : String(e)), 500);
  }
});
