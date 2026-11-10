/* Importar informes Word anteriores: lectura de porcentajes y efecto en Resumen / informe. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const errors = [];
const check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push(n); };
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
const teja = require('./fixtures/teja-s41.json'), sup = require('./fixtures/super-s41.json');

/* --- Lector aislado (sin pantalla) --- */
const sandbox = { window: {}, DecompressionStream, Response, Blob, TextDecoder, Uint8Array, DataView };
new Function('window', 'DecompressionStream', 'Response', 'Blob', 'TextDecoder', 'Uint8Array', 'DataView', fs.readFileSync(dir + 'features/import-reports.js', 'utf8'))
  (sandbox.window, DecompressionStream, Response, Blob, TextDecoder, Uint8Array, DataView);
const I = sandbox.window.SCImport;

(async () => {
  const t = I.parseReport(teja), s = I.parseReport(sup);
  check('Teja Food: área y semana desde el título', t.areaName === 'Teja Food' && t.week === 41);
  check('Teja Food: 7 valores (1 presentación + 3 limpieza + 3 orden)', t.rows.length === 7);
  const g = (r, type, sub) => r.rows.find(x => x.type === type && x.sub === sub);
  check('Teja Food: Presentación Personal 100%', g(t, 'trabajadores', '').pct === 100);
  check('Teja Food: Limpieza Cuarto Frio 95% (anterior 100%)', g(t, 'limpieza', 'Cuarto Frio').pct === 95 && g(t, 'limpieza', 'Cuarto Frio').prev === 100);
  check('Teja Food: Orden Cuarto Caliente 95%', g(t, 'orden', 'Cuarto Caliente').pct === 95);
  check('Teja Food: Termosellado sin dos puntos también se lee', g(t, 'limpieza', 'Cuarto Termosellado').pct === 100);
  check('Supermercado: Limpieza 96% y Orden 100% sin sub-área', s.areaName === 'Supermercado' && s.rows.length === 2 && g(s, 'limpieza', '').pct === 96 && g(s, 'orden', '').pct === 100);
  check('Semana → lunes ISO (S41 2026 = 2026-10-05)', I.weekStart(2026, 41) === '2026-10-05');

  /* .docx real, si está disponible en esta máquina */
  const real = '/mnt/user-data/attachments/c1f8f38a-166c-56b8-af1f-56acdce146ca/975fe065-Informe_Sala_Supermercado_Semana_41.docx';
  if (fs.existsSync(real)) {
    const b = fs.readFileSync(real), ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const r = I.parseReport(await I.readDocx(ab));
    check('Word real: se lee el .docx completo', r.week === 41 && r.rows.length === 2 && r.rows[0].pct === 96);
  }

  /* --- En la app --- */
  const raw = fs.readFileSync(dir + 'index.html', 'utf8');
  const html = raw.replace('<link rel="stylesheet" href="styles.css">', '').replace(/<script[\s\S]*?<\/script>/g, '');
  const scripts = [...raw.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
    .filter(x => !/supabaseClient\.js|auth\.js|^https?:/.test(x.replace('./', ''))).map(x => fs.readFileSync(path.join(dir, x), 'utf8'));
  const U = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const subs = ['Cuarto Caliente', 'Cuarto Frío', 'Cuarto Termosellado'].map((n, i) => ({ id: 'sub' + i, name: n, workerIds: [] }));
  const blk = (n, type, sub) => ({ id: U(n), type, sub: sub.name, subId: sub.id, items: [{ id: U(n + 500), text: 'Ítem ' + n }] });
  const db = { version: 2, settings: { evaluator: 'M', store: '', goal: 90 }, params: [], bosses: [], workers: [],
    areas: [{ id: U(1), name: 'Teja Food', bossId: '', workerIds: [], subs, blocks: subs.flatMap((s, i) => [blk(10 + i, 'limpieza', s), blk(20 + i, 'orden', s)]) },
      { id: U(2), name: 'Sala Supermercado', bossId: '', workerIds: [], subs: [], blocks: [{ id: U(30), type: 'limpieza', sub: '', subId: '', items: [{ id: U(31), text: 'x' }] }] }],
    audits: [] };
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { w.localStorage.setItem('sc_data_v2', JSON.stringify(db)); } });
  const w = dom.window, d = w.document, $ = q => d.querySelector(q), $$ = q => [...d.querySelectorAll(q)];
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s2 = d.createElement('script'); s2.textContent = code; d.body.appendChild(s2); });
  await tick(80);
  const docs = { 'a.docx': teja, 'b.docx': sup };
  w.SCImport.readDocx = async buf => docs[buf.name];
  const fakeFile = n => ({ name: n, arrayBuffer: async () => ({ name: n }) });
  w.location.hash = '#/config'; await tick(60);
  $('[data-action="cfg-tab"][data-tab="files"]').click(); await tick(60);
  check('Archivos: botón para importar informes Word', !!$('#reportImportInput'));
  const inp = $('#reportImportInput');
  Object.defineProperty(inp, 'files', { value: [fakeFile('a.docx'), fakeFile('b.docx')] });
  inp.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(120);
  check('Revisión: una tarjeta por archivo', $$('.imp-card').length === 2);
  check('Revisión: reconoce las áreas', $$('.imp-card [data-imp-f="area"]').map(s => s.value).join() === U(1) + ',' + U(2));
  check('Revisión: Cuarto Frio (sin tilde) se une a "Cuarto Frío"', [...$$('.imp-card')[0].querySelectorAll('[data-imp-f="sub"]')].some(s => s.value === 'Cuarto Frío'));
  [...$$('.modal-foot .btn')].find(b => /Guardar importación/.test(b.textContent)).click(); await tick(150);
  const stored = JSON.parse(w.localStorage.getItem('sc_data_v2'));
  check('Se guardan 2 informes importados con semana 41 de 2026', stored.imported.length === 2 && stored.imported.every(i => i.week === 41 && i.year === 2026 && i.start === '2026-10-05'));
  check('Solo porcentajes: no se crean auditorías', stored.audits.length === 0);
  check('La lista muestra lo importado', /Semana 41/.test($('#view').textContent) && /Limpieza Cuarto Frío: 95%/.test($('#view').textContent));

  /* Re-importar la misma semana reemplaza, no duplica */
  const inp2 = $('#reportImportInput');
  Object.defineProperty(inp2, 'files', { value: [fakeFile('b.docx')] });
  inp2.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(120);
  [...$$('.modal-foot .btn')].find(b => /Guardar importación/.test(b.textContent)).click(); await tick(150);
  check('Importar de nuevo la misma semana reemplaza', JSON.parse(w.localStorage.getItem('sc_data_v2')).imported.length === 2);

  /* Informe de la semana 42 con una auditoría real: la 41 importada es la "anterior" */
  const real42 = { id: 'r42', date: '2026-10-13', ts: '2026-10-13T15:00:00Z', evaluator: 'M', areas: [{ areaId: U(2), areaName: 'Sala Supermercado', boss: '', notEvaluated: false, total: 1, done: 1,
    blocks: [{ id: U(30), type: 'limpieza', label: 'Check Limpieza', entries: [{ k: 'k', text: 'x', status: 'ok', obs: '', corr: '', photos: [] }] }] }] };
  const dbNow = JSON.parse(w.localStorage.getItem('sc_data_v2')); dbNow.audits.push(real42);
  const rep = w.SCWeekly.compute(dbNow, U(2), '2026-10-14');
  const lim = rep.cats.find(c => c.type === 'limpieza').blocks[0];
  check('Informe S42: ahora 100%, anterior 96% (importado), variación +4', lim.now === 100 && lim.prev === 96 && lim.delta === 4);
  check('Informe S42: el gráfico incluye la S41 importada', lim.series.some(p => p.n === 41 && p.v === 96));
  /* Resumen: la comparativa de semanas usa lo importado */
  const dom2 = new JSDOM(html, { url: 'http://localhost/#/resumen', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(x) { x.localStorage.setItem('sc_data_v2', JSON.stringify(dbNow)); } });
  const w2 = dom2.window, d2 = w2.document;
  w2.addEventListener('error', e => errors.push('window error: ' + e.message));
  w2.scrollTo = () => {}; w2.Element.prototype.scrollIntoView = () => {};
  w2.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s2 = d2.createElement('script'); s2.textContent = code; d2.body.appendChild(s2); });
  await tick(100);
  const ref = d2.querySelector('[data-sum="ref"]'); ref.value = '2026-10-14'; ref.dispatchEvent(new w2.Event('change', { bubbles: true })); await tick(80);
  const txt = d2.querySelector('#view').textContent;
  check('Resumen: aparece la semana importada (96%) junto a la real (100%)', /96%/.test(txt) && /Sala Supermercado/.test(txt));

  /* Eliminar */
 
  $('[data-action="cfg-tab"][data-tab="files"]').click(); await tick(60);
  $('[data-action="del-import"]').click(); await tick(60);
  [...$$('.modal-foot .btn')].find(b => /Eliminar/.test(b.textContent)).click(); await tick(100);
  check('Eliminar un informe importado', JSON.parse(w.localStorage.getItem('sc_data_v2')).imported.length === 1);

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
