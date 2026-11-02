/* Borrado total del historial en la nube (administrador), con Supabase simulado. */
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
const audit = { id: 'a1', audit_date: '2026-10-28', evaluator_name: 'M', goal: 90, created_at: '2026-10-28T14:00:00Z', audit_conformity: null,
  audit_area_results: [{ id: 'r1', area_id: 'x', area_name: 'Panadería', boss_name: '', not_evaluated: true, total_items: 0, done_items: 0, sort_order: 0, audit_blocks: [], audit_absences: [] }] };
const calls = { rpc: [], removed: [] };
function fakeSb(role) {
  const q = table => { const api = { select() { return api; }, order() { return api; }, limit() { return api; }, eq() { return api; },
    maybeSingle() { return Promise.resolve({ data: { store_id: 'st', role, full_name: 'Admin', active: true }, error: null }); },
    then(res) { return Promise.resolve({ data: table === 'audits' ? [audit] : [], error: null }).then(res); } }; return api; };
  return { from: q,
    rpc: (fn, args) => { calls.rpc.push({ fn, args }); return Promise.resolve({ data: args.p_confirm === 'BORRAR TODO' ? 1 : null, error: args.p_confirm === 'BORRAR TODO' ? null : { message: 'Confirmación incorrecta' } }); },
    storage: { from: () => ({ list: p => Promise.resolve({ data: p === 'st' ? [{ name: 'a1' }] : [], error: null }), remove: paths => { calls.removed.push(...paths); return Promise.resolve({ data: [], error: null }); }, createSignedUrls: () => Promise.resolve({ data: [] }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }), onAuthStateChange() {} } };
}
function boot(role) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.sb = fakeSb(role); w.SCAuth = { role: () => role, signedIn: () => true }; } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {}; w.HTMLAnchorElement.prototype.click = function () { w.__downloaded = this.download; };
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  return { w, d, $: q => d.querySelector(q), click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })), foot: i => d.querySelectorAll('.modal-foot .btn')[i] };
}
(async () => {
  let t = boot('monitora'); await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(200);
  t.w.location.hash = '#/config'; await tick(60); t.click(t.$('[data-tab="general"]')); await tick();
  check('Monitora: no ve el botón de borrar historial en la nube', !t.$('[data-action="cloud-wipe"]'));

  t = boot('administrador'); await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(200);
  t.w.location.hash = '#/config'; await tick(60); t.click(t.$('[data-tab="general"]')); await tick();
  check('Administrador: ve el botón', !!t.$('[data-action="cloud-wipe"]'));
  t.click(t.$('[data-action="cloud-wipe"]')); await tick(); t.click(t.foot(1)); await tick(150);
  check('Descarga el respaldo antes de pedir la frase', /^respaldo-historial-nube-\d{4}-\d{2}-\d{2}\.json$/.test(t.w.__downloaded || ''));
  t.d.querySelector('input[name="phrase"]').value = 'borrar'; t.click(t.foot(1)); await tick(100);
  check('Frase incorrecta: no llama a la base', calls.rpc.length === 0);
  t.d.querySelector('input[name="phrase"]').value = 'BORRAR TODO'; t.click(t.foot(1)); await tick(200);
  check('Frase correcta: llama a delete_all_audits', calls.rpc.length === 1 && calls.rpc[0].fn === 'delete_all_audits' && calls.rpc[0].args.p_confirm === 'BORRAR TODO');
  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
