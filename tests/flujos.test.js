const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const html = fs.readFileSync(dir + 'index.html', 'utf8').replace('<link rel="stylesheet" href="styles.css">', '').replace('<script src="app.js"></script>', '');
const js = fs.readFileSync(dir + 'app.js', 'utf8');
const errors = [];

function boot(initial) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) { if (initial) Object.entries(initial).forEach(([k, v]) => w.localStorage.setItem(k, v)); } });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.scrollTo = () => {}; w.print = () => { w.__printed = true; }; w.Element.prototype.scrollIntoView = () => {};
  w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
  const s = d.createElement('script'); s.textContent = js; d.body.appendChild(s);
  const t = {
    w, d, $: q => d.querySelector(q), $$: q => [...d.querySelectorAll(q)],
    click(el) { if (!el) throw new Error('click: elemento no encontrado'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); },
    tick: (ms = 25) => new Promise(r => setTimeout(r, ms)),
    go: async h => { w.location.hash = h; await t.tick(30); },
    db: () => JSON.parse(w.localStorage.getItem('sc_data_v2')),
    foot: i => t.$$('.modal-foot .btn')[i],
    typeIn(el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); },
    submit(f) { f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); }
  };
  return t;
}
const check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push('check: ' + n); };

(async () => {
  /* ===== Migración desde v1 ===== */
  const v1 = { version: 1, settings: { evaluator: 'Camila', store: 'Super X', goal: 85 }, bosses: [{ id: 'b1', name: 'Jefe Real' }, { id: 'b2', name: 'Jefe Demo', sample: true }],
    workers: [{ id: 'w1', name: 'Trabajador Real' }], areas: [{ id: 'a1', name: 'Teja Food', bossId: 'b1', workerIds: ['w1'],
      items: { limpieza: [{ id: 'l1', text: 'Pisos' }], orden: [{ id: 'o1', text: 'Mesas' }], personal: [{ id: 'p1', text: 'Lavado de manos' }, { id: 'p2', text: 'Uniforme' }] } }],
    audits: [{ id: 'x', date: '2026-10-01' }] };
  let t = boot({ sc_data_v1: JSON.stringify(v1) });
  await t.tick();
  check('Migración: conserva área, jefe y trabajador; descarta auditorías', t.db().areas.length === 1 && t.db().areas[0].name === 'Teja Food' && t.db().audits.length === 0 && t.db().bosses.length === 1);
  check('Migración: personal pasa a parámetros globales', t.db().params.length === 2 && t.db().params[0].text === 'Lavado de manos');
  check('Migración: ajustes conservados', t.db().settings.evaluator === 'Camila' && t.db().settings.goal === 85);

  /* ===== Flujo principal con datos nuevos ===== */
  t = boot(); await t.tick();
  const { $, $$, click, tick, go, db, foot, typeIn, submit, w } = t;
  check('Inicio muestra 7 áreas con estado Pendiente', $$('[data-area]').length === 7 && $$('.status.pending').length === 7);
  check('Primera área abierta por defecto', !!$('[data-area] .area-body'));

  // Configuración: trabajadores y jefe, asignar a Panadería (Teja Food equivalente)
  await go('#/config');
  click($('[data-tab="workers"]')); await tick();
  for (const n of ['Trabajador TF 1', 'Trabajador TF 2']) {
    click($('[data-action="add-worker"]')); await tick();
    $('input[name="name"]').value = n; click(foot(1)); await tick();
  }
  check('2 trabajadores creados', db().workers.length === 2);
  click($('[data-tab="areas"]')); await tick();
  click($('[data-action="edit-area"]')); await tick();
  $$('input[name="workerIds"]').forEach(i => { i.checked = true; });
  click(foot(1)); await tick();
  check('Trabajadores asignados al área completa', db().areas[0].workerIds.length === 2);

  // Sub-áreas: agregar bloque Orden (Frío) y Orden (Caliente)
  click($('[data-tab="checklists"]')); await tick();
  for (const sub of ['Caliente', 'Frío']) {
    click($('[data-action="add-block"]')); await tick();
    $('select[name="type"]').value = 'orden'; $('input[name="sub"]').value = sub; click(foot(1)); await tick();
  }
  check('Bloques con sub-área creados', db().areas[0].blocks.length === 4 && db().areas[0].blocks[3].sub === 'Frío');
  const blkId = db().areas[0].blocks[3].id;
  for (const txt of ['Mesas', 'Rejillas']) {
    const f = $(`[data-form="add-item"][data-block="${blkId}"]`); f.elements.text.value = txt; submit(f); await tick();
  }
  check('Ítems agregados al bloque', db().areas[0].blocks[3].items.length === 2);
  click($('[data-tab="params"]')); await tick();
  check('Parámetros globales por defecto (6)', db().params.length === 6);

  // Ajustes: evaluador
  click($('[data-tab="general"]')); await tick();
  const sf = $('[data-form="settings"]'); sf.elements.evaluator.value = 'Monitora Test'; submit(sf); await tick();

  // Inicio: evaluar
  await go('#/inicio');
  let m = $('[data-area] .status'); check('Área 1 inicia pendiente', m.textContent === 'Pendiente');
  const prog = $('[data-area] .ah-prog').textContent;
  check('Barra: total = ítems + trabajadores (5+5+0+2+2 = 14)', /0 \/ 14 checks evaluados/.test(prog));

  // Marcar ✓ en los primeros 4 de limpieza
  for (let i = 0; i < 4; i++) click($$('[data-area] [data-action="mark"][data-s="ok"]')[i]);
  check('Estado pasa a En revisión', $('[data-area] .status').textContent === 'En revisión');
  // Marcar ✗ en el 5º (Limpieza) → aparece campo de observación
  click($$('[data-area] [data-action="mark"][data-s="nok"]')[4]); await tick();
  check('Al marcar ✗ aparece campo de observación', !!$('[data-obs-input]'));
  // Intentar guardar sin observación → bloqueado
  click($('[data-action="save-audit"]')); await tick(40);
  check('Guardar bloqueado sin observación/foto', db().audits.length === 0 && $('.obs-in.invalid'));
  typeIn($('[data-obs-input]'), 'Residuo en pisos');
  await tick(450);
  // Marcar ausente al trabajador 2 y evaluar trabajador 1
  const rows = $$('.wrow');
  check('Dos filas de trabajadores con botones Ausente y Evaluar', rows.length === 2 && rows[0].querySelector('[data-action="absent"]') && rows[0].querySelector('[data-action="eval-worker"]'));
  click($$('[data-action="absent"]')[1]); await tick();
  check('Trabajador marcado ausente', $('.wrow .chip.warn') && /Ausente/.test($('.wrow .chip.warn').textContent));
  check('Ausente se excluye del total (14 → 13)', /\/ 13 checks/.test($('[data-area] .ah-prog').textContent));
  click($$('[data-action="eval-worker"]')[0]); await tick();
  check('Modal de higiene abre con 6 parámetros', $$('.wtable tbody tr [data-wp]').length === 18);
  // guardar incompleto → rechaza
  click(foot(1)); await tick();
  check('Guardar check incompleto es rechazado', !!$('.wtable'));
  const setWp = (pid, s) => click($$('[data-wp="' + pid + '"][data-s="' + s + '"]')[0]);
  const pids = db().params.map(p => p.id);
  setWp(pids[0], 'ok'); setWp(pids[1], 'ok'); setWp(pids[2], 'na'); setWp(pids[3], 'ok'); setWp(pids[4], 'ok'); setWp(pids[5], 'nok'); await tick();
  check('Porcentaje en modal = 80% (4 de 5, N/A excluido)', /80%/.test($('.wfoot-pct').textContent));
  check('No cumple abre observación', !!$('[data-wp-obs]'));
  click(foot(1)); await tick();
  check('No cumple sin observación/foto es rechazado', !!$('.wtable'));
  typeIn($('[data-wp-obs]'), 'Herida sin cubrir');
  click(foot(1)); await tick();
  check('Check de trabajador guardado en borrador', !$('.wtable') && /Evaluado 80%/.test($('.wrow').textContent));
  check('Botón cambia a Editar', $$('[data-action="eval-worker"]')[0].textContent === 'Editar');
  check('Progreso ahora 6 / 13 (5 ítems + 1 trabajador)', /6 \/ 13 checks/.test($('[data-area] .ah-prog').textContent));

  // Guardar con pendientes → confirmación
  click($('[data-action="save-audit"]')); await tick(40);
  check('Confirmación de pendientes (checks, áreas sin evaluar y ausentes)', $('.modal') && /sin evaluar/.test($('.modal').textContent) && /ausente/.test($('.modal').textContent));
  click(foot(0)); await tick();
  check('Cancelar no guarda', db().audits.length === 0);
  click($('[data-action="save-audit"]')); await tick(40);
  click(foot(1)); await tick(40);
  check('Auditoría guardada: 1 registro, 7 áreas', db().audits.length === 1 && db().audits[0].areas.length === 7);
  const aud = db().audits[0];
  check('Áreas no iniciadas guardadas como "No evaluada"', aud.areas.filter(r => r.notEvaluated).length === 6);
  const r0 = aud.areas[0], wb = r0.blocks.find(b => b.id === 'workers');
  check('Ausente registrado y entradas del trabajador', wb.absent.length === 1 && wb.entries.length === 6);
  check('Inicio reiniciado tras guardar', $$('.status.pending').length === 7 && /0 \/ \d+ checks/.test($('[data-area] .ah-prog').textContent));
  check('Aviso de auditoría de hoy ya guardada', !!$('.banner'));

  // Segunda sesión el mismo día: se combina, no duplica
  click($$('[data-action="mark"][data-s="ok"]')[0]); await tick();   // marca 1er ítem de Limpieza en área 1
  click($('[data-action="save-audit"]')); await tick(40);
  if ($('.modal')) { click(foot(1)); await tick(40); }
  check('Segundo guardado del día se combina (sigue 1 registro)', db().audits.length === 1);
  const r0b = db().audits[0].areas[0];
  check('Combinar conserva lo anterior (worker entries y limpieza previa)', r0b.blocks.find(b => b.id === 'workers').entries.length === 6 && r0b.blocks.find(b => b.type === 'limpieza').entries.length === 5);

  // Historial
  await go('#/historial');
  check('Historial: una fila por día', $$('[data-day]').length === 1);
  check('Fila muestra evaluador definido', /Monitora Test/.test($('.day-head').textContent));
  click($('[data-action="toggle-day"]')); await tick();
  check('Se muestran 7 tarjetas de área (6 "No evaluada")', $$('.hcard').length === 7 && $$('.hcard.na').length === 6);
  const card = $('.hcard:not(.na)');
  const blocksTxt = card.querySelector('.hc-blocks').textContent;
  check('Tarjeta: bloques Trabajadores/Limpieza/Orden (Caliente)/(Frío)', /Check Trabajadores/.test(blocksTxt) && /Check Orden \(Caliente\)/.test(blocksTxt) && /Check Orden \(Frío\)/.test(blocksTxt));
  check('Orden (Caliente) sin ítems muestra --%', /Check Orden \(Caliente\)--%/.test(blocksTxt.replace(/\s/g, '')) || /Caliente\)\s*--%/.test(blocksTxt));
  check('Observaciones: hallazgo Limpieza + trabajador con acción correctiva', /Limpieza • /.test(card.textContent) && /Trabajador: Trabajador TF 1 • Sin heridas/.test(card.textContent) && /Residuo en pisos/.test(card.textContent) && /Herida sin cubrir/.test(card.textContent));
  // porcentaje general = promedio de bloques
  const nums = [...card.querySelectorAll('.hc-b b')].map(b => parseInt(b.textContent)).filter(n => !isNaN(n));
  const expected = Math.round(nums.reduce((s, x) => s + x, 0) / nums.length);
  check(`Porcentaje general (${card.querySelector('.hc-main strong').textContent}) = promedio de bloques (${expected}%)`, parseInt(card.querySelector('.hc-main strong').textContent) === expected);
  click(card.querySelector('[data-action="toggle-obs"]')); await tick();
  check('Observaciones se pliegan', !$('.hcard:not(.na) .find'));
  click($('.hcard:not(.na) [data-action="toggle-obs"]')); await tick();

  // Filtros
  const q = $('[data-hist="q"]'); typeIn(q, 'zzz'); await tick();
  check('Filtro sin coincidencias', $$('[data-day]').length === 0);
  typeIn(q, 'trabajador tf 1'); await tick();
  check('Filtro por trabajador', $$('[data-day]').length === 1);
  typeIn(q, ''); const sel = $('[data-hist="only"]'); sel.value = 'ok'; sel.dispatchEvent(new w.Event('input', { bubbles: true })); await tick();
  check('Filtro "Sin hallazgos" excluye día con hallazgos', $$('[data-day]').length === 0);
  click($('[data-action="hist-clear"]')); await tick();

  // Editar auditoría
  click($('[data-action="edit-aud"]')); await tick();
  const first = $$('[data-ea-s]')[0]; first.value = 'nok';
  click(foot(1)); await tick();
  check('Editar: exige observación al pasar a no conforme', !!$('[data-ea-s]'));
  $$('[data-ea-o]')[0].value = 'Editado'; click(foot(1)); await tick();
  check('Editar: cambios guardados', JSON.stringify(db().audits[0]).includes('Editado'));

  // Datos de ejemplo + Resumen
  await go('#/config'); click($('[data-tab="general"]')); await tick();
  click($('[data-action="load-sample"]')); await tick();
  check('Datos de ejemplo cargados (≈40 días, uno por día)', db().audits.length > 35 && new Set(db().audits.map(a => a.date)).size === db().audits.length);
  for (const p of ['day', 'week', 'month', 'year']) { await go('#/resumen'); click($(`[data-action="period"][data-p="${p}"]`)); await tick(); check(`Resumen ${p} renderiza`, !!$('.kpis') || !!$('.empty')); }
  click($('[data-action="period"][data-p="month"]')); await tick();
  check('Resumen mes: KPIs + tendencia + barras', !!$('.kpis') && !!$('svg.trend') && $$('.bar-row').length >= 4);
  click($('[data-action="period"][data-p="month"]')); await tick();
  click($('[data-action="report"]')); await tick();
  check('Informe: vista previa y días', !!$('#reportPreview .report') && $$('[data-rday]').length > 0);
  const days = $$('[data-rday]'); days[0].checked = false; days[0].dispatchEvent(new w.Event('change', { bubbles: true })); await tick();
  click(foot(1)); await tick();
  check('Informe: imprimir', w.__printed === true && !!$('#printArea .report'));
  click(foot(0)); await tick();
  await go('#/historial');
  check('Historial con datos de ejemplo: varias filas, ordenadas', $$('[data-day]').length > 30);
  click($$('[data-action="toggle-day"]')[3]); await tick();
  check('Día de ejemplo muestra tarjetas', $$('.hcard').length >= 7);
  await go('#/config'); click($('[data-tab="general"]')); await tick();
  click($('[data-action="remove-sample"]')); await tick();
  check('Quitar ejemplo deja el registro real', db().audits.length === 1);

  // XSS
  click($('[data-tab="workers"]')); await tick();
  click($('[data-action="add-worker"]')); await tick();
  $('input[name="name"]').value = '<img src=x onerror=alert(1)>'; click(foot(1)); await tick();
  check('Texto de usuario escapado', !$('#view img'));

  /* ===== Fotos: miniatura y ampliación ===== */
  const base = JSON.parse(JSON.stringify(db()));
  const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';
  base.audits[0].areas[0].blocks.find(b => b.type === 'limpieza').entries.forEach(e => { if (e.status === 'nok') e.photos = [tiny]; });
  base.audits[0].areas[0].blocks[1].entries.push({ k: 'zz', text: 'Con foto', status: 'nok', obs: '', photos: [tiny] });
  const t2 = boot({ sc_data_v2: JSON.stringify(base) }); await t2.tick();
  await t2.go('#/historial');
  t2.click(t2.$('[data-action="toggle-day"]')); await t2.tick();
  const th = t2.$('.hcard .f-ph .thumb');
  check('Foto: miniatura visible en observaciones', !!th);
  t2.click(th); await t2.tick();
  check('Foto: se amplía al tocar (lightbox)', !!t2.$('.lightbox img') && t2.$('.lightbox img').src.startsWith('data:image/jpeg'));
  t2.click(t2.$('.lightbox')); await t2.tick();
  check('Foto: lightbox se cierra', !t2.$('.lightbox'));
  check('Hallazgo sin texto muestra "Sin observación registrada"', /Sin observación registrada/.test(t2.$('.hcard').textContent));

  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sin errores de consola'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
