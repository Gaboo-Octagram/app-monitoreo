/* =====================================================================
   Capa de datos — fachada (AppData)

   La aplicación nunca llama a localStorage ni a Supabase directamente:
   siempre pasa por acá. Eso permite cambiar de proveedor sin tocar
   las vistas ni la lógica de la app.

   Todos los métodos son ASÍNCRONOS a propósito, porque Supabase lo es.
   Si fueran sincrónicos hoy, habría que reescribir cada llamada al migrar.

   Contrato que debe cumplir cualquier proveedor:
     name: string
     available(): boolean
     loadDB():        Promise<object|null>   último registro guardado
     loadLegacyDB():  Promise<object|null>   formato antiguo (solo migración)
     saveDB(db):      Promise<void>          lanza Error si falla
     loadDrafts():    Promise<object>
     saveDrafts(d):   Promise<void>
     loadFiles():     Promise<Array>
     saveFiles(f):    Promise<void>

   Para agregar Supabase más adelante:
     1. crear src/data/supabase-provider.js
     2. llamar AppData.register('supabase', {...})
     3. cambiar AppData.use('localStorage') por AppData.use('supabase')
   ===================================================================== */
(function () {
  'use strict';

  const adapters = Object.create(null);
  let active = null;
  let readOnly = false; // vista de la jefa: nada se guarda en este navegador

  const REQUIRED = [
    'loadDB', 'loadLegacyDB', 'saveDB',
    'loadDrafts', 'saveDrafts',
    'loadFiles', 'saveFiles'
  ];

  function register(name, adapter) {
    if (!adapter) throw new Error('Proveedor de datos vacío: ' + name);
    const missing = REQUIRED.filter(m => typeof adapter[m] !== 'function');
    if (missing.length) {
      throw new Error(`Proveedor "${name}" incompleto. Falta: ${missing.join(', ')}`);
    }
    adapters[name] = adapter;
    return adapter;
  }

  function use(name) {
    const adapter = adapters[name];
    if (!adapter) {
      throw new Error(`Proveedor de datos no registrado: "${name}". Registrados: ${Object.keys(adapters).join(', ') || 'ninguno'}`);
    }
    active = adapter;
    return adapter;
  }

  function current() {
    if (!active) throw new Error('No hay proveedor de datos activo. Falta llamar a AppData.use(...)');
    return active;
  }

  window.AppData = {
    register,
    use,

    /** Nombre del proveedor activo, útil para mostrar en pantalla o depurar. */
    get backend() { return active ? active.name : 'none'; },

    /** true si el proveedor puede operar en este navegador. */
    available() { return !!active && (typeof active.available !== 'function' || active.available()); },

    loadDB() { return current().loadDB(); },
    loadLegacyDB() { return current().loadLegacyDB(); },
    saveDB(db) { return readOnly ? Promise.resolve() : current().saveDB(db); },

    loadDrafts() { return current().loadDrafts(); },
    saveDrafts(drafts) { return readOnly ? Promise.resolve() : current().saveDrafts(drafts); },

    loadFiles() { return current().loadFiles(); },
    saveFiles(files) { return readOnly ? Promise.resolve() : current().saveFiles(files); },

    /** Con true, los datos de este navegador no se tocan (la jefa solo mira la nube). */
    setReadOnly(v) { readOnly = !!v; },
    get readOnly() { return readOnly; },

    /** Solo para pruebas: descarta todos los proveedores registrados. */
    _reset() { active = null; Object.keys(adapters).forEach(k => delete adapters[k]); }
  };
})();
