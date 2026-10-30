/* =====================================================================
   Acceso con Supabase (correo y contraseña)
   ---------------------------------------------------------------------
   Capa independiente de la app: no lee ni escribe auditorías.
   - Muestra una pantalla de acceso al abrir, con opción "Seguir sin conexión".
   - Si hay sesión, muestra el nombre y el rol en la barra superior.
   - El botón de la barra abre "Mi cuenta" (datos y cerrar sesión).

   Los datos siguen en localStorage hasta que se conecte el proveedor de
   Supabase. Aquí solo se comprueba quién eres.
   ===================================================================== */
(function () {
  'use strict';

  const ROLES = {
    administrador: 'Administrador',
    monitora: 'Monitora de calidad',
    jefa_calidad: 'Jefa de calidad'
  };
  const SKIP_KEY = 'sc_login_omitido';

  let session = null;
  let profile = null;
  let overlay = null;
  let modal = null;

  const sb = () => window.sb || null;
  const mail = () => (session && session.user && session.user.email) || '';

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function friendly(message) {
    const m = String(message || '');
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/email not confirmed/i.test(m)) return 'Falta confirmar el correo. Revisa tu bandeja de entrada.';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
      return 'No hay conexión con Supabase. Revisa internet e inténtalo de nuevo.';
    }
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos seguidos. Espera un minuto.';
    return m || 'No se pudo entrar. Inténtalo de nuevo.';
  }

  /* ---------- Barra superior ---------- */
  function chip() {
    return document.getElementById('accountChip');
  }

  /* La app lee el rol desde acá y se entera de los cambios con el evento "sc-auth". */
  window.SCAuth = { role: () => (session && profile ? profile.role : null), signedIn: () => !!session };

  function renderChip() {
    try { window.dispatchEvent(new CustomEvent('sc-auth')); } catch (e) { /* sin eventos */ }
    const c = chip();
    if (!c) return;
    c.hidden = false;
    if (session) {
      const name = (profile && profile.full_name) || mail() || 'Sesión iniciada';
      const role = profile ? (ROLES[profile.role] || profile.role) : '';
      c.textContent = role ? `${name} · ${role}` : name;
      c.title = 'Ver mi cuenta';
      c.dataset.mode = 'account';
    } else {
      c.textContent = 'Iniciar sesión';
      c.title = 'Entrar con tu cuenta';
      c.dataset.mode = 'login';
    }
  }

  function onChip() {
    if (session) openAccount(); else openLogin();
  }

  /* ---------- Perfil ---------- */
  async function loadProfile() {
    profile = null;
    const client = sb();
    if (!session || !client) return;
    try {
      const { data, error } = await client
        .from('profiles')
        .select('full_name, role, store_id, stores(name)')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error) {
        console.warn('No se pudo leer el perfil:', error.message);
        return;
      }
      profile = data || null;
    } catch (e) {
      console.warn('No se pudo leer el perfil:', e);
    }
  }

  /* ---------- Pantalla de acceso ---------- */
  function setLoginError(text) {
    if (!overlay) return;
    const box = overlay.querySelector('#loginError');
    box.textContent = text || '';
    box.hidden = !text;
  }

  function setBusy(busy) {
    if (!overlay) return;
    const btn = overlay.querySelector('#loginSubmit');
    btn.disabled = busy;
    btn.textContent = busy ? 'Entrando…' : 'Entrar';
    overlay.querySelector('#loginEmail').disabled = busy;
    overlay.querySelector('#loginPassword').disabled = busy;
  }

  function closeLogin() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function openLogin(message) {
    closeLogin();
    const hasClient = !!sb();
    overlay = h(`
      <div class="login-overlay" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <div class="login-card">
          <div class="login-brand">
            <div class="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </div>
            <div class="brand-text">
              <strong>Sistema de Calidad</strong>
              <span>Control de auditorías</span>
            </div>
          </div>

          <h2 id="loginTitle">Entrar</h2>
          <p class="login-sub">Usa la cuenta creada en Supabase.</p>

          <form id="loginForm" novalidate>
            <label class="field"><span>Correo</span>
              <input id="loginEmail" type="email" autocomplete="username" inputmode="email" placeholder="nombre@correo.com" ${hasClient ? '' : 'disabled'}>
            </label>
            <label class="field"><span>Contraseña</span>
              <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Tu contraseña" ${hasClient ? '' : 'disabled'}>
            </label>
            <p class="login-error" id="loginError" role="alert" hidden></p>
            <button class="btn primary big" id="loginSubmit" type="submit" ${hasClient ? '' : 'disabled'}>Entrar</button>
          </form>

          <button class="btn ghost login-skip" id="loginSkip" type="button">Seguir sin conexión</button>
          <p class="login-note">
            Tus auditorías siguen guardadas <strong>solo en este navegador</strong>.
            La cuenta se usará cuando conectemos los datos a la nube.
          </p>
        </div>
      </div>`);

    document.body.appendChild(overlay);

    const form = overlay.querySelector('#loginForm');
    const skip = overlay.querySelector('#loginSkip');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const client = sb();
      if (!client) { setLoginError('No se pudo cargar la conexión con Supabase.'); return; }

      const email = overlay.querySelector('#loginEmail').value.trim();
      const password = overlay.querySelector('#loginPassword').value;
      if (!email || !password) { setLoginError('Escribe tu correo y tu contraseña.'); return; }

      setLoginError('');
      setBusy(true);
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) { setLoginError(friendly(error.message)); setBusy(false); return; }
        session = data.session;
        sessionStorage.removeItem(SKIP_KEY);
        await loadProfile();
        setBusy(false);
        closeLogin();
        renderChip();
      } catch (err) {
        setLoginError(friendly(err && err.message));
        setBusy(false);
      }
    });

    skip.addEventListener('click', () => {
      sessionStorage.setItem(SKIP_KEY, '1');
      closeLogin();
    });

    if (hasClient) {
      const emailInput = overlay.querySelector('#loginEmail');
      if (emailInput) emailInput.focus();
    } else {
      setLoginError('No se pudo cargar la conexión con Supabase. Puedes seguir sin conexión.');
    }

    if (message) setLoginError(message);
  }

  /* ---------- Mi cuenta ---------- */
  function closeAccount() {
    if (modal) { modal.remove(); modal = null; }
  }

  function openAccount() {
    if (!session) { openLogin(); return; }
    closeAccount();

    const role = profile ? (ROLES[profile.role] || profile.role) : 'Sin perfil';
    const name = (profile && profile.full_name) || '—';
    const store = profile && profile.stores ? profile.stores.name
      : (profile && profile.store_id ? 'Local asignado' : 'Sin local asignado');

    modal = h(`
      <div class="overlay" id="accountOverlay">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
          <div class="modal-head">
            <h3 id="accountTitle">Mi cuenta</h3>
            <button class="icon-btn" type="button" id="accountClose" aria-label="Cerrar">×</button>
          </div>
          <div class="modal-body">
            <div class="account-row"><span>Nombre</span><strong>${esc(name)}</strong></div>
            <div class="account-row"><span>Rol</span><strong>${esc(role)}</strong></div>
            <div class="account-row"><span>Local</span><strong>${esc(store)}</strong></div>
            <div class="account-row"><span>Correo</span><strong>${esc(mail())}</strong></div>
            <p class="account-note">
              Por ahora la app sigue usando los datos de este navegador. Los permisos
              por rol se aplicarán cuando conectemos las auditorías a Supabase.
            </p>

            <div class="cloud-box">
              <div class="cloud-head">
                <div>
                  <strong>Datos en la nube</strong>
                  <p class="cloud-msg" id="cloudMsg">Comprueba que la app puede leer tu local desde Supabase.</p>
                </div>
                <div class="cloud-btns">
                  <button class="btn sm" type="button" id="cloudCheck">Comprobar</button>
                  <button class="btn sm" type="button" id="cloudSync" hidden>Subir pendientes</button>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-foot">
            <button class="btn" type="button" id="accountBack">Cerrar</button>
            <button class="btn danger" type="button" id="accountSignOut">Cerrar sesión</button>
          </div>
        </div>
      </div>`);

    document.body.appendChild(modal);

    const close = () => closeAccount();
    modal.querySelector('#accountClose').addEventListener('click', close);
    modal.querySelector('#accountBack').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelector('#accountSignOut').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Saliendo…';
      try { await sb().auth.signOut(); } catch (err) { console.warn(err); }
      session = null;
      profile = null;
      sessionStorage.removeItem(SKIP_KEY);
      closeAccount();
      renderChip();
      openLogin();
    });

    const cloudBtn = modal.querySelector('#cloudCheck');
    if (cloudBtn) cloudBtn.addEventListener('click', () => runCloudCheck(cloudBtn));

    const syncBtn = modal.querySelector('#cloudSync');
    if (syncBtn) {
      const pending = window.SCSync ? SCSync.count() : 0;
      if (pending) { syncBtn.hidden = false; syncBtn.textContent = `Subir pendientes (${pending})`; }
      syncBtn.addEventListener('click', () => runCloudSync(syncBtn));
    }

    modal.querySelector('#accountClose').focus();
  }

  /* ---------- Comprobación de la nube ---------- */
  function cloudMessage(text, kind) {
    const box = modal && modal.querySelector('#cloudMsg');
    if (!box) return;
    box.textContent = text;
    box.className = 'cloud-msg' + (kind ? ' ' + kind : '');
  }

  function describeCloud(r) {
    const n = (count, one, many) => count + ' ' + (count === 1 ? one : many);
    if (!r.areas) {
      return 'La nube responde, pero el local «' + (r.store || 'sin nombre') + '» todavía no tiene áreas.';
    }
    const parts = [
      n(r.areas, 'área', 'áreas'),
      n(r.items, 'check', 'checks'),
      n(r.params, 'parámetro', 'parámetros')
    ];
    if (r.workers) parts.push(n(r.workers, 'trabajador', 'trabajadores'));
    const audits = r.audits.total
      ? n(r.audits.total, 'auditoría', 'auditorías') +
        (r.audits.lastDate ? ' · última del ' + r.audits.lastDate : '')
      : 'Sin auditorías todavía';
    return (r.store ? r.store + ': ' : '') + parts.join(' · ') + '. ' + audits + '.';
  }

  /* Sube las auditorías que quedaron sin nube (sin conexión o sin sesión). */
  async function runCloudSync(btn) {
    if (!window.SCSync) { cloudMessage('No disponible. Recarga la página.', 'bad'); return; }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Subiendo…';
    try {
      const r = await window.SCSync.pending();
      const left = r.pending || 0;
      if (r.synced) {
        cloudMessage(`Se ${r.synced === 1 ? 'subió 1 auditoría' : `subieron ${r.synced} auditorías`}.` +
          (left ? ` Quedan ${left} pendientes.` : ' Todo al día.'), 'ok');
      } else {
        cloudMessage(left
          ? `No se pudo subir. Quedan ${left} pendientes: revisa la conexión o vuelve a entrar.`
          : 'No había nada pendiente.', left ? 'bad' : '');
      }
      btn.hidden = !left;
      btn.textContent = left ? `Subir pendientes (${left})` : 'Subir pendientes';
    } catch (e) {
      cloudMessage(e.message || 'No se pudieron subir las auditorías pendientes.', 'bad');
      btn.textContent = label;
    } finally {
      btn.disabled = false;
    }
  }

  async function runCloudCheck(btn) {    if (!window.SupabaseRead) {
      cloudMessage('La comprobación no está disponible. Recarga la página.', 'bad');
      return;
    }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Comprobando…';
    cloudMessage('Consultando la nube…', '');
    try {
      const r = await window.SupabaseRead.summary();
      cloudMessage(describeCloud(r), 'ok');
    } catch (e) {
      cloudMessage(e.message || 'No se pudo comprobar la nube.', 'bad');
      console.warn('Comprobación de la nube:', e);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---------- Arranque ---------- */
  async function init() {
    renderChip();
    const c = chip();
    if (c && !c.dataset.wired) {
      c.dataset.wired = '1';
      c.addEventListener('click', onChip);
    }

    const client = sb();
    if (!client) {
      openLogin('No se pudo cargar la conexión con Supabase. Puedes seguir sin conexión.');
      return;
    }

    try {
      const { data } = await client.auth.getSession();
      session = (data && data.session) || null;
      if (session) {
        await loadProfile();
        renderChip();
      } else if (!sessionStorage.getItem(SKIP_KEY)) {
        openLogin();
      }
    } catch (e) {
      console.warn('No se pudo comprobar la sesión:', e);
      openLogin('No se pudo comprobar la sesión. Puedes seguir sin conexión.');
    }

    // Si la sesión se cierra desde otra pestaña o caduca.
    client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      setTimeout(() => {
        session = null;
        profile = null;
        closeAccount();
        renderChip();
      }, 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
