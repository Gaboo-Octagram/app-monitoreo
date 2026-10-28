/* =====================================================================
   Proveedor: localStorage

   Implementación actual de la capa de datos. Guarda todo en el navegador.
   Las claves se mantienen iguales a la versión 2 para no perder datos
   de quien ya venía usando la app.
   ===================================================================== */
(function () {
  'use strict';

  const KEYS = {
    db: 'sc_data_v2',
    legacy: 'sc_data_v1',
    drafts: 'sc_drafts_v2',
    files: 'sc_files_v1'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      // Dato corrupto o ilegible: no reventamos la app, se parte de cero.
      console.warn('[AppData] No se pudo leer "' + key + '":', e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      const err = new Error(e && e.name === 'QuotaExceededError'
        ? 'Almacenamiento lleno. Descarga un respaldo y borra fotos antiguas.'
        : 'No se pudo guardar: almacenamiento bloqueado por el navegador.');
      err.code = e && e.name === 'QuotaExceededError' ? 'quota' : 'storage';
      err.cause = e;
      throw err;
    }
  }

  function available() {
    try {
      const probe = '__sc_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  AppData.register('localStorage', {
    name: 'localStorage',
    keys: KEYS,
    available,

    async loadDB() { return read(KEYS.db, null); },
    async loadLegacyDB() { return read(KEYS.legacy, null); },
    async saveDB(db) { write(KEYS.db, db); },

    async loadDrafts() { return read(KEYS.drafts, {}); },
    async saveDrafts(drafts) { write(KEYS.drafts, drafts); },

    async loadFiles() { return read(KEYS.files, []); },
    async saveFiles(files) { write(KEYS.files, files); }
  });

  // Proveedor activo por ahora. Al migrar a Supabase, cambiar esta línea.
  AppData.use('localStorage');
})();
