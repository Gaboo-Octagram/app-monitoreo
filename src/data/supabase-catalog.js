/* =====================================================================
   Catálogo en Supabase (áreas, checks, trabajadores, jefes, parámetros)
   ---------------------------------------------------------------------
   push(db) deja la nube igual al catálogo de la app:
     - lo nuevo o editado se guarda (upsert por id),
     - lo que ya no está pasa a inactivo (active = false), así el historial
       viejo no se rompe; los bloques sin uso sí se borran.
   Solo lo pueden hacer el administrador y la monitora (lo exige la base).
   Los datos de ejemplo (sample) nunca se suben.
   ===================================================================== */
(function () {
  'use strict';

  const sb = () => window.sb || null;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const friendly = (e, t) => (window.SupabaseRead ? SupabaseRead.friendly(e, t) : Object.assign(new Error(String((e && e.message) || e)), { table: t }));
  const chunk = (l, n) => { const o = []; for (let i = 0; i < l.length; i += n) o.push(l.slice(i, i + n)); return o; };

  /* Lo que se sube, sin ejemplos. Sirve también para detectar cambios. */
  function payload(db) {
    const workers = db.workers.filter(w => !w.sample);
    const bosses = db.bosses.filter(b => !b.sample);
    const wOk = new Set(workers.map(w => w.id)), bOk = new Set(bosses.map(b => b.id));
    return {
      bosses, workers,
      params: db.params,
      areas: db.areas.map(a => ({ ...a, bossId: bOk.has(a.bossId) ? a.bossId : '', workerIds: (a.workerIds || []).filter(id => wOk.has(id)) }))
    };
  }
  const signature = db => JSON.stringify(payload(db));

  async function ok(promise, table) {
    const { data, error } = await promise;
    if (error) throw friendly(error, table);
    return data || [];
  }

  async function upsert(client, table, rows) {
    for (const part of chunk(rows, 200)) await ok(client.from(table).upsert(part, { onConflict: 'id' }), table);
  }

  /* Marca como inactivo (o borra) lo que existe en la nube y ya no está en la app. */
  async function retire(client, table, keep, mode) {
    const rows = await ok(client.from(table).select(mode === 'delete' ? 'id' : 'id,active'), table);
    const gone = rows.filter(r => mode === 'delete' || r.active !== false).map(r => r.id).filter(id => !keep.has(id));
    for (const part of chunk(gone, 100)) {
      if (mode === 'delete') await ok(client.from(table).delete().in('id', part), table);
      else await ok(client.from(table).update({ active: false }).in('id', part), table);
    }
  }

  async function push(db) {
    const client = sb();
    if (!client) return { skipped: 'sin-cliente' };
    const { data: ses } = await client.auth.getSession();
    const user = ses && ses.session && ses.session.user;
    if (!user) return { skipped: 'sin-sesion' };
    const { data: prof, error: pe } = await client.from('profiles').select('store_id, role, active').eq('id', user.id).maybeSingle();
    if (pe) throw friendly(pe, 'profiles');
    if (!prof || !prof.active || !prof.store_id) return { skipped: 'sin-local' };
    if (!['administrador', 'monitora'].includes(prof.role)) return { skipped: 'rol' };
    const store = prof.store_id;

    const c = payload(db);
    const everyId = [...c.bosses, ...c.workers, ...c.params, ...c.areas, ...c.areas.flatMap(a => [...a.blocks, ...a.blocks.flatMap(b => b.items)])];
    if (everyId.some(x => !UUID.test(x.id))) throw new Error('El catálogo local es antiguo. Recarga la página para sincronizarlo con la nube.');

    /* Un área archivada con el mismo nombre estorba (nombre único por local). */
    const cloudAreas = await ok(client.from('areas').select('id,name,active'), 'areas');
    const localNames = new Map(c.areas.map(a => [norm(a.name), a.id]));
    for (const ca of cloudAreas) {
      if (ca.active === false && localNames.has(norm(ca.name)) && localNames.get(norm(ca.name)) !== ca.id) {
        await ok(client.from('areas').update({ name: `${ca.name} (archivada ${ca.id.slice(0, 4)})` }).eq('id', ca.id), 'areas');
      }
    }

    await upsert(client, 'bosses', c.bosses.map(b => ({ id: b.id, store_id: store, name: b.name, position: b.role || b.position || '', active: true })));
    await upsert(client, 'workers', c.workers.map(w => ({ id: w.id, store_id: store, name: w.name, position: w.role || w.position || '', active: true })));
    await upsert(client, 'hygiene_params', c.params.map((p, i) => ({ id: p.id, store_id: store, text: p.text, sort_order: i, active: true })));
    await upsert(client, 'areas', c.areas.map((a, i) => ({ id: a.id, store_id: store, name: a.name, boss_id: a.bossId || null, sort_order: i, active: true })));

    const blocks = c.areas.flatMap(a => a.blocks.map((b, i) => ({ id: b.id, area_id: a.id, type: b.type, sub: b.sub || '', sort_order: i })));
    await upsert(client, 'checklist_blocks', blocks);
    const items = c.areas.flatMap(a => a.blocks.flatMap(b => b.items.map((it, i) => ({ id: it.id, block_id: b.id, text: it.text, sort_order: i, active: true }))));
    await upsert(client, 'checklist_items', items);

    /* Trabajadores por área: se reemplaza el conjunto completo. */
    await ok(client.from('area_workers').delete().eq('store_id', store), 'area_workers');
    const links = c.areas.flatMap(a => a.workerIds.map(w => ({ area_id: a.id, worker_id: w, store_id: store })));
    for (const part of chunk(links, 200)) await ok(client.from('area_workers').insert(part), 'area_workers');

    await retire(client, 'checklist_items', new Set(items.map(x => x.id)));
    await retire(client, 'checklist_blocks', new Set(blocks.map(x => x.id)), 'delete');
    await retire(client, 'areas', new Set(c.areas.map(x => x.id)));
    await retire(client, 'workers', new Set(c.workers.map(x => x.id)));
    await retire(client, 'bosses', new Set(c.bosses.map(x => x.id)));
    await retire(client, 'hygiene_params', new Set(c.params.map(x => x.id)));

    return { ok: true, areas: c.areas.length, items: items.length };
  }

  window.SupabaseCatalog = { push, signature };
})();
