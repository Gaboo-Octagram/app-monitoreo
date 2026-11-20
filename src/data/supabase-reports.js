/* =====================================================================
   Informes semanales anteriores (Word) en Supabase
   ---------------------------------------------------------------------
   Guarda el .docx en Storage (bucket weekly-reports) y sus porcentajes en
   weekly_reports / weekly_report_values (migración 005).
     SupabaseReports.list()                    -> [{id, year, week, start, areaId, areaName, fileName, filePath, fileSize, rows}]
     SupabaseReports.save(file, info)          -> guarda (reemplaza la misma área y semana)
     SupabaseReports.remove(id, filePath)      -> borra fila, valores y archivo
     SupabaseReports.download(filePath, name)  -> abre el Word con un enlace temporal
   Solo administrador y jefa pueden escribir (lo exige la base de datos).
   ===================================================================== */
(function () {
  'use strict';
  const BUCKET = 'weekly-reports';
  const MAX = 10 * 1024 * 1024;
  const sb = () => window.sb || null;

  function friendly(error, table) {
    if (window.SupabaseRead && SupabaseRead.friendly) return SupabaseRead.friendly(error, table);
    return Object.assign(new Error(String((error && error.message) || error || 'No se pudo completar la operación.')), { table: table || null });
  }
  function need() {
    const c = sb();
    if (!c) throw new Error('Inicia sesión para subir informes a la nube.');
    return c;
  }
  const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

  async function storeId(client) {
    const { data: s } = await client.auth.getSession();
    const uid = s && s.session && s.session.user && s.session.user.id;
    if (!uid) throw new Error('Tu sesión venció. Vuelve a entrar.');
    const { data, error } = await client.from('profiles').select('store_id').eq('id', uid).maybeSingle();
    if (error) throw friendly(error, 'profiles');
    if (!data || !data.store_id) throw new Error('Tu usuario no tiene local asignado.');
    return data.store_id;
  }

  async function list() {
    const client = sb(); if (!client) return null;
    const { data, error } = await client.from('weekly_reports')
      .select('id, area_id, year, week, week_start, file_name, file_path, file_size, areas(name), weekly_report_values(type, sub, pct)')
      .order('week_start', { ascending: false });
    if (error) throw friendly(error, 'weekly_reports');
    return (data || []).map(r => ({
      id: r.id, year: r.year, week: r.week, start: r.week_start, areaId: r.area_id,
      areaName: (r.areas && r.areas.name) || '', fileName: r.file_name, filePath: r.file_path, fileSize: r.file_size,
      rows: (r.weekly_report_values || []).map(v => ({ type: v.type, sub: v.sub || '', pct: Number(v.pct) }))
    }));
  }

  async function remove(id, filePath) {
    const client = need();
    if (filePath) await client.storage.from(BUCKET).remove([filePath]);
    const { error } = await client.from('weekly_reports').delete().eq('id', id);
    if (error) throw friendly(error, 'weekly_reports');
  }

  /* info: { areaId, year, week, start, fileName, rows:[{type, sub, pct}] } */
  async function save(file, info) {
    const client = need();
    if (file.size > MAX) throw new Error(`"${file.name}" supera 10 MB y no se guardó.`);
    const store = await storeId(client);
    // Misma área y semana: se reemplaza el informe anterior (archivo y valores).
    const { data: old, error: oe } = await client.from('weekly_reports').select('id, file_path')
      .eq('store_id', store).eq('area_id', info.areaId).eq('year', info.year).eq('week', info.week).maybeSingle();
    if (oe) throw friendly(oe, 'weekly_reports');
    if (old) await remove(old.id, old.file_path);

    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    const path = `${store}/${info.areaId}/${info.year}-S${String(info.week).padStart(2, '0')}-${id}-${safe(file.name)}`;
    const up = await client.storage.from(BUCKET).upload(path, file, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false });
    if (up.error) throw new Error('No se pudo subir el archivo: ' + (up.error.message || up.error));

    const { error: ie } = await client.from('weekly_reports').insert({
      id, store_id: store, area_id: info.areaId, year: info.year, week: info.week, week_start: info.start,
      file_name: file.name, file_path: path, file_size: file.size });
    if (ie) { await client.storage.from(BUCKET).remove([path]); throw friendly(ie, 'weekly_reports'); }

    const vals = info.rows.map(r => ({ report_id: id, store_id: store, type: r.type, sub: r.sub || '', pct: r.pct }));
    if (vals.length) {
      const { error: ve } = await client.from('weekly_report_values').insert(vals);
      if (ve) { await client.from('weekly_reports').delete().eq('id', id); await client.storage.from(BUCKET).remove([path]); throw friendly(ve, 'weekly_report_values'); }
    }
    return { id, filePath: path };
  }

  async function download(filePath, name) {
    const client = need();
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(filePath, 300, { download: name || true });
    if (error) throw friendly(error, 'storage');
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  window.SupabaseReports = { list, save, remove, download, MAX };
})();
