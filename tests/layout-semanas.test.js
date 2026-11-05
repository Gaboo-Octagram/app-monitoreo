/* Comparativa por semanas: con más de 7 áreas los gráficos se alargan y pasan uno debajo de otro. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const raw = fs.readFileSync(dir + 'index.html', 'utf8');
const html = raw.replace('<link rel="stylesheet" href="styles.css">', '').replace(/<script[\s\S]*?<\/script>/g, '');
const scripts = [...raw.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(s => !/supabaseClient\.js|auth\.js|^https?:/.test(s.replace('./', ''))).map(s => fs.readFileSync(path.join(dir, s), 'utf8'));
const errors = [], check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push(n); };
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function dbWith(nAreas) {
  const areas = Array.from({ length: nAreas }, (_, i) => ({ id: U(i + 1), name: `Área número ${i + 1}`, bossId: '', workerIds: [], blocks: [] }));
  const day = new Date(); const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const audits = [0, 7, 14].map((back, j) => { const d = new Date(day); d.setDate(d.getDate() - back);
    return { id: 'a' + j, date: iso(d), ts: d.toISOString(), evaluator: 'M', areas: areas.map((a, i) => ({ areaId: a.id, areaName: a.name, boss: '', notEvaluated: false, total: 2, done: 2,
      blocks: ['trabajadores', 'limpieza', 'orden'].map(t => ({ id: t, type: t, label: 'Check ' + t, entries: [{ k: 'k1', w: t === 'trabajadores' ? 'w1' : undefined, worker: t === 'trabajadores' ? 'Ana' : '', text: 'x', status: 'ok', obs: '', photos: [] }, { k: 'k2', w: t === 'trabajadores' ? 'w1' : undefined, worker: t === 'trabajadores' ? 'Ana' : '', text: 'y', status: (i + j) % 3 ? 'ok' : 'nok', obs: 'o', photos: [] }], absent: [] })) })) }; });
  return { version: 2, settings: { evaluator: 'M', store: '', goal: 90 }, params: [], bosses: [], workers: [], areas, audits };
}
async function open(n) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.localStorage.setItem('sc_data_v2', JSON.stringify(dbWith(n))); } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message)); w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  await tick(); w.location.hash = '#/resumen'; await tick(100);
  return d;
}
(async () => {
  let d = await open(7);
  check('7 áreas: tres gráficos en una fila', d.querySelectorAll('.cmp').length === 3 && !d.querySelector('.grid-3.stack'));
  const w7 = +d.querySelector('.cmp-svg').getAttribute('viewBox').split(' ')[2];
  d = await open(10);
  check('10 áreas: los gráficos pasan uno debajo de otro', !!d.querySelector('.grid-3.stack') && d.querySelectorAll('.cmp').length === 3);
  const w10 = +d.querySelector('.cmp-svg').getAttribute('viewBox').split(' ')[2];
  check('10 áreas: el gráfico se alarga (más ancho)', w10 > w7 * 1.8);
  check('10 áreas: todas las áreas aparecen en el gráfico', d.querySelectorAll('.cmp-svg')[0].querySelectorAll('.wk-0 .wk-pt').length === 10);
  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
