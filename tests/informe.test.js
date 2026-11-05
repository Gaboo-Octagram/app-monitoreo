/* Informe semanal por sala: cálculo (semana ISO, variación, sub-áreas), hallazgos, conclusión y pantalla. */
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
const PIC = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

/* Jueves 22-oct-2026 = semana ISO 43. Auditorías en las semanas 43, 42 y 40 (la 41 no se auditó). */
const REF = '2026-10-22';
const ent = (status, extra = {}) => ({ k: 'k' + Math.random(), text: 'Ítem', status, obs: status === 'nok' ? 'obs' : '', corr: '', photos: [], ...extra });
const blk = (type, label, oks, noks, extra = {}) => ({ id: type + label, type, label, entries: [...Array(oks).fill(0).map(() => ent('ok')), ...Array(noks).fill(0).map(() => ent('nok', extra))], absent: [] });
const audit = (id, date, blocks) => ({ id, date, ts: date + 'T12:00:00Z', evaluator: 'Camila', areas: [{ areaId: U(1), areaName: 'Teja Food', boss: 'Jefe Uno', notEvaluated: false, total: 1, done: 1, blocks }] });
const DB = {
  version: 2, settings: { evaluator: 'Camila Vásquez', store: '', goal: 90 }, params: [], bosses: [{ id: U(9), name: 'Jefe Uno' }], workers: [],
  areas: [{ id: U(1), name: 'Teja Food', bossId: U(9), workerIds: [], blocks: [] }, { id: U(2), name: 'Bodega', bossId: '', workerIds: [], blocks: [] }],
  audits: [
    audit('a43', '2026-10-21', [
      blk('trabajadores', 'Check Trabajadores', 4, 0),
      blk('limpieza', 'Check Limpieza (Cuarto Frío)', 19, 1, { photos: [PIC], corr: 'Se informó al jefe', text: 'Mesón sucio' }),
      blk('limpieza', 'Check Limpieza (Cuarto Caliente)', 5, 0),
      blk('orden', 'Check Orden (Cuarto Frío)', 5, 0)
    ]),
    audit('a42', '2026-10-14', [blk('limpieza', 'Check Limpieza (Cuarto Frío)', 4, 0), blk('limpieza', 'Check Limpieza (Cuarto Caliente)', 5, 0)]),
    audit('a40', '2026-10-01', [blk('limpieza', 'Check Limpieza (Cuarto Frío)', 4, 1), blk('limpieza', 'Check Limpieza (Cuarto Caliente)', 5, 0)])
  ]
};
DB.audits[0].areas[0].blocks.push(blk('trabajadores', 'Check Trabajadores', 0, 1, { worker: 'Persona Ficticia', photos: [PIC], corr: 'Carta de amonestación' }));
DB.audits[0].areas[0].blocks.splice(0, 1);   // se queda con el bloque de trabajadores que trae el hallazgo

async function open(db) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.localStorage.setItem('sc_data_v2', JSON.stringify(db)); w.print = () => { w.__printed = true; }; } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message)); w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  scripts.forEach(code => { const s = d.createElement('script'); s.textContent = code; d.body.appendChild(s); });
  await tick(); return w;
}

(async () => {
  const w = await open(JSON.parse(JSON.stringify(DB))), d = w.document;
  const S = w.SCWeekly;
  check('Semana ISO: 22-oct-2026 es la 43', S.isoWeek(REF).week === 43);
  check('Semana ISO: 1-ene-2027 es la 53 de 2026', S.isoWeek('2027-01-01').week === 53 && S.isoWeek('2027-01-01').year === 2026);
  check('Número en palabras', S.words(41) === 'cuarenta y uno' && S.words(43) === 'cuarenta y tres' && S.words(20) === 'veinte');

  const db = JSON.parse(JSON.stringify(DB));
  const r = S.compute(db, U(1), REF);
  check('Semana del informe', r.week === 43 && r.start === '2026-10-19' && r.end === '2026-10-25');
  check('Gráfico: 5 semanas (43 y 4 hacia atrás)', r.weeks.map(x => x.n).join() === '39,40,41,42,43');
  const lim = r.cats.find(c => c.type === 'limpieza');
  check('Sub-áreas: dos bloques de Limpieza', lim.blocks.length === 2 && lim.blocks.map(b => b.sub).join() === 'Cuarto Frío,Cuarto Caliente');
  const frio = lim.blocks[0];
  check('Cuarto Frío: 95% ahora', frio.now === 95);
  check('Semana anterior = última auditada (la 42, no la 41)', frio.prev === 100 && frio.delta === -5);
  check('Serie con hueco en la semana 41', frio.series[1].v === 80 && frio.series[2].v === null && frio.series[3].v === 100);
  check('Cuarto Caliente sin variación', lim.blocks[1].now === 100 && lim.blocks[1].delta === 0);
  check('Hallazgos: los No cumple de la semana', r.findings.length === 2);
  const pers = r.findings.find(f => f.type === 'trabajadores');
  check('Personal: sin fotos', pers && pers.photos.length === 0 && pers.worker === 'Persona Ficticia' && pers.corr === 'Carta de amonestación');
  check('Limpieza: conserva la foto', r.findings.find(f => f.type === 'limpieza').photos.length === 1);
  check('Calificación: 3 aspectos, promedio 74% = Medianamente', r.aspects === 3 && r.overall === 74 && r.level.key === 'medio');

  const out = S.html(r, { title: 'TÍTULO X', rev: '01', docDate: '25.02.2026', evaluator: 'Camila Vásquez', issued: '2026-11-05' });
  check('Encabezado: título, fecha y Rev', out.includes('TÍTULO X') && out.includes('Fecha: 25.02.2026') && out.includes('Rev: 01'));
  check('Pie con evaluadora y fecha de emisión', out.includes('Elaborado por Camila Vásquez') && out.includes('05.11.2026'));
  check('Título del informe', out.includes('Informe Sala Teja Food Semana 43'));
  check('Variación visible', out.includes('-5%') && out.includes('Semana Anterior'));
  check('Acciones correctivas visibles', out.includes('Se informó al jefe') && out.includes('Carta de amonestación'));
  check('Niveles de satisfacción', out.includes('Muy Satisfactorio') && out.includes('Medianamente Satisfactorio') && out.includes('Insatisfactorio') && out.includes('89% - 70%'));
  check('Conclusión con la semana en palabras', out.includes('semana cuarenta y tres'));
  check('Gráficos de línea', (out.match(/<svg class="wr-svg"/g) || []).length >= 2);
  check('Fotos solo en limpieza (1 imagen de hallazgo)', (out.match(/alt="Foto del hallazgo"/g) || []).length === 1);

  const vacio = S.compute(db, U(2), REF);
  check('Sala sin auditorías: aviso', !vacio.hasData && S.html(vacio, {}).includes('No hay auditorías de esta sala'));
  const lvl = p => S.levelOf(p).key;
  check('Umbrales 90 / 70', lvl(100) === 'muy' && lvl(90) === 'muy' && lvl(89) === 'medio' && lvl(70) === 'medio' && lvl(69) === 'insat');

  /* Pantalla */
  w.location.hash = '#/resumen'; await tick(100);
  d.querySelector('[data-action="report"]').click(); await tick();
  check('Pantalla: lista de áreas con jefe', d.querySelectorAll('[data-rep-area]').length === 2 && d.body.textContent.includes('Jefe/a: Jefe Uno'));
  const ref = d.getElementById('repRef'); ref.value = REF; ref.dispatchEvent(new w.Event('change', { bubbles: true })); await tick();
  d.querySelector('[data-rep-area="' + U(1) + '"]').click(); await tick();
  check('Pantalla: vista previa del informe', !!d.querySelector('#reportPreview .wr') && d.querySelector('#reportPreview').textContent.includes('Semana 43'));
  [...d.querySelectorAll('.modal-foot .btn')].find(b => /Imprimir/.test(b.textContent)).click(); await tick();
  check('Pantalla: imprimir', w.__printed === true && !!d.querySelector('#printArea .wr'));

  console.log(errors.length ? `\n${errors.length} falla(s)` : '\nTodo OK'); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
