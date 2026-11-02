/* Historial entre dispositivos: bajar, unir, no pisar y quitar lo borrado. Supabase simulado. */
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
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const entry = (id, text, status, obs = '') => ({ id, item_id: null, param_id: null, worker_id: null, worker_name: '', item_text: text, status, observation: obs, created_at: '2026-10-30T10:00:00.00' + id.slice(-1) + 'Z', audit_photos: [] });
const cloudRow = (id, date, areaId, areaName, updated, entries) => ({ id, audit_date: date, evaluator_name: 'Tablet', goal: 90, created_at: date + 'T10:00:00Z', updated_at: updated, audit_conformity: null,
  audit_area_results: [{ id: 'r' + id, area_id: areaId, area_name: areaName, boss_name: '', not_evaluated: false, total_items: entries.length, done_items: entries.length, sort_order: 0,
    audit_blocks: [{ id: 'b' + id, block_type: 'limpieza', label: 'Check Limpieza', source_block_id: null, sort_order: 0, audit_entries: entries }], audit_absences: [] }] });

let cloud = [];            // auditorías en la "nube"
const calls = [];
function from(table) {
  let op = 'select', filters = [];
  const api = { select() { return api; }, order() { return api; }, limit() { return api; },
    eq(c, v) { filters.push([c, v]); return api; }, in() { return api; }, single() { return api; },
    update() { op = 'update'; return api; }, insert(r) { op = 'insert'; api.rows = r; return api; }, delete() { op = 'delete'; return api; }, upsert() { op = 'upsert'; return api; },
    maybeSingle() { return api.then(r => ({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: null })); },
    then(res, rej) {
      let data = [];
      if (table === 'profiles') data = [{ store_id: 'st', role: 'monitora', full_name: 'Moni', active: true }];
      else if (table === 'areas') data = [{ id: U(1), name: 'Panadería', boss_id: null, active: true, sort_order: 0 }, { id: U(2), name: 'Bodega', boss_id: null, active: true, sort_order: 1 }];
      else if (table === 'audits' && op === 'select') data = cloud.filter(a => filters.every(([c, v]) => (c === 'audit_date' ? a.audit_date === v : true))).map(a => ({ ...a }));
      else if (table === 'audits' && op === 'update') { calls.push('update-audit'); const a = cloud.find(x => filters.some(([c, v]) => c === 'id' && v === x.id)); if (a) { a.updated_at = new Date().toISOString(); data = { id: a.id, updated_at: a.updated_at }; } }
      else if (table === 'audits' && op === 'insert') { calls.push('insert-audit'); const n = { id: U(900), audit_date: api.rows.audit_date, updated_at: new Date().toISOString(), created_at: new Date().toISOString(), audit_area_results: [], audit_conformity: null }; cloud.push(n); data = { id: n.id, updated_at: n.updated_at }; }
      return Promise.resolve({ data, error: null }).then(res, rej);
    } };
  return api;
}
const fakeSb = () => ({ from, storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [] }), list: () => Promise.resolve({ data: [] }), remove: () => Promise.resolve({}) }) },
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }), onAuthStateChange() {} } });

function boot(local) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.sb = fakeSb(); w.SCAuth = { role: () => 'monitora', signedIn: () => true }; if (local) w.localStorage.setItem('sc_data_v2', JSON.stringify(local)); } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  return { w, d, $: q => d.querySelector(q), db: () => JSON.parse(w.localStorage.getItem('sc_data_v2')), login: async () => { await tick(80); w.dispatchEvent(new w.CustomEvent('sc-auth')); await tick(500); } };
}
const base = audits => ({ version: 2, settings: { evaluator: 'Moni', store: '', goal: 90 }, params: [], bosses: [], workers: [],
  areas: [{ id: U(1), name: 'Panadería', bossId: '', workerIds: [], blocks: [] }, { id: U(2), name: 'Bodega', bossId: '', workerIds: [], blocks: [] }], audits });
const localArea = (id, name, text, status) => ({ areaId: id, areaName: name, boss: '', notEvaluated: false, total: 1, done: 1, blocks: [{ id: 'limp', type: 'limpieza', label: 'Check Limpieza', entries: [{ k: 'k1', text, status, obs: '', photos: [] }] }] });

(async () => {
  /* 1. La tablet guardó un día; el computador (vacío) lo trae. */
  cloud = [cloudRow(U(100), '2026-10-30', U(2), 'Bodega', '2026-10-30T12:00:00Z', [entry('e1', 'Pisos limpios', 'ok'), entry('e2', 'Basureros', 'nok', 'Sin tapa')])];
  let t = boot(base([])); await t.login();
  let a = t.db().audits;
  check('Computador: el día guardado en la tablet aparece en su Historial', a.length === 1 && a[0].date === '2026-10-30' && a[0].areas[0].areaName === 'Bodega' && a[0].cloudId === U(100));
  check('El día traído conserva sus hallazgos', a[0].areas[0].blocks[0].entries.some(e => e.status === 'nok' && e.obs === 'Sin tapa'));
  check('Lo traído de la nube no se vuelve a subir', calls.length === 0);

  /* 2. Borrado total en la nube: lo ya sincronizado desaparece de aquí. */
  cloud = [];
  t = boot(base([{ id: 'l1', date: '2026-10-29', ts: '2026-10-29T10:00:00Z', evaluator: 'Moni', cloudId: U(101), cloudSyncedAt: '2026-10-29T10:01:00Z', cloudUpdatedAt: '2026-10-29T10:01:00Z', areas: [localArea(U(1), 'Panadería', 'X', 'ok')] },
                         { id: 'l2', date: '2026-10-31', ts: '2026-10-31T10:00:00Z', evaluator: 'Moni', areas: [localArea(U(1), 'Panadería', 'Y', 'ok')] }]));
  await t.login();
  a = t.db().audits;
  check('Borrado en la nube: se quita lo ya sincronizado', !a.some(x => x.date === '2026-10-29'));
  check('…pero no se pierde una auditoría local que aún no se sube (sin pisar)', a.some(x => x.date === '2026-10-31') || calls.includes('insert-audit'));

  /* 3. Conflicto: este dispositivo evaluó Panadería; otro guardó Bodega el mismo día. */
  calls.length = 0;
  cloud = [cloudRow(U(102), '2026-10-30', U(2), 'Bodega', '2026-10-30T15:00:00Z', [entry('e3', 'Pisos limpios', 'ok')])];
  t = boot(base([{ id: 'l3', date: '2026-10-30', ts: '2026-10-30T14:00:00Z', evaluator: 'Moni', cloudId: U(102), cloudUpdatedAt: '2026-10-30T09:00:00Z', areas: [localArea(U(1), 'Panadería', 'Mesas', 'ok')] }]));
  await t.login();
  a = t.db().audits.filter(x => x.date === '2026-10-30');
  check('Conflicto: queda UNA sola auditoría del día', a.length === 1);
  check('Conflicto: se unen las dos áreas (Panadería de aquí, Bodega de la otra)', a[0].areas.map(r => r.areaName).sort().join() === 'Bodega,Panadería');
  check('Conflicto: lo unido se sube a la nube', calls.includes('update-audit') && !!a[0].cloudSyncedAt);

  /* 4. saveAudit no pisa: la nube cambió después de lo último que bajamos. */
  cloud = [cloudRow(U(103), '2026-10-30', U(2), 'Bodega', '2026-10-30T18:00:00Z', [])];
  const r = await t.w.SupabaseWrite.saveAudit({ date: '2026-10-30', cloudId: U(103), cloudUpdatedAt: '2026-10-30T12:00:00Z', areas: [] }, base([]));
  check('Subir sobre algo más nuevo en la nube se frena (conflicto)', r && r.skipped === 'conflicto');

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
