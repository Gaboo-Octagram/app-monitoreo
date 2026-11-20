/* Todas las cuentas traen las auditorías guardadas en la nube (antes solo monitora y administrador). */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src') + path.sep;
const raw = fs.readFileSync(dir + 'index.html', 'utf8');
const html = raw.replace('<link rel="stylesheet" href="styles.css">', '').replace(/<script[\s\S]*?<\/script>/g, '');
const scripts = [...raw.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1])
  .filter(x => !/supabaseClient\.js|auth\.js|^https?:/.test(x.replace('./', ''))).map(x => fs.readFileSync(path.join(dir, x), 'utf8'));
const errors = [];
const check = (n, c) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + n); if (!c) errors.push(n); };
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

async function run(role) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.sb = { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); }, then(r) { return Promise.resolve({ data: [], error: null }).then(r); } }),
        auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }), onAuthStateChange() {} },
        storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) }, functions: { invoke: () => Promise.resolve({ data: {}, error: null }) } };
      w.SCAuth = { role: () => role, signedIn: () => true };
    } });
  const w = dom.window; let pulls = 0;
  w.console.error = () => {};
  scripts.forEach(code => { const s = w.document.createElement('script'); s.textContent = code; w.document.body.appendChild(s); });
  await tick(60);
  w.SupabaseRead.audits = async () => { pulls++; return []; };
  w.SupabaseRead.catalog = async () => ({ areas: [], params: [], workers: [], bosses: [] });
  w.dispatchEvent(new w.CustomEvent('sc-auth')); await tick(200);
  return pulls;
}
(async () => {
  for (const r of ['monitora', 'administrador', 'jefa_calidad']) {
    const n = await run(r);
    check(`${r}: trae las auditorías de la nube al iniciar sesión`, n >= 1);
  }
  console.log('\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'TODO OK — sincronía por rol'));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('EXCEPCIÓN', e); process.exit(2); });
