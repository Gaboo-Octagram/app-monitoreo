// src/supabaseClient.js
const SUPABASE_URL = "https://nswzqlwsvoamryatyqsv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zd3pxbHdzdm9hbXJ5YXR5cXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNjc3OTMsImV4cCI6MjEwODc0Mzc5M30.MEPUH6YNVtJRgO4BZPlE4wL-96xBAbYGPhFmWeMRc5Q";

(function initSupabase() {
  try {
    let lib = window.supabase;
    if (!lib) {
      // Intentar otras formas comunes
      lib = window._supabase || window.Supabase || null;
    }
    if (!lib) {
      console.error('Supabase library not loaded. window.supabase is undefined');
      return;
    }
    const createClient =
      (typeof lib.createClient === 'function' && lib.createClient) ||
      (lib.default && typeof lib.default.createClient === 'function' && lib.default.createClient) ||
      (typeof lib === 'function' && lib); // por si acaso
    if (typeof createClient !== 'function') {
      console.error('createClient not found', lib);
      return;
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.sb = supabase;
    console.log('Supabase client initialized');
  } catch (e) {
    console.error('Error initializing Supabase:', e);
  }
})();
