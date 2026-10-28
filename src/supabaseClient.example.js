// src/supabaseClient.example.js
// Copia este archivo como src/supabaseClient.js y rellena tus datos.
// El archivo real está en .gitignore y no se sube al repositorio.
const SUPABASE_URL = "https://TU_PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "TU_ANON_KEY_AQUI";

(function initSupabase() {
  try {
    if (typeof window.supabase === 'undefined') {
      console.error('Supabase library not loaded');
      return;
    }
    const createClient = window.supabase.createClient || (window.supabase.default && window.supabase.default.createClient);
    if (typeof createClient !== 'function') {
      console.error('createClient not found', window.supabase);
      return;
    }
    window.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('Supabase client initialized');
  } catch (e) {
    console.error('Error initializing Supabase:', e);
  }
})();
