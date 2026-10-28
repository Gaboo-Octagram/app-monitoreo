/* =====================================================================
   Modelo de datos
   ---------------------------------------------------------------------
   Forma del "documento" que guarda la app y cómo se crea, normaliza y
   migra. No toca la pantalla: solo datos.

   Estructura:
     { version, settings, params, bosses, workers, areas, audits }
   ===================================================================== */

const DEFAULT_PARAMS = ['Lavado de manos', 'Uso de mascarilla', 'Uso de cofia', 'Sin joyas', 'Uniforme', 'Sin heridas'];
const DEFAULT_LIMPIEZA = ['Pisos limpios y sin residuos', 'Mesones y superficies sanitizadas', 'Equipos y utensilios limpios', 'Basureros vaciados y tapados', 'Sin señales de plagas'];
const DEFAULT_ORDEN = ['Productos ordenados y rotulados', 'Pasillos y salidas despejados', 'Herramientas en su lugar', 'Productos sin contacto con el piso', 'Rotación de productos (FIFO) respetada'];
const DEFAULT_AREAS = ['Panadería', 'Pastelería', 'Carnicería', 'Rostisería', 'Frutería y Verdulería', 'Sala de Ventas', 'Bodega'];

const mkItems = list => list.map(text => ({ id: uid(), text }));
const mkBlock = (type, sub, texts) => ({ id: uid(), type, sub: sub || '', items: mkItems(texts) });
const defaultBlocks = () => [mkBlock('limpieza', '', DEFAULT_LIMPIEZA), mkBlock('orden', '', DEFAULT_ORDEN)];
const blockLabel = b => `Check ${b.type === 'orden' ? 'Orden' : 'Limpieza'}${b.sub ? ` (${b.sub})` : ''}`;

function seed() {
  return {
    version: 2,
    settings: { evaluator: '', store: '', goal: 90 },
    params: mkItems(DEFAULT_PARAMS),
    bosses: [], workers: [],
    areas: DEFAULT_AREAS.map(name => ({ id: uid(), name, bossId: '', workerIds: [], blocks: defaultBlocks() })),
    audits: []
  };
}

/* Completa datos que falten o vengan de versiones anteriores. */
function normalizeDB(d) {
  d = d && typeof d === 'object' ? d : seed();
  d.settings = Object.assign({ evaluator: '', store: '', goal: 90 }, d.settings || {});
  if (!Array.isArray(d.params)) d.params = mkItems(DEFAULT_PARAMS);
  ['bosses', 'workers', 'areas', 'audits'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
  d.areas.forEach(a => {
    a.workerIds = a.workerIds || [];
    a.blocks = Array.isArray(a.blocks) ? a.blocks : [];
    a.blocks.forEach(b => { b.items = b.items || []; b.sub = b.sub || ''; });
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
