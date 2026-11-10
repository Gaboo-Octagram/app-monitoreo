/* =====================================================================
   Importar informes semanales anteriores (Word .docx)
   ---------------------------------------------------------------------
   Solo toma los PORCENTAJES de la semana (no hallazgos ni gráficos):
     readDocx(buffer)      -> Promise<string[]>  párrafos de texto del .docx
     parseReport(parrafos) -> { areaName, week, rows:[{ type, sub, pct, prev }] }
     weekStart(year, week) -> lunes ISO de esa semana
     asAudits(db)          -> auditorías "virtuales" (no se guardan) para Resumen e informe
   Lo importado vive en db.imported y no se sube a la nube.
   ===================================================================== */
(function () {
  'use strict';
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* ---- .docx = zip: se lee word/document.xml con DecompressionStream ---- */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function zipEntry(buf, name) {
    const u = new Uint8Array(buf), v = new DataView(buf);
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('No es un archivo Word válido.');
    let p = v.getUint32(e + 16, true);
    const n = v.getUint16(e + 10, true), td = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      if (td.decode(u.subarray(p + 46, p + 46 + nl)) === name) {
        const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
        const data = u.subarray(start, start + csize);
        return method === 0 ? data : inflateRaw(data);
      }
      p += 46 + nl + el + cl;
    }
    throw new Error('El Word no tiene contenido legible.');
  }
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  async function readDocx(buffer) {
    const xml = new TextDecoder().decode(await zipEntry(buffer, 'word/document.xml'));
    return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
      .map(p => unesc((p.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>/g) || []).map(t => t === '<w:tab/>' ? ' ' : t.replace(/<[^>]+>/g, '')).join('')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /* ---- Lectura del texto del informe ---- */
  const CAT = [['presentacion personal', 'trabajadores'], ['trabajadores', 'trabajadores'], ['limpieza', 'limpieza'], ['orden', 'orden']];
  function parseReport(par) {
    const out = { areaName: '', week: 0, rows: [] };
    const t = par.map(s => /^informe\s/i.test(s) && /semana\s*\d+/i.test(s) ? s : null).find(Boolean);
    if (t) {
      const m = /informe\s+(?:de\s+)?(?:sala\s+)?(.+?)\s+semana\s*(\d+)/i.exec(t);
      if (m) { out.areaName = m[1].trim(); out.week = +m[2]; }
    }
    let cat = '', sub = '', cur = null;
    for (const line of par) {
      const n = norm(line).replace(/:$/, '').trim();
      if (/^hallazgos/.test(n) || /^conclusion/.test(n)) break;
      const hit = CAT.find(([k]) => n === k);
      if (hit) { cat = hit[1]; sub = ''; cur = null; continue; }
      let m = /^semana\s*anterior\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/.exec(n);
      if (m) { if (cur) cur.prev = Math.round(parseFloat(m[1].replace(',', '.'))); continue; }
      m = /^semana\s*\d+\s*:\s*(\d+(?:[.,]\d+)?)\s*%/.exec(n);
      if (m) {
        if (!cat) continue;
        cur = { type: cat, sub, pct: Math.round(parseFloat(m[1].replace(',', '.'))), prev: null };
        out.rows.push(cur); continue;
      }
      if (/^variacion/.test(n) || /^informe\s/.test(n) || /^semana/.test(n)) continue;
      if (cat && line.length <= 40) { sub = line.replace(/:\s*$/, '').trim(); cur = null; }
    }
    return out;
  }

  /* ---- Semana ISO -> lunes ---- */
  function weekStart(year, week) {
    const j4 = new Date(year, 0, 4, 12);
    const mon = new Date(j4); mon.setDate(j4.getDate() - ((j4.getDay() + 6) % 7) + 7 * (week - 1));
    return iso(mon);
  }

  /* ---- Auditorías virtuales para Resumen e informe ---- */
  const labelFor = (type, sub) => type === 'trabajadores' ? 'Check Trabajadores' : `Check ${type === 'orden' ? 'Orden' : 'Limpieza'}${sub ? ` (${sub})` : ''}`;
  function asAudits(db) {
    return ((db && db.imported) || []).map(im => ({
      id: 'imp-' + im.id, date: im.start, ts: im.start + 'T12:00:00', evaluator: '', imported: true,
      areas: [{
        areaId: im.areaId, areaName: im.areaName, boss: '', notEvaluated: false, total: 0, done: 0,
        blocks: im.rows.map((r, i) => ({ id: 'imp' + i, type: r.type, label: labelFor(r.type, r.sub), entries: [], pct: r.pct, imported: true }))
      }]
    }));
  }
  const all = db => db.audits.concat(asAudits(db));

  window.SCImport = { readDocx, parseReport, weekStart, asAudits, all, labelFor, norm };
})();
