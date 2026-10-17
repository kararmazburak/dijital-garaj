// Araçlar, tanımlar (araç/belge türleri), kullanıcılar, roller, ayarlar, denetim kaydı.
import express from 'express';
import { all, get, run, tx, getSettings, setSetting, DEFAULT_SETTINGS } from './db.js';
import { clean, bad, conflict, forbidden, notFound, nowIso, today, daysBetween, setTimezone } from './util.js';
import { can, requirePerm, getMatrix, saveMatrix, resetMatrix, MODULES, ACTIONS, ROLES } from './perms.js';
import { insert, update, mustGet, audit, diff, ah, idParam } from './crud.js';
import { hashPassword, passwordProblem } from './security.js';
import { VEHICLE_SELECT, vehicleWithStatus, recomputeVehicleKm } from './domain.js';
import { maintenanceStatus, alertsForUser, computeAlerts } from './alerts.js';

export const BODY_TYPES = {
  car: 'Otomobil', suv: 'SUV', van: 'Van', pickup: 'Pikap', minibus: 'Minibüs', bus: 'Otobüs', truck: 'Kamyon',
  tractor: 'Traktör', trailer: 'Römork', forklift: 'Forklift', excavator: 'İş makinesi', motorcycle: 'Motosiklet', generic: 'Genel araç',
};

const vehicleSchema = {
  plate: { type: 'str', required: true, max: 20, upper: true, label: 'Plaka' },
  brand: { type: 'str', max: 60, label: 'Marka' },
  model: { type: 'str', max: 60, label: 'Model' },
  year: { type: 'int', min: 1950, max: 2100, label: 'Model yılı' },
  type_id: { type: 'id', required: true, label: 'Araç türü' },
  color: { type: 'color', default: '#9aa3ad', label: 'Renk' },
  vin: { type: 'str', max: 40, upper: true, label: 'Şasi no' },
  engine_no: { type: 'str', max: 40, upper: true, label: 'Motor no' },
  fuel_type: { type: 'enum', values: ['diesel', 'gasoline', 'lpg', 'hybrid', 'electric', 'other'], label: 'Yakıt türü' },
  tank_capacity: { type: 'num', min: 0, max: 5000, label: 'Depo kapasitesi' },
  transmission: { type: 'enum', values: ['manual', 'automatic', 'semi'], label: 'Vites' },
  seats: { type: 'int', min: 0, max: 200, label: 'Koltuk sayısı' },
  load_capacity: { type: 'num', min: 0, max: 200000, label: 'Yük kapasitesi' },
  purchase_date: { type: 'date', label: 'Satın alma tarihi' },
  purchase_price: { type: 'num', min: 0, max: 1e10, label: 'Satın alma bedeli' },
  assigned_to: { type: 'str', max: 120, label: 'Zimmet' },
  department: { type: 'str', max: 120, label: 'Departman' },
  maint_interval_km: { type: 'int', min: 0, max: 1000000, label: 'Bakım aralığı (km)' },
  maint_interval_months: { type: 'int', min: 0, max: 120, label: 'Bakım aralığı (ay)' },
  photo_file_id: { type: 'id', label: 'Fotoğraf' },
  notes: { type: 'str', max: 4000 },
};

const userSchema = {
  username: { type: 'str', required: true, max: 40, pattern: /^[a-zA-Z0-9._-]{3,40}$/, label: 'Kullanıcı adı' },
  full_name: { type: 'str', required: true, max: 120, label: 'Ad soyad' },
  role: { type: 'enum', values: Object.keys(ROLES), required: true, label: 'Rol' },
  phone: { type: 'str', max: 40, label: 'Telefon' },
  email: { type: 'str', max: 160, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, label: 'E-posta' },
  department: { type: 'str', max: 120, label: 'Departman' },
  license_no: { type: 'str', max: 40, label: 'Ehliyet no' },
  license_class: { type: 'str', max: 40, label: 'Ehliyet sınıfı' },
  license_expiry: { type: 'date', label: 'Ehliyet bitiş' },
  src_expiry: { type: 'date', label: 'SRC bitiş' },
  active: { type: 'bool', default: 1, label: 'Aktif' },
  notes: { type: 'str', max: 2000 },
};

const USER_COLS = 'id, username, full_name, role, phone, email, department, license_no, license_class, license_expiry, src_expiry, active, must_change_password, notes, last_login_at, created_at';

export function resourcesRouter() {
  const r = express.Router();

  // ---------------- ARAÇLAR ----------------
  r.get('/vehicles', requirePerm('vehicles', 'read'), ah((req, res) => {
    const where = [];
    const p = [];
    if (req.query.active === '1') where.push(`v.status != 'passive'`);
    if (req.query.type_id) { where.push('v.type_id = ?'); p.push(Number(req.query.type_id)); }
    const rows = all(`${VEHICLE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.plate`, ...p);
    res.json(rows);
  }));

  r.get('/vehicles/:id', requirePerm('vehicles', 'read'), ah((req, res) => {
    const v = vehicleWithStatus(idParam(req));
    if (!v) throw notFound('Araç');
    res.json(v);
  }));

  r.get('/vehicles/:id/summary', requirePerm('vehicles', 'read'), ah((req, res) => {
    const id = idParam(req);
    const v = vehicleWithStatus(id);
    if (!v) throw notFound('Araç');
    const t = today();
    const s = getSettings();
    const maint = maintenanceStatus(v, s, t);
    const docs = can(req.user, 'documents', 'read')
      ? all(`SELECT d.id, d.end_date, d.doc_no, d.provider, dt.name AS type_name, dt.required FROM documents d JOIN doc_types dt ON dt.id = d.doc_type_id WHERE d.vehicle_id = ? AND d.archived = 0 ORDER BY d.end_date`, id)
        .map((d) => ({ ...d, days_left: d.end_date ? daysBetween(t, d.end_date) : null }))
      : null;
    const stats = get(
      `SELECT COUNT(*) AS trip_count, COALESCE(SUM(end_km - start_km), 0) AS total_km, COUNT(DISTINCT driver_id) AS driver_count
         FROM trips WHERE vehicle_id = ? AND end_km IS NOT NULL`, id);
    const costs = can(req.user, 'costs', 'read')
      ? {
        total: get(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE vehicle_id = ? AND status = 'approved'`, id).s,
        year: get(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE vehicle_id = ? AND status = 'approved' AND date >= ?`, id, t.slice(0, 4) + '-01-01').s,
        by_category: all(`SELECT category, SUM(amount) AS amount FROM expenses WHERE vehicle_id = ? AND status = 'approved' GROUP BY category ORDER BY amount DESC`, id),
      }
      : null;
    const openTrip = v.open_trip_id ? get(`SELECT t.*, u.full_name AS driver_name FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.id = ?`, v.open_trip_id) : null;
    const alerts = alertsForUser(req.user, computeAlerts()).filter((a) => a.vehicle_id === id);
    const fuel = get(`SELECT COALESCE(SUM(liters),0) AS liters FROM expenses WHERE vehicle_id = ? AND category = 'fuel' AND status != 'rejected'`, id).liters
      + get(`SELECT COALESCE(SUM(fuel_liters),0) AS l FROM trips WHERE vehicle_id = ?`, id).l;
    res.json({
      vehicle: v,
      maintenance: { ...maint, last: maint.last ? { id: maint.last.id, date: maint.last.date, km: maint.last.km } : null },
      documents: docs,
      stats: { ...stats, fuel_liters: fuel, consumption: stats.total_km > 0 && fuel > 0 ? Math.round((fuel / stats.total_km) * 1000) / 10 : null },
      costs,
      open_trip: openTrip,
      alerts,
      purchase_price: v.purchase_price,
    });
  }));

  r.post('/vehicles', requirePerm('vehicles', 'create'), ah((req, res) => {
    const b = clean(req.body, vehicleSchema);
    const { current_km } = clean(req.body, { current_km: { type: 'int', min: 0, max: 9999999, default: 0, label: 'Güncel km' } });
    const id = tx(() => {
      if (get('SELECT 1 AS x FROM vehicles WHERE plate = ?', b.plate)) throw conflict(`${b.plate} plakalı araç zaten kayıtlı`, 'DUPLICATE');
      mustGet('vehicle_types', b.type_id, 'Araç türü');
      const vid = insert('vehicles', { ...b, initial_km: current_km || 0, current_km: current_km || 0, status: 'available', created_at: nowIso() });
      audit(req, 'create', 'vehicle', vid, null, { ...b, current_km });
      return vid;
    });
    res.status(201).json(vehicleWithStatus(id));
  }));

  r.put('/vehicles/:id', requirePerm('vehicles', 'update'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, vehicleSchema, { partial: true });
    const extra = clean(req.body, {
      current_km: { type: 'int', min: 0, max: 9999999, label: 'Güncel km' },
      km_reason: { type: 'str', max: 500, label: 'Km düzeltme gerekçesi' },
    }, { partial: true });
    tx(() => {
      const old = mustGet('vehicles', id, 'Araç');
      if (b.plate && b.plate.toLowerCase() !== old.plate.toLowerCase() && get('SELECT 1 AS x FROM vehicles WHERE plate = ? AND id != ?', b.plate, id)) throw conflict(`${b.plate} plakalı araç zaten kayıtlı`, 'DUPLICATE');
      if (b.type_id) mustGet('vehicle_types', b.type_id, 'Araç türü');
      const d = diff(old, b);
      update('vehicles', id, { ...b, updated_at: nowIso() });
      if (d.changed) audit(req, 'update', 'vehicle', id, d.old, d.new);
      if (extra.current_km != null && extra.current_km !== old.current_km) {
        if (extra.current_km < old.current_km) {
          if (req.user.role !== 'admin') throw forbidden('Km değerini düşürmek yalnızca yönetici tarafından yapılabilir');
          if (!extra.km_reason) throw bad('Km değerini düşürmek için gerekçe yazmalısınız', 'VALIDATION', { field: 'km_reason' });
          const maxTrip = get('SELECT MAX(MAX(start_km), COALESCE(MAX(end_km), 0)) AS m FROM trips WHERE vehicle_id = ?', id)?.m ?? 0;
          if (extra.current_km < maxTrip) throw bad(`Seferlerde kayıtlı en yüksek km ${maxTrip}. Önce ilgili seferi düzeltin.`, 'KM_TOO_LOW');
        }
        run('UPDATE vehicles SET initial_km = ?, current_km = ?, updated_at = ? WHERE id = ?', extra.current_km, extra.current_km, nowIso(), id);
        recomputeVehicleKm(id);
        audit(req, 'km_correct', 'vehicle', id, { current_km: old.current_km }, { current_km: extra.current_km }, extra.km_reason || null);
      }
    });
    res.json(vehicleWithStatus(id));
  }));

  r.post('/vehicles/:id/status', ah((req, res) => {
    const id = idParam(req);
    const { status, reason } = clean(req.body, {
      status: { type: 'enum', values: ['available', 'maintenance', 'broken', 'passive'], required: true, label: 'Durum' },
      reason: { type: 'str', max: 500, label: 'Açıklama' },
    });
    // Bakıma alma/bakımdan çıkarma bakım yetkisiyle de yapılabilir; diğer durumlar araç düzenleme yetkisi ister.
    const allowed = can(req.user, 'vehicles', 'update') || (['maintenance', 'available'].includes(status) && can(req.user, 'maintenance', 'create'));
    if (!allowed) throw forbidden('Araç durumunu değiştirme yetkiniz yok');
    tx(() => {
      const v = vehicleWithStatus(id);
      if (!v) throw notFound('Araç');
      if (status === 'passive' && v.open_trip_id) throw conflict('Seferdeki araç pasife alınamaz; önce dönüş kaydı yapın');
      run('UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
      audit(req, 'vehicle_status', 'vehicle', id, { status: v.status }, { status }, reason || null);
    });
    res.json(vehicleWithStatus(id));
  }));

  r.delete('/vehicles/:id', requirePerm('vehicles', 'delete'), ah((req, res) => {
    const id = idParam(req);
    const result = tx(() => {
      const v = mustGet('vehicles', id, 'Araç');
      const hasHistory = get(`SELECT (SELECT COUNT(*) FROM trips WHERE vehicle_id = ?1) + (SELECT COUNT(*) FROM expenses WHERE vehicle_id = ?1)
        + (SELECT COUNT(*) FROM maintenance WHERE vehicle_id = ?1) + (SELECT COUNT(*) FROM documents WHERE vehicle_id = ?1) AS n`, id).n;
      if (hasHistory) {
        if (get('SELECT 1 AS x FROM trips WHERE vehicle_id = ? AND end_at IS NULL', id)) throw conflict('Seferdeki araç pasife alınamaz');
        run(`UPDATE vehicles SET status = 'passive', updated_at = ? WHERE id = ?`, nowIso(), id);
        audit(req, 'deactivate', 'vehicle', id, { status: v.status }, { status: 'passive' }, 'Geçmiş kaydı olduğu için silinmedi, pasife alındı');
        return { ok: true, deactivated: true };
      }
      run('UPDATE tires SET vehicle_id = NULL WHERE vehicle_id = ?', id);
      run('UPDATE parts SET vehicle_id = NULL WHERE vehicle_id = ?', id);
      run('DELETE FROM vehicles WHERE id = ?', id);
      audit(req, 'delete', 'vehicle', id, v);
      return { ok: true };
    });
    res.json(result);
  }));

  // ---------------- ARAÇ / BELGE TÜRLERİ ----------------
  r.get('/vehicle-types', ah((req, res) => {
    res.json(all('SELECT vt.*, (SELECT COUNT(*) FROM vehicles v WHERE v.type_id = vt.id) AS vehicle_count FROM vehicle_types vt ORDER BY sort, name'));
  }));
  const vtSchema = {
    name: { type: 'str', required: true, max: 60, label: 'Tür adı' },
    icon: { type: 'str', max: 8, label: 'Simge' },
    body: { type: 'enum', values: Object.keys(BODY_TYPES), required: true, label: '3B gövde tipi' },
    length: { type: 'num', min: 1, max: 25, default: 4.5, label: 'Uzunluk (m)' },
    sort: { type: 'int', min: 0, max: 10000, default: 500 },
    active: { type: 'bool', default: 1 },
  };
  r.post('/vehicle-types', requirePerm('settings', 'manage'), ah((req, res) => {
    const b = clean(req.body, vtSchema);
    if (get('SELECT 1 AS x FROM vehicle_types WHERE name = ?', b.name)) throw conflict('Bu adla bir araç türü zaten var', 'DUPLICATE');
    const id = insert('vehicle_types', b);
    audit(req, 'create', 'vehicle_type', id, null, b);
    res.status(201).json(get('SELECT * FROM vehicle_types WHERE id = ?', id));
  }));
  r.put('/vehicle-types/:id', requirePerm('settings', 'manage'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, vtSchema, { partial: true });
    const old = mustGet('vehicle_types', id, 'Araç türü');
    if (b.name && get('SELECT 1 AS x FROM vehicle_types WHERE name = ? AND id != ?', b.name, id)) throw conflict('Bu adla bir araç türü zaten var', 'DUPLICATE');
    const d = diff(old, b);
    update('vehicle_types', id, b);
    if (d.changed) audit(req, 'update', 'vehicle_type', id, d.old, d.new);
    res.json(get('SELECT * FROM vehicle_types WHERE id = ?', id));
  }));
  r.delete('/vehicle-types/:id', requirePerm('settings', 'manage'), ah((req, res) => {
    const id = idParam(req);
    const old = mustGet('vehicle_types', id, 'Araç türü');
    if (get('SELECT COUNT(*) AS n FROM vehicles WHERE type_id = ?', id).n) throw conflict('Bu türde kayıtlı araçlar var; silmek yerine pasifleştirin', 'IN_USE');
    run('DELETE FROM vehicle_types WHERE id = ?', id);
    audit(req, 'delete', 'vehicle_type', id, old);
    res.json({ ok: true });
  }));

  r.get('/doc-types', ah((req, res) => {
    res.json(all('SELECT dt.*, (SELECT COUNT(*) FROM documents d WHERE d.doc_type_id = dt.id) AS doc_count FROM doc_types dt ORDER BY sort, name'));
  }));
  const dtSchema = {
    name: { type: 'str', required: true, max: 80, label: 'Belge türü' },
    required: { type: 'bool', default: 0, label: 'Zorunlu' },
    has_expiry: { type: 'bool', default: 1, label: 'Bitiş tarihi var' },
    warn_days: { type: 'int', min: 1, max: 365, label: 'Uyarı süresi (gün)' },
    expense_category: { type: 'enum', values: ['insurance', 'casco', 'inspection', 'other'], default: 'other', label: 'Masraf kategorisi' },
    sort: { type: 'int', min: 0, max: 10000, default: 500 },
    active: { type: 'bool', default: 1 },
  };
  r.post('/doc-types', requirePerm('settings', 'manage'), ah((req, res) => {
    const b = clean(req.body, dtSchema);
    if (get('SELECT 1 AS x FROM doc_types WHERE name = ?', b.name)) throw conflict('Bu adla bir belge türü zaten var', 'DUPLICATE');
    const id = insert('doc_types', b);
    audit(req, 'create', 'doc_type', id, null, b);
    res.status(201).json(get('SELECT * FROM doc_types WHERE id = ?', id));
  }));
  r.put('/doc-types/:id', requirePerm('settings', 'manage'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, dtSchema, { partial: true });
    const old = mustGet('doc_types', id, 'Belge türü');
    if (b.name && get('SELECT 1 AS x FROM doc_types WHERE name = ? AND id != ?', b.name, id)) throw conflict('Bu adla bir belge türü zaten var', 'DUPLICATE');
    const d = diff(old, b);
    update('doc_types', id, b);
    if (d.changed) audit(req, 'update', 'doc_type', id, d.old, d.new);
    res.json(get('SELECT * FROM doc_types WHERE id = ?', id));
  }));
  r.delete('/doc-types/:id', requirePerm('settings', 'manage'), ah((req, res) => {
    const id = idParam(req);
    const old = mustGet('doc_types', id, 'Belge türü');
    if (get('SELECT COUNT(*) AS n FROM documents WHERE doc_type_id = ?', id).n) throw conflict('Bu türde belgeler var; silmek yerine pasifleştirin', 'IN_USE');
    run('DELETE FROM doc_types WHERE id = ?', id);
    audit(req, 'delete', 'doc_type', id, old);
    res.json({ ok: true });
  }));

  // ---------------- KULLANICILAR ----------------
  r.get('/users', requirePerm('users', ['read', 'manage']), ah((req, res) => {
    const rows = all(`SELECT ${USER_COLS},
        (SELECT COUNT(*) FROM trips t WHERE t.driver_id = users.id) AS trip_count,
        (SELECT COUNT(*) FROM trips t WHERE t.driver_id = users.id AND t.end_at IS NULL) AS open_trips
      FROM users ORDER BY active DESC, full_name`);
    res.json(rows);
  }));

  r.post('/users', requirePerm('users', 'manage'), ah((req, res) => {
    const b = clean(req.body, userSchema);
    const password = String(req.body?.password || '');
    const problem = passwordProblem(password);
    if (problem) throw bad(problem, 'WEAK_PASSWORD', { field: 'password' });
    if (get('SELECT 1 AS x FROM users WHERE username = ?', b.username)) throw conflict(`"${b.username}" kullanıcı adı alınmış`, 'DUPLICATE');
    const { must_change_password } = clean(req.body, { must_change_password: { type: 'bool', default: 1 } });
    const id = insert('users', { ...b, password_hash: hashPassword(password), must_change_password, created_at: nowIso() });
    audit(req, 'user_create', 'user', id, null, b);
    res.status(201).json(get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id));
  }));

  r.put('/users/:id', requirePerm('users', 'manage'), ah((req, res) => {
    const id = idParam(req);
    const b = clean(req.body, userSchema, { partial: true });
    tx(() => {
      const old = mustGet('users', id, 'Kullanıcı');
      if (b.username && b.username.toLowerCase() !== old.username.toLowerCase() && get('SELECT 1 AS x FROM users WHERE username = ? AND id != ?', b.username, id)) throw conflict(`"${b.username}" kullanıcı adı alınmış`, 'DUPLICATE');
      const losingAdmin = old.role === 'admin' && ((b.role && b.role !== 'admin') || b.active === 0);
      if (losingAdmin && get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, id).n === 0) {
        throw conflict('Sistemde en az bir aktif yönetici kalmalıdır', 'LAST_ADMIN');
      }
      if (id === req.user.id && (b.active === 0 || (b.role && b.role !== old.role))) throw conflict('Kendi rolünüzü veya aktifliğinizi değiştiremezsiniz', 'SELF_CHANGE');
      const d = diff(old, b);
      update('users', id, { ...b, updated_at: nowIso() });
      if (b.active === 0) run('DELETE FROM sessions WHERE user_id = ?', id);
      if (d.changed) audit(req, d.new.role ? 'role_change' : 'user_update', 'user', id, d.old, d.new);
    });
    res.json(get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id));
  }));

  r.post('/users/:id/reset-password', requirePerm('users', 'manage'), ah((req, res) => {
    const id = idParam(req);
    mustGet('users', id, 'Kullanıcı');
    const password = String(req.body?.password || '');
    const problem = passwordProblem(password);
    if (problem) throw bad(problem, 'WEAK_PASSWORD', { field: 'password' });
    run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', hashPassword(password), nowIso(), id);
    run('DELETE FROM sessions WHERE user_id = ?', id);
    audit(req, 'password_reset', 'user', id);
    res.json({ ok: true });
  }));

  r.delete('/users/:id', requirePerm('users', 'manage'), ah((req, res) => {
    const id = idParam(req);
    if (id === req.user.id) throw conflict('Kendi hesabınızı silemezsiniz', 'SELF_CHANGE');
    const result = tx(() => {
      const old = mustGet('users', id, 'Kullanıcı');
      if (old.role === 'admin' && get(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`, id).n === 0) throw conflict('Sistemde en az bir aktif yönetici kalmalıdır', 'LAST_ADMIN');
      const history = get(`SELECT (SELECT COUNT(*) FROM trips WHERE driver_id = ?1) + (SELECT COUNT(*) FROM expenses WHERE driver_id = ?1 OR created_by = ?1)
          + (SELECT COUNT(*) FROM issues WHERE reported_by = ?1) + (SELECT COUNT(*) FROM documents WHERE created_by = ?1)
          + (SELECT COUNT(*) FROM maintenance WHERE created_by = ?1) + (SELECT COUNT(*) FROM part_moves WHERE created_by = ?1)
          + (SELECT COUNT(*) FROM tire_events WHERE created_by = ?1) + (SELECT COUNT(*) FROM trips WHERE created_by = ?1) AS n`, id).n;
      if (get('SELECT 1 AS x FROM trips WHERE driver_id = ? AND end_at IS NULL', id)) throw conflict('Açık seferi olan kullanıcı silinemez', 'HAS_OPEN_TRIP');
      run('DELETE FROM sessions WHERE user_id = ?', id);
      if (history) {
        run('UPDATE users SET active = 0, updated_at = ? WHERE id = ?', nowIso(), id);
        audit(req, 'user_deactivate', 'user', id, { active: 1 }, { active: 0 }, 'Geçmiş kaydı olduğu için silinmedi, pasifleştirildi');
        return { ok: true, deactivated: true };
      }
      run('UPDATE vehicles SET active_driver_id = NULL WHERE active_driver_id = ?', id);
      run('DELETE FROM alert_reads WHERE user_id = ?', id);
      run('UPDATE uploads SET uploaded_by = NULL WHERE uploaded_by = ?', id);
      run('DELETE FROM users WHERE id = ?', id);
      audit(req, 'user_delete', 'user', id, old);
      return { ok: true };
    });
    res.json(result);
  }));

  // ---------------- ROLLER ----------------
  r.get('/roles', requirePerm('roles', 'manage'), (req, res) => {
    res.json({ roles: ROLES, modules: MODULES, actions: ACTIONS, matrix: getMatrix() });
  });
  r.put('/roles', requirePerm('roles', 'manage'), ah((req, res) => {
    const old = getMatrix();
    const matrix = saveMatrix(req.body?.matrix);
    audit(req, 'role_matrix_update', 'roles', null, old, matrix);
    res.json({ roles: ROLES, modules: MODULES, actions: ACTIONS, matrix });
  }));
  r.post('/roles/reset', requirePerm('roles', 'manage'), ah((req, res) => {
    const old = getMatrix();
    const matrix = resetMatrix();
    audit(req, 'role_matrix_reset', 'roles', null, old, matrix);
    res.json({ roles: ROLES, modules: MODULES, actions: ACTIONS, matrix });
  }));

  // ---------------- AYARLAR ----------------
  const settingsSchema = {
    company_name: { type: 'str', max: 120, required: true, label: 'Şirket adı' },
    timezone: { type: 'str', max: 60, label: 'Saat dilimi' },
    license_warn_days: { type: 'int', min: 1, max: 365, label: 'Ehliyet uyarı süresi' },
    maint_default_km: { type: 'int', min: 0, max: 1000000, label: 'Varsayılan bakım aralığı (km)' },
    maint_default_months: { type: 'int', min: 0, max: 120, label: 'Varsayılan bakım aralığı (ay)' },
    maint_warn_km: { type: 'int', min: 0, max: 100000, label: 'Bakım uyarı km' },
    maint_warn_days: { type: 'int', min: 0, max: 365, label: 'Bakım uyarı gün' },
    tire_max_age_years: { type: 'num', min: 1, max: 20, label: 'Lastik yaş sınırı' },
    tire_min_tread_mm: { type: 'num', min: 0, max: 10, label: 'Asgari diş derinliği' },
    tire_warn_tread_mm: { type: 'num', min: 0, max: 15, label: 'Diş uyarı eşiği' },
    tire_default_max_km: { type: 'int', min: 0, max: 1000000, label: 'Lastik km sınırı' },
    winter_start: { type: 'str', max: 5, pattern: /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, label: 'Kış dönemi başlangıcı (AA-GG)' },
    winter_end: { type: 'str', max: 5, pattern: /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, label: 'Kış dönemi bitişi (AA-GG)' },
    winter_check: { type: 'bool', label: 'Kış lastiği denetimi' },
    block_on_expired_docs: { type: 'bool', label: 'Belgesi eksik/bitmiş araca çıkış engeli' },
    block_on_expired_license: { type: 'bool', label: 'Ehliyeti bitmiş şoföre çıkış engeli' },
    trip_open_warn_hours: { type: 'int', min: 1, max: 720, label: 'Açık sefer uyarı süresi (saat)' },
    trip_long_km: { type: 'int', min: 1, max: 100000, label: 'Uzun sefer eşiği (km)' },
    km_gap_threshold: { type: 'int', min: 0, max: 100000, label: 'Km boşluğu eşiği' },
    notify_emails: { type: 'str', max: 1000, label: 'Bildirim e-postaları' },
    scan_interval_min: { type: 'int', min: 5, max: 1440, label: 'Tarama aralığı (dk)' },
  };

  r.get('/settings', requirePerm('settings', ['read', 'manage']), (req, res) => {
    const s = { ...getSettings() };
    delete s.role_matrix;
    res.json({ settings: s, defaults: DEFAULT_SETTINGS, body_types: BODY_TYPES, smtp_configured: !!process.env.SMTP_HOST });
  });

  r.put('/settings', requirePerm('settings', 'manage'), ah((req, res) => {
    const b = clean(req.body, settingsSchema, { partial: true });
    if (req.body && 'doc_warn_days' in req.body) {
      const arr = Array.isArray(req.body.doc_warn_days) ? req.body.doc_warn_days.map(Number) : [];
      if (arr.length !== 3 || arr.some((n) => !Number.isInteger(n) || n < 0 || n > 365) || !(arr[0] >= arr[1] && arr[1] >= arr[2])) {
        throw bad('Belge uyarı eşikleri büyükten küçüğe üç tam sayı olmalıdır (örn. 30, 15, 7)', 'VALIDATION', { field: 'doc_warn_days' });
      }
      b.doc_warn_days = arr;
    }
    if (b.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: b.timezone });
      } catch {
        throw bad('Geçersiz saat dilimi', 'VALIDATION', { field: 'timezone' });
      }
    }
    if (b.tire_warn_tread_mm != null && b.tire_min_tread_mm != null && b.tire_warn_tread_mm < b.tire_min_tread_mm) throw bad('Diş uyarı eşiği asgari diş derinliğinden küçük olamaz');
    const old = getSettings();
    const changedOld = {};
    const changedNew = {};
    tx(() => {
      for (const [k, v] of Object.entries(b)) {
        if (JSON.stringify(old[k]) === JSON.stringify(v)) continue;
        changedOld[k] = old[k];
        changedNew[k] = v;
        setSetting(k, v);
      }
    });
    if (b.timezone) setTimezone(b.timezone);
    if (Object.keys(changedNew).length) audit(req, 'settings_update', 'settings', null, changedOld, changedNew);
    const s = { ...getSettings() };
    delete s.role_matrix;
    res.json({ settings: s, defaults: DEFAULT_SETTINGS, body_types: BODY_TYPES, smtp_configured: !!process.env.SMTP_HOST });
  }));

  // ---------------- DENETİM KAYDI ----------------
  r.get('/audit', requirePerm('audit', 'read'), ah((req, res) => {
    const where = [];
    const p = [];
    if (req.query.entity) { where.push('entity = ?'); p.push(String(req.query.entity)); }
    if (req.query.entity_id) { where.push('entity_id = ?'); p.push(Number(req.query.entity_id)); }
    if (req.query.user_id) { where.push('user_id = ?'); p.push(Number(req.query.user_id)); }
    if (req.query.action) { where.push('action = ?'); p.push(String(req.query.action)); }
    if (req.query.from) { where.push('created_at >= ?'); p.push(String(req.query.from)); }
    if (req.query.to) { where.push('created_at < ?'); p.push(String(req.query.to) + 'T99'); }
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    res.json(all(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`, ...p));
  }));

  return r;
}
