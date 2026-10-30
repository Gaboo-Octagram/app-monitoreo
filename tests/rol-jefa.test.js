/* Vista de la jefa de calidad con un Supabase simulado (sin red). */
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

const cloudAudit = {
  id: 'aud-1', audit_date: '2026-10-28', evaluator_name: 'Monitora Demo', goal: 90, created_at: '2026-10-28T14:00:00Z',
  audit_conformity: null,
  audit_area_results: [{
    id: 'r1', area_id: 'ar1', area_name: 'Panadería', boss_name: 'Jefe Demo', not_evaluated: false, total_items: 2, done_items: 2, sort_order: 0,
    audit_blocks: [{ id: 'b1', block_type: 'limpieza', label: 'Check Limpieza', sort_order: 0, audit_entries: [
      { id: 'e1', item_id: 'i1', param_id: null, worker_id: null, worker_name: '', item_text: 'Pisos limpios', status: 'ok', observation: '', created_at: '2026-10-28T14:00:00.001Z', audit_photos: [] },
      { id: 'e2', item_id: 'i2', param_id: null, worker_id: null, worker_name: '', item_text: 'Basureros', status: 'nok', observation: 'Sin tapa', created_at: '2026-10-28T14:00:00.002Z', audit_photos: [{ storage_path: 's/a/e2/1.jpg' }] }] }],
    audit_absences: [{ worker_id: null, worker_name: 'Ana Demo' }]
  }]
};
const log = { upserts: [], from: [] };
function fakeSb() {
  const q = table => {
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; }, eq() { return api; }, maybeSingle() { return Promise.resolve({ data: { store_id: 's', role: 'jefa_calidad', full_name: 'Jefa Demo', active: true }, error: null }); },
      upsert(row) { log.upserts.push({ table, row }); cloudAudit.audit_conformity = { note: row.note, reviewer_name: row.reviewer_name, updated_at: 'x' }; return Promise.resolve({ error: null }); },
      then(res) {
        log.from.push(table);
        const data = table === 'audits' ? [cloudAudit] : [];
        return Promise.resolve({ data, error: null }).then(res);
      }
    };
    return api;
  };
  return {
    from: q,
    storage: { from: () => ({ createSignedUrls: paths => Promise.resolve({ data: paths.map(p => ({ path: p, signedUrl: 'https://x/' + p })), error: null }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }), onAuthStateChange() {} }
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

(async () => {
  /* ----- jefa de calidad ----- */
  let t = boot('jefa_calidad');
  await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(250);
  const nav = t.$$('.nav a').filter(a => !a.hidden).map(a => a.dataset.view);
  check('Jefa: solo ve Historial y Resumen', nav.join() === 'historial,resumen');
  check('Jefa: entra directo a Resumen', t.w.location.hash === '#/resumen');
  t.w.location.hash = '#/config'; await tick(60);
  check('Jefa: Configuración redirige a Resumen', t.$('#pageTitle').textContent === 'Resumen');
  t.w.location.hash = '#/historial'; await tick(60);
  check('Jefa: Historial muestra la auditoría de la nube', t.$$('[data-day]').length === 1);
  t.click(t.$('[data-action="toggle-day"]')); await tick();
  check('Jefa: no ve Editar ni Eliminar', !t.$('[data-action="edit-aud"]') && !t.$('[data-action="del-aud"]'));
  check('Jefa: ve hallazgo con su foto firmada', /Sin tapa/.test(t.$('.hcard').textContent) && !!t.$('.thumb[src^="https://x/"]'));
  check('Jefa: ve ausente', /Ana Demo/.test(t.$('.hc-abs').textContent));
  t.$('[data-conf-note]').value = 'Todo conforme, revisar basureros';
  t.click(t.$('[data-action="save-conf"]')); await tick(80);
  check('Jefa: la conformidad se envía a audit_conformity', log.upserts.length === 1 && log.upserts[0].table === 'audit_conformity'
    && log.upserts[0].row.audit_id === 'aud-1' && log.upserts[0].row.note.startsWith('Todo conforme'));
  check('Jefa: la pantalla muestra quién la dio', /Dada por Jefa Demo/.test(t.$('.conf').textContent));
  const stored = t.w.localStorage.getItem('sc_data_v2');
  check('Jefa: las auditorías de la nube no se guardan en este navegador', !stored || JSON.parse(stored).audits.length === 0);

  /* ----- monitora ----- */
  cloudAudit.audit_conformity = { note: 'Revisar basureros', reviewer_name: 'Jefa Demo', updated_at: 'x' };
  t = boot('monitora');
  await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(100);
  check('Monitora: ve Inicio, Historial, Resumen y Configuración', t.$$('.nav a').filter(a => !a.hidden).length === 4);
  check('Monitora: Inicio muestra las áreas (modo normal)', t.$$('[data-area]').length >= 1);

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
