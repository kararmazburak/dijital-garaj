// İş kuralları: seferler, belgeler, bakım, lastik, parça, masraf, arıza.
import express from 'express';
import { all, get, run, tx, getSettings } from './db.js';
import { clean, bad, forbidden, conflict, notFound, nowIso, today, daysBetween, round2, dotToDate, trDate } from './util.js';
import { can, readScope, assertCan, requirePerm } from './perms.js';
import { insert, update, mustGet, audit, diff, ah, idParam } from './crud.js';
import { tireUsage } from './alerts.js';

export const STATUS_LABELS = { available: 'Müsait', on_trip: 'Seferde', maintenance: 'Bakımda', broken: 'Arızalı', passive: 'Pasif' };

export const EXPENSE_CATEGORIES = {
  fuel: 'Yakıt',
  maintenance: 'Bakım',
  part: 'Parça',
  tire: 'Lastik',
  insurance: 'Sigorta',
  casco: 'Kasko',
  inspection: 'Muayene',
  toll_parking: 'Otopark / Köprü-Otoyol',
  fine: 'Ceza',
  wash: 'Yıkama',
  other: 'Diğer',
};

export const MAINT_KINDS = { periodic: 'Periyodik bakım', repair: 'Onarım', accident: 'Kaza onarımı', wash: 'Yıkama', other: 'Diğer' };
export const SEVERITIES = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' };
export const TIRE_POSITIONS = ['Ön Sol', 'Ön Sağ', 'Arka Sol', 'Arka Sağ', 'Arka Sol İç', 'Arka Sağ İç', 'Orta Sol', 'Orta Sağ', 'Stepne'];

/** Aracın görünen durumu: sefer, kritik arıza ve elle verilen durum birleşimi. */
export const STATUS_SQL = `CASE
  WHEN v.status = 'passive' THEN 'passive'
  WHEN EXISTS (SELECT 1 FROM trips t0 WHERE t0.vehicle_id = v.id AND t0.end_at IS NULL) THEN 'on_trip'
  WHEN v.status = 'broken' OR EXISTS (SELECT 1 FROM issues i0 WHERE i0.vehicle_id = v.id AND i0.severity = 'critical' AND i0.status IN ('open','in_progress')) THEN 'broken'
  WHEN v.status = 'maintenance' THEN 'maintenance'
  ELSE 'available' END`;

export const VEHICLE_SELECT = `
  SELECT v.*, vt.name AS type_name, vt.code AS type_code, vt.body, vt.length AS type_length, vt.icon AS type_icon,
         ${STATUS_SQL} AS display_status,
         u.full_name AS driver_name,
         (SELECT t1.id FROM trips t1 WHERE t1.vehicle_id = v.id AND t1.end_at IS NULL) AS open_trip_id
    FROM vehicles v
    JOIN vehicle_types vt ON vt.id = v.type_id
    LEFT JOIN users u ON u.id = v.active_driver_id`;

export function vehicleWithStatus(id) {
  return get(`${VEHICLE_SELECT} WHERE v.id = ?`, id);
}

function mustVehicle(id) {
  const v = vehicleWithStatus(id);
  if (!v) throw notFound('Araç');
  return v;
}

/** Kaynağı belge/bakım/lastik olan otomatik masrafı oluşturur, günceller veya siler. */
export function syncExpense(source, sourceId, data) {
  const existing = get('SELECT * FROM expenses WHERE source = ? AND source_id = ?', source, sourceId);
  if (!data || !(Number(data.amount) > 0)) {
    if (existing) run('DELETE FROM expenses WHERE id = ?', existing.id);
    return null;
  }
  const row = {
    vehicle_id: data.vehicle_id ?? null,
    category: data.category,
    amount: round2(data.amount),
    date: data.date || today(),
    description: data.description ?? null,
    invoice_no: data.invoice_no ?? null,
  };
  if (existing) {
    update('expenses', existing.id, { ...row, updated_at: nowIso() });
    return existing.id;
  }
  return insert('expenses', {
    ...row,
    source,
    source_id: sourceId,
    status: 'approved',
    approved_by: data.created_by ?? null,
    approved_at: nowIso(),
    created_by: data.created_by ?? null,
    created_at: nowIso(),
  });
}

/** Aracın km değerini tüm kayıtlardan yeniden hesaplar (düzeltme/silme sonrası). */
export function recomputeVehicleKm(vehicleId) {
  const r = get(
    `SELECT MAX(x) AS km FROM (
       SELECT initial_km AS x FROM vehicles WHERE id = ?1
       UNION ALL SELECT MAX(start_km) FROM trips WHERE vehicle_id = ?1
       UNION ALL SELECT MAX(end_km) FROM trips WHERE vehicle_id = ?1
       UNION ALL SELECT MAX(km) FROM maintenance WHERE vehicle_id = ?1 AND status = 'done')`,
    vehicleId,
  );
  run('UPDATE vehicles SET current_km = ?, updated_at = ? WHERE id = ?', r?.km ?? 0, nowIso(), vehicleId);
}

function bumpVehicleKm(vehicleId, km) {
  if (km == null) return;
  run('UPDATE vehicles SET current_km = MAX(current_km, ?), updated_at = ? WHERE id = ?', km, nowIso(), vehicleId);
}

/** Sefer başlatmayı engelleyen kurallar (zorla çıkışla aşılabilenler). */
export function tripBlocks(vehicle, driver) {
  const s = getSettings();
  const t = today();
  const blocks = [];
  if (vehicle.display_status === 'maintenance') blocks.push({ code: 'VEHICLE_IN_MAINTENANCE', message: 'Araç bakımda görünüyor.' });
  if (vehicle.display_status === 'broken') blocks.push({ code: 'VEHICLE_BROKEN', message: 'Araçta açık kritik arıza var.' });
  if (s.block_on_expired_license && driver) {
    if (driver.license_expiry && driver.license_expiry < t) blocks.push({ code: 'LICENSE_EXPIRED', message: `${driver.full_name} adlı şoförün ehliyet süresi ${trDate(driver.license_expiry)} tarihinde dolmuş.` });
    if (driver.src_expiry && driver.src_expiry < t) blocks.push({ code: 'SRC_EXPIRED', message: `${driver.full_name} adlı şoförün SRC belgesinin süresi ${trDate(driver.src_expiry)} tarihinde dolmuş.` });
  }
  if (s.block_on_expired_docs) {
    const required = all('SELECT id, name, has_expiry FROM doc_types WHERE required = 1 AND active = 1');
    for (const dt of required) {
      const doc = get('SELECT * FROM documents WHERE vehicle_id = ? AND doc_type_id = ? AND archived = 0 ORDER BY end_date DESC LIMIT 1', vehicle.id, dt.id);
      if (!doc) blocks.push({ code: 'DOC_MISSING', message: `${dt.name} kaydı yok.` });
      else if (dt.has_expiry && doc.end_date && doc.end_date < t) blocks.push({ code: 'DOC_EXPIRED', message: `${dt.name} süresi ${trDate(doc.end_date)} tarihinde dolmuş.` });
    }
  }
  return blocks;
}

// =====================================================================
export function domainRouter() {
  const r = express.Router();

  // ---------------- SEFERLER ----------------
  r.get('/trips', ah((req, res) => {
    const scope = readScope(req.user, 'trips');
    if (!scope) throw forbidden();
    const where = [];
    const p = [];
    if (scope === 'own') {
      where.push('t.driver_id = ?');
      p.push(req.user.id);
    }
    for (const k of ['vehicle_id', 'driver_id', 'id']) {
      if (req.query[k]) {
        where.push(`t.${k} = ?`);
        p.push(Number(req.query[k]));
      }
    }
    if (req.query.open === '1') where.push('t.end_at IS NULL');
    if (req.query.from) {
      where.push('t.start_at >= ?');
      p.push(String(req.query.from));
    }
    if (req.query.to) {
      where.push('t.start_at < ?');
      p.push(String(req.query.to) + 'T99');
    }
    const rows = all(
      `SELECT t.*, v.plate, v.brand, v.model, u.full_name AS driver_name,
              CASE WHEN t.end_km IS NOT NULL THEN t.end_km - t.start_km END AS distance
         FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = t.driver_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (t.end_at IS NULL) DESC, t.start_at DESC LIMIT 3000`,
      ...p,
    );
    res.json(rows);
  }));

  r.get('/trips/check', ah((req, res) => {
    // Çıkış öncesi kural ön kontrolü (form uyarıları için)
    const v = mustVehicle(Number(req.query.vehicle_id));
    const driverId = Number(req.query.driver_id) || req.user.id;
    const driver = get('SELECT * FROM users WHERE id = ?', driverId);
    res.json({ vehicle: { id: v.id, plate: v.plate, current_km: v.current_km, display_status: v.display_status }, blocks: tripBlocks(v, driver) });
  }));

  r.post('/trips/start', ah((req, res) => {
    const manage = can(req.user, 'trips', 'manage');
    if (!manage && !can(req.user, 'trips', 'create')) throw forbidden('Araç çıkışı yapma yetkiniz yok');
    const b = clean(req.body, {
      vehicle_id: { type: 'id', required: true, label: 'Araç' },
      start_km: { type: 'int', required: true, min: 0, max: 9999999, label: 'Çıkış km' },
      purpose: { type: 'str', max: 300, label: 'Amaç' },
      destination: { type: 'str', max: 300, label: 'Gidilecek yer' },
      notes: { type: 'str', max: 2000 },
      driver_id: { type: 'id', label: 'Şoför' },
      force: { type: 'bool' },
      force_reason: { type: 'str', max: 500, label: 'Gerekçe' },
    });
    let driverId = req.user.id;
    if (b.driver_id && b.driver_id !== req.user.id) {
      if (!manage) throw forbidden('Başkası adına çıkış yapma yetkiniz yok');
      driverId = b.driver_id;
    }
    if (b.force && !manage) throw forbidden('Zorla çıkış yetkiniz yok');
    if (b.force && !b.force_reason) throw bad('Zorla çıkış için gerekçe yazmalısınız', 'FORCE_REASON_REQUIRED');

    const id = tx(() => {
      const v = mustVehicle(b.vehicle_id);
      const driver = get('SELECT * FROM users WHERE id = ? AND active = 1', driverId);
      if (!driver) throw bad('Şoför bulunamadı veya pasif');
      if (v.display_status === 'passive') throw bad('Pasif araç için çıkış yapılamaz', 'VEHICLE_PASSIVE');
      if (v.display_status === 'on_trip') throw conflict(`${v.plate} zaten seferde`, 'VEHICLE_ON_TRIP');
      const open = get('SELECT t.id, v.plate FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.driver_id = ? AND t.end_at IS NULL', driverId);
      if (open) throw conflict(`${driver.full_name} için kapanmamış bir sefer var (${open.plate}). Önce dönüş kaydı yapılmalı.`, 'DRIVER_HAS_OPEN_TRIP', { trip_id: open.id });
      if (b.start_km < v.current_km) {
        throw bad(`Çıkış km (${b.start_km.toLocaleString('tr-TR')}) aracın kayıtlı km değerinden (${v.current_km.toLocaleString('tr-TR')}) küçük olamaz.`, 'KM_TOO_LOW', { current_km: v.current_km });
      }
      const blocks = tripBlocks(v, driver);
      if (blocks.length && !b.force) {
        throw forbidden(`Çıkış engellendi: ${blocks.map((x) => x.message).join(' ')}`, 'TRIP_BLOCKED', { blocks, can_force: manage });
      }
      const now = nowIso();
      const tripId = insert('trips', {
        vehicle_id: v.id,
        driver_id: driverId,
        start_km: b.start_km,
        start_at: now,
        purpose: b.purpose,
        destination: b.destination,
        notes: b.notes,
        forced: blocks.length && b.force ? 1 : 0,
        force_reason: blocks.length && b.force ? b.force_reason : null,
        created_by: req.user.id,
        created_at: now,
      });
      run('UPDATE vehicles SET current_km = ?, active_driver_id = ?, updated_at = ? WHERE id = ?', b.start_km, driverId, now, v.id);
      audit(req, blocks.length && b.force ? 'trip_force_start' : 'trip_start', 'trip', tripId, null,
        { plate: v.plate, driver: driver.full_name, start_km: b.start_km }, blocks.length && b.force ? `Zorla çıkış: ${b.force_reason} | ${blocks.map((x) => x.code).join(',')}` : null);
      return tripId;
    });
    res.status(201).json(get('SELECT * FROM trips WHERE id = ?', id));
  }));

  r.post('/trips/:id/end', ah((req, res) => {
    const id = idParam(req);
    const manage = can(req.user, 'trips', 'manage');
    const b = clean(req.body, {
      end_km: { type: 'int', required: true, min: 0, max: 9999999, label: 'Dönüş km' },
      fuel_liters: { type: 'num', min: 0, max: 5000, label: 'Alınan yakıt (L)' },
      end_notes: { type: 'str', max: 2000, label: 'Notlar' },
    });
    tx(() => {
      const trip = mustGet('trips', id, 'Sefer');
      if (trip.end_at) throw conflict('Bu sefer zaten kapatılmış', 'TRIP_CLOSED');
      if (!manage && !(trip.driver_id === req.user.id && can(req.user, 'trips', 'create'))) throw forbidden('Bu seferi kapatma yetkiniz yok');
      if (b.end_km < trip.start_km) {
        throw bad(`Dönüş km (${b.end_km.toLocaleString('tr-TR')}) çıkış km değerinden (${trip.start_km.toLocaleString('tr-TR')}) küçük olamaz.`, 'KM_TOO_LOW', { start_km: trip.start_km });
      }
      const now = nowIso();
      update('trips', id, { end_km: b.end_km, end_at: now, fuel_liters: b.fuel_liters, end_notes: b.end_notes });
      run('UPDATE vehicles SET current_km = MAX(current_km, ?), active_driver_id = NULL, updated_at = ? WHERE id = ?', b.end_km, now, trip.vehicle_id);
      audit(req, 'trip_end', 'trip', id, null, { end_km: b.end_km, distance: b.end_km - trip.start_km });
    });
    res.json(get('SELECT * FROM trips WHERE id = ?', id));
  }));

  r.put('/trips/:id', requirePerm('trips', 'manage'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, {
      start_km: { type: 'int', min: 0, max: 9999999, label: 'Çıkış km' },
      end_km: { type: 'int', min: 0, max: 9999999, label: 'Dönüş km' },
      purpose: { type: 'str', max: 300 },
      destination: { type: 'str', max: 300 },
      fuel_liters: { type: 'num', min: 0, max: 5000 },
      notes: { type: 'str', max: 2000 },
      end_notes: { type: 'str', max: 2000 },
      reason: { type: 'str', max: 500, required: true, label: 'Düzeltme gerekçesi' },
    }, { partial: true });
    if (!b.reason) throw bad('Düzeltme gerekçesi zorunludur');
    const reason = b.reason;
    delete b.reason;
    tx(() => {
      const trip = mustGet('trips', id, 'Sefer');
      const start = b.start_km ?? trip.start_km;
      const end = b.end_km !== undefined ? b.end_km : trip.end_km;
      if (!trip.end_at && b.end_km != null) throw bad('Açık seferin dönüş km değeri düzeltilemez; önce dönüş kaydı yapın');
      if (end != null && end < start) throw bad('Dönüş km çıkış km değerinden küçük olamaz', 'KM_TOO_LOW');
      const d = diff(trip, b);
      if (!d.changed) return;
      update('trips', id, { ...b, corrected: 1 });
      recomputeVehicleKm(trip.vehicle_id);
      const kmChanged = 'start_km' in d.new || 'end_km' in d.new;
      audit(req, kmChanged ? 'km_correct' : 'trip_update', 'trip', id, d.old, d.new, reason);
    });
    res.json(get('SELECT * FROM trips WHERE id = ?', id));
  }));

  r.delete('/trips/:id', requirePerm('trips', 'manage'), ah((req, res) => {
    const id = idParam(req);
    tx(() => {
      const trip = mustGet('trips', id, 'Sefer');
      run('DELETE FROM trips WHERE id = ?', id);
      if (!trip.end_at) run('UPDATE vehicles SET active_driver_id = NULL WHERE id = ?', trip.vehicle_id);
      recomputeVehicleKm(trip.vehicle_id);
      audit(req, 'delete', 'trip', id, trip, null, String(req.query.reason || '') || null);
    });
    res.json({ ok: true });
  }));

  // ---------------- BELGELER ----------------
  const docSchema = {
    vehicle_id: { type: 'id', required: true, label: 'Araç' },
    doc_type_id: { type: 'id', required: true, label: 'Belge türü' },
    doc_no: { type: 'str', max: 100, label: 'Belge / poliçe no' },
    provider: { type: 'str', max: 200, label: 'Firma' },
    start_date: { type: 'date', label: 'Başlangıç' },
    end_date: { type: 'date', label: 'Bitiş' },
    amount: { type: 'num', min: 0, max: 1e9, label: 'Tutar' },
    file_id: { type: 'id', label: 'Dosya' },
    notes: { type: 'str', max: 2000 },
  };

  function syncDocExpense(doc, userId) {
    const dt = get('SELECT * FROM doc_types WHERE id = ?', doc.doc_type_id);
    syncExpense('document', doc.id, doc.amount > 0 ? {
      vehicle_id: doc.vehicle_id,
      category: dt.expense_category || 'other',
      amount: doc.amount,
      date: doc.start_date || today(),
      description: [dt.name, doc.provider].filter(Boolean).join(' — '),
      invoice_no: doc.doc_no,
      created_by: userId,
    } : null);
  }

  r.get('/documents', requirePerm('documents', 'read'), ah((req, res) => {
    const where = [];
    const p = [];
    if (req.query.vehicle_id) {
      where.push('d.vehicle_id = ?');
      p.push(Number(req.query.vehicle_id));
    }
    if (req.query.doc_type_id) {
      where.push('d.doc_type_id = ?');
      p.push(Number(req.query.doc_type_id));
    }
    if (req.query.archived !== 'all') {
      where.push('d.archived = ?');
      p.push(req.query.archived === '1' ? 1 : 0);
    }
    const t = today();
    const rows = all(
      `SELECT d.*, dt.name AS type_name, dt.has_expiry, dt.required, v.plate, v.brand, v.model,
              f.original_name AS file_name, f.mime AS file_mime
         FROM documents d JOIN doc_types dt ON dt.id = d.doc_type_id JOIN vehicles v ON v.id = d.vehicle_id
         LEFT JOIN uploads f ON f.id = d.file_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (d.end_date IS NULL), d.end_date, v.plate`,
      ...p,
    );
    for (const d of rows) d.days_left = d.end_date ? daysBetween(t, d.end_date) : null;
    res.json(rows);
  }));

  r.post('/documents', requirePerm('documents', 'create'), ah((req, res) => {
    const b = clean(req.body, docSchema);
    const id = tx(() => {
      const v = mustVehicle(b.vehicle_id);
      const dt = mustGet('doc_types', b.doc_type_id, 'Belge türü');
      if (dt.has_expiry && !b.end_date) throw bad(`${dt.name} için bitiş tarihi zorunludur`, 'VALIDATION', { field: 'end_date' });
      if (b.start_date && b.end_date && b.end_date < b.start_date) throw bad('Bitiş tarihi başlangıçtan önce olamaz', 'VALIDATION', { field: 'end_date' });
      // Yenileme: aynı türün önceki geçerli belgesi arşive geçer.
      const archived = run('UPDATE documents SET archived = 1, updated_at = ? WHERE vehicle_id = ? AND doc_type_id = ? AND archived = 0', nowIso(), v.id, dt.id).changes;
      const docId = insert('documents', { ...b, created_by: req.user.id, created_at: nowIso() });
      syncDocExpense({ ...b, id: docId }, req.user.id);
      audit(req, archived ? 'document_renew' : 'create', 'document', docId, null, { plate: v.plate, type: dt.name, end_date: b.end_date, amount: b.amount });
      return docId;
    });
    res.status(201).json(get('SELECT * FROM documents WHERE id = ?', id));
  }));

  r.put('/documents/:id', requirePerm('documents', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, docSchema, { partial: true });
    delete b.vehicle_id;
    tx(() => {
      const old = mustGet('documents', id, 'Belge');
      const merged = { ...old, ...b };
      const dt = mustGet('doc_types', merged.doc_type_id, 'Belge türü');
      if (dt.has_expiry && !merged.end_date) throw bad(`${dt.name} için bitiş tarihi zorunludur`);
      if (merged.start_date && merged.end_date && merged.end_date < merged.start_date) throw bad('Bitiş tarihi başlangıçtan önce olamaz');
      const d = diff(old, b);
      update('documents', id, { ...b, updated_at: nowIso() });
      syncDocExpense(merged, req.user.id);
      if (d.changed) audit(req, 'update', 'document', id, d.old, d.new);
    });
    res.json(get('SELECT * FROM documents WHERE id = ?', id));
  }));

  r.delete('/documents/:id', requirePerm('documents', 'delete'), ah((req, res) => {
    const id = idParam(req);
    tx(() => {
      const old = mustGet('documents', id, 'Belge');
      syncExpense('document', id, null);
      run('DELETE FROM documents WHERE id = ?', id);
      if (!old.archived) {
        // Silinen güncel belgeyse önceki dönemi geri getir.
        const prev = get('SELECT id FROM documents WHERE vehicle_id = ? AND doc_type_id = ? ORDER BY end_date DESC, id DESC LIMIT 1', old.vehicle_id, old.doc_type_id);
        if (prev) run('UPDATE documents SET archived = 0 WHERE id = ?', prev.id);
      }
      audit(req, 'delete', 'document', id, old);
    });
    res.json({ ok: true });
  }));

  // ---------------- BAKIM ----------------
  const maintSchema = {
    vehicle_id: { type: 'id', required: true, label: 'Araç' },
    kind: { type: 'enum', values: Object.keys(MAINT_KINDS), required: true, label: 'Bakım türü' },
    status: { type: 'enum', values: ['done', 'planned'], default: 'done', label: 'Durum' },
    date: { type: 'date', label: 'Tarih' },
    km: { type: 'int', min: 0, max: 9999999, label: 'Km' },
    service_name: { type: 'str', max: 200, label: 'Servis' },
    description: { type: 'str', max: 4000, label: 'Yapılan işlem' },
    labor_cost: { type: 'num', min: 0, max: 1e9, default: 0, label: 'İşçilik' },
    other_cost: { type: 'num', min: 0, max: 1e9, default: 0, label: 'Diğer tutar' },
    invoice_no: { type: 'str', max: 100, label: 'Fatura no' },
    next_km: { type: 'int', min: 0, max: 9999999, label: 'Sonraki bakım km' },
    next_date: { type: 'date', label: 'Sonraki bakım tarihi' },
    issue_id: { type: 'id', label: 'Arıza' },
    file_id: { type: 'id', label: 'Dosya' },
  };

  function normalizeParts(list) {
    if (list == null) return null;
    if (!Array.isArray(list)) throw bad('Parça listesi geçersiz');
    const out = [];
    for (const it of list) {
      const c = clean(it, {
        part_id: { type: 'id', required: true, label: 'Parça' },
        qty: { type: 'num', required: true, min: 0.001, max: 100000, label: 'Miktar' },
        unit_price: { type: 'num', min: 0, max: 1e9, label: 'Birim fiyat' },
      });
      const part = mustGet('parts', c.part_id, 'Parça');
      out.push({ part_id: part.id, qty: c.qty, unit_price: c.unit_price ?? part.unit_price ?? 0, name: part.name, unit: part.unit });
    }
    return out;
  }

  function applyMaintenance(id, req) {
    const m = get('SELECT * FROM maintenance WHERE id = ?', id);
    const parts = all('SELECT mp.*, p.name, p.stock, p.unit FROM maintenance_parts mp JOIN parts p ON p.id = mp.part_id WHERE mp.maintenance_id = ?', id);
    const partsTotal = round2(parts.reduce((s, x) => s + x.qty * x.unit_price, 0));
    const total = round2((m.labor_cost || 0) + partsTotal + (m.other_cost || 0));
    update('maintenance', id, { parts_total: partsTotal, total_cost: total });
    if (m.status !== 'done') return;
    for (const p of parts) {
      const cur = get('SELECT stock FROM parts WHERE id = ?', p.part_id).stock;
      if (cur < p.qty) throw bad(`${p.name} için yeterli stok yok (mevcut ${cur} ${p.unit}, gereken ${p.qty} ${p.unit})`, 'INSUFFICIENT_STOCK');
      const after = round2(cur - p.qty);
      run('UPDATE parts SET stock = ?, updated_at = ? WHERE id = ?', after, nowIso(), p.part_id);
      insert('part_moves', { part_id: p.part_id, kind: 'maintenance', qty: -p.qty, stock_after: after, unit_price: p.unit_price, ref_type: 'maintenance', ref_id: id, created_by: req.user.id, created_at: nowIso() });
    }
    const v = get('SELECT plate FROM vehicles WHERE id = ?', m.vehicle_id);
    syncExpense('maintenance', id, total > 0 ? {
      vehicle_id: m.vehicle_id,
      category: m.kind === 'wash' ? 'wash' : 'maintenance',
      amount: total,
      date: m.date || today(),
      description: `${MAINT_KINDS[m.kind]}${m.service_name ? ' — ' + m.service_name : ''} (${v.plate})`,
      invoice_no: m.invoice_no,
      created_by: req.user.id,
    } : null);
    bumpVehicleKm(m.vehicle_id, m.km);
    if (m.issue_id) {
      run(`UPDATE issues SET status = 'resolved', maintenance_id = ?, resolved_at = COALESCE(resolved_at, ?), updated_at = ? WHERE id = ? AND status IN ('open','in_progress')`, id, nowIso(), nowIso(), m.issue_id);
    }
  }

  function revertMaintenance(id, req) {
    const m = get('SELECT * FROM maintenance WHERE id = ?', id);
    if (m.status === 'done') {
      for (const p of all('SELECT * FROM maintenance_parts WHERE maintenance_id = ?', id)) {
        const cur = get('SELECT stock FROM parts WHERE id = ?', p.part_id).stock;
        const after = round2(cur + p.qty);
        run('UPDATE parts SET stock = ?, updated_at = ? WHERE id = ?', after, nowIso(), p.part_id);
        insert('part_moves', { part_id: p.part_id, kind: 'maintenance_revert', qty: p.qty, stock_after: after, unit_price: p.unit_price, ref_type: 'maintenance', ref_id: id, note: 'Bakım kaydı değişikliği/silme', created_by: req.user.id, created_at: nowIso() });
      }
    }
    syncExpense('maintenance', id, null);
  }

  function validateMaint(m) {
    if (m.status === 'done' && !m.date) throw bad('Yapılan bakım için tarih zorunludur', 'VALIDATION', { field: 'date' });
    if (m.status === 'planned' && !m.date && m.km == null) throw bad('Planlı bakım için tarih veya km girilmelidir', 'VALIDATION', { field: 'date' });
    if (m.status === 'done' && m.date > today()) throw bad('Yapılan bakımın tarihi ileri bir tarih olamaz; planlı bakım olarak kaydedin', 'VALIDATION', { field: 'date' });
  }

  function maintDetail(id) {
    const m = get(`SELECT m.*, v.plate, v.brand, v.model FROM maintenance m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.id = ?`, id);
    if (!m) throw notFound('Bakım kaydı');
    m.parts = all('SELECT mp.*, p.code, p.name, p.unit FROM maintenance_parts mp JOIN parts p ON p.id = mp.part_id WHERE mp.maintenance_id = ?', id);
    if (m.file_id) m.file_name = get('SELECT original_name FROM uploads WHERE id = ?', m.file_id)?.original_name;
    return m;
  }

  r.get('/maintenance', requirePerm('maintenance', 'read'), ah((req, res) => {
    const where = [];
    const p = [];
    for (const k of ['vehicle_id']) if (req.query[k]) { where.push(`m.${k} = ?`); p.push(Number(req.query[k])); }
    for (const k of ['status', 'kind']) if (req.query[k]) { where.push(`m.${k} = ?`); p.push(String(req.query[k])); }
    if (req.query.from) { where.push('m.date >= ?'); p.push(String(req.query.from)); }
    if (req.query.to) { where.push('m.date <= ?'); p.push(String(req.query.to)); }
    res.json(all(
      `SELECT m.*, v.plate, v.brand, v.model,
              (SELECT COUNT(*) FROM maintenance_parts mp WHERE mp.maintenance_id = m.id) AS part_count
         FROM maintenance m JOIN vehicles v ON v.id = m.vehicle_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY (m.status = 'planned') DESC, m.date DESC, m.id DESC`,
      ...p,
    ));
  }));

  r.get('/maintenance/:id', requirePerm('maintenance', 'read'), ah((req, res) => res.json(maintDetail(idParam(req)))));

  r.post('/maintenance', requirePerm('maintenance', 'create'), ah((req, res) => {
    const b = clean(req.body, maintSchema);
    validateMaint(b);
    const id = tx(() => {
      const v = mustVehicle(b.vehicle_id);
      if (b.issue_id) {
        const iss = mustGet('issues', b.issue_id, 'Arıza');
        if (iss.vehicle_id !== v.id) throw bad('Arıza bildirimi başka bir araca ait');
      }
      const parts = normalizeParts(req.body?.parts) || [];
      const mid = insert('maintenance', { ...b, created_by: req.user.id, created_at: nowIso() });
      for (const p of parts) insert('maintenance_parts', { maintenance_id: mid, part_id: p.part_id, qty: p.qty, unit_price: p.unit_price });
      applyMaintenance(mid, req);
      audit(req, 'create', 'maintenance', mid, null, { plate: v.plate, kind: b.kind, status: b.status, km: b.km, parts: parts.map((x) => `${x.name} x${x.qty}`) });
      return mid;
    });
    res.status(201).json(maintDetail(id));
  }));

  r.put('/maintenance/:id', requirePerm('maintenance', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, maintSchema, { partial: true });
    delete b.vehicle_id;
    tx(() => {
      const old = mustGet('maintenance', id, 'Bakım kaydı');
      const merged = { ...old, ...b };
      validateMaint(merged);
      const oldParts = all('SELECT part_id, qty, unit_price FROM maintenance_parts WHERE maintenance_id = ?', id);
      revertMaintenance(id, req);
      const parts = normalizeParts(req.body?.parts) ?? oldParts;
      run('DELETE FROM maintenance_parts WHERE maintenance_id = ?', id);
      update('maintenance', id, { ...b, updated_at: nowIso() });
      for (const p of parts) insert('maintenance_parts', { maintenance_id: id, part_id: p.part_id, qty: p.qty, unit_price: p.unit_price });
      applyMaintenance(id, req);
      if (old.status === 'done' && old.km != null && b.km !== undefined && b.km !== old.km) recomputeVehicleKm(old.vehicle_id);
      const d = diff(old, b);
      audit(req, old.status === 'planned' && merged.status === 'done' ? 'maintenance_complete' : 'update', 'maintenance', id, d.old, d.new);
    });
    res.json(maintDetail(id));
  }));

  r.delete('/maintenance/:id', requirePerm('maintenance', 'delete'), ah((req, res) => {
    const id = idParam(req);
    tx(() => {
      const old = mustGet('maintenance', id, 'Bakım kaydı');
      revertMaintenance(id, req);
      run(`UPDATE issues SET maintenance_id = NULL, status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END, resolved_at = NULL WHERE maintenance_id = ?`, id);
      run('DELETE FROM maintenance WHERE id = ?', id);
      if (old.status === 'done') recomputeVehicleKm(old.vehicle_id);
      audit(req, 'delete', 'maintenance', id, old);
    });
    res.json({ ok: true });
  }));

  // ---------------- LASTİKLER ----------------
  const tireSchema = {
    vehicle_id: { type: 'id', label: 'Araç' },
    brand: { type: 'str', max: 100, label: 'Marka' },
    model: { type: 'str', max: 100, label: 'Model' },
    size: { type: 'str', max: 50, label: 'Ebat' },
    dot: { type: 'str', max: 4, pattern: /^\d{4}$/, label: 'DOT (HHYY)' },
    season: { type: 'enum', values: ['summer', 'winter', 'all'], default: 'summer', label: 'Tür' },
    tread_depth: { type: 'num', min: 0, max: 30, label: 'Diş derinliği' },
    position: { type: 'str', max: 50, label: 'Konum' },
    max_km: { type: 'int', min: 0, max: 1000000, label: 'Km sınırı' },
    cost: { type: 'num', min: 0, max: 1e8, label: 'Tutar' },
    purchase_date: { type: 'date', label: 'Alım tarihi' },
    notes: { type: 'str', max: 2000 },
  };

  function syncTireExpense(tire, userId) {
    const v = tire.vehicle_id ? get('SELECT plate FROM vehicles WHERE id = ?', tire.vehicle_id) : null;
    syncExpense('tire', tire.id, tire.cost > 0 ? {
      vehicle_id: tire.vehicle_id,
      category: 'tire',
      amount: tire.cost,
      date: tire.purchase_date || today(),
      description: `Lastik: ${[tire.brand, tire.model, tire.size].filter(Boolean).join(' ')}${v ? ' (' + v.plate + ')' : ''}`,
      created_by: userId,
    } : null);
  }

  function positionTaken(vehicleId, position, exceptId = 0) {
    return !!get(`SELECT 1 AS x FROM tires WHERE vehicle_id = ? AND status = 'mounted' AND position = ? AND id != ?`, vehicleId, position, exceptId);
  }

  function mountTire(tire, vehicle, position, km, date, req) {
    if (!position) throw bad('Takma konumu zorunludur', 'VALIDATION', { field: 'position' });
    if (positionTaken(vehicle.id, position, tire.id)) throw conflict(`${vehicle.plate} aracının "${position}" konumunda zaten takılı bir lastik var`, 'POSITION_TAKEN');
    const k = km ?? vehicle.current_km;
    update('tires', tire.id, { status: 'mounted', vehicle_id: vehicle.id, position, mounted_km: k, mount_date: date, updated_at: nowIso() });
    insert('tire_events', { tire_id: tire.id, vehicle_id: vehicle.id, kind: 'mount', km: k, date, position, created_by: req.user.id, created_at: nowIso() });
  }

  function dismountTire(tire, km, date, to, req, note = null) {
    const v = get('SELECT * FROM vehicles WHERE id = ?', tire.vehicle_id);
    const k = km ?? v?.current_km ?? tire.mounted_km;
    if (tire.mounted_km != null && k < tire.mounted_km) throw bad(`Sökme km (${k}) takma km değerinden (${tire.mounted_km}) küçük olamaz`, 'KM_TOO_LOW');
    const added = tire.mounted_km != null ? k - tire.mounted_km : 0;
    update('tires', tire.id, { status: to, total_km: (tire.total_km || 0) + added, mounted_km: null, updated_at: nowIso() });
    insert('tire_events', { tire_id: tire.id, vehicle_id: tire.vehicle_id, kind: to === 'scrap' ? 'scrap' : 'dismount', km: k, date, position: tire.position, note, created_by: req.user.id, created_at: nowIso() });
    return added;
  }

  function tireRows(where, p) {
    const t = today();
    const rows = all(
      `SELECT tr.*, v.plate, v.current_km AS vehicle_km FROM tires tr LEFT JOIN vehicles v ON v.id = tr.vehicle_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY tr.status = 'scrap', v.plate, tr.status, tr.position`,
      ...p,
    );
    for (const tr of rows) {
      tr.used_km = tireUsage(tr, tr.vehicle_km);
      const prod = dotToDate(tr.dot);
      tr.age_years = prod ? Math.round((daysBetween(prod, t) / 365.25) * 10) / 10 : null;
    }
    return rows;
  }

  r.get('/tires', requirePerm('tires', 'read'), ah((req, res) => {
    const where = [];
    const p = [];
    if (req.query.vehicle_id) { where.push('tr.vehicle_id = ?'); p.push(Number(req.query.vehicle_id)); }
    for (const k of ['status', 'season']) if (req.query[k]) { where.push(`tr.${k} = ?`); p.push(String(req.query[k])); }
    res.json(tireRows(where, p));
  }));

  r.get('/tires/:id/events', requirePerm('tires', 'read'), ah((req, res) => {
    res.json(all(`SELECT e.*, v.plate, u.full_name AS user_name FROM tire_events e LEFT JOIN vehicles v ON v.id = e.vehicle_id LEFT JOIN users u ON u.id = e.created_by WHERE e.tire_id = ? ORDER BY e.date DESC, e.id DESC`, idParam(req)));
  }));

  r.post('/tires', requirePerm('tires', 'create'), ah((req, res) => {
    const b = clean(req.body, tireSchema);
    const extra = clean(req.body, {
      mount: { type: 'bool' },
      mounted_km: { type: 'int', min: 0, max: 9999999, label: 'Takma km' },
      mount_date: { type: 'date', label: 'Takma tarihi' },
      total_km: { type: 'int', min: 0, max: 1000000, label: 'Önceki kullanım (km)' },
    });
    const id = tx(() => {
      const v = b.vehicle_id ? mustVehicle(b.vehicle_id) : null;
      const tid = insert('tires', { ...b, total_km: extra.total_km || 0, status: 'stored', created_at: nowIso() });
      if (extra.mount) {
        if (!v) throw bad('Takmak için araç seçmelisiniz', 'VALIDATION', { field: 'vehicle_id' });
        mountTire({ id: tid }, v, b.position, extra.mounted_km, extra.mount_date || today(), req);
      }
      syncTireExpense({ ...b, id: tid }, req.user.id);
      audit(req, 'create', 'tire', tid, null, { ...b, mounted: !!extra.mount });
      return tid;
    });
    res.status(201).json(tireRows(['tr.id = ?'], [id])[0]);
  }));

  r.put('/tires/:id', requirePerm('tires', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, tireSchema, { partial: true });
    tx(() => {
      const old = mustGet('tires', id, 'Lastik');
      if (old.status === 'mounted') {
        if (b.vehicle_id !== undefined && b.vehicle_id !== old.vehicle_id) throw bad('Takılı lastiğin aracı değiştirilemez; önce sökün');
        if (b.position !== undefined && b.position !== old.position) {
          if (!b.position) throw bad('Takılı lastiğin konumu boş olamaz');
          if (positionTaken(old.vehicle_id, b.position, id)) throw conflict(`"${b.position}" konumunda zaten takılı bir lastik var`, 'POSITION_TAKEN');
        }
      }
      if (b.vehicle_id) mustVehicle(b.vehicle_id);
      const d = diff(old, b);
      update('tires', id, { ...b, updated_at: nowIso() });
      if ('tread_depth' in d.new) insert('tire_events', { tire_id: id, vehicle_id: old.vehicle_id, kind: 'tread', date: today(), note: `Diş derinliği ${d.old.tread_depth ?? '-'} → ${d.new.tread_depth ?? '-'} mm`, created_by: req.user.id, created_at: nowIso() });
      syncTireExpense({ ...old, ...b }, req.user.id);
      if (d.changed) audit(req, 'update', 'tire', id, d.old, d.new);
    });
    res.json(tireRows(['tr.id = ?'], [id])[0]);
  }));

  r.delete('/tires/:id', requirePerm('tires', 'delete'), ah((req, res) => {
    const id = idParam(req);
    tx(() => {
      const old = mustGet('tires', id, 'Lastik');
      syncExpense('tire', id, null);
      run('DELETE FROM tires WHERE id = ?', id);
      audit(req, 'delete', 'tire', id, old);
    });
    res.json({ ok: true });
  }));

  r.post('/tires/:id/mount', requirePerm('tires', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, {
      vehicle_id: { type: 'id', required: true, label: 'Araç' },
      position: { type: 'str', required: true, max: 50, label: 'Konum' },
      km: { type: 'int', min: 0, max: 9999999, label: 'Km' },
      date: { type: 'date', label: 'Tarih' },
    });
    tx(() => {
      const tire = mustGet('tires', id, 'Lastik');
      if (tire.status !== 'stored') throw conflict(tire.status === 'mounted' ? 'Lastik zaten takılı' : 'Hurdaya ayrılmış lastik takılamaz', 'TIRE_NOT_STORED');
      const v = mustVehicle(b.vehicle_id);
      if (b.km != null && b.km < 0) throw bad('Km geçersiz');
      mountTire(tire, v, b.position, b.km, b.date || today(), req);
      audit(req, 'tire_mount', 'tire', id, null, { plate: v.plate, position: b.position, km: b.km ?? v.current_km });
    });
    res.json(tireRows(['tr.id = ?'], [id])[0]);
  }));

  r.post('/tires/:id/dismount', requirePerm('tires', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, {
      km: { type: 'int', min: 0, max: 9999999, label: 'Km' },
      date: { type: 'date', label: 'Tarih' },
      to: { type: 'enum', values: ['stored', 'scrap'], default: 'stored', label: 'Hedef' },
      tread_depth: { type: 'num', min: 0, max: 30, label: 'Diş derinliği' },
      note: { type: 'str', max: 500 },
    });
    tx(() => {
      const tire = mustGet('tires', id, 'Lastik');
      if (tire.status === 'scrap') throw conflict('Lastik zaten hurdaya ayrılmış');
      if (b.tread_depth != null) update('tires', id, { tread_depth: b.tread_depth });
      if (tire.status === 'stored') {
        if (b.to !== 'scrap') throw conflict('Lastik zaten depoda');
        update('tires', id, { status: 'scrap', updated_at: nowIso() });
        insert('tire_events', { tire_id: id, vehicle_id: tire.vehicle_id, kind: 'scrap', date: b.date || today(), note: b.note, created_by: req.user.id, created_at: nowIso() });
      } else {
        dismountTire(tire, b.km, b.date || today(), b.to, req, b.note);
      }
      audit(req, b.to === 'scrap' ? 'tire_scrap' : 'tire_dismount', 'tire', id, null, { km: b.km });
    });
    res.json(tireRows(['tr.id = ?'], [id])[0]);
  }));

  r.post('/tires/seasonal-change', requirePerm('tires', 'update'), ah((req, res) => {
    const b = clean(req.body, {
      vehicle_id: { type: 'id', required: true, label: 'Araç' },
      to_season: { type: 'enum', values: ['summer', 'winter'], required: true, label: 'Hedef mevsim' },
      km: { type: 'int', min: 0, max: 9999999, label: 'Km' },
      date: { type: 'date', label: 'Tarih' },
    });
    const ids = Array.isArray(req.body?.tire_ids) ? req.body.tire_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : null;
    const result = tx(() => {
      const v = mustVehicle(b.vehicle_id);
      const km = b.km ?? v.current_km;
      if (km < v.current_km) throw bad(`Km (${km}) aracın kayıtlı km değerinden (${v.current_km}) küçük olamaz`, 'KM_TOO_LOW');
      const date = b.date || today();
      const mounted = all(`SELECT * FROM tires WHERE vehicle_id = ? AND status = 'mounted' ORDER BY id`, v.id);
      let candidates;
      if (ids && ids.length) {
        candidates = ids.map((tid) => {
          const tr = mustGet('tires', tid, 'Lastik');
          if (tr.status !== 'stored') throw conflict(`#${tid} numaralı lastik depoda değil`);
          return tr;
        });
      } else {
        candidates = all(`SELECT * FROM tires WHERE vehicle_id = ? AND status = 'stored' AND season IN (?, 'all') ORDER BY id`, v.id, b.to_season);
      }
      if (!candidates.length) throw bad(`${v.plate} aracına ait depoda ${b.to_season === 'winter' ? 'kış' : 'yaz'} lastiği bulunamadı. Önce lastikleri envantere ekleyin.`, 'NO_TIRES');
      for (const tr of mounted) dismountTire(tr, km, date, 'stored', req, 'Mevsimsel değişim');
      const freed = mounted.map((x) => x.position).filter(Boolean);
      const used = new Set();
      const pick = (pref) => {
        if (pref && !used.has(pref)) return pref;
        const p = freed.find((x) => !used.has(x)) || TIRE_POSITIONS.find((x) => !used.has(x));
        return p;
      };
      for (const tr of candidates) {
        const pos = pick(tr.position);
        used.add(pos);
        mountTire(tr, v, pos, km, date, req);
      }
      audit(req, 'tire_seasonal_change', 'vehicle', v.id, null, { to_season: b.to_season, dismounted: mounted.length, mounted: candidates.length, km });
      return { dismounted: mounted.length, mounted: candidates.length };
    });
    res.json(result);
  }));

  // ---------------- YEDEK PARÇA ----------------
  const partSchema = {
    code: { type: 'str', required: true, max: 60, label: 'Parça kodu' },
    name: { type: 'str', required: true, max: 200, label: 'Parça adı' },
    category: { type: 'str', max: 100, label: 'Kategori' },
    vehicle_id: { type: 'id', label: 'Uyumlu araç' },
    unit: { type: 'str', max: 20, default: 'adet', label: 'Birim' },
    min_stock: { type: 'num', min: 0, max: 1e7, default: 0, label: 'Asgari stok' },
    unit_price: { type: 'num', min: 0, max: 1e9, label: 'Birim fiyat' },
    shelf: { type: 'str', max: 100, label: 'Raf' },
    supplier: { type: 'str', max: 200, label: 'Tedarikçi' },
    notes: { type: 'str', max: 2000 },
    active: { type: 'bool', default: 1 },
  };

  const partSelect = `SELECT p.*, v.plate AS vehicle_plate,
      (SELECT COUNT(*) FROM part_moves m WHERE m.part_id = p.id) AS move_count
      FROM parts p LEFT JOIN vehicles v ON v.id = p.vehicle_id`;

  r.get('/parts', requirePerm('parts', 'read'), ah((req, res) => {
    const where = [];
    const p = [];
    if (req.query.low === '1') where.push('p.min_stock > 0 AND p.stock < p.min_stock');
    if (req.query.vehicle_id) { where.push('(p.vehicle_id = ? OR p.vehicle_id IS NULL)'); p.push(Number(req.query.vehicle_id)); }
    if (req.query.active !== 'all') where.push('p.active = 1');
    res.json(all(`${partSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`, ...p));
  }));

  r.post('/parts', requirePerm('parts', 'create'), ah((req, res) => {
    const b = clean(req.body, partSchema);
    const { stock } = clean(req.body, { stock: { type: 'num', min: 0, max: 1e7, default: 0, label: 'Başlangıç stoğu' } });
    const id = tx(() => {
      if (get('SELECT 1 AS x FROM parts WHERE code = ?', b.code)) throw conflict(`"${b.code}" kodlu parça zaten var`, 'DUPLICATE');
      if (b.vehicle_id) mustVehicle(b.vehicle_id);
      const pid = insert('parts', { ...b, stock: stock || 0, created_at: nowIso() });
      if (stock > 0) insert('part_moves', { part_id: pid, kind: 'in', qty: stock, stock_after: stock, unit_price: b.unit_price, note: 'Açılış stoğu', created_by: req.user.id, created_at: nowIso() });
      audit(req, 'create', 'part', pid, null, { ...b, stock });
      return pid;
    });
    res.status(201).json(get(`${partSelect} WHERE p.id = ?`, id));
  }));

  r.put('/parts/:id', requirePerm('parts', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, partSchema, { partial: true });
    tx(() => {
      const old = mustGet('parts', id, 'Parça');
      if (b.code && b.code.toLowerCase() !== old.code.toLowerCase() && get('SELECT 1 AS x FROM parts WHERE code = ? AND id != ?', b.code, id)) throw conflict(`"${b.code}" kodlu parça zaten var`, 'DUPLICATE');
      if (b.vehicle_id) mustVehicle(b.vehicle_id);
      const d = diff(old, b);
      update('parts', id, { ...b, updated_at: nowIso() });
      if (d.changed) audit(req, 'update', 'part', id, d.old, d.new);
    });
    res.json(get(`${partSelect} WHERE p.id = ?`, id));
  }));

  r.delete('/parts/:id', requirePerm('parts', 'delete'), ah((req, res) => {
    const id = idParam(req);
    const result = tx(() => {
      const old = mustGet('parts', id, 'Parça');
      const used = get('SELECT COUNT(*) AS n FROM maintenance_parts WHERE part_id = ?', id).n;
      if (used) {
        update('parts', id, { active: 0, updated_at: nowIso() });
        audit(req, 'deactivate', 'part', id, old, null, 'Bakım kayıtlarında kullanıldığı için pasifleştirildi');
        return { ok: true, deactivated: true };
      }
      run('DELETE FROM parts WHERE id = ?', id);
      audit(req, 'delete', 'part', id, old);
      return { ok: true };
    });
    res.json(result);
  }));

  r.post('/parts/:id/adjust', requirePerm('parts', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, {
      kind: { type: 'enum', values: ['in', 'out', 'count'], required: true, label: 'Hareket türü' },
      qty: { type: 'num', required: true, min: 0, max: 1e7, label: 'Miktar' },
      unit_price: { type: 'num', min: 0, max: 1e9, label: 'Birim fiyat' },
      note: { type: 'str', max: 500, label: 'Açıklama' },
    });
    const part = tx(() => {
      const p = mustGet('parts', id, 'Parça');
      let after;
      let qty;
      if (b.kind === 'in') {
        if (!(b.qty > 0)) throw bad('Miktar sıfırdan büyük olmalıdır');
        qty = b.qty;
        after = round2(p.stock + b.qty);
      } else if (b.kind === 'out') {
        if (!(b.qty > 0)) throw bad('Miktar sıfırdan büyük olmalıdır');
        if (b.qty > p.stock) throw bad(`Stokta yalnızca ${p.stock} ${p.unit} var`, 'INSUFFICIENT_STOCK');
        qty = -b.qty;
        after = round2(p.stock - b.qty);
      } else {
        qty = round2(b.qty - p.stock);
        after = b.qty;
      }
      run('UPDATE parts SET stock = ?, unit_price = COALESCE(?, unit_price), updated_at = ? WHERE id = ?', after, b.kind === 'in' ? b.unit_price : null, nowIso(), id);
      insert('part_moves', { part_id: id, kind: b.kind, qty, stock_after: after, unit_price: b.unit_price, note: b.note, created_by: req.user.id, created_at: nowIso() });
      audit(req, 'stock_' + b.kind, 'part', id, { stock: p.stock }, { stock: after }, b.note);
      return get(`${partSelect} WHERE p.id = ?`, id);
    });
    res.json(part);
  }));

  r.get('/parts/:id/moves', requirePerm('parts', 'read'), ah((req, res) => {
    res.json(all(
      `SELECT m.*, u.full_name AS user_name, mt.vehicle_id, v.plate
         FROM part_moves m LEFT JOIN users u ON u.id = m.created_by
         LEFT JOIN maintenance mt ON m.ref_type = 'maintenance' AND mt.id = m.ref_id
         LEFT JOIN vehicles v ON v.id = mt.vehicle_id
        WHERE m.part_id = ? ORDER BY m.created_at DESC, m.id DESC`,
      idParam(req),
    ));
  }));

  // ---------------- MASRAFLAR ----------------
  const expSchema = {
    vehicle_id: { type: 'id', label: 'Araç' },
    driver_id: { type: 'id', label: 'Şoför' },
    category: { type: 'enum', values: Object.keys(EXPENSE_CATEGORIES), required: true, label: 'Kategori' },
    amount: { type: 'num', required: true, min: 0.01, max: 1e9, label: 'Tutar' },
    date: { type: 'date', required: true, label: 'Tarih' },
    description: { type: 'str', max: 1000, label: 'Açıklama' },
    invoice_no: { type: 'str', max: 100, label: 'Fatura / fiş no' },
    liters: { type: 'num', min: 0, max: 5000, label: 'Litre' },
    km: { type: 'int', min: 0, max: 9999999, label: 'Km' },
    file_id: { type: 'id', label: 'Dosya' },
  };

  const expSelect = `SELECT e.*, v.plate, u.full_name AS driver_name, c.full_name AS created_by_name, a.full_name AS approved_by_name
      FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id LEFT JOIN users u ON u.id = e.driver_id
      LEFT JOIN users c ON c.id = e.created_by LEFT JOIN users a ON a.id = e.approved_by`;

  r.get('/expenses', ah((req, res) => {
    const scope = readScope(req.user, 'expenses');
    if (!scope) throw forbidden();
    const where = [];
    const p = [];
    if (scope === 'own') { where.push('(e.created_by = ? OR e.driver_id = ?)'); p.push(req.user.id, req.user.id); }
    for (const k of ['vehicle_id', 'driver_id']) if (req.query[k]) { where.push(`e.${k} = ?`); p.push(Number(req.query[k])); }
    for (const k of ['category', 'status', 'source']) if (req.query[k]) { where.push(`e.${k} = ?`); p.push(String(req.query[k])); }
    if (req.query.from) { where.push('e.date >= ?'); p.push(String(req.query.from)); }
    if (req.query.to) { where.push('e.date <= ?'); p.push(String(req.query.to)); }
    const rows = all(`${expSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC LIMIT 5000`, ...p);
    for (const e of rows) if (e.file_id) e.file_name = get('SELECT original_name FROM uploads WHERE id = ?', e.file_id)?.original_name;
    res.json(rows);
  }));

  r.post('/expenses', requirePerm('expenses', 'create'), ah((req, res) => {
    const b = clean(req.body, expSchema);
    if (b.date > today()) throw bad('Masraf tarihi ileri bir tarih olamaz', 'VALIDATION', { field: 'date' });
    const approver = can(req.user, 'expenses', 'approve');
    const seeAll = readScope(req.user, 'expenses') === 'all';
    if (!seeAll) b.driver_id = req.user.id; // şoför yalnızca kendi adına girer
    if (b.vehicle_id) mustVehicle(b.vehicle_id);
    if (b.driver_id && !get('SELECT 1 AS x FROM users WHERE id = ?', b.driver_id)) throw bad('Şoför bulunamadı');
    const autoApprove = approver && req.body?.status !== 'pending';
    const now = nowIso();
    const id = insert('expenses', {
      ...b,
      source: 'manual',
      status: autoApprove ? 'approved' : 'pending',
      approved_by: autoApprove ? req.user.id : null,
      approved_at: autoApprove ? now : null,
      created_by: req.user.id,
      created_at: now,
    });
    audit(req, 'create', 'expense', id, null, { category: b.category, amount: b.amount, status: autoApprove ? 'approved' : 'pending' });
    res.status(201).json(get(`${expSelect} WHERE e.id = ?`, id));
  }));

  function assertManual(e) {
    if (e.source !== 'manual') {
      const SRC = { document: 'belge', maintenance: 'bakım', tire: 'lastik' };
      throw bad(`Bu masraf ${SRC[e.source]} kaydından otomatik oluşturuldu; ilgili ${SRC[e.source]} kaydını düzenleyin.`, 'AUTO_EXPENSE');
    }
  }

  r.put('/expenses/:id', ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, expSchema, { partial: true });
    tx(() => {
      const old = mustGet('expenses', id, 'Masraf');
      assertManual(old);
      const full = can(req.user, 'expenses', 'update');
      const own = old.created_by === req.user.id && old.status === 'pending' && can(req.user, 'expenses', 'create');
      if (!full && !own) throw forbidden('Bu masrafı düzenleme yetkiniz yok (yalnızca onay bekleyen kendi masraflarınızı düzenleyebilirsiniz)');
      if (!full) delete b.driver_id;
      if (b.date && b.date > today()) throw bad('Masraf tarihi ileri bir tarih olamaz');
      if (b.vehicle_id) mustVehicle(b.vehicle_id);
      const d = diff(old, b);
      const changes = { ...b, updated_at: nowIso() };
      // Onaylanmış masraf onay yetkisi olmayan biri tarafından değiştirilirse yeniden onaya düşer.
      if (d.changed && old.status !== 'pending' && !can(req.user, 'expenses', 'approve')) Object.assign(changes, { status: 'pending', approved_by: null, approved_at: null });
      update('expenses', id, changes);
      if (d.changed) audit(req, 'update', 'expense', id, d.old, d.new);
    });
    res.json(get(`${expSelect} WHERE e.id = ?`, id));
  }));

  r.delete('/expenses/:id', ah((req, res) => {
    const id = idParam(req);
    tx(() => {
      const old = mustGet('expenses', id, 'Masraf');
      assertManual(old);
      const full = can(req.user, 'expenses', 'delete');
      const own = old.created_by === req.user.id && old.status === 'pending' && can(req.user, 'expenses', 'create');
      if (!full && !own) throw forbidden('Bu masrafı silme yetkiniz yok');
      run('DELETE FROM expenses WHERE id = ?', id);
      audit(req, 'delete', 'expense', id, old);
    });
    res.json({ ok: true });
  }));

  function decide(req, id, action, reason) {
    const e = mustGet('expenses', id, 'Masraf');
    if (e.status !== 'pending') throw conflict(`#${id} numaralı masraf zaten ${e.status === 'approved' ? 'onaylanmış' : 'reddedilmiş'}`, 'NOT_PENDING');
    if (action === 'reject' && !reason) throw bad('Ret gerekçesi zorunludur', 'VALIDATION', { field: 'reason' });
    update('expenses', id, {
      status: action === 'approve' ? 'approved' : 'rejected',
      approved_by: req.user.id,
      approved_at: nowIso(),
      reject_reason: action === 'reject' ? reason : null,
      updated_at: nowIso(),
    });
    audit(req, action === 'approve' ? 'expense_approve' : 'expense_reject', 'expense', id, { status: 'pending' }, { status: action === 'approve' ? 'approved' : 'rejected' }, reason || null);
  }

  r.post('/expenses/approve-bulk', requirePerm('expenses', 'approve'), ah((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
    if (!ids.length) throw bad('Masraf seçilmedi');
    const action = req.body?.action === 'reject' ? 'reject' : 'approve';
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    const done = tx(() => {
      let n = 0;
      for (const id of ids) {
        const e = get('SELECT status FROM expenses WHERE id = ?', id);
        if (e?.status === 'pending') {
          decide(req, id, action, reason);
          n++;
        }
      }
      return n;
    });
    res.json({ ok: true, count: done });
  }));

  r.post('/expenses/:id/approve', requirePerm('expenses', 'approve'), ah((req, res) => {
    const id = idParam(req);
    tx(() => decide(req, id, 'approve', String(req.body?.note || '').trim() || null));
    res.json(get(`${expSelect} WHERE e.id = ?`, id));
  }));

  r.post('/expenses/:id/reject', requirePerm('expenses', 'approve'), ah((req, res) => {
    const id = idParam(req);
    tx(() => decide(req, id, 'reject', String(req.body?.reason || '').trim().slice(0, 500)));
    res.json(get(`${expSelect} WHERE e.id = ?`, id));
  }));

  // ---------------- ARIZALAR ----------------
  const issueSelect = `SELECT i.*, v.plate, v.brand, v.model, u.full_name AS reporter_name, f.original_name AS file_name, f.mime AS file_mime
      FROM issues i JOIN vehicles v ON v.id = i.vehicle_id LEFT JOIN users u ON u.id = i.reported_by LEFT JOIN uploads f ON f.id = i.file_id`;

  r.get('/issues', ah((req, res) => {
    const scope = readScope(req.user, 'issues');
    if (!scope) throw forbidden();
    const where = [];
    const p = [];
    if (scope === 'own') { where.push('i.reported_by = ?'); p.push(req.user.id); }
    if (req.query.vehicle_id) { where.push('i.vehicle_id = ?'); p.push(Number(req.query.vehicle_id)); }
    if (req.query.open === '1') where.push(`i.status IN ('open','in_progress')`);
    for (const k of ['status', 'severity']) if (req.query[k]) { where.push(`i.${k} = ?`); p.push(String(req.query[k])); }
    res.json(all(`${issueSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.status IN ('open','in_progress') DESC, CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.created_at DESC`, ...p));
  }));

  r.post('/issues', requirePerm('issues', 'create'), ah((req, res) => {
    const b = clean(req.body, {
      vehicle_id: { type: 'id', required: true, label: 'Araç' },
      severity: { type: 'enum', values: Object.keys(SEVERITIES), required: true, label: 'Önem derecesi' },
      title: { type: 'str', required: true, max: 200, label: 'Başlık' },
      description: { type: 'str', max: 4000, label: 'Açıklama' },
      km: { type: 'int', min: 0, max: 9999999, label: 'Km' },
      file_id: { type: 'id', label: 'Fotoğraf' },
    });
    const v = mustVehicle(b.vehicle_id);
    const id = insert('issues', { ...b, reported_by: req.user.id, status: 'open', created_at: nowIso() });
    audit(req, 'create', 'issue', id, null, { plate: v.plate, severity: b.severity, title: b.title });
    res.status(201).json(get(`${issueSelect} WHERE i.id = ?`, id));
  }));

  r.put('/issues/:id', requirePerm('issues', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, {
      severity: { type: 'enum', values: Object.keys(SEVERITIES), label: 'Önem derecesi' },
      title: { type: 'str', max: 200, label: 'Başlık' },
      description: { type: 'str', max: 4000 },
      status: { type: 'enum', values: ['open', 'in_progress', 'resolved', 'rejected'], label: 'Durum' },
      resolution: { type: 'str', max: 4000, label: 'Çözüm notu' },
      file_id: { type: 'id' },
    }, { partial: true });
    tx(() => {
      const old = mustGet('issues', id, 'Arıza');
      const changes = { ...b, updated_at: nowIso() };
      if (b.status && ['resolved', 'rejected'].includes(b.status) && !old.resolved_at) changes.resolved_at = nowIso();
      if (b.status && ['open', 'in_progress'].includes(b.status)) changes.resolved_at = null;
      const d = diff(old, b);
      update('issues', id, changes);
      if (d.changed) audit(req, 'update', 'issue', id, d.old, d.new);
    });
    res.json(get(`${issueSelect} WHERE i.id = ?`, id));
  }));

  r.delete('/issues/:id', requirePerm('issues', 'delete'), ah((req, res) => {
    const id = idParam(req);
    const old = mustGet('issues', id, 'Arıza');
    run('UPDATE maintenance SET issue_id = NULL WHERE issue_id = ?', id);
    run('DELETE FROM issues WHERE id = ?', id);
    audit(req, 'delete', 'issue', id, old);
    res.json({ ok: true });
  }));

  r.post('/issues/:id/convert', ah((req, res) => {
    assertCan(req.user, 'maintenance', 'create');
    assertCan(req.user, 'issues', 'update');
    const id = idParam(req);
    const mid = tx(() => {
      const iss = mustGet('issues', id, 'Arıza');
      if (iss.maintenance_id) throw conflict('Bu arıza zaten bir bakım kaydına bağlı', 'ALREADY_CONVERTED', { maintenance_id: iss.maintenance_id });
      if (!['open', 'in_progress'].includes(iss.status)) throw conflict('Kapalı arıza bakıma dönüştürülemez');
      const v = get('SELECT * FROM vehicles WHERE id = ?', iss.vehicle_id);
      const m = insert('maintenance', {
        vehicle_id: iss.vehicle_id,
        kind: /kaza|çarp|hasar/i.test(iss.title + ' ' + (iss.description || '')) ? 'accident' : 'repair',
        status: 'planned',
        date: today(),
        km: Math.max(v.current_km, iss.km || 0),
        description: `Arıza bildirimi #${iss.id}: ${iss.title}${iss.description ? '\n' + iss.description : ''}`,
        issue_id: iss.id,
        created_by: req.user.id,
        created_at: nowIso(),
      });
      update('issues', id, { status: 'in_progress', maintenance_id: m, updated_at: nowIso() });
      audit(req, 'issue_convert', 'issue', id, null, { maintenance_id: m });
      return m;
    });
    res.status(201).json(maintDetail(mid));
  }));

  return r;
}
