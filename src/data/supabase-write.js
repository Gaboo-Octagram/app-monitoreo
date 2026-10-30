/* =====================================================================
   Escritura hacia Supabase
   ---------------------------------------------------------------------
   Sube UNA auditoría guardada: la fila principal, los resultados por
   área, los bloques, cada check, las ausencias y las fotos a Storage.

   Reglas de esta etapa (a propósito):
     - El navegador sigue siendo la copia principal. Si no hay internet,
       no hay sesión o algo falla, la auditoría ya quedó guardada local.
     - Se sube como BORRADOR ('draft'). La monitora podrá enviarla
       después; mientras esté en borrador se puede volver a subir.
     - Si la auditoría ya fue enviada o revisada, no se toca.
     - Las fotos se suben a audit-photos/<local>/<auditoría>/<check>/n.jpg
       (esa ruta es la que exigen los permisos de Storage).

   Uso:
     await SupabaseWrite.saveAudit(auditoria, db)
   Devuelve { ok, auditId, entries, photos } o { skipped, motivo }.
   ===================================================================== */
(function () {
  'use strict';

  const BUCKET = 'audit-photos';
  const sb = () => window.sb || null;

  const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function friendly(error, table) {
    if (window.SupabaseRead && SupabaseRead.friendly) return SupabaseRead.friendly(error, table);
    const text = String((error && (error.message || error.details)) || error || 'No se pudo guardar en la nube.');
    return Object.assign(new Error(text), { table: table || null });
  }

  /* UUID v4 en el navegador: así armamos la auditoría completa sin esperar
     una respuesta por cada fila. */
  function uuid() {
    const c = window.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  async function currentSession(client) {
    const { data, error } = await client.auth.getSession();
    if (error) throw friendly(error, 'auth');
    return (data && data.session) || null;
  }

  async function currentProfile(client, userId) {
    const { data, error } = await client
      .from('profiles')
      .select('store_id, role, full_name, active')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw friendly(error, 'profiles');
    return data || null;
  }

  /* Nombres y textos del catálogo de la nube, para enlazar las filas con
     las áreas, checks y trabajadores reales. Si algo no coincide, se deja
     vacío: el texto guardado en la auditoría mantiene el historial legible. */
  async function catalogMaps(client) {
    const grab = async (table, columns) => {
      const { data, error } = await client.from(table).select(columns);
      if (error) throw friendly(error, table);
      return data || [];
    };

    const [areas, blocks, items, params, workers] = await Promise.all([
      grab('areas', 'id,name'),
      grab('checklist_blocks', 'id,area_id,type,sub'),
      grab('checklist_items', 'id,block_id,text'),
      grab('hygiene_params', 'id,text'),
      grab('workers', 'id,name')
    ]);

    const areaById = new Map(areas.map(a => [a.id, a]));
    const areaByName = new Map(areas.map(a => [norm(a.name), a.id]));
    const blockLabel = b => `Check ${b.type === 'orden' ? 'Orden' : 'Limpieza'}${b.sub ? ` (${b.sub})` : ''}`;
    const blockByKey = new Map();
    blocks.forEach(b => {
      const area = areaById.get(b.area_id);
      if (!area) return;
      blockByKey.set(`${norm(area.name)}|${b.type}|${norm(blockLabel(b))}`, b.id);
    });
    const itemByKey = new Map(items.map(i => [`${i.block_id}|${norm(i.text)}`, i.id]));
    const paramByText = new Map(params.map(p => [norm(p.text), p.id]));
    const workerByName = new Map(workers.map(w => [norm(w.name), w.id]));

    return { areaByName, blockByKey, itemByKey, paramByText, workerByName };
  }

  /* Borra las fotos viejas de esta auditoría antes de volver a subirlas.
     La estructura es <local>/<auditoría>/<check>/archivo.jpg */
  async function cleanPhotos(client, storeId, auditId) {
    const bucket = client.storage.from(BUCKET);
    const root = `${storeId}/${auditId}`;
    const { data: top, error } = await bucket.list(root, { limit: 100 });
    if (error) return; // sin fotos o sin permiso de listar: no es grave

    const paths = [];
    for (const node of top || []) {
      if (node.id) { paths.push(`${root}/${node.name}`); continue; }
      const { data: inner } = await bucket.list(`${root}/${node.name}`, { limit: 100 });
      (inner || []).forEach(f => { if (f.id) paths.push(`${root}/${node.name}/${f.name}`); });
    }
    if (paths.length) await bucket.remove(paths);
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(r => r.blob());
  }

  const chunk = (list, size) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  };

  /* Sube la auditoría. Si ya existe una del mismo día, la reemplaza
     (siempre que siga en borrador). */
  async function saveAudit(audit, db) {
    const client = sb();
    if (!client) return { skipped: 'sin-cliente' };

    const session = await currentSession(client);
    if (!session || !session.user) return { skipped: 'sin-sesion' };

    const profile = await currentProfile(client, session.user.id);
    if (!profile || !profile.active) return { skipped: 'sin-perfil' };
    if (!profile.store_id) return { skipped: 'sin-local' };
    if (profile.role === 'jefa_calidad') return { skipped: 'rol' };

    const maps = await catalogMaps(client);
    const goal = Math.min(100, Math.max(1, Number(db && db.settings && db.settings.goal) || 90));

    /* 1. Una auditoría por local y día: si ya existe, se actualiza. */
    const { data: existing, error: findErr } = await client
      .from('audits')
      .select('id,status')
      .eq('store_id', profile.store_id)
      .eq('audit_date', audit.date)
      .maybeSingle();
    if (findErr) throw friendly(findErr, 'audits');

    let auditId = null;
    if (existing) {
      const { error: upErr } = await client
        .from('audits')
        .update({
          evaluator_name: audit.evaluator || (db && db.settings && db.settings.evaluator) || '',
          goal
        })
        .eq('id', existing.id);
      if (upErr) {
        if (/ya fue enviada|no se puede editar|no está pendiente/i.test(upErr.message || '')) return { skipped: 'enviada' };
        throw friendly(upErr, 'audits');
      }
      auditId = existing.id;
    } else {
      const { data: row, error: insErr } = await client
        .from('audits')
        .insert({
          store_id: profile.store_id,
          audit_date: audit.date,
          status: 'draft',
          evaluator_id: session.user.id,
          evaluator_name: audit.evaluator || (db && db.settings && db.settings.evaluator) || '',
          goal
        })
        .select('id')
        .single();
      if (insErr) throw friendly(insErr, 'audits');
      auditId = row.id;
    }

    /* 2. Reemplaza el contenido anterior de esa auditoría. */
    const { error: delErr } = await client.from('audit_area_results').delete().eq('audit_id', auditId);
    if (delErr) throw friendly(delErr, 'audit_area_results');
    await cleanPhotos(client, profile.store_id, auditId).catch(() => {});

    const areaRows = [];
    const blockRows = [];
    const entryRows = [];
    const absenceRows = [];
    const photoJobs = []; // { entryId, dataUrl, order }
    let order = 0;

    (audit.areas || []).forEach((r, ai) => {
      const areaResultId = uuid();
      areaRows.push({
        id: areaResultId,
        audit_id: auditId,
        area_id: maps.areaByName.get(norm(r.areaName)) || null,
        area_name: r.areaName || '',
        boss_name: r.boss || '',
        not_evaluated: !!r.notEvaluated,
        total_items: Number(r.total) || 0,
        done_items: Number(r.done) || 0,
        sort_order: ai
      });
      if (r.notEvaluated) return;

      (r.blocks || []).forEach((b, bi) => {
        const blockId = uuid();
        const isWorkers = b.type === 'trabajadores';
        const sourceBlockId = isWorkers ? null
          : (maps.blockByKey.get(`${norm(r.areaName)}|${b.type}|${norm(b.label)}`) || null);
        blockRows.push({
          id: blockId,
          area_result_id: areaResultId,
          block_type: b.type,
          label: b.label || '',
          source_block_id: sourceBlockId,
          sort_order: bi
        });

        (b.entries || []).forEach(e => {
          if (!['ok', 'nok', 'na'].includes(e.status)) return;
          const entryId = uuid();
          entryRows.push({
            id: entryId,
            block_id: blockId,
            item_id: isWorkers ? null : (maps.itemByKey.get(`${sourceBlockId}|${norm(e.text)}`) || null),
            param_id: isWorkers ? (maps.paramByText.get(norm(e.text)) || null) : null,
            worker_id: isWorkers ? (maps.workerByName.get(norm(e.worker)) || null) : null,
            worker_name: e.worker || '',
            item_text: e.text || '',
            status: e.status,
            observation: e.obs || '',
            /* ms distintos para que el orden se conserve al leer. */
            created_at: new Date(Date.now() + order++).toISOString()
          });
          (e.photos || []).forEach((p, pi) => photoJobs.push({ entryId, dataUrl: p, order: pi }));
        });

        if (isWorkers) {
          (b.absent || []).forEach(x => absenceRows.push({
            area_result_id: areaResultId,
            worker_id: maps.workerByName.get(norm(x.name)) || null,
            worker_name: x.name || ''
          }));
        }
      });
    });

    /* 3. Inserta por tandas (PostgREST acepta varias filas de una vez). */
    if (areaRows.length) {
      const { error } = await client.from('audit_area_results').insert(areaRows);
      if (error) throw friendly(error, 'audit_area_results');
    }
    for (const part of chunk(blockRows, 200)) {
      const { error } = await client.from('audit_blocks').insert(part);
      if (error) throw friendly(error, 'audit_blocks');
    }
    for (const part of chunk(entryRows, 200)) {
      const { error } = await client.from('audit_entries').insert(part);
      if (error) throw friendly(error, 'audit_entries');
    }
    for (const part of chunk(absenceRows, 200)) {
      const { error } = await client.from('audit_absences').insert(part);
      if (error) throw friendly(error, 'audit_absences');
    }

    /* 4. Fotos: primero Storage, después la fila que las enlaza. */
    const bucket = client.storage.from(BUCKET);
    const photoRows = [];
    let failedPhotos = 0;
    for (const job of photoJobs) {
      const path = `${profile.store_id}/${auditId}/${job.entryId}/${job.order + 1}.jpg`;
      try {
        const blob = await dataUrlToBlob(job.dataUrl);
        const { error } = await bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (error) throw error;
        photoRows.push({ id: uuid(), entry_id: job.entryId, storage_path: path });
      } catch (e) {
        failedPhotos++;
      }
    }
    for (const part of chunk(photoRows, 100)) {
      const { error } = await client.from('audit_photos').insert(part);
      if (error) throw friendly(error, 'audit_photos');
    }

    return {
      ok: true,
      auditId,
      entries: entryRows.length,
      photos: photoRows.length,
      failedPhotos
    };
  }

  /* Borra la copia en la nube de una auditoría (se busca por fecha).
     Solo funciona mientras siga en borrador: si ya fue enviada o
     revisada, se conserva como historial. */
  async function removeAudit(audit) {
    const client = sb();
    if (!client) return { skipped: 'sin-cliente' };
    const session = await currentSession(client);
    if (!session || !session.user) return { skipped: 'sin-sesion' };
    const profile = await currentProfile(client, session.user.id);
    if (!profile || !profile.store_id) return { skipped: 'sin-local' };

    const { data: row, error } = await client
      .from('audits')
      .select('id,status')
      .eq('store_id', profile.store_id)
      .eq('audit_date', audit.date)
      .maybeSingle();
    if (error) throw friendly(error, 'audits');
    if (!row) return { skipped: 'no-existe' };

    const { error: delErr } = await client.from('audits').delete().eq('id', row.id);
    if (delErr) throw friendly(delErr, 'audits');
    await cleanPhotos(client, profile.store_id, row.id).catch(() => {});
    return { ok: true, auditId: row.id };
  }

  /* Conformidad diaria de la jefa: opcional, una sola observación. */
  async function saveConformity(auditId, note) {
    const client = sb();
    if (!client) throw friendly('No hay conexión con la nube.', 'audit_conformity');
    const session = await currentSession(client);
    if (!session || !session.user) throw friendly('Inicia sesión para dar la conformidad.', 'audit_conformity');
    const profile = await currentProfile(client, session.user.id);
    const text = String(note || '').trim().slice(0, 500);
    const { error } = await client.from('audit_conformity').upsert({
      audit_id: auditId,
      reviewer_id: session.user.id,
      reviewer_name: (profile && profile.full_name) || '',
      note: text
    }, { onConflict: 'audit_id' });
    if (error) throw friendly(error, 'audit_conformity');
    return { ok: true, by: (profile && profile.full_name) || '', note: text };
  }

  /* Borrado total del historial (solo administrador): función de la base +
     limpieza de las fotos de Storage. Devuelve cuántas auditorías se borraron. */
  async function deleteAllAudits(phrase) {
    const client = sb();
    if (!client) throw friendly('No hay conexión con la nube.', 'audits');
    const session = await currentSession(client);
    if (!session || !session.user) throw friendly('Inicia sesión para continuar.', 'audits');
    const profile = await currentProfile(client, session.user.id);
    const { data, error } = await client.rpc('delete_all_audits', { p_confirm: phrase });
    if (error) throw friendly(error, 'audits');
    if (profile && profile.store_id) {
      const bucket = client.storage.from(BUCKET);
      const { data: dirs } = await bucket.list(profile.store_id, { limit: 1000 });
      for (const d of dirs || []) await cleanPhotos(client, profile.store_id, d.name).catch(() => {});
    }
    return { deleted: Number(data) || 0 };
  }

  window.SupabaseWrite = { saveAudit, removeAudit, saveConformity, deleteAllAudits, uuid };
})();
