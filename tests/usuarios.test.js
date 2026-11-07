/* Pestaña Usuarios (solo administrador) con la Edge Function simulada. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const raw = fs.readFileSync(dir + 'index.html', 'utf8');
const html = raw.replace('<link rel="stylesheet" href="styles.css">', '').replace(/<script[\s\S]*?<\/script>/g, '');
const scripts = [...raw.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(s => !/supabaseClient\.js|auth\.js|^https?:/.test(s.replace('./', ''))).map(s => fs.readFileSync(path.join(dir, s), 'utf8'));
const errors = [];
const check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push(n); };
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));

const calls = [];
let users = [
  { id: 'u-admin', full_name: 'Admin Demo', role: 'administrador', active: true, username: 'admindemo', last_sign_in_at: '2026-11-06T10:00:00Z', is_me: true },
  { id: 'u-mon', full_name: 'Monitora Demo', role: 'monitora', active: true, username: 'monitorademo', last_sign_in_at: null, is_me: false }
];
function fakeSb() {
  const empty = () => { const api = { select() { return api; }, order() { return api; }, limit() { return api; }, eq() { return api; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); }, then(r) { return Promise.resolve({ data: [], error: null }).then(r); } }; return api; };
  return {
    from: empty,
    storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-admin' } } }, error: null }), onAuthStateChange() {} },
    functions: {
      invoke(name, { body }) {
        calls.push({ name, body });
        if (body.action === 'list') return Promise.resolve({ data: { users }, error: null });
        if (body.action === 'create') {
          if (body.username === 'repetido') return Promise.resolve({ data: null, error: { message: 'x', context: { json: () => Promise.resolve({ error: 'Ese usuario ya existe.' }) } } });
          users = users.concat({ id: 'u-new', full_name: body.full_name, role: body.role, active: true, username: body.username.toLowerCase(), last_sign_in_at: null, is_me: false });
        }
        if (body.action === 'set_role') users = users.map(u => u.id === body.id ? { ...u, role: body.role } : u);
        if (body.action === 'set_active') users = users.map(u => u.id === body.id ? { ...u, active: body.active } : u);
        return Promise.resolve({ data: { ok: true }, error: null });
      }
    }
  };
}
function boot(role) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.sb = fakeSb(); w.SCAuth = { role: () => role, signedIn: () => !!role }; } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  return { w, d, $: q => d.querySelector(q), $$: q => [...d.querySelectorAll(q)], click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) };
}
const tabs = t => t.$$('[data-action="cfg-tab"]').map(b => b.dataset.tab);

(async () => {
  for (const role of ['monitora', 'jefa_calidad']) {
    const t = boot(role); await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(150);
    t.w.location.hash = '#/config'; await tick(100);
    check(role + ': no ve la pestaña Usuarios', !tabs(t).includes('users'));
  }
  const t = boot('administrador'); await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(150);
  t.w.location.hash = '#/config'; await tick(100);
  check('Administrador: ve la pestaña Usuarios', tabs(t).includes('users'));
  t.click(t.$('[data-action="cfg-tab"][data-tab="users"]')); await tick(150);
  check('Lista los usuarios', t.$$('tbody tr').length === 2 && /Monitora Demo/.test(t.d.body.textContent));
  check('Su propio rol está bloqueado y no se puede desactivar',
    t.$('select[data-id="u-admin"]').disabled && !t.$('[data-action="user-active"][data-id="u-admin"]'));

  const sel = t.$('select[data-id="u-mon"]'); sel.value = 'jefa_calidad';
  sel.dispatchEvent(new t.w.Event('change', { bubbles: true })); await tick(150);
  const sr = calls.find(c => c.body.action === 'set_role');
  check('Cambiar rol llama a set_role', sr && sr.name === 'admin-users' && sr.body.id === 'u-mon' && sr.body.role === 'jefa_calidad');
  check('La lista se refresca con el rol nuevo', t.$('select[data-id="u-mon"]').value === 'jefa_calidad');

  t.click(t.$('[data-action="add-user"]')); await tick();
  const fill = (n, v) => { t.$(`.modal [name="${n}"], [name="${n}"]`).value = v; };
  const submit = () => t.click([...t.$$('.modal button, .modal-actions button')].find(b => /Crear usuario/.test(b.textContent)));
  fill('full_name', 'Camila Demo'); fill('username', 'CaDemo'); fill('role', 'monitora'); fill('password', 'abcdefgh'); fill('password2', 'distinta1');
  submit(); await tick(60);
  check('Contraseñas distintas: no crea y deja el formulario abierto', !calls.some(c => c.body.action === 'create') && !!t.$('[name="password2"]'));
  fill('password', 'abc'); fill('password2', 'abc'); submit(); await tick(60);
  check('Contraseña corta: no crea', !calls.some(c => c.body.action === 'create'));
  fill('password', 'abcdefgh'); fill('password2', 'abcdefgh'); submit(); await tick(200);
  const cr = calls.find(c => c.body.action === 'create');
  check('Crear usuario envía nombre, usuario, rol y contraseña', cr && cr.body.username === 'CaDemo' && cr.body.role === 'monitora' && cr.body.password === 'abcdefgh' && cr.body.full_name === 'Camila Demo');
  check('El usuario nuevo aparece en la lista', /cademo/.test(t.d.body.textContent));

  t.click(t.$('[data-action="user-pass"][data-id="u-new"]')); await tick();
  fill('password', 'nueva-clave1'); fill('password2', 'nueva-clave1');
  t.click([...t.$$('.modal button, .modal-actions button')].find(b => /Cambiar contraseña/.test(b.textContent))); await tick(150);
  const sp = calls.find(c => c.body.action === 'set_password');
  check('Restablecer contraseña llama a set_password', sp && sp.body.id === 'u-new' && sp.body.password === 'nueva-clave1');

  t.click(t.$('[data-action="user-active"][data-id="u-new"]')); await tick(60);
  t.click([...t.$$('.modal button, .modal-actions button')].find(b => /^Desactivar$/.test(b.textContent.trim()))); await tick(200);
  const sa = calls.find(c => c.body.action === 'set_active');
  check('Desactivar pide confirmación y llama a set_active', sa && sa.body.id === 'u-new' && sa.body.active === false);
  check('Aparece como Desactivado', /Desactivado/.test(t.d.body.textContent));

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
