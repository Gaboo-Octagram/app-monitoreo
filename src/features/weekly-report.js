/* =====================================================================
   Informe semanal por sala
   ---------------------------------------------------------------------
   Dos partes independientes de la pantalla:
     SCWeekly.compute(db, areaId, refIso, opts) -> datos del informe
     SCWeekly.html(data, meta)                   -> HTML imprimible

   La semana es la semana ISO del año (lunes a domingo) de `refIso`.
   "Semana anterior" = la última semana anterior con auditoría de esa sala.
   El gráfico va de la semana del informe y 4 semanas hacia atrás.
   ===================================================================== */
(function () {
  'use strict';

  const WEEKS_BACK = 4;
  const LEVELS = [
    { key: 'muy', label: 'Muy Satisfactorio', range: '100% - 90%', min: 90 },
    { key: 'medio', label: 'Medianamente Satisfactorio', range: '89% - 70%', min: 70 },
    { key: 'insat', label: 'Insatisfactorio', range: '69% >', min: -1 }
  ];
  const levelOf = p => p === null ? null : LEVELS.find(l => p >= l.min);
  const CATS = [['trabajadores', 'Presentación Personal'], ['limpieza', 'Limpieza'], ['orden', 'Orden']];

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  const pctOf = entries => {
    const r = entries.filter(e => e.status === 'ok' || e.status === 'nok');
    return r.length ? Math.round(r.filter(e => e.status === 'ok').length / r.length * 100) : null;
  };

  /* Número de semana ISO 8601. */
  function isoWeek(s) {
    const d = parse(s); d.setHours(12);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const y = d.getFullYear(), j4 = new Date(y, 0, 4, 12);
    return { year: y, week: 1 + Math.round(((d - j4) / 864e5 - 3 + ((j4.getDay() + 6) % 7)) / 7) };
  }

  const UNITS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta'];
  function words(n) {   // 1..59 es suficiente para semanas
    if (n < 30) return UNITS[n];
    const t = Math.floor(n / 10), u = n % 10;
    return TENS[t] + (u ? ' y ' + UNITS[u] : '');
  }

  /* ---------------------------- Cálculo ---------------------------- */
  function compute(db, areaId, refIso, opts) {
    opts = opts || {};
    const area = db.areas.find(a => a.id === areaId);
    const start = mondayOf(refIso), end = addDays(start, 6), wk = isoWeek(start);
    const weeks = [];
    for (let i = WEEKS_BACK; i >= 0; i--) { const s = addDays(start, -7 * i); weeks.push({ start: s, end: addDays(s, 6), n: isoWeek(s).week }); }
    const inWeek = (a, w) => a.date >= w.start && a.date <= w.end;
    const results = (w) => db.audits.filter(a => inWeek(a, w)).flatMap(a => a.areas.filter(r => r.areaId === areaId && !r.notEvaluated).map(r => ({ date: a.date, r })));
    const blocksOf = (w) => results(w).flatMap(x => (x.r.blocks || []).map(b => ({ date: x.date, b })));

    const cur = weeks[weeks.length - 1], curBlocks = blocksOf(cur);
    /* Un bloque = categoría + sub-área (por la etiqueta guardada). */
    const keyOf = b => `${b.type}|${b.label}`;
    const order = [];
    curBlocks.forEach(({ b }) => { if (!order.some(o => o.key === keyOf(b))) order.push({ key: keyOf(b), type: b.type, label: b.label }); });
    const subOf = label => { const m = /\((.+)\)\s*$/.exec(label || ''); return m ? m[1] : ''; };
    const valueAt = (key, w) => avg(blocksOf(w).filter(x => keyOf(x.b) === key).map(x => pctOf(x.b.entries)).filter(v => v !== null));

    /* Semana anterior = última semana previa con auditoría de la sala (hasta 2 años atrás). */
    const prevStartFor = () => {
      const earlier = db.audits.filter(a => a.date < cur.start && a.areas.some(r => r.areaId === areaId && !r.notEvaluated)).map(a => a.date).sort();
      return earlier.length ? mondayOf(earlier[earlier.length - 1]) : null;
    };
    const ps = prevStartFor(), prevW = ps ? { start: ps, end: addDays(ps, 6), n: isoWeek(ps).week } : null;

    const cats = CATS.map(([type, name]) => {
      const blocks = order.filter(o => o.type === type).map(o => {
        const series = weeks.map(w => ({ n: w.n, v: valueAt(o.key, w) }));
        const now = series[series.length - 1].v, prev = prevW ? valueAt(o.key, prevW) : null;
        return { key: o.key, sub: subOf(o.label), now, prev, delta: now !== null && prev !== null ? now - prev : null, series };
      });
      return { type, name, blocks };
    }).filter(c => c.blocks.length);

    /* Hallazgos: todos los "No cumple" de la semana. */
    const findings = [];
    results(cur).sort((a, b) => a.date.localeCompare(b.date)).forEach(({ date, r }) => (r.blocks || []).forEach(b =>
      (b.entries || []).filter(e => e.status === 'nok').forEach(e => findings.push({
        date, type: b.type, label: b.label, text: e.text, worker: e.worker || '', obs: e.obs || '', corr: e.corr || '',
        photos: b.type === 'trabajadores' ? [] : (e.photos || [])
      }))));

    const all = cats.flatMap(c => c.blocks.map(b => b.now)).filter(v => v !== null);
    const overall = avg(all);
    const boss = ((db.bosses || []).find(b => b.id === (area || {}).bossId) || {}).name || ((results(cur)[0] || {}).r || {}).boss || '';
    return { areaId, areaName: area ? area.name : '', boss, week: wk.week, year: wk.year, start, end, weeks, cats, findings, overall, level: levelOf(overall), aspects: cats.length, goal: (db.settings || {}).goal || 90, hasData: curBlocks.length > 0 };
  }

  /* ---------------------------- Gráfico ---------------------------- */
  const LINE = '#1f5fbf';
  function chart(block, goal) {
    const pts = block.series, n = pts.length, W = 460, H = 150, L = 34, R = 24, T = 16, B = 26;
    const have = pts.filter(p => p.v !== null);
    const lo = Math.max(0, Math.min(Math.floor((Math.min(...have.map(p => p.v), goal) - 6) / 10) * 10, 80));
    const x = i => L + i * (W - L - R) / (n - 1), y = v => T + (100 - v) * (H - T - B) / (100 - lo);
    const ticks = []; for (let v = lo; v <= 100; v += (100 - lo) > 50 ? 20 : 10) ticks.push(v); if (ticks[ticks.length - 1] !== 100) ticks.push(100);
    const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#d5dae3" stroke-width="1"/><text x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end" font-size="9" fill="#5b6472">${v}</text>`).join('');
    let path = '', open = false;
    pts.forEach((p, i) => { if (p.v === null) { open = false; return; } path += `${open ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`; open = true; });
    const hi = have.reduce((m, p) => (m === null || p.v > m.v ? p : m), null), mn = have.reduce((m, p) => (m === null || p.v < m.v ? p : m), null);
    const lastIdx = n - 1, show = new Set([pts.indexOf(hi), pts.indexOf(mn), pts[lastIdx].v !== null ? lastIdx : -1].filter(i => i >= 0));
    const marks = pts.map((p, i) => p.v === null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${i === lastIdx ? 4.5 : 3.5}" fill="${LINE}" stroke="#fff" stroke-width="1.5"/>`).join('');
    const labs = [...show].map(i => `<text x="${x(i).toFixed(1)}" y="${(y(pts[i].v) + (pts[i].v >= 95 ? 15 : -8)).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${LINE}">${pts[i].v}%</text>`).join('');
    const xl = pts.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="#5b6472" ${i === lastIdx ? 'font-weight="700"' : ''}>S${p.n}</text>`).join('');
    return `<svg class="wr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumplimiento semanal, semanas ${pts[0].n} a ${pts[lastIdx].n}">${grid}
      <line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="#c0392b" stroke-width="1" stroke-dasharray="5 4"/>
      <path d="${path}" fill="none" stroke="${LINE}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>${marks}${labs}${xl}</svg>`;
  }

  /* ----------------------------- HTML ------------------------------ */
  const fmtP = v => v === null ? '—' : v + '%';
  const fmtD = d => d === null ? '—' : (d > 0 ? '+' : d < 0 ? '-' : '') + (d === 0 ? '0' : Math.abs(d)) + '%';
  const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };

  function blockHTML(b, name, d, goal, title) {
    const canChart = b.series.filter(p => p.v !== null).length >= 2;
    return `<div class="wr-block">
      <ul class="wr-vals"><li><b>${E(title)}</b></li>
        <li><u>Semana ${d.week}:</u> <b>${fmtP(b.now)}</b></li>
        <li><u>Semana Anterior:</u> <b>${fmtP(b.prev)}</b></li>
        <li><u>Variación:</u> <b>${fmtD(b.delta)}</b></li></ul>
      <div class="wr-chart">${canChart ? chart(b, goal) : '<span class="wr-nochart">Sin histórico suficiente para el gráfico</span>'}</div></div>`;
  }

  function findingsHTML(d) {
    if (!d.findings.length) return '<p>No se registraron hallazgos durante la semana.</p>';
    return `<table class="wr-find"><tbody>${d.findings.map(f => {
      const cat = f.type === 'trabajadores' ? 'Presentación Personal' : f.label.replace('Check ', '');
      const text = `<div class="wr-ctx">${fmtDate(f.date)} · ${E(cat)} · ${E(f.text)}${f.worker ? ` · <b>${E(f.worker)}</b>` : ''}</div>
        <p>Se observó: ${f.obs ? E(f.obs) : 'ver foto adjunta'}</p>
        <p><b>Acciones correctivas:</b> ${f.corr ? E(f.corr) : 'Sin acción registrada'}</p>`;
      return f.photos.length
        ? `<tr><td class="wr-ph">${f.photos.slice(0, 2).map(p => `<img src="${E(p)}" alt="Foto del hallazgo">`).join('')}</td><td>${text}</td></tr>`
        : `<tr><td colspan="2">${text}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function conclusionHTML(d) {
    if (!d.level) return '<p>Sin resultados evaluados en la semana.</p>';
    const asp = d.aspects === 1 ? 'el aspecto evaluado' : `los ${words(d.aspects)} aspectos evaluados`;
    const quality = { muy: 'se evidencia un adecuado nivel de cumplimiento', medio: 'se evidencia un nivel de cumplimiento aceptable, con oportunidades de mejora', insat: 'se evidencia un nivel de cumplimiento insuficiente, que requiere reforzar las acciones correctivas' }[d.level.key];
    const hope = d.level.key === 'muy' ? 'se espera que estos niveles se mantengan o aumenten al 100%' : 'se espera que estos niveles aumenten y se tomen en consideración las acciones correctivas';
    return `<p>En base a los resultados obtenidos en la semana ${words(d.week)}, ${quality} dando como calificación un <b>“${E(d.level.label)}”</b> en ${asp}, ${hope}.</p>
      <p>Se recuerda que se mantendrán los controles periódicos para asegurar la mejora continua y alcanzar los estándares establecidos.</p>
      <table class="wr-levels"><tbody>${LEVELS.map(l => `<tr class="lv-${l.key}"><td>${l.label}</td><td>${l.range}</td></tr>`).join('')}</tbody></table>`;
  }

  const LOGO_FALLBACK = `<svg viewBox="0 0 120 56" class="wr-logo-svg" role="img" aria-label="Logo"><rect x="1" y="1" width="118" height="54" rx="6" fill="none" stroke="#9aa3b2" stroke-width="2" stroke-dasharray="5 4"/><text x="60" y="33" text-anchor="middle" font-size="15" font-weight="700" fill="#7b8494" font-family="Arial,sans-serif">LOGO</text></svg>`;

  /* meta: { title, rev, docDate, logo, evaluator, role, issued (iso) } */
  function html(d, meta) {
    meta = meta || {};
    const head = `<div class="wr-head"><div class="wr-logo">${meta.logo ? `<img src="${E(meta.logo)}" alt="Logo">` : LOGO_FALLBACK}</div>
      <div class="wr-htitle">${E(meta.title || 'INFORME SEMANAL DE CHECK LIST DE PRESENTACIÓN PRINCIPAL Y LIMPIEZA')}</div>
      <div class="wr-hmeta">Fecha: ${E(meta.docDate || '')}<br>Rev: ${E(meta.rev || '01')}</div></div>`;
    const foot = `<div class="wr-foot">Elaborado por ${E(meta.evaluator || 'Monitora de Calidad')} / ${E(meta.role || 'Monitora de Calidad')} / ${meta.issued ? fmtDate(meta.issued) : ''}</div>`;
    let body;
    if (!d.hasData) {
      body = `<h1 class="wr-title">Informe Sala ${E(d.areaName)} Semana ${d.week}</h1><p class="wr-empty">No hay auditorías de esta sala en la semana ${d.week} (${fmtDate(d.start)} al ${fmtDate(d.end)}).</p>`;
    } else {
      const sections = d.cats.map(c => {
        const multi = c.blocks.length > 1 || (c.blocks[0] && c.blocks[0].sub);
        if (c.type === 'trabajadores' || !multi) return blockHTML(c.blocks[0], c.name, d, d.goal, c.name);
        return `<div class="wr-cat"><ul class="wr-vals"><li><b>${E(c.name)}</b></li></ul></div>` + c.blocks.map(b => blockHTML(b, c.name, d, d.goal, b.sub + ':')).join('');
      }).join('');
      body = `<h1 class="wr-title">Informe Sala ${E(d.areaName)} Semana ${d.week}</h1>
        ${d.boss ? `<div class="wr-boss">Jefe/a a cargo: ${E(d.boss)}</div>` : ''}
        ${sections}
        <h2 class="wr-h2">Hallazgos y Acciones Correctivas</h2>${findingsHTML(d)}
        <div class="wr-concl"><h2 class="wr-h2">Conclusión</h2>${conclusionHTML(d)}</div>`;
    }
    return `<table class="wr"><thead><tr><td>${head}</td></tr></thead><tfoot><tr><td>${foot}</td></tr></tfoot><tbody><tr><td class="wr-body">${body}</td></tr></tbody></table>`;
  }

  window.SCWeekly = { compute, html, isoWeek, levelOf, LEVELS, words };
})();
