/* =====================================================================
   Lectura desde Supabase
   ---------------------------------------------------------------------
   Primera parte del futuro proveedor de Supabase: por ahora SOLO LEE.
   No escribe nada, no reemplaza el almacenamiento del navegador y no
   toca las auditorías que ya tienes guardadas.

   Sirve para comprobar, con tu cuenta real, que:
     - la sesión llega a la base,
     - los permisos (RLS) dejan leer tu local,
     - los datos tienen la forma que la app espera.

   Cuando esté probado, este archivo crecerá hasta ser el proveedor
   completo (src/data/supabase-provider.js).

   Uso desde la consola del navegador:
     await SupabaseRead.summary()
     await SupabaseRead.store()
   ===================================================================== */
(function () {
  'use strict';

  const sb = () => window.sb || null;

  /* Traduce los errores técnicos a algo que se entienda. */
  function friendly(error, table) {
    const raw = String((error && (error.message || error.details || error.hint)) || error || '');
    let text;
    if (/JWT expired|invalid jwt|jwt malformed|expected 3 parts in jwt|not authenticated|invalid claim/i.test(raw)) {
      text = 'La sesión no es válida o caducó. Cierra sesión y vuelve a entrar.';
    } else if (/permission denied|row-level security|violates row-level|insufficient privilege/i.test(raw)) {
      text = 'Tu cuenta no tiene permiso para leer estos datos.';
    } else if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(raw)) {
      text = 'No hay conexión con la nube. Revisa internet e inténtalo de nuevo.';
    } else if (/does not exist|schema cache|could not find the table/i.test(raw)) {
      text = 'Falta una tabla en la base de datos. Avísame y lo reviso.';
    } else {
      text = raw || 'No se pudieron leer los datos de la nube.';
    }
    const err = new Error(text);
    err.table = table || null;
    err.raw = raw;
    return err;
  }

  /* Una consulta simple. Los permisos de la base filtran por local y rol. */
  async function select(client, table, columns, order) {
    let q = client.from(table).select(columns);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) throw friendly(error, table);
    return data || [];
  }

  /* Lee el catálogo completo del local del usuario. */
  async function catalog(client) {
    const [areas, blocks, items, params, workers, bosses, links] = await Promise.all([
      select(client, 'areas', 'id,name,boss_id,active,sort_order', 'sort_order'),
      select(client, 'checklist_blocks', 'id,area_id,type,sub,sort_order', 'sort_order'),
      select(client, 'checklist_items', 'id,block_id,text,sort_order,active', 'sort_order'),
      select(client, 'hygiene_params', 'id,text,sort_order,active', 'sort_order'),
      select(client, 'workers', 'id,name,position,active', 'name'),
      select(client, 'bosses', 'id,name,position,active', 'name'),
      select(client, 'area_workers', 'area_id,worker_id')
    ]);

    const itemsByBlock = new Map();
    items.forEach(it => {
      if (!itemsByBlock.has(it.block_id)) itemsByBlock.set(it.block_id, []);
      itemsByBlock.get(it.block_id).push({ id: it.id, text: it.text });
    });

    const workersByArea = new Map();
    links.forEach(l => {
      if (!workersByArea.has(l.area_id)) workersByArea.set(l.area_id, []);
      workersByArea.get(l.area_id).push(l.worker_id);
    });

    const blocksByArea = new Map();
    blocks.forEach(b => {
      if (!blocksByArea.has(b.area_id)) blocksByArea.set(b.area_id, []);
      blocksByArea.get(b.area_id).push({
        id: b.id,
        type: b.type,
        sub: b.sub || '',
        items: itemsByBlock.get(b.id) || []
      });
    });

    return {
      areas: areas.map(a => ({
        id: a.id,
        name: a.name,
        bossId: a.boss_id || '',
        workerIds: workersByArea.get(a.id) || [],
        blocks: blocksByArea.get(a.id) || []
      })),
      params: params.map(p => ({ id: p.id, text: p.text })),
      workers: workers.map(w => ({ id: w.id, name: w.name, position: w.position || '' })),
      bosses: bosses.map(b => ({ id: b.id, name: b.name, position: b.position || '' })),
      counts: {
        items: items.filter(i => i.active !== false).length,
        blocks: blocks.length
      }
    };
  }

  /* Cuenta las auditorías visibles para el usuario. */
  async function auditCount(client) {
    const rows = await select(client, 'audits', 'id,audit_date,status,evaluator_name', 'audit_date');
    const by = { draft: 0, submitted: 0, reviewed: 0 };
    rows.forEach(r => { if (by[r.status] !== undefined) by[r.status]++; });
    return {
      total: rows.length,
      draft: by.draft,
      submitted: by.submitted,
      reviewed: by.reviewed,
      lastDate: rows.length ? rows[rows.length - 1].audit_date : null
    };
  }

  /* Nombre del local del usuario (si el perfil lo tiene). */
  async function currentStore(client, userId) {
    const { data, error } = await client
      .from('profiles')
      .select('store_id, full_name, role, stores(name)')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw friendly(error, 'profiles');
    return {
      name: data && data.stores ? data.stores.name : null,
      profile: data || null
    };
  }

  /* ---------- API pública ---------- */
  async function summary() {
    const client = sb();
    if (!client) throw new Error('No se pudo cargar la conexión con Supabase.');

    const { data, error } = await client.auth.getSession();
    if (error) throw friendly(error, 'auth');
    const session = data && data.session;
    if (!session || !session.user) {
      const err = new Error('No hay una sesión iniciada. Entra con tu cuenta para comprobar la nube.');
      err.code = 'no-session';
      throw err;
    }

    const [store, cat, audits] = await Promise.all([
      currentStore(client, session.user.id),
      catalog(client),
      auditCount(client)
    ]);

    return {
      ok: true,
      store: store.name,
      profile: store.profile,
      areas: cat.areas.length,
      items: cat.counts.items,
      params: cat.params.length,
      workers: cat.workers.length,
      bosses: cat.bosses.length,
      audits
    };
  }

  /* Catálogo completo, en el formato que usa la app. */
  async function store() {
    const client = sb();
    if (!client) throw new Error('No se pudo cargar la conexión con Supabase.');
    const cat = await catalog(client);
    return cat;
  }

  /* ---------- Auditorías completas, en el formato que usa la app ----------
     Las usa la jefa de calidad (no tiene copia local). Las fotos son
     enlaces firmados temporales (1 hora). Incluye su conformidad, si hay. */
  const AUDIT_COLUMNS = 'id,audit_date,evaluator_name,goal,created_at,'
    + 'audit_conformity(note,reviewer_name,updated_at),'
    + 'audit_area_results(id,area_id,area_name,boss_name,not_evaluated,total_items,done_items,sort_order,'
    + 'audit_blocks(id,block_type,label,sort_order,'
    + 'audit_entries(id,item_id,param_id,worker_id,worker_name,item_text,status,observation,created_at,audit_photos(storage_path))),'
    + 'audit_absences(worker_id,worker_name))';

  const bySort = (a, b) => (a.sort_order || 0) - (b.sort_order || 0);
  const byCreated = (a, b) => String(a.created_at).localeCompare(String(b.created_at));
  const one = x => Array.isArray(x) ? (x[0] || null) : (x || null);

  async function audits(limit) {
    const client = sb();
    if (!client) throw new Error('No se pudo cargar la conexión con Supabase.');
    const { data, error } = await client
      .from('audits')
      .select(AUDIT_COLUMNS)
      .order('audit_date', { ascending: false })
      .limit(limit || 120);
    if (error) throw friendly(error, 'audits');

    const paths = [];
    (data || []).forEach(a => (a.audit_area_results || []).forEach(r => (r.audit_blocks || []).forEach(b =>
      (b.audit_entries || []).forEach(e => (e.audit_photos || []).forEach(p => paths.push(p.storage_path))))));

    const urls = new Map();
    if (paths.length) {
      const { data: signed } = await client.storage.from('audit-photos').createSignedUrls(paths, 3600);
      (signed || []).forEach(x => { if (x && x.signedUrl && x.path) urls.set(x.path, x.signedUrl); });
    }

    return (data || []).map(a => {
      const conf = one(a.audit_conformity);
      const areas = (a.audit_area_results || []).slice().sort(bySort).map(r => {
        const base = { areaId: r.area_id || r.id, areaName: r.area_name, boss: r.boss_name || '',
          notEvaluated: !!r.not_evaluated, total: r.total_items || 0, done: r.done_items || 0 };
        if (r.not_evaluated) return base;
        const blocks = (r.audit_blocks || []).slice().sort(bySort).map(b => {
          const isW = b.block_type === 'trabajadores';
          return {
            id: b.id, type: b.block_type, label: b.label,
            entries: (b.audit_entries || []).slice().sort(byCreated).map(e => ({
              k: e.param_id || e.item_id || e.id, w: e.worker_id || e.worker_name, worker: e.worker_name || '',
              text: e.item_text, status: e.status, obs: e.observation || '',
              photos: (e.audit_photos || []).map(p => urls.get(p.storage_path)).filter(Boolean)
            })),
            ...(isW ? { absent: (r.audit_absences || []).map(x => ({ id: x.worker_id || x.worker_name, name: x.worker_name })) } : {})
          };
        });
        if (!blocks.some(b => b.type === 'trabajadores') && (r.audit_absences || []).length) {
          blocks.unshift({ id: 'workers', type: 'trabajadores', label: 'Check Trabajadores', entries: [],
            absent: r.audit_absences.map(x => ({ id: x.worker_id || x.worker_name, name: x.worker_name })) });
        }
        return { ...base, blocks };
      });
      return {
        id: a.id, cloudId: a.id, cloudSyncedAt: a.created_at, date: a.audit_date, ts: a.created_at,
        evaluator: a.evaluator_name || '', goal: a.goal, areas,
        conformity: conf ? { note: conf.note || '', by: conf.reviewer_name || '', at: conf.updated_at } : null
      };
    });
  }

  /* Conformidades (fecha → datos), para mostrarlas también a la monitora. */
  async function conformities() {
    const client = sb();
    if (!client) return new Map();
    const { data, error } = await client
      .from('audit_conformity')
      .select('note,reviewer_name,updated_at,audits(audit_date)');
    if (error) throw friendly(error, 'audit_conformity');
    const out = new Map();
    (data || []).forEach(c => {
      const a = one(c.audits);
      if (a) out.set(a.audit_date, { note: c.note || '', by: c.reviewer_name || '', at: c.updated_at });
    });
    return out;
  }

  window.SupabaseRead = { summary, store, catalog, audits, conformities, friendly };
})();
