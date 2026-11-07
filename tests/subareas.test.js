/* Sub-áreas: migración de datos viejos, Configuración, Inicio por sub-área e informe con Presentación Personal única. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const raw = fs.readFileSync(dir + 'index.html', 'utf8');
const html = raw.replace('<link rel="stylesheet" href="styles.css">', '').replace(/<script[\s\S]*?<\/script>/g, '');
const scripts = [...raw.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(s => !/supabaseClient\.js|auth\.js|^https?:/.test(s.replace('./', ''))).map(s => fs.readFileSync(path.join(dir, s), 'utf8'));
const errors = [], check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push(n); };
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));

const blk = (id, type, sub, n) => ({ id, type, sub, items: Array.from({ length: n }, (_, i) => ({ id: id + 'i' + i, text: `${type} ${sub} ${i + 1}` })) });
const OLD = { version: 2, settings: { evaluator: 'Moni', store: '', goal: 90 }, params: [{ id: 'p1', text: 'Lavado de manos' }], bosses: [{ id: 'b1', name: 'Jefe Uno' }],
  workers: [{ id: 'w1', name: 'Ana Demo' }, { id: 'w2', name: 'Beto Demo' }, { id: 'w3', name: 'Cata Demo' }],
  areas: [{ id: 'a1', name: 'Teja Food', bossId: 'b1', workerIds: ['w1', 'w2', 'w3'], blocks: [blk('l1', 'limpieza', 'Cuarto Frío', 2), blk('l2', 'limpieza', 'Cuarto Caliente', 2), blk('o1', 'orden', 'Cuarto Frío', 1)] }], audits: [] };
function boot(initial) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.localStorage.setItem('sc_data_v2', JSON.stringify(initial)); w.print = () => {}; } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message)); w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  return { w, d, $: q => d.querySelector(q), $$: q => [...d.querySelectorAll(q)], click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    db: () => JSON.parse(w.localStorage.getItem('sc_data_v2')), go: async h => { w.location.hash = h; await tick(60); },
    change(el, v) { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); } };
}

(async () => {
  const t = boot(OLD); await tick(80);
  await t.go('#/config'); t.click(t.$('[data-tab="checklists"]')); await tick();
  /* Migración: los bloques con nombre de sub-área generan sub-áreas; los trabajadores quedan en "General". */
  const m = t.w.normalizeDB(JSON.parse(JSON.stringify(OLD))).areas[0];
  check('Migración: 2 sub-áreas desde los bloques con nombre', m.subs.length === 2 && m.subs.map(s => s.name).sort().join() === 'Cuarto Caliente,Cuarto Frío');
  check('Migración: cada bloque queda ligado a su sub-área', m.blocks.every(b => b.subId === m.subs.find(s => s.name === b.sub).id));
  check('Migración: los 3 trabajadores siguen en el área, sin sub-área', m.workerIds.length === 3 && m.subs.every(s => s.workerIds.length === 0));
  const dup = t.w.ensureSubs({ id: 'x', workerIds: [], blocks: [], subs: [{ id: 's1', name: 'A', workerIds: ['w1', 'w2'] }, { id: 's2', name: 'B', workerIds: ['w2'] }] });
  check('Un trabajador solo puede estar en una sub-área (se quita el duplicado)', dup.subs[0].workerIds.join() === 'w1,w2' && dup.subs[1].workerIds.length === 0 && dup.workerIds.join() === 'w1,w2');
  const cloud = t.w.ensureSubs({ id: 'x', workerIds: ['w1', 'w2'], workerSubs: { w1: 'Cuarto Frío', w2: '' }, blocks: [{ id: 'b', type: 'orden', sub: 'cuarto frio', items: [] }] });
  check('Nube: area_workers.sub arma las sub-áreas y se une al bloque por nombre (sin tildes ni mayúsculas)', cloud.subs.length === 1 && cloud.subs[0].workerIds.join() === 'w1' && cloud.blocks[0].subId === cloud.subs[0].id && !('workerSubs' in cloud));

  /* Configuración: pestañas por sub-área. */
  check('Config: pestañas General, Cuarto Frío y Cuarto Caliente', t.$$('.sub-tab').map(b => b.firstChild.textContent).join() === 'General,Cuarto Frío,Cuarto Caliente');
  const tab = n => t.$$('[data-action="cfg-sub"]').find(b => b.textContent.startsWith(n));
  const assign = async (sub, wid) => { t.click(tab(sub)); await tick(); t.change(t.$('[data-change="sub-add-worker"]'), wid); await tick(); };
  /* Mover trabajadores: se quitan de General y se agregan a su sub-área. */
  for (const [wid, sub] of [['w1', 'Cuarto Frío'], ['w2', 'Cuarto Caliente']]) {
    t.click(tab('General')); await tick(); t.click(t.$$('[data-action="sub-rm-worker"]').find(b => b.dataset.w === wid)); await tick();
    await assign(sub, wid);
  }
  let a = t.db().areas[0];
  check('Trabajadores por sub-área: Ana en Frío, Beto en Caliente, Cata sin sub-área', a.subs.find(s => s.name === 'Cuarto Frío').workerIds.join() === 'w1' && a.subs.find(s => s.name === 'Cuarto Caliente').workerIds.join() === 'w2' && a.workerIds.includes('w3') && a.workerIds.length === 3);
  check('Quitar de General sacó a Ana y Beto del área hasta reasignarlos (siguen en el área por sus sub-áreas)', a.workerIds.includes('w1') && a.workerIds.includes('w2'));
  t.click(tab('Cuarto Frío')); await tick(); t.click(t.$('[data-action="rename-sub"]')); await tick();
  t.$('input[name="name"]').value = 'Cuarto Frío 2'; t.click(t.$$('.modal-foot .btn')[1]); await tick(60);
  a = t.db().areas[0];
  check('Renombrar sub-área actualiza el nombre de sus bloques', a.subs.some(s => s.name === 'Cuarto Frío 2') && a.blocks.filter(b => b.sub === 'Cuarto Frío 2').length === 2 && !a.blocks.some(b => b.sub === 'Cuarto Frío'));

  /* Inicio: un grupo por sub-área, con sus trabajadores y checks. */
  await t.go('#/inicio'); if (!t.$('.subgroup')) { t.click(t.$('[data-action="toggle-area"]')); await tick(); }
  check('Inicio: encabezados General / Cuarto Frío 2 / Cuarto Caliente', t.$$('.subhead').map(h => h.textContent).join() === 'General,Cuarto Frío 2,Cuarto Caliente');
  const groupOf = n => t.$$('.subgroup').find(g => g.querySelector('.subhead').textContent === n);
  check('Inicio: cada sub-área muestra solo sus trabajadores', groupOf('Cuarto Frío 2').textContent.includes('Ana Demo') && !groupOf('Cuarto Frío 2').textContent.includes('Beto Demo') && groupOf('Cuarto Caliente').textContent.includes('Beto Demo') && groupOf('General').textContent.includes('Cata Demo'));
  check('Inicio: "Check Trabajadores (sub-área)" y checks de su sub-área', /Check Trabajadores \(Cuarto Frío 2\)/.test(groupOf('Cuarto Frío 2').textContent) && /Check Limpieza \(Cuarto Frío 2\)/.test(groupOf('Cuarto Frío 2').textContent));

  /* Informe: Presentación Personal es un solo bloque de toda la sala. */
  const d2 = JSON.parse(JSON.stringify(t.db())); const today = new Date().toISOString().slice(0, 10);
  const ent = (w, wk) => ({ k: 'p1', w, worker: wk, text: 'Lavado de manos', status: 'ok', obs: '', corr: '', photos: [] });
  d2.audits = [{ id: 'au', date: today, ts: today + 'T12:00:00Z', evaluator: 'Moni', areas: [{ areaId: 'a1', areaName: 'Teja Food', boss: 'Jefe Uno', notEvaluated: false, total: 3, done: 3,
    blocks: [{ id: 'workers', type: 'trabajadores', label: 'Check Trabajadores', entries: [ent('w1', 'Ana Demo'), ent('w2', 'Beto Demo'), ent('w3', 'Cata Demo')], absent: [] }, { id: 'l1', type: 'limpieza', label: 'Check Limpieza (Cuarto Frío 2)', entries: [{ k: 'x', text: 't', status: 'ok', obs: '', photos: [] }] }] }] }];
  const r = t.w.SCWeekly.compute(d2, 'a1', today);
  check('Informe: Presentación Personal = 1 solo bloque (sin sub-áreas) con las 3 personas', r.cats.find(c => c.type === 'trabajadores').blocks.length === 1 && t.w.SCWeekly.html(r, {}).includes('Presentación Personal'));

  /* Eliminar sub-área: sus checklists se van, sus trabajadores quedan sin sub-área. */
  await t.go('#/config'); t.click(t.$('[data-tab="checklists"]')); await tick(); t.click(tab('Cuarto Caliente')); await tick();
  t.click(t.$('[data-action="del-sub"]')); await tick(); t.click(t.$$('.modal-foot .btn')[1]); await tick(60);
  a = t.db().areas[0];
  check('Eliminar sub-área: se van sus bloques y Beto sigue en el área sin sub-área', a.subs.length === 1 && !a.blocks.some(b => b.sub === 'Cuarto Caliente') && a.workerIds.includes('w2') && !a.subs[0].workerIds.includes('w2'));

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
