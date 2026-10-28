(() => {
'use strict';

/* =====================================================================
   Sistema de Calidad — Control de Auditorías e Inspecciones  (v2)
   HTML + CSS + JS puro. Los datos se guardan en LocalStorage.
   ===================================================================== */

/* ---------- Utilidades y constantes ----------
   Viven en src/lib/util.js y src/lib/constants.js (se cargan antes). */
const svg = (inner, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const CAMERA = svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>');
const WARN = svg('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>', 14);
const CAL = svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');

/* ---------- Almacenamiento (a través de la capa de datos) ---------- */
/* Las claves ya viven en src/data/local-storage-provider.js.
   Acá solo se usan las operaciones de alto nivel de AppData. */

/* ---------- Modelo de datos ----------
   seed(), normalizeDB(), migrateV1() y los valores por defecto viven en
   src/data/model.js. Acá solo se usan. */

/* ---------- Estado de datos ----------
   db, drafts y files se llenan en hydrate() antes del primer render. */
let db = seed();
let drafts = {};
let files = [];

async function hydrate() {
  const v2 = await AppData.loadDB();
  if (v2) {
    db = normalizeDB(v2);
  } else {
    const v1 = await AppData.loadLegacyDB();
    db = v1 ? normalizeDB(migrateV1(v1)) : seed();
    await save();
  }
  drafts = (await AppData.loadDrafts()) || {};
  files = (await AppData.loadFiles()) || [];
}

let savedTimer = null;
/* Aviso discreto de "Guardado" en la barra superior. */
function flashSaved() {
  const el = $('#saveState');
  if (!el) return;
  el.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.hidden = true; }, 1500);
}

async function save() {
  try { await AppData.saveDB(db); flashSaved(); return true; }
  catch (e) { toast(e.message || 'No se pudo guardar.', 'error'); return false; }
}

/* Los borradores no se escriben en cada clic: con fotos, cada escritura
   puede pesar varios MB. Se agrupan y se escriben a los 400 ms. */
let draftsDirty = false;

async function saveDrafts() {
  try { await AppData.saveDrafts(drafts); draftsDirty = false; flashSaved(); return true; }
  catch (e) { toast(e.message || 'No se pudo guardar el borrador.', 'error'); return false; }
}

const saveDraftsSoon = debounce(() => { if (draftsDirty) saveDrafts(); }, 400);
const markDrafts = () => { draftsDirty = true; saveDraftsSoon(); };

/* Escribe ya lo pendiente: al guardar la auditoría, cambiar de pantalla
   o cerrar la pestaña. */
async function flushDrafts() {
  if (!draftsDirty) return;
  saveDraftsSoon.cancel();
  await saveDrafts();
}

const dEnsure = id => { const d = drafts[id] = drafts[id] || {}; d.checks = d.checks || {}; d.workers = d.workers || {}; return d; };

/* ---------- Estado de la interfaz ---------- */
const ui = {
  openAreas: new Set(), openDays: new Set(), closedObs: new Set(), invalid: new Set(), init: false,
  hist: { q: '', area: '', from: '', to: '', only: '' },
  sum: { period: 'week', ref: todayISO() },
  cfgTab: 'areas', cfgArea: ''
};

/* ---------- Cálculos ---------- */
const bossName = id => (db.bosses.find(b => b.id === id) || {}).name || '';
const pct = entries => {
  const r = entries.filter(e => e.status === 'ok' || e.status === 'nok');
  return r.length ? Math.round(r.filter(e => e.status === 'ok').length / r.length * 100) : null;
};
const pctClass = p => p === null || p === undefined ? 'none' : p >= db.settings.goal ? 'ok' : p >= db.settings.goal - 15 ? 'warn' : 'nok';
const pillHTML = p => `<span class="pill ${pctClass(p)}">${p === null ? 'Sin datos' : p + '%'}</span>`;
const blockPct = b => pct(b.entries);
const areaPct = r => r.notEvaluated ? null : avg((r.blocks || []).map(blockPct).filter(p => p !== null));

/* Modelo de una área a partir del borrador actual de Inicio */
function areaModel(a) {
  const d = drafts[a.id] || {}, checks = d.checks || {}, wst = d.workers || {};
  const workers = a.workerIds.map(id => db.workers.find(w => w.id === id)).filter(Boolean).map(w => ({ w, st: wst[w.id] || null }));
  const blocks = a.blocks.map(b => ({ b, label: blockLabel(b), items: b.items.map(it => ({ it, key: `${b.id}|${it.id}`, ans: checks[`${b.id}|${it.id}`] || null })) }));
  let total = 0, done = 0;
  blocks.forEach(x => x.items.forEach(i => { total++; if (i.ans) done++; }));
  const active = workers.filter(x => !(x.st && x.st.st === 'absent'));
  const absent = workers.length - active.length;
  total += active.length; done += active.filter(x => x.st && x.st.st === 'done').length;
  const touched = done > 0 || absent > 0;
  const status = total > 0 && done === total ? 'done' : touched ? 'review' : 'pending';
  const wEntries = [];
  workers.forEach(({ st }) => { if (st && st.st === 'done') db.params.forEach(p => { const r = st.items[p.id]; if (r) wEntries.push({ status: r.s }); }); });
  const wPct = pct(wEntries);
  const bPcts = blocks.map(x => pct(x.items.filter(i => i.ans).map(i => ({ status: i.ans.s }))));
  const general = avg([...(workers.length ? [wPct] : []), ...bPcts].filter(p => p !== null));
  return { a, workers, blocks, total, done, absent, touched, status, wPct, bPcts, general };
}

/* ---------- Toasts, modales y lightbox ---------- */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function openLightbox(src) {
  const el = document.createElement('div'); el.className = 'lightbox';
  const img = document.createElement('img'); img.src = src; img.alt = 'Foto adjunta';
  const x = document.createElement('button'); x.className = 'icon-btn'; x.textContent = '×'; x.setAttribute('aria-label', 'Cerrar');
  el.append(img, x); el.addEventListener('click', () => el.remove()); document.body.appendChild(el);
}

let modalDismiss = null;
let modalPrevFocus = null;

function closeModal() {
  $('#modalRoot').innerHTML = '';
  const f = modalDismiss; modalDismiss = null;
  if (f) f();
  if (modalPrevFocus) {
    const el = modalPrevFocus;
    modalPrevFocus = null;
    try { el.focus({ preventScroll: true }); } catch (e) { /* el elemento ya no existe */ }
  }
}
function modal({ title, titleHTML, body, buttons = [], size = '', wide = false, onOpen, onDismiss }) {
  const root = $('#modalRoot');
  modalPrevFocus = document.activeElement;
  root.innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h3>${titleHTML || esc(title)}</h3><button class="icon-btn" data-m="close" aria-label="Cerrar">×</button></div>
    <div class="modal-body">${body}</div><div class="modal-foot"></div></div></div>`;
  modalDismiss = onDismiss || null;
  const m = $('.modal', root), foot = $('.modal-foot', root);
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.onclick = async () => {
      const r = b.onClick ? await b.onClick(m) : undefined;
      if (r !== false) { modalDismiss = null; $('#modalRoot').innerHTML = ''; if (b.dismiss && onDismiss) onDismiss(); }
    };
    foot.appendChild(el);
  });
  $('[data-m=close]', root).onclick = closeModal;
  $('.overlay', root).addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) closeModal(); });
  if (onOpen) onOpen(m);
}
document.addEventListener('keydown', e => {
  const lightbox = $('.lightbox');
  if (e.key === 'Escape') {
    if (lightbox) { lightbox.remove(); return; }
    if ($('.overlay')) closeModal();
    return;
  }
  /* Tab no se escapa del diálogo abierto. */
  if (e.key !== 'Tab' || lightbox) return;
  const box = $('.modal');
  if (!box) return;
  const focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', box)
    .filter(el => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  const outside = !box.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || outside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || outside)) { e.preventDefault(); first.focus(); }
});

const confirmBox = (msg, ok = 'Confirmar', danger = false, title = 'Confirmar') => new Promise(res => {
  modal({
    title, body: msg.split('\n').map(l => `<p style="margin-bottom:6px">${esc(l)}</p>`).join(''), onDismiss: () => res(false),
    buttons: [{ label: 'Cancelar', dismiss: true }, { label: ok, cls: danger ? 'danger' : 'primary', onClick: () => { res(true); } }]
  });
});

function fieldHTML(f, val) {
  const v = val ?? f.default ?? '';
  const req = f.required ? 'required' : '';
  const label = `<span>${esc(f.label)}${f.required ? ' *' : ''}</span>`;
  if (f.type === 'select')
    return `<label class="field">${label}<select name="${f.name}" ${req}>${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
  if (f.type === 'checkboxes') {
    const sel = new Set(val || []);
    return `<div class="field">${label}<div class="checks">${f.options.length ? f.options.map(o => `<label><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${sel.has(o.value) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('') : `<span class="muted">${esc(f.empty || 'Sin opciones disponibles')}</span>`}</div></div>`;
  }
  return `<label class="field">${label}<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${req}></label>`;
}
function formModal({ title, fields, values = {}, submitLabel = 'Guardar', onSubmit }) {
  modal({
    title, body: `<form class="form" onsubmit="return false">${fields.map(f => fieldHTML(f, values[f.name])).join('')}</form>`,
    buttons: [{ label: 'Cancelar' }, {
      label: submitLabel, cls: 'primary', onClick: m => {
        const form = $('form', m);
        if (!form.reportValidity()) return false;
        const data = {};
        fields.forEach(f => {
          if (f.type === 'checkboxes') data[f.name] = $$(`input[name="${f.name}"]:checked`, form).map(i => i.value);
          else data[f.name] = form.elements[f.name].value.trim();
        });
        return onSubmit(data);
      }
    }],
    onOpen: m => { const first = $('input[type=text],input:not([type]),textarea', m); if (first) first.focus(); }
  });
}

/* ---------- Fotos ----------
   compressImage() y thumbsHTML() viven en src/lib/photos.js. */

/* =====================================================================
   VISTA: INICIO
   ===================================================================== */
function overallStats() {
  const ms = db.areas.map(areaModel);
  return { total: ms.reduce((s, m) => s + m.total, 0), done: ms.reduce((s, m) => s + m.done, 0), areasDone: ms.filter(m => m.status === 'done').length, n: ms.length };
}
const overallHTML = () => { const o = overallStats(); return `<strong>Auditoría de hoy:</strong> ${o.done}/${o.total} checks · ${o.areasDone} de ${o.n} ${plural(o.n, 'área completada', 'áreas completadas')}`; };

function viewInicio() {
  if (!db.areas.length) return emptyState('Aún no hay áreas', 'Crea las áreas del supermercado y sus checklists en Configuración.', 'Ir a Configuración', '#/config');
  if (!ui.init) { ui.init = true; ui.openAreas.add(db.areas[0].id); }
  const today = db.audits.find(r => r.date === todayISO());
  return `${today ? `<div class="banner">Ya hay una auditoría guardada hoy (${fmtTime(today.ts)}). Al guardar, los resultados nuevos se combinarán con ella: no se crea otra fila en el Historial.</div>` : ''}
    <div class="toolbar"><div class="chip" id="overall">${overallHTML()}</div></div>
    <div id="areaList">${db.areas.map(areaCardHTML).join('')}</div>
    <div class="save-bar">
      <button class="btn ghost" data-action="discard">Descartar borrador</button>
      <button class="btn primary big" data-action="save-audit">${svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>', 18)} Guardar Auditoría Completa en Historial</button>
    </div>`;
}

function areaCardHTML(a) {
  const m = areaModel(a), open = ui.openAreas.has(a.id);
  const idx = Math.max(0, db.areas.findIndex(x => x.id === a.id));
  const p = m.total ? Math.round(m.done / m.total * 100) : 0;
  return `<section class="card area ${open ? 'open' : ''} ${m.status === 'done' ? 'is-done' : ''}" data-area="${a.id}">
    <button class="area-head" data-action="toggle-area" data-id="${a.id}" aria-expanded="${open}">
      <span class="ah-top"><span class="ico" style="--c:${COLORS[idx % COLORS.length]}">${svg(ICONS[idx % ICONS.length], 17)}</span>
        <h3>${esc(a.name)}</h3><span class="status ${m.status}">${STATUS_LABEL[m.status]}</span><span class="chev"></span></span>
      <span class="ah-prog"><span>Progreso general: <b>${p}%</b>${m.absent ? ` · ${m.absent} ${plural(m.absent, 'ausente', 'ausentes')}` : ''}</span><span>${m.done} / ${m.total} checks evaluados</span></span>
      <span class="bar"><i style="width:${p}%"></i></span>
    </button>
    ${open ? `<div class="area-body"><div class="blocks">${workersCardHTML(m)}${m.blocks.map((x, i) => blockCardHTML(m, x, m.bPcts[i])).join('')}</div></div>` : ''}
  </section>`;
}

function workersCardHTML(m) {
  const a = m.a;
  if (!m.workers.length)
    return `<div class="bcard"><div class="bhead"><h4>Check Trabajadores</h4></div><p class="hint">Esta área no tiene trabajadores asignados. Asígnalos en Configuración → Áreas.</p></div>`;
  return `<div class="bcard"><div class="bhead"><h4>Check Trabajadores</h4><div class="pctbox">% GENERAL<b class="p-${pctClass(m.wPct)}">${pctText(m.wPct)}</b></div></div>
    ${m.workers.map(({ w, st }) => {
      const items = st && st.st === 'done' ? db.params.map(p => st.items[p.id]).filter(Boolean).map(r => ({ status: r.s })) : [];
      const wp = pct(items), absent = st && st.st === 'absent', done = st && st.st === 'done';
      return `<div class="wrow"><div class="wtop"><span class="wname">${esc(w.name)}</span>
        ${absent ? '<span class="chip warn">Ausente</span>' : done ? `<span class="chip ok">Evaluado ${pctText(wp)}</span>` : ''}</div>
        <div class="wbtns"><button class="btn ${absent ? 'on-warn' : ''}" data-action="absent" data-id="${a.id}" data-w="${w.id}" aria-pressed="${!!absent}">${absent ? 'Quitar ausencia' : 'Ausente'}</button>
        <button class="btn primary" data-action="eval-worker" data-id="${a.id}" data-w="${w.id}">${done ? 'Editar' : 'Evaluar'}</button></div></div>`;
    }).join('')}</div>`;
}

function blockCardHTML(m, x, p) {
  const a = m.a, d = (drafts[a.id] || {}).checks || {};
  if (!x.items.length) return `<div class="bcard"><div class="bhead"><h4>${esc(x.label)}</h4></div><p class="hint">Sin ítems. Agrégalos en Configuración → Checklists.</p></div>`;
  return `<div class="bcard"><div class="bhead"><h4>${esc(x.label)}</h4><div class="pctbox">% ${x.b.type === 'orden' ? 'ORDEN' : 'LIMPIEZA'}<b class="p-${pctClass(p)}">${pctText(p)}</b></div></div>
    <div class="cgrid"><span class="ch">Ítem</span><span class="ch c ok">✓</span><span class="ch c nok">✕</span>
    ${x.items.map(i => {
      const st = i.ans ? i.ans.s : '', attrs = `data-id="${a.id}" data-key="${esc(i.key)}"`, bad = ui.invalid.has(i.key);
      return `<span class="crow-name ${bad ? 'invalid' : ''}">${esc(i.it.text)}</span>
        <button class="rd ok ${st === 'ok' ? 'on' : ''}" data-action="mark" data-s="ok" ${attrs} aria-pressed="${st === 'ok'}" aria-label="Conforme: ${esc(i.it.text)}"></button>
        <button class="rd nok ${st === 'nok' ? 'on' : ''}" data-action="mark" data-s="nok" ${attrs} aria-pressed="${st === 'nok'}" aria-label="No conforme: ${esc(i.it.text)}"></button>
        ${st === 'nok' ? `<div class="full obs-row"><input type="text" class="obs-in ${bad ? 'invalid' : ''}" data-obs-input ${attrs} value="${esc(i.ans.o)}" placeholder="Observación / Acción Correctiva" aria-label="Observación">
          <label class="photo-btn" title="Adjuntar foto" aria-label="Adjuntar foto">${CAMERA}<input type="file" accept="image/*" hidden data-photo-input ${attrs}></label>
          ${thumbsHTML(i.ans.p, n => `data-action="rm-photo" ${attrs} data-i="${n}"`)}</div>` : ''}`;
    }).join('')}</div></div>`;
}

function redrawArea(id) {
  const a = db.areas.find(x => x.id === id), el = $(`[data-area="${id}"]`);
  if (a && el) el.outerHTML = areaCardHTML(a);
  const o = $('#overall'); if (o) o.innerHTML = overallHTML();
}

/* ----- Evaluación de un trabajador (parámetros globales) ----- */
function workerModal(areaId, wid) {
  const w = db.workers.find(x => x.id === wid);
  if (!db.params.length) return toast('Primero define los parámetros de personal en Configuración.', 'error');
  const cur = ((((drafts[areaId] || {}).workers || {})[wid]) || {}).items || {};
  const st = {}; db.params.forEach(p => { const c = cur[p.id]; st[p.id] = c ? { s: c.s, o: c.o || '', p: [...(c.p || [])] } : null; });
  let bad = null;
  const calc = () => pct(Object.values(st).filter(Boolean).map(x => ({ status: x.s })));
  const body = () => {
    const c = calc();
    return `<table class="wtable"><thead><tr><th>Parámetros globales</th><th class="c-ok">Cumple</th><th class="c-nok">No cumple</th><th>N/A</th></tr></thead><tbody>
      ${db.params.map(p => {
        const x = st[p.id];
        return `<tr class="${bad === p.id ? 'invalid' : ''}"><td>${esc(p.text)}</td>${[['ok', 'Cumple'], ['nok', 'No cumple'], ['na', 'N/A']].map(([s, l]) =>
          `<td><button type="button" class="rd ${s} ${x && x.s === s ? 'on' : ''}" data-wp="${p.id}" data-s="${s}" aria-pressed="${!!(x && x.s === s)}" aria-label="${l}: ${esc(p.text)}"></button></td>`).join('')}</tr>
          ${x && x.s === 'nok' ? `<tr class="obs-tr"><td colspan="4"><div class="obs-row"><input type="text" class="obs-in ${bad === p.id ? 'invalid' : ''}" data-wp-obs="${p.id}" value="${esc(x.o)}" placeholder="Observación / Acción Correctiva para ${esc(p.text)}" aria-label="Observación">
            <label class="photo-btn" title="Adjuntar foto" aria-label="Adjuntar foto">${CAMERA}<input type="file" accept="image/*" hidden data-wp-photo="${p.id}"></label>
            ${thumbsHTML(x.p, n => `data-wp-rm="${p.id}" data-i="${n}"`)}</div></td></tr>` : ''}`;
      }).join('')}</tbody></table>
      <div class="wfoot-pct">PORCENTAJE<b class="p-${pctClass(c)}">${c === null ? '—' : c + '%'}</b></div>`;
  };
  const draw = () => { const m = $('.modal'); if (m) $('.modal-body', m).innerHTML = body(); };
  modal({
    title: `Higiene · ${w.name}`, titleHTML: `Higiene · <span>${esc(w.name)}</span>`, size: 'mid', body: body(),
    buttons: [{ label: 'Cancelar' }, {
      label: 'Guardar Check', cls: 'primary', onClick: async () => {
        const miss = db.params.find(p => !st[p.id]);
        if (miss) { bad = miss.id; draw(); toast('Marca todos los parámetros (usa N/A si no aplica).', 'error'); return false; }
        const noObs = db.params.find(p => st[p.id].s === 'nok' && !st[p.id].o.trim() && !st[p.id].p.length);
        if (noObs) { bad = noObs.id; draw(); toast('Agrega una observación o una foto en lo que no cumple.', 'error'); return false; }
        dEnsure(areaId).workers[wid] = { st: 'done', items: st };
        await saveDrafts(); redrawArea(areaId);
      }
    }],
    onOpen: m => {
      m.addEventListener('click', e => {
        const b = e.target.closest('[data-wp]');
        if (b) {
          const pid = b.dataset.wp, s = b.dataset.s, x = st[pid];
          st[pid] = x && x.s === s ? null : { s, o: x && s === 'nok' ? x.o : '', p: x && s === 'nok' ? x.p : [] };
          bad = null; return draw();
        }
        const rm = e.target.closest('[data-wp-rm]');
        if (rm) { st[rm.dataset.wpRm].p.splice(Number(rm.dataset.i), 1); draw(); }
      });
      m.addEventListener('input', e => { const t = e.target; if (t.dataset.wpObs) { st[t.dataset.wpObs].o = t.value; t.classList.remove('invalid'); } });
      m.addEventListener('change', async e => {
        const t = e.target; if (!t.dataset.wpPhoto) return;
        const f = t.files[0]; t.value = ''; if (!f) return;
        const x = st[t.dataset.wpPhoto];
        if (x.p.length >= MAX_PHOTOS) return toast(`Máximo ${MAX_PHOTOS} fotos por ítem.`, 'error');
        try { x.p.push(await compressImage(f)); draw(); } catch (err) { toast('No se pudo leer la imagen.', 'error'); }
      });
    }
  });
}

/* ----- Guardar la auditoría completa ----- */
function buildAreaResult(a) {
  const m = areaModel(a), boss = bossName(a.bossId);
  if (!m.touched) return { areaId: a.id, areaName: a.name, boss, notEvaluated: true, total: m.total, done: 0 };
  const blocks = [];
  if (m.workers.length) {
    const entries = [], absent = [];
    m.workers.forEach(({ w, st }) => {
      if (st && st.st === 'absent') absent.push({ id: w.id, name: w.name });
      else if (st && st.st === 'done') db.params.forEach(p => { const r = st.items[p.id]; if (r) entries.push({ k: p.id, w: w.id, worker: w.name, text: p.text, status: r.s, obs: r.o || '', photos: r.p || [] }); });
    });
    blocks.push({ id: 'workers', type: 'trabajadores', label: 'Check Trabajadores', entries, absent });
  }
  m.blocks.forEach(x => blocks.push({ id: x.b.id, type: x.b.type, label: x.label,
    entries: x.items.filter(i => i.ans).map(i => ({ k: i.it.id, text: i.it.text, status: i.ans.s, obs: i.ans.o || '', photos: i.ans.p || [] })) }));
  return { areaId: a.id, areaName: a.name, boss, notEvaluated: false, total: m.total, done: m.done, blocks };
}
const resultDone = r => r.notEvaluated ? 0 : r.blocks.reduce((n, b) => n + (b.type === 'trabajadores' ? new Set(b.entries.map(e => e.w)).size : b.entries.length), 0);

function mergeResult(old, nw) {
  if (nw.notEvaluated) return old;
  if (old.notEvaluated) return nw;
  const blocks = old.blocks.map(ob => ({ ...ob, entries: [...ob.entries], absent: ob.absent ? [...ob.absent] : undefined }));
  nw.blocks.forEach(nb => {
    const ob = blocks.find(x => x.id === nb.id);
    if (!ob) { blocks.push(nb); return; }
    const keyOf = e => `${e.w || ''}|${e.k}`;
    const map = new Map(ob.entries.map(e => [keyOf(e), e]));
    nb.entries.forEach(e => map.set(keyOf(e), e));
    ob.entries = [...map.values()]; ob.label = nb.label;
    if (nb.type === 'trabajadores') {
      const evald = new Set(ob.entries.map(e => e.w)), ab = new Map();
      [...(ob.absent || []), ...(nb.absent || [])].forEach(x => { if (!evald.has(x.id)) ab.set(x.id, x); });
      ob.absent = [...ab.values()];
    }
  });
  const merged = { ...nw, blocks }; merged.done = resultDone(merged);
  return merged;
}

/* Sube la auditoría a la nube después de guardarla aquí. Si algo falla,
   la copia del navegador ya está a salvo: solo se avisa. */
async function syncToCloud(aud) {
  if (!window.SupabaseWrite) return { skipped: 'sin-cliente' };
  try {
    const r = await SupabaseWrite.saveAudit(aud, db);
    if (r && r.ok) {
      aud.cloudId = r.auditId;
      aud.cloudSyncedAt = new Date().toISOString();
      try { await AppData.saveDB(db); } catch (e) { /* la copia local ya existe */ }
      if (r.failedPhotos) toast(`No se ${plural(r.failedPhotos, 'pudo', 'pudieron')} subir ${r.failedPhotos} ${plural(r.failedPhotos, 'foto', 'fotos')}.`, 'error');
      else toast(`También en la nube (${r.entries} ${plural(r.entries, 'check', 'checks')}${r.photos ? ` · ${r.photos} ${plural(r.photos, 'foto', 'fotos')}` : ''}).`);
    } else if (r && r.skipped === 'enviada') {
      toast('En la nube esta auditoría ya fue enviada; no se modificó.');
    } else if (r && r.skipped === 'rol') {
      toast('Tu rol no crea auditorías: quedó guardada en este navegador.');
    }
    return r || {};
  } catch (e) {
    toast(`Guardada en este navegador, pero no se pudo subir a la nube: ${e.message || 'error de conexión'}`, 'error');
    return { error: e.message || 'error' };
  }
}

async function saveAudit() {
  const models = db.areas.map(areaModel);
  if (!models.some(m => m.touched)) return toast('Aún no has evaluado nada.', 'error');
  /* Observación o foto obligatoria en cada "No conforme" */
  const missing = [];
  db.areas.forEach(a => { Object.entries((drafts[a.id] || {}).checks || {}).forEach(([k, v]) => { if (v.s === 'nok' && !(v.o || '').trim() && !(v.p || []).length) missing.push({ areaId: a.id, key: k }); }); });
  if (missing.length) {
    ui.invalid = new Set(missing.map(x => x.key)); missing.forEach(x => ui.openAreas.add(x.areaId));
    render(true);
    toast(`Falta la observación o una foto en ${missing.length} ${plural(missing.length, 'ítem no conforme', 'ítems no conformes')}.`, 'error');
    const first = $('.obs-in.invalid'); if (first) { first.scrollIntoView({ block: 'center' }); first.focus(); }
    return;
  }
  ui.invalid = new Set();
  /* Confirmación si quedan pendientes */
  const started = models.filter(m => m.touched), notStarted = models.filter(m => !m.touched);
  const pendChecks = started.reduce((s, m) => s + (m.total - m.done), 0);
  const absentN = models.reduce((s, m) => s + m.absent, 0);
  const lines = [];
  if (pendChecks) lines.push(`• ${pendChecks} ${plural(pendChecks, 'check sin evaluar', 'checks sin evaluar')} en áreas ya iniciadas.`);
  if (notStarted.length) lines.push(`• ${notStarted.length} ${plural(notStarted.length, 'área sin evaluar', 'áreas sin evaluar')}: ${notStarted.map(m => m.a.name).join(', ')}.`);
  if (absentN) lines.push(`• ${absentN} ${plural(absentN, 'trabajador ausente', 'trabajadores ausentes')} (quedará registrado).`);
  if (lines.length && !await confirmBox(`Hay pendientes en esta auditoría:\n${lines.join('\n')}\n¿Guardar de todas formas?`, 'Guardar igual', false, 'Hay pendientes')) return;

  const results = db.areas.map(buildAreaResult);
  const day = todayISO(), now = new Date().toISOString();
  const snapshot = JSON.stringify(db.audits);
  let aud = db.audits.find(r => r.date === day);
  if (aud) {
    const merged = db.areas.map((a, i) => { const old = aud.areas.find(r => r.areaId === a.id); return old ? mergeResult(old, results[i]) : results[i]; });
    const extra = aud.areas.filter(r => !db.areas.some(a => a.id === r.areaId));
    aud.areas = [...merged, ...extra]; aud.ts = now; aud.evaluator = db.settings.evaluator || aud.evaluator || '';
  } else {
    aud = { id: uid(), date: day, ts: now, evaluator: db.settings.evaluator, areas: results };
    db.audits.push(aud);
  }
  if (!await save()) { db.audits = JSON.parse(snapshot); return; }
  saveDraftsSoon.cancel(); drafts = {}; await saveDrafts(); ui.openAreas = new Set(); ui.init = false;
  render();
  toast('Auditoría guardada en el Historial.');
  await syncToCloud(aud);
}

/* =====================================================================
   VISTA: HISTORIAL
   ===================================================================== */
function viewHistorial() {
  const f = ui.hist;
  return `<div class="card filters">
    <label class="field grow"><span>Buscar</span><input type="search" data-hist="q" value="${esc(f.q)}" placeholder="Área, trabajador, observación, fecha…"></label>
    <label class="field"><span>Área</span><select data-hist="area"><option value="">Todas</option>${db.areas.map(a => `<option value="${a.id}" ${f.area === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Desde</span><input type="date" data-hist="from" value="${f.from}"></label>
    <label class="field"><span>Hasta</span><input type="date" data-hist="to" value="${f.to}"></label>
    <label class="field"><span>Resultado</span><select data-hist="only"><option value="">Todos</option><option value="nok" ${f.only === 'nok' ? 'selected' : ''}>Con hallazgos</option><option value="ok" ${f.only === 'ok' ? 'selected' : ''}>Sin hallazgos</option></select></label>
    <button class="btn" data-action="hist-clear">Limpiar filtros</button>
    <button class="btn" data-action="export-csv" title="Descarga las auditorías filtradas para Excel">Exportar CSV</button>
  </div><div id="histList">${histListHTML()}</div>`;
}

function areaFindings(r) {
  if (r.notEvaluated) return [];
  return r.blocks.flatMap(b => b.entries.filter(e => e.status === 'nok').map(e => ({
    label: b.type === 'trabajadores' ? `Trabajador: ${e.worker} • ${e.text}` : `${b.label.replace('Check ', '')} • ${e.text}`, obs: e.obs, photos: e.photos || []
  })));
}

function filteredAudits() {
  const f = ui.hist, q = norm(f.q), out = [];
  db.audits.forEach(a => {
    if ((f.from && a.date < f.from) || (f.to && a.date > f.to)) return;
    let areas = a.areas;
    if (f.area) areas = areas.filter(r => r.areaId === f.area && !r.notEvaluated);
    if (!areas.length) return;
    const hasNok = areas.some(r => areaFindings(r).length);
    if (f.only === 'nok' && !hasNok) return;
    if (f.only === 'ok' && (hasNok || areas.every(r => r.notEvaluated))) return;
    if (q) {
      const hay = norm([a.evaluator, a.date, fmtDate(a.date), ...areas.flatMap(r => [r.areaName, r.boss, ...(r.notEvaluated ? ['no evaluada'] : r.blocks.flatMap(b => [b.label, ...(b.absent || []).map(x => 'ausente ' + x.name), ...b.entries.flatMap(e => [e.text, e.worker, e.obs])]))])].join(' '));
      if (!hay.includes(q)) return;
    }
    out.push({ a, areas });
  });
  return out.sort((x, y) => y.a.date.localeCompare(x.a.date) || y.a.ts.localeCompare(x.a.ts));
}

function histListHTML() {
  if (!db.audits.length) return emptyState('Sin auditorías todavía', 'Cuando guardes una auditoría desde Inicio, aparecerá aquí.', 'Ir a Inicio', '#/inicio');
  const list = filteredAudits();
  if (!list.length) return `<div class="card empty"><h3>Sin resultados</h3><p>Prueba con otros filtros.</p></div>`;
  return `<div class="list-head"><span>${list.length} ${plural(list.length, 'auditoría', 'auditorías')}</span></div>${list.map(({ a, areas }) => dayCardHTML(a, areas)).join('')}`;
}

/* Al escribir en "Buscar" no hace falta redibujar en cada tecla. */
const refreshHist = debounce(() => {
  const list = $('#histList');
  if (list) list.innerHTML = histListHTML();
}, 180);

/* ---------- Exportar el historial filtrado a CSV (Excel) ---------- */
const CSV_HEADERS = ['Fecha', 'Hora', 'Evaluador', 'Área', 'Categoría', 'Ítem', 'Trabajador', 'Resultado', 'Observación', 'Fotos'];

function auditCsvRows(list) {
  const rows = [];
  list.forEach(({ a, areas }) => {
    const time = a.ts ? fmtTime(a.ts) : '';
    areas.forEach(r => {
      if (r.notEvaluated) {
        rows.push([a.date, time, a.evaluator || '', r.areaName, '', '— Área no evaluada', '', '', '', '']);
        return;
      }
      r.blocks.forEach(b => {
        const cat = CAT_LABEL[b.type] || b.type;
        b.entries.forEach(e => rows.push([
          a.date, time, a.evaluator || '', r.areaName, cat, e.text, e.worker || '',
          e.status === 'ok' ? 'Conforme' : e.status === 'nok' ? 'No conforme' : 'N/A',
          e.obs || '', (e.photos || []).length
        ]));
        (b.absent || []).forEach(x => rows.push([
          a.date, time, a.evaluator || '', r.areaName, cat, 'Trabajador ausente', x.name, 'Ausente', '', 0
        ]));
      });
    });
  });
  return rows;
}

function exportCsv() {
  const list = filteredAudits();
  if (!list.length) return toast('No hay auditorías para exportar con estos filtros.', 'error');
  const rows = auditCsvRows(list);
  if (!rows.length) return toast('No hay resultados para exportar.', 'error');
  SCExport.saveCsv(`auditorias-${todayISO()}.csv`, SCExport.build(CSV_HEADERS, rows));
  toast(`${rows.length} ${plural(rows.length, 'fila exportada', 'filas exportadas')} a CSV.`);
}

function dayCardHTML(a, areas) {
  const open = ui.openDays.has(a.id);
  const ev = areas.filter(r => !r.notEvaluated);
  const nf = ev.reduce((n, r) => n + areaFindings(r).length, 0);
  const p = avg(ev.map(areaPct).filter(x => x !== null));
  return `<article class="card day ${open ? 'open' : ''}" data-day="${a.id}">
    <button class="day-head" data-action="toggle-day" data-id="${a.id}" aria-expanded="${open}">
      <span class="datechip">${CAL} ${fmtDateSlash(a.date)}, ${fmtTime(a.ts)}</span>
      <span class="ev">Evaluador: <b>${esc(a.evaluator || 'Inspector no especificado')}</b></span>
      <span class="push">${nf ? `<span class="chip nok">${nf} ${plural(nf, 'hallazgo', 'hallazgos')}</span>` : '<span class="chip ok">Sin hallazgos</span>'}${pillHTML(p)}<span class="chev"></span></span>
    </button>
    ${open ? `<div class="day-body"><div class="hcards">${areas.map(r => histAreaCard(a, r)).join('')}</div>
      <div class="day-actions"><button class="btn sm" data-action="edit-aud" data-id="${a.id}">Editar</button><button class="btn sm danger" data-action="del-aud" data-id="${a.id}">Eliminar</button></div></div>` : ''}
  </article>`;
}

function histAreaCard(a, r) {
  if (r.notEvaluated)
    return `<div class="hcard na"><div class="hc-name"><b>${esc(r.areaName)}</b></div><div class="na-box"><b>No evaluada</b>Esta área no fue evaluada en esta auditoría.</div></div>`;
  const p = areaPct(r), fs = areaFindings(r), key = `${a.id}|${r.areaId}`, open = !ui.closedObs.has(key);
  const absent = r.blocks.flatMap(b => b.absent || []);
  const partial = r.total && resultDone(r) < r.total;
  return `<div class="hcard">
    <div class="hc-top">
      <div class="hc-main"><small>PORCENTAJE GENERAL DEL ÁREA</small><em>(${esc(r.areaName)})</em><strong class="p-${pctClass(p)}">${pctText(p)}</strong>${partial ? `<span class="chip warn">Parcial ${resultDone(r)}/${r.total}</span>` : ''}</div>
      <div class="hc-blocks">${r.blocks.map(b => { const bp = blockPct(b); return `<div class="hc-b"><span>${esc(b.label)}</span><b class="p-${pctClass(bp)}">${pctText(bp)}</b></div>`; }).join('')}</div>
    </div>
    ${absent.length ? `<div class="hc-abs">Ausentes: ${esc(absent.map(x => x.name).join(', '))}</div>` : ''}
    <div class="${open ? 'open' : ''}"><button class="hc-obs-head" data-action="toggle-obs" data-key="${esc(key)}" aria-expanded="${open}">Observaciones <span class="cnt">(${fs.length})</span><span class="chev"></span></button>
    ${open ? (fs.length ? fs.map(f => `<div class="find"><div class="f-top">${WARN}<span>${esc(f.label)}</span></div>
      <div class="f-act">Acción correctiva: ${f.obs ? esc(f.obs) : 'Sin observación registrada'}</div>
      ${f.photos.length ? `<div class="f-ph">${f.photos.map((p, i) => `<img class="thumb" src="${esc(p)}" alt="Foto ${i + 1}" data-action="zoom">`).join('')}</div>` : ''}</div>`).join('')
      : `<div class="allok">${partial ? 'Sin no conformidades en lo evaluado.' : '100% cumplido. No se registraron acciones correctivas.'}</div>`) : ''}</div>
  </div>`;
}

function editAuditModal(id) {
  const a = db.audits.find(x => x.id === id);
  let html = '';
  a.areas.forEach((r, ri) => {
    if (r.notEvaluated) return;
    html += `<div class="edit-group">${esc(r.areaName)}</div>`;
    r.blocks.forEach((b, bi) => b.entries.forEach((e, ei) => {
      const path = `${ri}.${bi}.${ei}`;
      html += `<div class="edit-row"><div>${esc(e.text)}<small>${esc(b.label)}${e.worker ? ' · ' + esc(e.worker) : ''}${(e.photos || []).length ? ' · con foto' : ''}</small></div>
        <select data-ea-s="${path}"><option value="ok" ${e.status === 'ok' ? 'selected' : ''}>Conforme</option><option value="nok" ${e.status === 'nok' ? 'selected' : ''}>No conforme</option>${b.type === 'trabajadores' ? `<option value="na" ${e.status === 'na' ? 'selected' : ''}>N/A</option>` : ''}</select>
        <input class="obs-in2" type="text" data-ea-o="${path}" value="${esc(e.obs)}" placeholder="Observación (o foto, si no cumple)"></div>`;
    }));
  });
  modal({
    title: `Editar auditoría · ${fmtDate(a.date)}`, wide: true,
    body: `<div class="form"><label class="field" style="max-width:260px"><span>Evaluador</span><input type="text" id="eaEv" value="${esc(a.evaluator)}"></label>${html || '<p class="muted">No hay áreas evaluadas para editar.</p>'}</div>`,
    buttons: [{ label: 'Cancelar' }, {
      label: 'Guardar cambios', cls: 'primary', onClick: async m => {
        const upd = [];
        for (const [ri, r] of a.areas.entries()) { if (r.notEvaluated) continue;
          for (const [bi, b] of r.blocks.entries()) for (const [ei, e] of b.entries.entries()) {
            const path = `${ri}.${bi}.${ei}`, s = $(`[data-ea-s="${path}"]`, m).value, o = $(`[data-ea-o="${path}"]`, m).value.trim();
            if (s === 'nok' && !o && !(e.photos || []).length) { $(`[data-ea-o="${path}"]`, m).focus(); toast('Falta la observación de un ítem no conforme.', 'error'); return false; }
            upd.push([e, s, s === 'nok' ? o : '']);
          } }
        upd.forEach(([e, s, o]) => { e.status = s; e.obs = o; if (s !== 'nok') e.photos = []; });
        a.evaluator = $('#eaEv', m).value.trim();
        await save(); render(true); toast('Auditoría actualizada.');
      }
    }]
  });
}

/* =====================================================================
   VISTA: RESUMEN
   ===================================================================== */
function periodRange(period, ref) {
  const d = parseISO(ref); let a, b;
  if (period === 'day') { a = b = d; }
  else if (period === 'week') { a = new Date(d); a.setDate(d.getDate() - (d.getDay() + 6) % 7); b = new Date(a); b.setDate(a.getDate() + 6); }
  else if (period === 'month') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  else { a = new Date(d.getFullYear(), 0, 1); b = new Date(d.getFullYear(), 11, 31); }
  return [isoDate(a), isoDate(b)];
}
function periodLabel(period, from, to) {
  const a = parseISO(from);
  if (period === 'day') return longDate(a);
  if (period === 'week') return `Semana del ${fmtDate(from)} al ${fmtDate(to)}`;
  if (period === 'month') return `${MONTHS[a.getMonth()][0].toUpperCase() + MONTHS[a.getMonth()].slice(1)} de ${a.getFullYear()}`;
  return `Año ${a.getFullYear()}`;
}
function shiftRef(dir) {
  const d = parseISO(ui.sum.ref), p = ui.sum.period;
  if (p === 'day') d.setDate(d.getDate() + dir);
  else if (p === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (p === 'month') d.setMonth(d.getMonth() + dir, 1);
  else d.setFullYear(d.getFullYear() + dir, 0, 1);
  ui.sum.ref = isoDate(d);
}

/* Cada "item" es una evaluación de un área en un día. */
function summaryData(daysFilter) {
  const [from, to] = periodRange(ui.sum.period, ui.sum.ref);
  const audits = db.audits.filter(a => a.date >= from && a.date <= to && (!daysFilter || daysFilter.includes(a.date)));
  const items = audits.flatMap(a => a.areas.filter(r => !r.notEvaluated).map(r => ({ date: a.date, r, p: areaPct(r) })));
  const byArea = [...new Set(items.map(i => i.r.areaId))].map(id => {
    const its = items.filter(i => i.r.areaId === id);
    return { id, name: its[0].r.areaName, count: its.length, checks: its.reduce((n, i) => n + i.r.blocks.reduce((m, b) => m + b.entries.length, 0), 0),
      nok: its.reduce((n, i) => n + areaFindings(i.r).length, 0), pct: avg(its.map(i => i.p).filter(x => x !== null)) };
  }).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  const byCat = ['trabajadores', 'limpieza', 'orden'].map(t => ({ name: CAT_LABEL[t], pct: avg(items.flatMap(i => i.r.blocks.filter(b => b.type === t).map(blockPct)).filter(x => x !== null)) }));
  const entries = items.flatMap(i => i.r.blocks.flatMap(b => b.entries.map(e => ({ ...e, type: b.type, label: b.label, area: i.r.areaName, date: i.date }))));
  const nokEntries = entries.filter(e => e.status === 'nok');
  const tally = (list, keyFn) => { const m = new Map(); list.forEach(e => { const k = keyFn(e); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
  return { from, to, audits, items, total: avg(items.map(i => i.p).filter(x => x !== null)), byArea, byCat, entries, nokEntries,
    topFindings: tally(nokEntries, e => `${e.text}||${e.area}`).slice(0, 6), topWorkers: tally(nokEntries.filter(e => e.worker), e => e.worker).slice(0, 5) };
}

function trendPoints(s) {
  const p = ui.sum.period; if (p === 'day') return [];
  const pts = [];
  if (p === 'year') {
    const y = parseISO(s.from).getFullYear();
    for (let m = 0; m < 12; m++) {
      const pre = `${y}-${pad(m + 1)}`;
      pts.push({ label: MONTHS[m].slice(0, 3), title: `${MONTHS[m]} ${y}`, value: avg(s.items.filter(i => i.date.startsWith(pre)).map(i => i.p).filter(x => x !== null)) });
    }
  } else {
    for (let d = parseISO(s.from); isoDate(d) <= s.to; d.setDate(d.getDate() + 1)) {
      const iso = isoDate(d);
      pts.push({ label: `${d.getDate()}`, title: fmtDate(iso), value: avg(s.items.filter(i => i.date === iso).map(i => i.p).filter(x => x !== null)) });
    }
  }
  return pts;
}

function trendSVG(pts) {
  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 26, n = pts.length;
  const x = i => L + (n <= 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
  const y = v => T + (100 - v) * (H - T - B) / 100;
  let g = '', path = '', prev = false;
  [0, 25, 50, 75, 100].forEach(v => { g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
  g += `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(db.settings.goal)}" y2="${y(db.settings.goal)}"/>`;
  pts.forEach((p, i) => { if (p.value === null) { prev = false; return; } path += `${prev ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)} `; prev = true; });
  const step = Math.ceil(n / 8);
  const labels = pts.map((p, i) => i % step === 0 ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>` : '').join('');
  const dots = pts.map((p, i) => p.value === null ? '' : `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5"><title>${esc(p.title)}: ${p.value}%</title></circle>`).join('');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendencia del cumplimiento">${g}<path class="line" d="${path}"/>${dots}${labels}</svg>`;
}

const barRow = (label, p) => `<div class="bar-row"><span class="bar-label" title="${esc(label)}">${esc(label)}</span>
  <div class="bar-track"><div class="bar-fill ${pctClass(p)}" style="width:${p ?? 0}%"></div><span class="bar-goal" style="left:${db.settings.goal}%" title="Meta ${db.settings.goal}%"></span></div>
  <span class="bar-val">${pctText(p)}</span></div>`;

function viewResumen() {
  const s = summaryData(), p = ui.sum.period;
  const periods = [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']];
  const head = `<div class="period-bar">
    <div class="seg">${periods.map(([k, l]) => `<button class="seg-btn ${p === k ? 'on' : ''}" data-action="period" data-p="${k}">${l}</button>`).join('')}</div>
    <button class="btn sm" data-action="period-nav" data-dir="-1" aria-label="Período anterior">‹</button>
    <input type="date" data-sum="ref" value="${ui.sum.ref}" aria-label="Fecha de referencia">
    <button class="btn sm" data-action="period-nav" data-dir="1" aria-label="Período siguiente">›</button>
    <div class="range"><strong>${esc(periodLabel(p, s.from, s.to))}</strong>Meta de cumplimiento: ${db.settings.goal}%</div>
    <button class="btn primary" data-action="report" ${s.items.length ? '' : 'disabled'}>Generar informe</button></div>`;
  if (!s.items.length) return head + `<div class="card empty"><h3>Sin auditorías en este período</h3><p>Cambia el período o la fecha, o guarda una auditoría desde Inicio.</p></div>`;
  const okN = s.entries.filter(e => e.status === 'ok').length;
  return head + `<div class="kpis">
    <div class="card kpi"><div class="label">Cumplimiento general</div><div class="value">${pctText(s.total)}</div><div class="sub2">${pillHTML(s.total)}</div></div>
    <div class="card kpi"><div class="label">Auditorías (días)</div><div class="value">${s.audits.length}</div><div class="sub2">${s.items.length} ${plural(s.items.length, 'evaluación de área', 'evaluaciones de área')}</div></div>
    <div class="card kpi"><div class="label">Checks evaluados</div><div class="value">${s.entries.length}</div><div class="sub2">${okN} conformes</div></div>
    <div class="card kpi"><div class="label">No conformidades</div><div class="value" style="color:${s.nokEntries.length ? 'var(--nok)' : 'inherit'}">${s.nokEntries.length}</div><div class="sub2">hallazgos registrados</div></div></div>
    <div class="grid-2">
      <div class="card panel"><h3>Cumplimiento por área<small>de menor a mayor</small></h3>${s.byArea.map(a => barRow(a.name, a.pct)).join('')}<p class="legend-note">La línea vertical marca la meta (${db.settings.goal}%).</p></div>
      <div class="card panel"><h3>Cumplimiento por categoría</h3>${s.byCat.map(c => barRow(c.name, c.pct)).join('')}
        ${p === 'day' ? '' : `<h3 style="margin-top:22px">Tendencia<small>${p === 'year' ? 'por mes' : 'por día'}</small></h3>${trendSVG(trendPoints(s))}`}</div>
    </div>
    <div class="grid-2">
      <div class="card panel"><h3>Hallazgos más repetidos</h3>${s.topFindings.length ? `<ul class="rank">${s.topFindings.map(([k, n]) => { const [t, a] = k.split('||'); return `<li><span>${esc(t)}<small>${esc(a)}</small></span><span class="count">${n}</span></li>`; }).join('')}</ul>` : '<p class="muted">Sin no conformidades en el período.</p>'}</div>
      <div class="card panel"><h3>Personal con más hallazgos</h3>${s.topWorkers.length ? `<ul class="rank">${s.topWorkers.map(([w, n]) => `<li><span>${esc(w)}</span><span class="count">${n}</span></li>`).join('')}</ul>` : '<p class="muted">Sin hallazgos asociados a personal.</p>'}</div>
    </div>`;
}

/* ----- Informe ----- */
function reportHTML(days) {
  const s = summaryData(days);
  return SCReport.html(s, {
    days,
    store: db.settings.store,
    evaluator: db.settings.evaluator,
    goal: db.settings.goal,
    periodText: periodLabel(ui.sum.period, s.from, s.to),
    today: todayISO()
  });
}

function openReport() {
  const s = summaryData(), days = s.audits.map(a => a.date).sort();
  modal({
    title: 'Generar informe', wide: true,
    body: `<p class="muted" style="margin-bottom:8px">Elige qué días incluir en el informe:</p>
      <div class="report-days">${days.map(d => `<label><input type="checkbox" data-rday value="${d}" checked> ${fmtDate(d)}</label>`).join('')}</div>
      <div id="reportPreview"></div>`,
    buttons: [{ label: 'Cerrar' }, {
      label: 'Imprimir / Guardar PDF', cls: 'primary', onClick: m => {
        const sel = $$('[data-rday]:checked', m).map(i => i.value);
        if (!sel.length) { toast('Selecciona al menos un día.', 'error'); return false; }
        $('#printArea').innerHTML = reportHTML(sel);
        window.print();
        return false;
      }
    }],
    onOpen: m => {
      const draw = () => { $('#reportPreview', m).innerHTML = reportHTML($$('[data-rday]:checked', m).map(i => i.value)); };
      m.addEventListener('change', e => { if (e.target.matches('[data-rday]')) draw(); });
      draw();
    }
  });
}
window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

/* =====================================================================
   VISTA: CONFIGURACIÓN
   ===================================================================== */
const CFG_TABS = [['areas', 'Áreas'], ['workers', 'Trabajadores'], ['bosses', 'Jefes responsables'], ['checklists', 'Checklists'], ['params', 'Parámetros de personal'], ['files', 'Archivos'], ['general', 'General']];

function viewConfig() {
  return `<div class="tabs" role="tablist">${CFG_TABS.map(([k, l]) => `<button class="tab ${ui.cfgTab === k ? 'active' : ''}" role="tab" data-action="cfg-tab" data-tab="${k}">${l}</button>`).join('')}</div>${cfgTabHTML()}`;
}
function cfgTabHTML() {
  return ({ areas: cfgAreas, workers: cfgWorkers, bosses: cfgBosses, checklists: cfgChecklists, params: cfgParams, files: cfgFiles, general: cfgGeneral })[ui.cfgTab]();
}
const sectionHead = (title, btn) => `<div class="section-head"><h2>${title}</h2>${btn || ''}</div>`;
const tableWrap = (heads, rows, empty) => rows.length
  ? `<div class="card table-wrap"><table class="table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<div class="card empty"><p>${empty}</p></div>`;
const rowBtns = (kind, id) => `<td class="actions"><button class="btn sm" data-action="edit-${kind}" data-id="${id}">Editar</button> <button class="btn sm ghost" data-action="del-${kind}" data-id="${id}">Eliminar</button></td>`;

function cfgAreas() {
  return sectionHead('Áreas del supermercado', `<button class="btn primary" data-action="add-area">+ Nueva área</button>`) +
    tableWrap(['Área', 'Responsable', 'Trabajadores', 'Bloques de checklist', ''], db.areas.map(a => `<tr>
      <td><strong>${esc(a.name)}</strong></td><td>${esc(bossName(a.bossId)) || '<span class="muted">—</span>'}</td>
      <td>${a.workerIds.filter(id => db.workers.some(w => w.id === id)).length}</td>
      <td class="muted">${a.blocks.map(b => esc(blockLabel(b).replace('Check ', ''))).join(' · ') || 'Ninguno'}</td>${rowBtns('area', a.id)}</tr>`), 'Aún no hay áreas. Crea la primera.');
}
function areaForm(a) {
  formModal({
    title: a ? 'Editar área' : 'Nueva área', values: a ? { name: a.name, bossId: a.bossId, workerIds: a.workerIds } : {},
    fields: [
      { name: 'name', label: 'Nombre del área', required: true, placeholder: 'Ej.: Panadería' },
      { name: 'bossId', label: 'Jefe responsable', type: 'select', options: [{ value: '', label: 'Sin asignar' }, ...db.bosses.map(b => ({ value: b.id, label: b.name }))] },
      { name: 'workerIds', label: 'Trabajadores del área (toda el área)', type: 'checkboxes', options: db.workers.map(w => ({ value: w.id, label: w.name })), empty: 'Primero agrega trabajadores en la pestaña Trabajadores.' }
    ],
    onSubmit: async d => {
      if (a) Object.assign(a, d);
      else db.areas.push({ id: uid(), ...d, blocks: defaultBlocks() });
      await save(); render(true);
    }
  });
}

function cfgWorkers() {
  return sectionHead('Trabajadores', `<button class="btn primary" data-action="add-worker">+ Nuevo trabajador</button>`) +
    tableWrap(['Nombre', 'Cargo', 'Área', ''], db.workers.map(w => `<tr><td><strong>${esc(w.name)}</strong></td><td>${esc(w.role) || '<span class="muted">—</span>'}</td>
      <td>${esc(db.areas.filter(a => a.workerIds.includes(w.id)).map(a => a.name).join(', ')) || '<span class="muted">Sin área</span>'}</td>${rowBtns('worker', w.id)}</tr>`), 'Aún no hay trabajadores. Agrégalos y luego asígnalos a un área.');
}
function personForm(kind, p) {
  const isW = kind === 'worker';
  formModal({
    title: `${p ? 'Editar' : 'Nuevo'} ${isW ? 'trabajador' : 'jefe responsable'}`, values: p || {},
    fields: [{ name: 'name', label: 'Nombre completo', required: true }, { name: 'role', label: 'Cargo', placeholder: isW ? 'Ej.: Panadero' : 'Ej.: Jefe de Panadería' }],
    onSubmit: async d => {
      const list = isW ? db.workers : db.bosses;
      if (p) Object.assign(p, d); else list.push({ id: uid(), ...d });
      await save(); render(true);
    }
  });
}
function cfgBosses() {
  return sectionHead('Jefes responsables', `<button class="btn primary" data-action="add-boss">+ Nuevo jefe</button>`) +
    tableWrap(['Nombre', 'Cargo', 'Áreas a cargo', ''], db.bosses.map(b => `<tr><td><strong>${esc(b.name)}</strong></td><td>${esc(b.role) || '<span class="muted">—</span>'}</td>
      <td>${esc(db.areas.filter(a => a.bossId === b.id).map(a => a.name).join(', ')) || '<span class="muted">Sin áreas</span>'}</td>${rowBtns('boss', b.id)}</tr>`), 'Aún no hay jefes. Agrégalos para asignarlos como responsables de un área.');
}

function cfgChecklists() {
  if (!db.areas.length) return `<div class="card empty"><p>Crea al menos un área para armar sus checklists.</p></div>`;
  if (!db.areas.some(a => a.id === ui.cfgArea)) ui.cfgArea = db.areas[0].id;
  const a = db.areas.find(x => x.id === ui.cfgArea);
  return `<div class="section-head"><label class="inline-field">Área
      <select data-change="cfg-area">${db.areas.map(x => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-action="add-block">+ Agregar bloque</button>
      <button class="btn" data-action="copy-checklist" ${db.areas.length < 2 ? 'disabled' : ''}>Copiar desde otra área</button></div></div>
    <p class="hint" style="margin-top:-4px">Cada bloque es un checklist de Limpieza u Orden. Para sub-áreas (por ejemplo Caliente y Frío) crea un bloque por cada una y ponle el nombre de la sub-área. El check de Trabajadores usa los parámetros de la pestaña <b>Parámetros de personal</b>.</p>
    ${a.blocks.length ? `<div class="cl-grid">${a.blocks.map(b => `<div class="card cl-col"><div class="cl-top"><div><h3>${esc(blockLabel(b))}</h3><p>${b.items.length} ${plural(b.items.length, 'ítem', 'ítems')}</p></div>
        <div><button class="btn sm ghost" data-action="edit-block" data-id="${b.id}">Editar</button><button class="btn sm ghost" data-action="del-block" data-id="${b.id}">Eliminar</button></div></div>
      ${b.items.length ? b.items.map(it => `<div class="cl-item"><span>${esc(it.text)}</span>
        <button class="btn sm ghost" data-action="edit-item" data-block="${b.id}" data-id="${it.id}">Editar</button>
        <button class="btn sm ghost" data-action="del-item" data-block="${b.id}" data-id="${it.id}" aria-label="Eliminar ítem">✕</button></div>`).join('') : '<p class="hint">Sin ítems todavía.</p>'}
      <form class="cl-add" data-form="add-item" data-block="${b.id}"><input type="text" name="text" placeholder="Nuevo ítem…" aria-label="Nuevo ítem de ${esc(blockLabel(b))}" required><button class="btn sm primary">Agregar</button></form></div>`).join('')}</div>`
    : `<div class="card empty"><p>Esta área no tiene bloques. Agrega uno de Limpieza u Orden.</p></div>`}`;
}
function blockForm(b) {
  formModal({
    title: b ? 'Editar bloque' : 'Nuevo bloque', values: b || { type: 'limpieza' },
    fields: [
      { name: 'type', label: 'Tipo de checklist', type: 'select', options: [{ value: 'limpieza', label: 'Limpieza' }, { value: 'orden', label: 'Orden' }] },
      { name: 'sub', label: 'Sub-área (opcional)', placeholder: 'Ej.: Caliente, Frío, Cocina' }
    ],
    onSubmit: async d => {
      const a = db.areas.find(x => x.id === ui.cfgArea);
      if (b) Object.assign(b, d); else a.blocks.push({ id: uid(), type: d.type, sub: d.sub, items: [] });
      await save(); render(true);
    }
  });
}

function cfgParams() {
  return sectionHead('Parámetros de personal (globales)') +
    `<p class="hint" style="margin-top:-4px">Son los mismos para todos los trabajadores de todas las áreas. Al evaluar a una persona se responde cada uno con Cumple, No cumple o N/A.</p>
    <div class="card cl-col" style="max-width:640px">
      ${db.params.length ? db.params.map(p => `<div class="cl-item"><span>${esc(p.text)}</span>
        <button class="btn sm ghost" data-action="edit-param" data-id="${p.id}">Editar</button>
        <button class="btn sm ghost" data-action="del-param" data-id="${p.id}" aria-label="Eliminar parámetro">✕</button></div>`).join('') : '<p class="hint">Sin parámetros todavía.</p>'}
      <form class="cl-add" data-form="add-param"><input type="text" name="text" placeholder="Nuevo parámetro…" aria-label="Nuevo parámetro" required><button class="btn sm primary">Agregar</button></form></div>`;
}

function cfgFiles() {
  return sectionHead('Archivos e informes anteriores') +
    `<div class="dropzone"><p style="margin-bottom:10px">Sube informes previos (PDF, Word, Excel, imágenes). Máximo 1,5 MB por archivo.</p>
      <label class="btn primary" style="cursor:pointer">Seleccionar archivos<input type="file" id="fileInput" multiple hidden></label></div>` +
    tableWrap(['Archivo', 'Tamaño', 'Subido', ''], files.map(f => `<tr><td><strong>${esc(f.name)}</strong></td><td>${fmtSize(f.size)}</td><td>${fmtDate(f.date)}</td>
      <td class="actions"><button class="btn sm" data-action="dl-file" data-id="${f.id}">Descargar</button> <button class="btn sm ghost" data-action="del-file" data-id="${f.id}">Eliminar</button></td></tr>`), 'Todavía no hay archivos guardados.');
}
function handleFiles(list) {
  const MAX = 1.5 * 1024 * 1024;
  [...list].forEach(file => {
    if (file.size > MAX) return toast(`"${file.name}" supera 1,5 MB y no se guardó.`, 'error');
    const rd = new FileReader();
    rd.onload = async () => {
      const entry = { id: uid(), name: file.name, type: file.type, size: file.size, date: todayISO(), data: rd.result };
      files.push(entry);
      try { await AppData.saveFiles(files); }
      catch (e) { files.pop(); toast(e.message || 'No se pudo guardar el archivo.', 'error'); return; }
      if (ui.cfgTab === 'files') render(true);
      toast(`"${file.name}" guardado.`);
    };
    rd.readAsDataURL(file);
  });
}

/* Espacio que ocupan los datos en este navegador (aprox.). */
function localStorageBytes() {
  let total = 0;
  try {
    Object.keys(localStorage).forEach(k => {
      const v = localStorage.getItem(k);
      total += (k.length + (v ? v.length : 0)) * 2;
    });
  } catch (e) { /* almacenamiento bloqueado */ }
  return total;
}

function cfgGeneral() {
  const s = db.settings;
  const hasSample = db.audits.some(r => r.sample) || db.workers.some(w => w.sample);
  const used = localStorageBytes();
  const nearLimit = used > 4 * 1024 * 1024;
  return sectionHead('Ajustes generales') + `<form class="card settings-grid" data-form="settings">
      <label class="field"><span>Nombre de la monitora / evaluador</span><input type="text" name="evaluator" value="${esc(s.evaluator)}" placeholder="Aparecerá en auditorías e informes"></label>
      <label class="field"><span>Nombre del local</span><input type="text" name="store" value="${esc(s.store)}" placeholder="Ej.: Supermercado Centro"></label>
      <label class="field"><span>Meta de cumplimiento (%)</span><input type="number" name="goal" min="1" max="100" value="${s.goal}"></label>
      <div style="display:flex;align-items:flex-end"><button class="btn primary">Guardar ajustes</button></div></form>` +
    sectionHead('Respaldo y datos') + `<div class="card panel"><p class="muted" style="margin-bottom:12px">Los datos viven solo en este navegador. Descarga un respaldo de vez en cuando, y úsalo para llevar la información a otro computador.<br>
      <span class="${nearLimit ? 'p-nok' : ''}">Espacio usado: <b>${fmtSize(used)}</b>${nearLimit ? ' · cerca del límite del navegador. Descarga un respaldo y elimina fotos o archivos antiguos.' : ''}</span></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-action="export">Descargar respaldo</button>
        <label class="btn" style="cursor:pointer">Restaurar respaldo<input type="file" id="importInput" accept=".json,application/json" hidden></label>
        <button class="btn" data-action="${hasSample ? 'remove-sample' : 'load-sample'}">${hasSample ? 'Quitar datos de ejemplo' : 'Cargar datos de ejemplo'}</button>
        <button class="btn danger" data-action="reset">Borrar todo</button></div></div>`;
}

/* ----- Datos de ejemplo ----- */
async function loadSample() {
  let seedN = 42;
  const rnd = () => { seedN |= 0; seedN = seedN + 0x6D2B79F5 | 0; let t = Math.imul(seedN ^ seedN >>> 15, 1 | seedN); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const mk = x => { const [name, role] = x.split('|'); return { id: uid(), name, role, sample: true }; };
  const bosses = ['Marcela Soto|Jefa de Panificación', 'Cristián Muñoz|Jefe de Carnes', 'Patricia Rojas|Jefa de Sala'].map(mk);
  const workers = ['Ana Paredes|Panadera', 'Luis Carrasco|Pastelero', 'Javiera Núñez|Ayudante', 'Pedro Vidal|Carnicero', 'Rosa Fuentes|Rotisera', 'Matías Leiva|Reponedor', 'Camila Soto|Cajera', 'Diego Araya|Bodeguero'].map(mk);
  db.bosses.push(...bosses); db.workers.push(...workers);
  db.areas.forEach((a, i) => { if (!a.bossId) a.bossId = bosses[i % 3].id; if (!a.workerIds.length && workers[i * 2]) a.workerIds = [workers[i * 2].id, workers[i * 2 + 1] && workers[i * 2 + 1].id].filter(Boolean); });
  const obsList = ['Residuo acumulado bajo el mesón', 'Falta rotulado en productos', 'Uniforme incompleto', 'Basurero sin tapa', 'Pasillo con cajas', 'Utensilios sin sanitizar', ''];
  const entry = (k, text, extra, level) => { const ok = rnd() < level; return { k, text, ...extra, status: ok ? 'ok' : 'nok', obs: ok ? '' : obsList[Math.floor(rnd() * obsList.length)], photos: [] }; };
  for (let back = 45; back >= 1; back--) {
    const d = new Date(); d.setDate(d.getDate() - back);
    if (d.getDay() === 0) continue;
    d.setHours(17 + Math.floor(rnd() * 4), Math.floor(rnd() * 60));
    const areas = db.areas.map(a => {
      const r = rnd(), boss = bossName(a.bossId);
      if (r < .12) return { areaId: a.id, areaName: a.name, boss, notEvaluated: true, total: 0, done: 0 };
      const partial = r < .2, level = .7 + (back < 20 ? .13 : 0) + rnd() * .12, keep = () => !partial || rnd() < .6;
      const blocks = [];
      const ws = a.workerIds.map(id => db.workers.find(w => w.id === id)).filter(Boolean);
      if (ws.length) {
        const entries = [], absent = [];
        ws.forEach(w => { if (rnd() < .08) absent.push({ id: w.id, name: w.name }); else if (keep()) db.params.forEach(p => { if (rnd() < .1) entries.push({ k: p.id, w: w.id, worker: w.name, text: p.text, status: 'na', obs: '', photos: [] }); else entries.push(entry(p.id, p.text, { w: w.id, worker: w.name }, level)); }); });
        blocks.push({ id: 'workers', type: 'trabajadores', label: 'Check Trabajadores', entries, absent });
      }
      a.blocks.forEach(b => blocks.push({ id: b.id, type: b.type, label: blockLabel(b), entries: b.items.filter(keep).map(it => entry(it.id, it.text, {}, level)) }));
      const res = { areaId: a.id, areaName: a.name, boss, notEvaluated: false, total: 0, blocks };
      res.done = resultDone(res); res.total = Math.max(res.done, blocks.reduce((n, b) => n + (b.type === 'trabajadores' ? ws.length : b.entries.length), 0));
      return res;
    });
    db.audits.push({ id: uid(), date: isoDate(d), ts: d.toISOString(), evaluator: db.settings.evaluator, areas, sample: true });
  }
  await save(); render(true); toast('Datos de ejemplo cargados. Puedes quitarlos cuando quieras.');
}
async function removeSample() {
  const ids = new Set(db.workers.filter(w => w.sample).map(w => w.id)), bids = new Set(db.bosses.filter(b => b.sample).map(b => b.id));
  db.audits = db.audits.filter(r => !r.sample);
  db.workers = db.workers.filter(w => !w.sample); db.bosses = db.bosses.filter(b => !b.sample);
  db.areas.forEach(a => { a.workerIds = a.workerIds.filter(id => !ids.has(id)); if (bids.has(a.bossId)) a.bossId = ''; });
  await save(); render(true); toast('Datos de ejemplo eliminados.');
}

/* =====================================================================
   ENRUTADOR Y RENDER
   ===================================================================== */
function emptyState(title, text, btn, href) {
  return `<div class="card empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn ? `<a class="btn primary" href="${href}">${esc(btn)}</a>` : ''}</div>`;
}
const VIEWS = { inicio: viewInicio, historial: viewHistorial, resumen: viewResumen, config: viewConfig };
const TITLES = { inicio: 'Inicio', historial: 'Historial', resumen: 'Resumen', config: 'Configuración' };

function render(keepScroll) {
  const route = location.hash.replace('#/', '');
  const v = VIEWS[route] ? route : 'inicio';
  const y = window.scrollY;
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  $('#pageTitle').textContent = TITLES[v];
  document.title = `${TITLES[v]} · Sistema de Calidad`;
  $('#view').innerHTML = VIEWS[v]();
  $('#storeName').textContent = db.settings.store || 'Auditorías e Inspecciones';
  $('#todayLabel').textContent = longDate(new Date());
  $('#evaluatorLabel').textContent = db.settings.evaluator || 'Definir evaluador';
  window.scrollTo(0, keepScroll === true ? y : 0);
}
window.addEventListener('hashchange', () => render());

/* ---------- Eventos ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const { action, id } = el.dataset;
  const area = () => db.areas.find(a => a.id === id);
  switch (action) {
    /* Inicio */
    case 'toggle-area': ui.openAreas.has(id) ? ui.openAreas.delete(id) : ui.openAreas.add(id); redrawArea(id); break;
    case 'mark': {
      const { key, s } = el.dataset, d = dEnsure(id), cur = d.checks[key];
      if (cur && cur.s === s) delete d.checks[key];
      else d.checks[key] = s === 'ok' ? { s, o: '', p: [] } : { s, o: cur ? cur.o : '', p: cur ? cur.p : [] };
      ui.invalid.delete(key); markDrafts(); redrawArea(id);
      if (s === 'nok' && d.checks[key]) { const inp = $$('[data-obs-input]', $(`[data-area="${id}"]`)).find(i => i.dataset.key === key); if (inp) inp.focus(); }
      break;
    }
    case 'rm-photo': { const d = dEnsure(id); d.checks[el.dataset.key].p.splice(Number(el.dataset.i), 1); markDrafts(); redrawArea(id); break; }
    case 'absent': {
      const wid = el.dataset.w, d = dEnsure(id), cur = d.workers[wid];
      if (cur && cur.st === 'absent') delete d.workers[wid];
      else if (cur && cur.st === 'done') {
        if (!await confirmBox('Este trabajador ya fue evaluado. ¿Marcarlo como ausente y descartar su evaluación?', 'Marcar ausente', true)) break;
        d.workers[wid] = { st: 'absent' };
      } else d.workers[wid] = { st: 'absent' };
      markDrafts(); redrawArea(id); break;
    }
    case 'eval-worker': workerModal(id, el.dataset.w); break;
    case 'zoom': openLightbox(el.src); break;
    case 'save-audit': saveAudit(); break;
    case 'discard':
      if (await confirmBox('¿Descartar todo lo que has marcado en esta auditoría sin guardar?', 'Descartar', true)) { saveDraftsSoon.cancel(); drafts = {}; await saveDrafts(); render(true); }
      break;
    /* Historial */
    case 'toggle-day': ui.openDays.has(id) ? ui.openDays.delete(id) : ui.openDays.add(id); $('#histList').innerHTML = histListHTML(); break;
    case 'toggle-obs': ui.closedObs.has(el.dataset.key) ? ui.closedObs.delete(el.dataset.key) : ui.closedObs.add(el.dataset.key); $('#histList').innerHTML = histListHTML(); break;
    case 'edit-aud': editAuditModal(id); break;
    case 'del-aud': {
      const target = db.audits.find(r => r.id === id);
      if (await confirmBox('¿Eliminar esta auditoría del Historial? No se puede deshacer.', 'Eliminar', true)) {
        db.audits = db.audits.filter(r => r.id !== id);
        await save(); render(true); toast('Auditoría eliminada.');
        if (target && window.SupabaseWrite) {
          SupabaseWrite.removeAudit(target).catch(() =>
            toast('Se eliminó en este navegador, pero no se pudo borrar de la nube.', 'error'));
        }
      }
      break;
    }
    case 'hist-clear': ui.hist = { q: '', area: '', from: '', to: '', only: '' }; render(true); break;
    case 'export-csv': exportCsv(); break;
    /* Resumen */
    case 'period': ui.sum.period = el.dataset.p; render(true); break;
    case 'period-nav': shiftRef(Number(el.dataset.dir)); render(true); break;
    case 'report': openReport(); break;
    /* Configuración */
    case 'cfg-tab': ui.cfgTab = el.dataset.tab; render(true); break;
    case 'add-area': areaForm(); break;
    case 'edit-area': areaForm(area()); break;
    case 'del-area':
      if (await confirmBox(`¿Eliminar el área "${area().name}"? El historial se conserva.`, 'Eliminar', true)) { db.areas = db.areas.filter(a => a.id !== id); delete drafts[id]; await saveDrafts(); await save(); render(true); }
      break;
    case 'add-worker': personForm('worker'); break;
    case 'edit-worker': personForm('worker', db.workers.find(w => w.id === id)); break;
    case 'del-worker':
      if (await confirmBox('¿Eliminar este trabajador? Se quitará de las áreas; el historial se conserva.', 'Eliminar', true)) { db.workers = db.workers.filter(w => w.id !== id); db.areas.forEach(a => { a.workerIds = a.workerIds.filter(x => x !== id); }); await save(); render(true); }
      break;
    case 'add-boss': personForm('boss'); break;
    case 'edit-boss': personForm('boss', db.bosses.find(b => b.id === id)); break;
    case 'del-boss':
      if (await confirmBox('¿Eliminar este jefe? Las áreas a su cargo quedarán sin responsable.', 'Eliminar', true)) { db.bosses = db.bosses.filter(b => b.id !== id); db.areas.forEach(a => { if (a.bossId === id) a.bossId = ''; }); await save(); render(true); }
      break;
    case 'add-block': blockForm(); break;
    case 'edit-block': blockForm(db.areas.find(a => a.id === ui.cfgArea).blocks.find(b => b.id === id)); break;
    case 'del-block':
      if (await confirmBox('¿Eliminar este bloque y todos sus ítems?', 'Eliminar', true)) { const a = db.areas.find(x => x.id === ui.cfgArea); a.blocks = a.blocks.filter(b => b.id !== id); await save(); render(true); }
      break;
    case 'edit-item': {
      const b = db.areas.find(x => x.id === ui.cfgArea).blocks.find(x => x.id === el.dataset.block), it = b.items.find(i => i.id === id);
      formModal({ title: 'Editar ítem', values: it, fields: [{ name: 'text', label: 'Texto del ítem', required: true }], onSubmit: async d => { it.text = d.text; await save(); render(true); } });
      break;
    }
    case 'del-item': { const b = db.areas.find(x => x.id === ui.cfgArea).blocks.find(x => x.id === el.dataset.block); b.items = b.items.filter(i => i.id !== id); await save(); render(true); break; }
    case 'edit-param': {
      const p = db.params.find(x => x.id === id);
      formModal({ title: 'Editar parámetro', values: p, fields: [{ name: 'text', label: 'Texto del parámetro', required: true }], onSubmit: async d => { p.text = d.text; await save(); render(true); } });
      break;
    }
    case 'del-param': db.params = db.params.filter(p => p.id !== id); await save(); render(true); break;
    case 'copy-checklist':
      formModal({
        title: 'Copiar checklist', submitLabel: 'Copiar',
        fields: [{ name: 'from', label: 'Copiar desde (reemplaza los bloques de esta área)', type: 'select', options: db.areas.filter(a => a.id !== ui.cfgArea).map(a => ({ value: a.id, label: a.name })) }],
        onSubmit: async d => {
          const src = db.areas.find(a => a.id === d.from), dst = db.areas.find(a => a.id === ui.cfgArea);
          dst.blocks = src.blocks.map(b => ({ id: uid(), type: b.type, sub: b.sub, items: b.items.map(i => ({ id: uid(), text: i.text })) }));
          await save(); render(true); toast('Checklist copiado.');
        }
      });
      break;
    case 'dl-file': { const f = files.find(x => x.id === id); download(f.name, f.data); break; }
    case 'del-file':
      if (await confirmBox('¿Eliminar este archivo?', 'Eliminar', true)) { files = files.filter(f => f.id !== id); await AppData.saveFiles(files); render(true); }
      break;
    case 'export': download(`respaldo-calidad-${todayISO()}.json`, 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ db, files }))); break;
    case 'load-sample': if (!db.areas.length) return toast('Crea al menos un área primero.', 'error'); await loadSample(); break;
    case 'remove-sample': await removeSample(); break;
    case 'reset':
      if (await confirmBox('Se borrarán TODAS las áreas, trabajadores, auditorías y archivos de este navegador. ¿Continuar?', 'Borrar todo', true)) {
        db = seed(); saveDraftsSoon.cancel(); drafts = {}; files = []; ui.init = false; await save(); await saveDrafts(); await AppData.saveFiles(files); render(true); toast('Datos restablecidos.');
      }
      break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset && t.dataset.hist) { ui.hist[t.dataset.hist] = t.value; refreshHist(); }
  if (t.hasAttribute && t.hasAttribute('data-obs-input')) {
    const c = ((drafts[t.dataset.id] || {}).checks || {})[t.dataset.key];
    if (c) { c.o = t.value; markDrafts(); t.classList.remove('invalid'); ui.invalid.delete(t.dataset.key); }
  }
});
document.addEventListener('change', async e => {
  const t = e.target, c = t.dataset && t.dataset.change;
  if (c === 'cfg-area') { ui.cfgArea = t.value; render(true); }
  if (t.dataset && t.dataset.sum === 'ref' && t.value) { ui.sum.ref = t.value; render(true); }
  if (t.id === 'fileInput') { handleFiles(t.files); t.value = ''; }
  if (t.id === 'importInput' && t.files[0]) importBackup(t.files[0]);
  if (t.hasAttribute && t.hasAttribute('data-photo-input')) {
    const f = t.files[0], { id, key } = t.dataset; t.value = ''; if (!f) return;
    const cur = ((drafts[id] || {}).checks || {})[key]; if (!cur) return;
    if ((cur.p || []).length >= MAX_PHOTOS) return toast(`Máximo ${MAX_PHOTOS} fotos por ítem.`, 'error');
    try { cur.p = [...(cur.p || []), await compressImage(f)]; ui.invalid.delete(key); markDrafts(); redrawArea(id); }
    catch (err) { toast('No se pudo leer la imagen.', 'error'); }
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.dataset && e.target.dataset.form; if (!f) return;
  e.preventDefault();
  const text = e.target.elements.text ? e.target.elements.text.value.trim() : '';
  if (f === 'add-item') {
    const b = db.areas.find(x => x.id === ui.cfgArea).blocks.find(x => x.id === e.target.dataset.block);
    if (text) { b.items.push({ id: uid(), text }); await save(); render(true); const inp = $(`[data-form="add-item"][data-block="${b.id}"] input`); if (inp) inp.focus(); }
  }
  if (f === 'add-param' && text) { db.params.push({ id: uid(), text }); await save(); render(true); const inp = $('[data-form="add-param"] input'); if (inp) inp.focus(); }
  if (f === 'settings') {
    const el = e.target.elements, goal = Math.min(100, Math.max(1, Number(el.goal.value) || 90));
    Object.assign(db.settings, { evaluator: el.evaluator.value.trim(), store: el.store.value.trim(), goal });
    await save(); render(true); toast('Ajustes guardados.');
  }
});

function importBackup(file) {
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const obj = JSON.parse(rd.result);
      if (!obj.db || !Array.isArray(obj.db.areas) || !Array.isArray(obj.db.audits)) throw new Error('formato');
      if (!await confirmBox('Restaurar este respaldo reemplazará los datos actuales. ¿Continuar?', 'Restaurar', true)) return;
      const isV1 = !obj.db.version || obj.db.version < 2;
      db = normalizeDB(isV1 ? migrateV1(obj.db) : obj.db); files = Array.isArray(obj.files) ? obj.files : []; drafts = {}; ui.init = false;
      await save(); await saveDrafts(); await AppData.saveFiles(files); render(true); toast('Respaldo restaurado.');
    } catch (err) { toast('El archivo no es un respaldo válido.', 'error'); }
  };
  rd.readAsText(file);
}

/* Si se cierra la pestaña o se cambia de aplicación, se escribe lo pendiente. */
function flushOnExit() {
  if (!draftsDirty) return;
  saveDraftsSoon.cancel();
  saveDrafts();
}
window.addEventListener('pagehide', flushOnExit);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnExit(); });

/* ---------- Reintento hacia la nube ----------
   Si una auditoría quedó sin subir (sin internet, sin sesión o un error
   pasajero), se vuelve a intentar al abrir la app y al iniciar sesión.
   No bloquea nada: si sigue sin poder, se reintenta más adelante. */
const pendingSync = () => db.audits.filter(a => !a.cloudSyncedAt && !a.cloudSkipped);

async function syncPending(limit = 5) {
  if (!window.SupabaseWrite) return { synced: 0, pending: 0 };
  let synced = 0;
  for (const aud of pendingSync().slice(-limit)) {
    let r;
    try { r = await SupabaseWrite.saveAudit(aud, db); }
    catch (e) { break; }
    if (r && r.ok) { aud.cloudId = r.auditId; aud.cloudSyncedAt = new Date().toISOString(); delete aud.cloudSkipped; synced++; }
    else if (r && ['enviada', 'rol', 'sin-local'].includes(r.skipped)) aud.cloudSkipped = r.skipped;
    else break;
  }
  if (synced) { try { await AppData.saveDB(db); } catch (e) { /* queda en memoria */ } }
  return { synced, pending: pendingSync().length };
}

window.SCSync = { pending: syncPending, count: () => pendingSync().length };

/* Al entrar con una cuenta, se sube lo que haya quedado pendiente. */
if (window.sb && sb.auth && sb.auth.onAuthStateChange) {
  sb.auth.onAuthStateChange((event, session) => {
    if (session) setTimeout(() => syncPending().catch(() => {}), 1200);
  });
}

/* ---------- Arranque ---------- */
async function boot() {
  try {
    await hydrate();
  } catch (e) {
    console.error('No se pudieron cargar los datos:', e);
    toast('No se pudieron cargar los datos guardados. Se parte de cero.', 'error');
    db = seed();
  }
  if (!location.hash) location.hash = '#/inicio';
  render();
  syncPending().catch(() => {});
}
boot();

})();
