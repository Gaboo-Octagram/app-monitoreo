/* =====================================================================
   Exportar a CSV (se abre en Excel)
   ---------------------------------------------------------------------
   Usa punto y coma como separador (Excel en español) y agrega la marca
   de codificación para que las tildes se vean bien.
   ===================================================================== */
(function () {
  'use strict';

  function cell(value) {
    const text = String(value == null ? '' : value);
    return /[";\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function build(headers, rows) {
    return '\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(';')).join('\r\n');
  }

  function saveCsv(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download(name, url);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  window.SCExport = { cell, build, saveCsv };
})();
