/* =====================================================================
   Modelo de datos
   ---------------------------------------------------------------------
   Forma del "documento" que guarda la app y cómo se crea, normaliza y
   migra. No toca la pantalla: solo datos.

   Estructura:
     { version, settings, params, bosses, workers, areas, audits }
   ===================================================================== */

const REPORT_DEFAULTS = { reportTitle: 'INFORME SEMANAL DE CHECK LIST DE PRESENTACIÓN PRINCIPAL Y LIMPIEZA', reportRev: '01', reportDate: '25.02.2026', reportLogo: '' };
const DEFAULT_PARAMS = ['Lavado de manos', 'Uso de mascarilla', 'Uso de cofia', 'Sin joyas', 'Uniforme', 'Sin heridas'];
const DEFAULT_LIMPIEZA = ['Pisos limpios y sin residuos', 'Mesones y superficies sanitizadas', 'Equipos y utensilios limpios', 'Basureros vaciados y tapados', 'Sin señales de plagas'];
const DEFAULT_ORDEN = ['Productos ordenados y rotulados', 'Pasillos y salidas despejados', 'Herramientas en su lugar', 'Productos sin contacto con el piso', 'Rotación de productos (FIFO) respetada'];
const DEFAULT_AREAS = ['Panadería', 'Pastelería', 'Carnicería', 'Rostisería', 'Frutería y Verdulería', 'Sala de Ventas', 'Bodega'];

const mkItems = list => list.map(text => ({ id: uid(), text }));
const mkBlock = (type, sub, texts) => ({ id: uid(), type, sub: sub || '', subId: '', items: mkItems(texts) });
const defaultBlocks = () => [mkBlock('limpieza', '', DEFAULT_LIMPIEZA), mkBlock('orden', '', DEFAULT_ORDEN)];
const blockLabel = b => `Check ${b.type === 'orden' ? 'Orden' : 'Limpieza'}${b.sub ? ` (${b.sub})` : ''}`;

function seed() {
  return {
    version: 2,
    settings: { evaluator: '', store: '', goal: 90, ...REPORT_DEFAULTS },
    params: mkItems(DEFAULT_PARAMS),
    bosses: [], workers: [],
    areas: DEFAULT_AREAS.map(name => ({ id: uid(), name, bossId: '', workerIds: [], subs: [], blocks: defaultBlocks() })),
    audits: []
  };
}

/* Sub-áreas: cada área tiene subs = [{ id, name, workerIds }]. Un bloque de checklist
   se liga a su sub-área con subId (y repite el nombre en `sub`, que usan las etiquetas
   y el informe). Un trabajador está en una sola sub-área; `a.workerIds` sigue siendo
   la lista completa del área. Los datos antiguos (bloques con `sub` y trabajadores
   sueltos) se convierten aquí; `workerSubs` ({ trabajadorId: nombreSub }) viene de la nube. */
const normName = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function ensureSubs(a) {
  a.workerIds = Array.from(new Set(a.workerIds || []));
  a.blocks = Array.isArray(a.blocks) ? a.blocks : [];
  a.subs = Array.isArray(a.subs) ? a.subs : [];
  a.subs.forEach(s => { s.workerIds = Array.from(new Set(s.workerIds || [])); });
  const byName = n => a.subs.find(s => normName(s.name) === normName(n));
  a.blocks.forEach(b => {
    b.items = b.items || []; b.sub = (b.sub || '').trim();
    let s = b.subId && a.subs.find(x => x.id === b.subId);
    if (!s && b.sub) s = byName(b.sub) || (a.subs.push({ id: uid(), name: b.sub, workerIds: [] }), a.subs[a.subs.length - 1]);
    b.subId = s ? s.id : ''; b.sub = s ? s.name : '';
  });
  if (a.workerSubs) {
    Object.entries(a.workerSubs).forEach(([wid, name]) => {
      if (!name) return;
      const s = byName(name) || (a.subs.push({ id: uid(), name, workerIds: [] }), a.subs[a.subs.length - 1]);
      if (!s.workerIds.includes(wid)) s.workerIds.push(wid);
    });
    delete a.workerSubs;
  }
  const seen = new Set();   // un trabajador, una sola sub-área
  a.subs.forEach(s => { s.workerIds = s.workerIds.filter(id => !seen.has(id) && seen.add(id)); s.workerIds.forEach(id => { if (!a.workerIds.includes(id)) a.workerIds.push(id); }); });
  return a;
}
const subOfWorker = (a, wid) => (a.subs || []).find(s => s.workerIds.includes(wid)) || null;

/* Completa datos que falten o vengan de versiones anteriores. */
function normalizeDB(d) {
  d = d && typeof d === 'object' ? d : seed();
  d.settings = Object.assign({ evaluator: '', store: '', goal: 90 }, REPORT_DEFAULTS, d.settings || {});
  if (!Array.isArray(d.params)) d.params = mkItems(DEFAULT_PARAMS);
  ['bosses', 'workers', 'areas', 'audits'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
  d.areas.forEach(a => {
    ensureSubs(a);
  });
  d.audits.forEach(a => { a.areas = Array.isArray(a.areas) ? a.areas : []; });
  return d;
}

/* Migra datos de la versión 1: conserva áreas, trabajadores, jefes y ajustes. */
function migrateV1(o) {
  const d = {
    version: 2,
    settings: { evaluator: (o.settings || {}).evaluator || '', store: (o.settings || {}).store || '', goal: (o.settings || {}).goal || 90 },
    params: [], bosses: (o.bosses || []).filter(b => !b.sample), workers: (o.workers || []).filter(w => !w.sample), areas: [], audits: []
  };
  (o.areas || []).forEach(a => {
    const it = a.items || {};
    const blk = (type, list) => ({ id: uid(), type, sub: '', items: (list || []).map(i => ({ id: i.id || uid(), text: i.text })) });
    d.areas.push({
      id: a.id, name: a.name, bossId: d.bosses.some(b => b.id === a.bossId) ? a.bossId : '',
      workerIds: (a.workerIds || []).filter(id => d.workers.some(w => w.id === id)),
      blocks: [blk('limpieza', it.limpieza), blk('orden', it.orden)]
    });
  });
  const withP = (o.areas || []).find(a => a.items && a.items.personal && a.items.personal.length);
  d.params = withP ? withP.items.personal.map(i => ({ id: i.id || uid(), text: i.text })) : mkItems(DEFAULT_PARAMS);
  return d;
}
