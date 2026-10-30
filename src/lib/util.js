/* =====================================================================
   Utilidades compartidas
   ---------------------------------------------------------------------
   Funciones puras (sin estado y sin tocar la pantalla). Se cargan antes
   que app.js y quedan disponibles para todos los módulos.

   No usan módulos ES para que la app siga funcionando al abrir
   src/index.html directamente (file://).
   ===================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* UUID v4: los ids del catálogo son los mismos en el navegador y en Supabase. */
const uid = () => {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const pad = n => String(n).padStart(2, '0');

const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => isoDate(new Date());
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}`; };
const fmtDateSlash = s => fmtDate(s).replace(/-/g, '/');

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const longDate = d => `${DAYS_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
const fmtTime = iso => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

const plural = (n, s, p) => n === 1 ? s : p;
const pctText = p => p === null || p === undefined ? '--%' : p + '%';
const avg = arr => arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/* Espera a que el usuario deje de escribir antes de ejecutar. */
function debounce(fn, ms = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); timer = null; fn(...args); };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  wrapped.pending = () => timer !== null;
  return wrapped;
}

function download(name, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
