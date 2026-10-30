/* Catálogo en la nube (monitora) con un Supabase simulado en memoria. */
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

/* Base en memoria con lo justo de PostgREST: select / upsert / insert / update / delete + eq / in. */
const T = {
  profiles: [{ id: 'u1', store_id: 'st', role: 'monitora', full_name: 'Moni', active: true }],
  areas: [{ id: U(1), store_id: 'st', name: 'Panadería', boss_id: null, active: true, sort_order: 0 }, { id: U(2), store_id: 'st', name: 'Bodega', boss_id: null, active: true, sort_order: 1 }],
  checklist_blocks: [{ id: U(11), area_id: U(1), type: 'limpieza', sub: '', sort_order: 0 }],
  checklist_items: [{ id: U(21), block_id: U(11), text: 'Pisos limpios', sort_order: 0, active: true }, { id: U(22), block_id: U(11), text: 'Basureros', sort_order: 1, active: true }],
  hygiene_params: [{ id: U(31), store_id: 'st', text: 'Lavado de manos', sort_order: 0, active: true }],
  workers: [{ id: U(41), store_id: 'st', name: 'Ana Demo', position: '', active: true }],
  bosses: [], area_workers: [{ area_id: U(1), worker_id: U(41), store_id: 'st' }], audits: [], audit_conformity: []
};
const log = [];
function from(table) {
  let op = 'select', rows = null, patch = null, filters = [], onConflict = 'id';
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(c, v) { filters.push(r => r[c] === v); return api; },
    in(c, v) { filters.push(r => v.includes(r[c])); return api; },
    upsert(r, o) { op = 'upsert'; rows = r; onConflict = (o && o.onConflict) || 'id'; return api; },
    insert(r) { op = 'insert'; rows = r; return api; },
    update(p) { op = 'update'; patch = p; return api; },
    delete() { op = 'delete'; return api; },
    maybeSingle() { return api.then(r => ({ data: (r.data || [])[0] || null, error: null })); },
    then(res, rej) {
      const t = T[table] || (T[table] = []);
      const f = r => filters.every(x => x(r));
      let data = null;
      if (op === 'select') data = t.filter(f).map(r => ({ ...r }));
      else if (op === 'upsert') rows.forEach(n => { const i = t.findIndex(r => r[onConflict] === n[onConflict]); if (i >= 0) Object.assign(t[i], n); else t.push({ ...n }); });
      else if (op === 'insert') rows.forEach(n => t.push({ ...n }));
      else if (op === 'update') t.filter(f).forEach(r => Object.assign(r, patch));
      else if (op === 'delete') T[table] = t.filter(r => !f(r));
      if (op !== 'select') log.push({ table, op, n: rows ? rows.length : undefined });
      return Promise.resolve({ data, error: null }).then(res, rej);
    }
  };
  return api;
}
const fakeSb = () => ({ from, storage: { from: () => ({}) }, auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }), onAuthStateChange() {} } });

function boot(role, initial) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.sb = fakeSb(); w.SCAuth = { role: () => role, signedIn: () => true }; if (initial) w.localStorage.setItem('sc_data_v2', initial); } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  return { w, d, $: q => d.querySelector(q), $$: q => [...d.querySelectorAll(q)], click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })),
    db: () => JSON.parse(w.localStorage.getItem('sc_data_v2')), go: async h => { w.location.hash = h; await tick(60); } };
}

(async () => {
  /* Navegador con un catálogo local viejo (ids cortos) y una auditoría guardada. */
  const old = { version: 2, settings: { evaluator: 'Moni', store: '', goal: 90 }, params: [{ id: 'p1', text: 'Otro' }], bosses: [], workers: [],
    areas: [{ id: 'a-local', name: 'Panadería', bossId: '', workerIds: [], blocks: [] }], audits: [{ id: 'x', date: '2026-10-01', areas: [{ areaId: 'a-local', areaName: 'Panadería', notEvaluated: true }] }] };
  const t = boot('monitora', JSON.stringify(old));
  await tick(80); t.w.dispatchEvent(new t.w.CustomEvent('sc-auth')); await tick(300);

  let db = t.db();
  check('Baja el catálogo de la nube (2 áreas, 1 parámetro, 1 trabajador)', db.areas.length === 2 && db.params.length === 1 && db.workers.length === 1);
  check('Los ids locales pasan a ser los de la nube', db.areas[0].id === U(1) && db.areas[0].blocks[0].items.length === 2);
  check('Reasigna el área de las auditorías viejas por nombre', db.audits[0].areas[0].areaId === U(1));
  check('Trabajador asignado al área', db.areas[0].workerIds.join() === U(41));

  /* Configuración: agregar un ítem y un trabajador, borrar otro ítem. */
  await t.go('#/config');
  t.click(t.$('[data-tab="checklists"]')); await tick();
  const form = t.$(`[data-form="add-item"][data-block="${U(11)}"]`);
  form.elements.text.value = 'Ítem nuevo de la monitora';
  form.dispatchEvent(new t.w.Event('submit', { bubbles: true, cancelable: true })); await tick(1200);
  const added = T.checklist_items.find(i => i.text === 'Ítem nuevo de la monitora');
  check('Ítem nuevo se guarda en Supabase con id uuid y bloque correcto', !!added && /^[0-9a-f-]{36}$/.test(added.id) && added.block_id === U(11) && added.active === true);
  check('Los ítems existentes siguen activos', T.checklist_items.filter(i => i.active).length === 3);

  t.click(t.$('[data-tab="workers"]')); await tick();
  t.click(t.$('[data-action="add-worker"]')); await tick();
  t.$('input[name="name"]').value = 'Luis Demo'; t.$('input[name="role"]').value = 'Cajero';
  t.click(t.$$('.modal-foot .btn')[1]); await tick(1200);
  check('Trabajador nuevo se guarda en la nube', T.workers.some(w => w.name === 'Luis Demo' && w.position === 'Cajero'));

  /* Quitar un ítem desde la lista de checks: queda inactivo, no borrado. */
  t.click(t.$('[data-tab="checklists"]')); await tick();
  const delBtn = t.$(`[data-action="del-item"][data-id="${U(22)}"]`);
  t.click(delBtn); await tick(1200);
  check('Un ítem quitado queda inactivo (no se borra, el historial lo conserva)', T.checklist_items.length === 3 && T.checklist_items.filter(i => i.active === false).length === 1);

  /* Datos de ejemplo nunca suben. */
  const before = T.workers.length;
  await t.go('#/config'); t.click(t.$('[data-tab="general"]')); await tick();
  t.click(t.$('[data-action="load-sample"]')); await tick(1300);
  check('Los datos de ejemplo no se suben a la nube', T.workers.length === before && !T.workers.some(w => w.sample));

  /* La jefa nunca empuja catálogo. */
  const n = log.length;
  const j = boot('jefa_calidad'); await tick(80); j.w.dispatchEvent(new j.w.CustomEvent('sc-auth')); await tick(300);
  check('Jefa: no escribe nada en el catálogo', log.length === n);

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
