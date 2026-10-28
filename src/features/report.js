/* =====================================================================
   Informe imprimible (PDF)
   ---------------------------------------------------------------------
   Recibe los datos ya calculados y los metadatos del local. No lee el
   estado de la app: así se puede probar y reutilizar por separado.

   Uso:  SCReport.html(summaryData(dias), {
           days, store, evaluator, goal, periodText, today
         })
   ===================================================================== */
(function () {
  'use strict';

  function html(s, meta) {
    const days = (meta.days || []).slice().sort();
    const rows = s.byArea.map(a =>
      `<tr><td>${esc(a.name)}</td><td>${a.count}</td><td>${a.checks}</td><td>${a.nok}</td><td><b>${pctText(a.pct)}</b></td></tr>`
    ).join('');
    const nok = [...s.nokEntries].sort((a, b) => a.date.localeCompare(b.date));

    return `<div class="report">
    <h2>Informe de Auditorías e Inspecciones</h2>
    <div class="meta">${esc(meta.store || 'Supermercado')} · ${esc(meta.periodText)}<br>
      Días incluidos: ${days.length ? days.map(fmtDate).join(', ') : '—'}<br>
      Elaborado por: ${esc(meta.evaluator || 'Monitora de Calidad')} · Emitido el ${fmtDate(meta.today)}</div>
    <div class="kpi-line"><div><b>${pctText(s.total)}</b>Cumplimiento general</div><div><b>${s.audits.length}</b>Auditorías</div><div><b>${s.entries.length}</b>Checks evaluados</div><div><b>${nok.length}</b>No conformidades</div><div><b>${meta.goal}%</b>Meta</div></div>
    <h3>Resultados por área</h3>
    <table><thead><tr><th>Área</th><th>Días evaluada</th><th>Checks</th><th>No conformes</th><th>Cumplimiento</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Sin datos</td></tr>'}</tbody></table>
    <h3>Cumplimiento por categoría</h3>
    <table><tbody><tr>${s.byCat.map(c => `<td>${esc(c.name)}: <b>${pctText(c.pct)}</b></td>`).join('')}</tr></tbody></table>
    <h3>Detalle de no conformidades</h3>
    ${nok.length ? `<table><thead><tr><th>Fecha</th><th>Área</th><th>Categoría</th><th>Ítem</th><th>Acción correctiva</th></tr></thead><tbody>${nok.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.area)}</td><td>${esc(e.label.replace('Check ', ''))}</td><td>${esc(e.text)}${e.worker ? '<br><i>' + esc(e.worker) + '</i>' : ''}</td><td>${e.obs ? esc(e.obs) : '<i>Sin observación registrada</i>'}${(e.photos || []).length ? '<br>' + e.photos.map(p => `<img class="rph" src="${esc(p)}" alt="Foto adjunta">`).join('') : ''}</td></tr>`).join('')}</tbody></table>` : '<p>No se registraron no conformidades en los días seleccionados.</p>'}
    <div class="sign"><div>Monitora de Calidad</div><div>Jefatura</div></div></div>`;
  }

  window.SCReport = { html };
})();
