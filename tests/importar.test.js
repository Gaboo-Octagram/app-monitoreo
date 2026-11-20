/* Informes Word anteriores: lectura de porcentajes, subida por área a Supabase (simulada),
   lista por área/año/semana, búsqueda, eliminación y efecto en Resumen / informe. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const errors = [];
const check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push(n); };
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
const teja = require('./fixtures/teja-s41.json'), sup = require('./fixtures/super-s41.json');

/* --- Lector aislado (sin pantalla) --- */
const sandbox = { window: {} };
new Function('window', 'DecompressionStream', 'Response', 'Blob', 'TextDecoder', 'Uint8Array', 'DataView', fs.readFileSync(dir + 'features/import-reports.js', 'utf8'))
  (sandbox.window, DecompressionStream, Response, Blob, TextDecoder, Uint8Array, DataView);
const I = sandbox.window.SCImport;

const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* --- Supabase simulado: tablas en memoria + Storage --- */
function fakeCloud() {
  const T = { profiles: [{ id: 'u-admin', store_id: 'st1', role: 'administrador', active: true }], stores: [{ id: 'st1' }],
    areas: [{ id: U(1), name: 'Teja Food' }, { id: U(2), name: 'Sala Supermercado' }], weekly_reports: [], weekly_report_values: [] };
  const storage = {};
  const from = table => {
    let filters = [], mode = 'select', payload = null, single = false;
    const rowsOf = () => T[table] || (T[table] = []);
    const run = () => {
      if (mode === 'insert') { payload.forEach(x => rowsOf().push({ ...x })); return Promise.resolve({ data: payload, error: null }); }
      if (mode === 'delete') { T[table] = rowsOf().filter(r => !filters.every(f => f(r))); return Promise.resolve({ data: null, error: null }); }
      let d = rowsOf().filter(r => filters.every(f => f(r)));
      if (table === 'weekly_reports') d = d.map(r => ({ ...r, areas: T.areas.find(a => a.id === r.area_id) || null,
        weekly_report_values: T.weekly_report_values.filter(v => v.report_id === r.id) }));
      return Promise.resolve({ data: single ? (d[0] || null) : d, error: null });
    };
    const api = {
      select() { return api; }, order() { return api; },
      eq(k, v) { filters.push(r => r[k] === v); return api; },
      maybeSingle() { single = true; return api; },
      insert(p) { mode = 'insert'; payload = Array.isArray(p) ? p : [p]; return api; },
      delete() { mode = 'delete'; return api; },
      then(res, rej) { return run().then(res, rej); }
    };
    return api;
  };
  const client = {
    from,
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u-admin' } } }, error: null }), onAuthStateChange() {} },
    storage: { from: bucket => ({
      upload: (p, f) => { storage[p] = f; return Promise.resolve({ data: { path: p }, error: null }); },
      remove: ps => { ps.forEach(p => delete storage[p]); return Promise.resolve({ data: [], error: null }); },
      createSignedUrl: p => Promise.resolve({ data: { signedUrl: 'https://x/' + p }, error: null })
    }) },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) }
  };
  return { client, T, storage };
}

(async () => {
  const t = I.parseReport(teja), s = I.parseReport(sup);
  check('Teja Food: área y semana desde el título', t.areaName === 'Teja Food' && t.week === 41);
  check('Teja Food: 7 valores (1 presentación + 3 limpieza + 3 orden)', t.rows.length === 7);
  const g = (r, type, sub) => r.rows.find(x => x.type === type && x.sub === sub);
  check('Teja Food: Presentación Personal 100%', g(t, 'trabajadores', '').pct === 100);
  check('Teja Food: Limpieza Cuarto Frio 95% (anterior 100%)', g(t, 'limpieza', 'Cuarto Frio').pct === 95 && g(t, 'limpieza', 'Cuarto Frio').prev === 100);
  check('Teja Food: Termosellado sin dos puntos también se lee', g(t, 'limpieza', 'Cuarto Termosellado').pct === 100);
  check('Supermercado: Limpieza 96% y Orden 100% sin sub-área', s.areaName === 'Supermercado' && s.rows.length === 2 && g(s, 'limpieza', '').pct === 96 && g(s, 'orden', '').pct === 100);
  check('Semana → lunes ISO (S41 2026 = 2026-10-05)', I.weekStart(2026, 41) === '2026-10-05');
  const real = '/mnt/user-data/attachments/c1f8f38a-166c-56b8-af1f-56acdce146ca/975fe065-Informe_Sala_Supermercado_Semana_41.docx';
  if (fs.existsSync(real)) {
    const b = fs.readFileSync(real), ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const r = I.parseReport(await I.readDocx(ab));
    check('Word real: se lee el .docx completo', r.week === 41 && r.rows.length === 2 && r.rows[0].pct === 96);
  }

  /* --- En la app --- */
  const cloud = fakeCloud();
  const raw = fs.readFileSync(dir + 'index.html', 'utf8');
  const html = raw.replace('<link rel="stylesheet" href="styles.css">', '').replace(/<script[\s\S]*?<\/script>/g, '');
  const scripts = [...raw.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
    .filter(x => !/supabaseClient\.js|auth\.js|^https?:/.test(x.replace('./', ''))).map(x => fs.readFileSync(path.join(dir, x), 'utf8'));
  const subs = ['Cuarto Caliente', 'Cuarto Frío', 'Cuarto Termosellado'].map((n, i) => ({ id: 'sub' + i, name: n, workerIds: [] }));
  const blk = (n, type, sub) => ({ id: U(n), type, sub: sub.name, subId: sub.id, items: [{ id: U(n + 500), text: 'Ítem ' + n }] });
  const db = { version: 2, settings: { evaluator: 'M', store: '', goal: 90 }, params: [], bosses: [], workers: [],
    areas: [{ id: U(1), name: 'Teja Food', bossId: '', workerIds: [], subs, blocks: subs.flatMap((s2, i) => [blk(10 + i, 'limpieza', s2), blk(20 + i, 'orden', s2)]) },
      { id: U(2), name: 'Sala Supermercado', bossId: '', workerIds: [], subs: [], blocks: [{ id: U(30), type: 'limpieza', sub: '', subId: '', items: [{ id: U(31), text: 'x' }] }] }],
    audits: [] };
  const boot = (url) => {
    const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) { w.localStorage.setItem('sc_data_v2', JSON.stringify(db)); w.sb = cloud.client; w.SCAuth = { role: () => 'administrador', signedIn: () => true }; } });
    const w = dom.window;
    w.addEventListener('error', e => errors.push('window error: ' + e.message));
    w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
    w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
    scripts.forEach(code => { const s2 = dom.window.document.createElement('script'); s2.textContent = code; dom.window.document.body.appendChild(s2); });
    return { w, d: w.document, $: q => w.document.querySelector(q), $$: q => [...w.document.querySelectorAll(q)] };
  };
  const page = boot('http://localhost/');
  const { w, $, $$ } = page;
  await tick(80);
  w.SupabaseRead.catalog = async () => ({ areas: [], params: [], workers: [], bosses: [] }); // la nube simulada no trae catálogo: se conserva el local
  w.dispatchEvent(new w.CustomEvent('sc-auth')); await tick(150);
  w.location.hash = '#/config'; await tick(60);
  $('[data-action="cfg-tab"][data-tab="files"]').click(); await tick(100);
  check('Archivos: sin área elegida, el botón de subir está desactivado', $('[data-action="imp-pick"]').disabled === true);
  const fakeFile = n => ({ name: n, size: 20000, arrayBuffer: async () => ({ name: n }) });
  w.SCImport.readDocx = async buf => ({ 'a.docx': teja, 'b.docx': sup })[buf.name];
  const btn = () => [...$$('.modal-foot .btn')].find(b => /Subir informes/.test(b.textContent));
  const pick = async (areaId, file) => {
    const ar = $('[data-change="imp-area"]'); ar.value = areaId; ar.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(60);
    const inp = $('#reportImportInput');
    Object.defineProperty(inp, 'files', { value: [fakeFile(file)] });
    inp.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(120);
  };
  await pick(U(1), 'a.docx');
  check('Revisión: el área elegida arriba se aplica al archivo', $$('.imp-card [data-imp-f="area"]').map(x => x.value).join() === U(1));
  check('Revisión: Cuarto Frio (sin tilde) se une a "Cuarto Frío"', [...$$('.imp-card')[0].querySelectorAll('[data-imp-f="sub"]')].some(x => x.value === 'Cuarto Frío'));
  btn().click(); await tick(200);
  await pick(U(2), 'b.docx');
  check('Revisión: Supermercado tiene una sola tarjeta', $$('.imp-card').length === 1 && $$('.imp-card [data-imp-f="area"]')[0].value === U(2));
  btn().click(); await tick(200);
  check('Se suben 2 informes a la nube (tabla weekly_reports)', cloud.T.weekly_reports.length === 2);
  check('Semana 41 de 2026 y lunes 2026-10-05', cloud.T.weekly_reports.every(r => r.week === 41 && r.year === 2026 && r.week_start === '2026-10-05'));
  check('Se guardan los porcentajes (teja: 7, supermercado: 2)', cloud.T.weekly_report_values.length === 9);
  check('Los archivos quedan en Storage con su área', Object.keys(cloud.storage).length === 2 && Object.keys(cloud.storage).every(k => k.startsWith('st1/')));
  check('Solo porcentajes: no se crean auditorías', !cloud.T.audits && cloud.T.weekly_reports.length === 2);
  check('La lista muestra área, año y semana', /Teja Food/.test($('#impList').textContent) && /2026/.test($('#impList').textContent) && /Semana 41/.test($('#impList').textContent));

  /* Búsqueda y filtros */
  const q = $('#impSearch'); q.value = 'supermercado'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(30);
  check('Buscar por área deja solo ese informe', /Sala Supermercado/.test($('#impList').textContent) && !/Teja Food/.test($('#impList').textContent));
  q.value = ''; q.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(30);
  const fa = $('[data-change="imp-filter-area"]'); fa.value = U(1); fa.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(30);
  check('Filtro por área', /Teja Food/.test($('#impList').textContent) && !/Sala Supermercado/.test($('#impList').textContent));
  fa.value = ''; fa.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(30);

  /* Re-subir la misma semana reemplaza */
  await pick(U(2), 'b.docx');
  btn().click(); await tick(200);
  check('Volver a subir la misma área y semana reemplaza (sigue en 2)', cloud.T.weekly_reports.length === 2 && Object.keys(cloud.storage).length === 2);

  /* Efecto en el informe semanal: S42 con auditoría real, la S41 importada es la anterior */
  const imported = await w.SupabaseReports.list();
  const real42 = { id: 'r42', date: '2026-10-13', ts: '2026-10-13T15:00:00Z', evaluator: 'M', areas: [{ areaId: U(2), areaName: 'Sala Supermercado', boss: '', notEvaluated: false, total: 1, done: 1,
    blocks: [{ id: U(30), type: 'limpieza', label: 'Check Limpieza', entries: [{ k: 'k', text: 'x', status: 'ok', obs: '', corr: '', photos: [] }] }] }] };
  const dbNow = JSON.parse(w.localStorage.getItem('sc_data_v2')); dbNow.audits.push(real42); dbNow.imported = imported;
  const rep = w.SCWeekly.compute(dbNow, U(2), '2026-10-14');
  const lim = rep.cats.find(c => c.type === 'limpieza').blocks[0];
  check('Informe S42: ahora 100%, anterior 96% (importado), variación +4', lim.now === 100 && lim.prev === 96 && lim.delta === 4);
  check('Informe S42: el gráfico incluye la S41 importada', lim.series.some(p => p.n === 41 && p.v === 96));

  /* Resumen: página nueva con sesión; carga lo subido desde la nube */
  const pg2 = boot('http://localhost/#/resumen'); await tick(80);
  pg2.w.dispatchEvent(new pg2.w.CustomEvent('sc-auth')); await tick(150);
  const ref = pg2.$('[data-sum="ref"]');
  if (ref) { ref.value = '2026-10-14'; ref.dispatchEvent(new pg2.w.Event('change', { bubbles: true })); await tick(80); }
  check('Resumen: aparece la semana importada (96%) junto a la real (100%)', /96%/.test(pg2.$('#view').textContent) && /Sala Supermercado/.test(pg2.$('#view').textContent));

  /* Eliminar */
  page.w.location.hash = '#/config'; await tick(40);
  $('[data-action="cfg-tab"][data-tab="files"]').click(); await tick(80);
  $('[data-action="del-import"]').click(); await tick(60);
  [...$$('.modal-foot .btn')].find(b => /Eliminar/.test(b.textContent)).click(); await tick(150);
  check('Eliminar un informe: se borra de la nube y de Storage', cloud.T.weekly_reports.length === 1 && Object.keys(cloud.storage).length === 1);

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
