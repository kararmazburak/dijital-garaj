// API birleştirici: kimlik, genel uç noktalar (lookups, garaj, panel, uyarılar), dosyalar, raporlar.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, getSettings } from './db.js';
import { HttpError, bad, forbidden, notFound, nowIso, today, daysBetween, toCsv, round2, addDays } from './util.js';
import { can, readScope, requirePerm, permsFor, stripCosts, ROLES } from './perms.js';
import { authRouter, authenticate, requireAuth, requirePasswordFresh, publicUser } from './auth.js';
import { insert, ah, idParam } from './crud.js';
import { computeAlerts, alertsForUser, withReadState, alertCounts } from './alerts.js';
import { domainRouter, VEHICLE_SELECT, STATUS_LABELS, EXPENSE_CATEGORIES, MAINT_KINDS, SEVERITIES, TIRE_POSITIONS } from './domain.js';
import { resourcesRouter, BODY_TYPES } from './resources.js';

const FILE_TYPES = [
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/gif', ext: '.gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
];
export const MAX_UPLOAD = 10 * 1024 * 1024;

export function apiRouter({ uploadDir }) {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));
  r.use(authenticate);

  // CSRF savunması: durum değiştiren isteklerde özel başlık zorunlu (çapraz site formlar bunu ekleyemez).
  r.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'dijital-garaj') return next(new HttpError(403, 'Geçersiz istek kaynağı', 'CSRF'));
    next();
  });

  r.get('/health', (req, res) => res.json({ ok: true, time: nowIso(), today: today() }));
  r.use('/auth', authRouter());

  r.use(requireAuth, requirePasswordFresh);

  // Maliyet alanı gizleme: yetkisi olmayan rollerde yanıttan sunucu tarafında çıkarılır.
  r.use((req, res, next) => {
    if (can(req.user, 'costs', 'read')) return next();
    const orig = res.json.bind(res);
    res.json = (body) => orig(stripCosts(body, req.user.id));
    next();
  });

  // ---------------- Genel ----------------
  r.get('/lookups', ah((req, res) => {
    const s = getSettings();
    const seeDrivers = can(req.user, 'trips', 'manage') || readScope(req.user, 'drivers') === 'all' || readScope(req.user, 'expenses') === 'all' || can(req.user, 'users', 'read');
    res.json({
      me: publicUser(req.user),
      perms: permsFor(req.user),
      company_name: s.company_name,
      vehicle_types: all('SELECT id, code, name, icon, body, length, active FROM vehicle_types ORDER BY sort, name'),
      doc_types: all('SELECT id, code, name, required, has_expiry, warn_days, expense_category, active FROM doc_types ORDER BY sort, name'),
      vehicles: can(req.user, 'vehicles', 'read') || can(req.user, 'garage', 'read')
        ? all(`SELECT id, plate, brand, model, current_km, color, type_name, body, display_status FROM (${VEHICLE_SELECT}) ORDER BY plate`)
        : [],
      drivers: seeDrivers
        ? all(`SELECT id, full_name, username, role, license_expiry, src_expiry, active FROM users ORDER BY active DESC, full_name`)
        : [{ id: req.user.id, full_name: req.user.full_name, username: req.user.username, role: req.user.role, license_expiry: req.user.license_expiry, src_expiry: req.user.src_expiry, active: 1 }],
      constants: {
        statuses: STATUS_LABELS,
        expense_categories: EXPENSE_CATEGORIES,
        maint_kinds: MAINT_KINDS,
        severities: SEVERITIES,
        tire_positions: TIRE_POSITIONS,
        roles: ROLES,
        body_types: BODY_TYPES,
      },
      settings: {
        doc_warn_days: s.doc_warn_days,
        tire_min_tread_mm: s.tire_min_tread_mm,
        tire_warn_tread_mm: s.tire_warn_tread_mm,
        tire_max_age_years: s.tire_max_age_years,
        tire_default_max_km: s.tire_default_max_km,
        winter_start: s.winter_start,
        winter_end: s.winter_end,
        block_on_expired_docs: s.block_on_expired_docs,
        block_on_expired_license: s.block_on_expired_license,
      },
      today: today(),
    });
  }));

  r.get('/garage', requirePerm('garage', 'read'), ah((req, res) => {
    const vehicles = all(`${VEHICLE_SELECT} ORDER BY vt.sort, v.plate`);
    const alerts = alertsForUser(req.user, computeAlerts());
    const byVehicle = new Map();
    for (const a of alerts) {
      if (!a.vehicle_id) continue;
      if (!byVehicle.has(a.vehicle_id)) byVehicle.set(a.vehicle_id, []);
      byVehicle.get(a.vehicle_id).push({ level: a.level, title: a.title, message: a.message, link: a.link, category: a.category });
    }
    res.json({
      vehicles: vehicles.map((v) => {
        const list = byVehicle.get(v.id) || [];
        return {
          id: v.id, plate: v.plate, brand: v.brand, model: v.model, year: v.year, color: v.color,
          type_id: v.type_id, type_name: v.type_name, type_icon: v.type_icon, body: v.body, length: v.type_length,
          display_status: v.display_status, current_km: v.current_km, driver_name: v.driver_name, active_driver_id: v.active_driver_id,
          open_trip_id: v.open_trip_id, department: v.department, assigned_to: v.assigned_to, fuel_type: v.fuel_type,
          alerts: list,
          alert_level: list.some((a) => a.level === 'critical') ? 'critical' : list.some((a) => a.level === 'warning') ? 'warning' : list.length ? 'info' : null,
        };
      }),
      company_name: getSettings().company_name,
    });
  }));

  r.get('/dashboard', ah((req, res) => {
    const u = req.user;
    const t = today();
    const monthStart = t.slice(0, 7) + '-01';
    const counts = { total: 0, available: 0, on_trip: 0, maintenance: 0, broken: 0, passive: 0 };
    for (const row of all(`SELECT display_status, COUNT(*) AS n FROM (${VEHICLE_SELECT}) GROUP BY display_status`)) {
      counts[row.display_status] = row.n;
      counts.total += row.n;
    }
    const alerts = withReadState(u, alertsForUser(u, computeAlerts()));
    const out = { company_name: getSettings().company_name, today: t, counts, alert_counts: alertCounts(alerts), top_alerts: alerts.slice(0, 8) };

    out.my_open_trip = get(`SELECT t.*, v.plate, v.brand, v.model FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.driver_id = ? AND t.end_at IS NULL`, u.id) || null;

    const tripScope = readScope(u, 'trips');
    if (tripScope) {
      out.open_trips = all(
        `SELECT t.id, t.start_at, t.start_km, t.destination, t.purpose, t.driver_id, v.plate, v.id AS vehicle_id, us.full_name AS driver_name
           FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN users us ON us.id = t.driver_id
          WHERE t.end_at IS NULL ${tripScope === 'own' ? 'AND t.driver_id = ' + Number(u.id) : ''} ORDER BY t.start_at`);
      const m = get(`SELECT COUNT(*) AS trips, COALESCE(SUM(end_km - start_km), 0) AS km FROM trips WHERE end_km IS NOT NULL AND start_at >= ? ${tripScope === 'own' ? 'AND driver_id = ' + Number(u.id) : ''}`, monthStart);
      out.month = { trips: m.trips, km: m.km };
    }
    if (can(u, 'documents', 'read')) {
      out.upcoming = all(
        `SELECT d.id, d.end_date, d.vehicle_id, dt.name AS type_name, v.plate FROM documents d JOIN doc_types dt ON dt.id = d.doc_type_id JOIN vehicles v ON v.id = d.vehicle_id
          WHERE d.archived = 0 AND d.end_date IS NOT NULL AND d.end_date <= ? AND v.status != 'passive' ORDER BY d.end_date LIMIT 10`, addDays(t, 45))
        .map((d) => ({ ...d, days_left: daysBetween(t, d.end_date) }));
    }
    if (can(u, 'maintenance', 'read')) {
      out.planned_maintenance = all(`SELECT m.id, m.date, m.km, m.description, m.kind, v.plate, v.id AS vehicle_id FROM maintenance m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.status = 'planned' ORDER BY m.date LIMIT 8`);
    }
    const expScope = readScope(u, 'expenses');
    if (expScope) {
      out.recent_expenses = all(
        `SELECT e.id, e.date, e.category, e.amount, e.status, e.created_by, v.plate FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id
          ${expScope === 'own' ? 'WHERE e.created_by = ' + Number(u.id) + ' OR e.driver_id = ' + Number(u.id) : ''} ORDER BY e.date DESC, e.id DESC LIMIT 8`);
      if (can(u, 'costs', 'read')) {
        out.month = out.month || {};
        out.month.expense_total = get(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE status = 'approved' AND date >= ?`, monthStart).s;
        out.month.fuel_total = get(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE status = 'approved' AND category = 'fuel' AND date >= ?`, monthStart).s;
      }
    }
    if (can(u, 'expenses', 'approve')) out.pending_expenses = get(`SELECT COUNT(*) AS n FROM expenses WHERE status = 'pending'`).n;
    if (readScope(u, 'issues')) {
      out.open_issues = all(`SELECT i.id, i.title, i.severity, i.status, i.created_at, v.plate, v.id AS vehicle_id FROM issues i JOIN vehicles v ON v.id = i.vehicle_id
        WHERE i.status IN ('open','in_progress') ${readScope(u, 'issues') === 'own' ? 'AND i.reported_by = ' + Number(u.id) : ''}
        ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.created_at DESC LIMIT 8`);
    }
    res.json(out);
  }));

  r.get('/alerts', ah((req, res) => {
    if (!can(req.user, 'alerts', 'read')) throw forbidden();
    const list = withReadState(req.user, alertsForUser(req.user, computeAlerts()));
    res.json({ alerts: list, counts: alertCounts(list) });
  }));

  r.get('/alerts/count', ah((req, res) => {
    if (!can(req.user, 'alerts', 'read')) return res.json({ critical: 0, warning: 0, info: 0, unread: 0, total: 0 });
    res.json(alertCounts(withReadState(req.user, alertsForUser(req.user, computeAlerts()))));
  }));

  r.post('/alerts/read', ah((req, res) => {
    let keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String).slice(0, 2000) : [];
    if (req.body?.all) keys = alertsForUser(req.user, computeAlerts()).map((a) => a.key);
    const unread = req.body?.unread === true;
    const now = nowIso();
    for (const k of keys) {
      if (unread) run('DELETE FROM alert_reads WHERE user_id = ? AND alert_key = ?', req.user.id, k);
      else run('INSERT OR IGNORE INTO alert_reads (user_id, alert_key, read_at) VALUES (?,?,?)', req.user.id, k, now);
    }
    res.json({ ok: true, count: keys.length });
  }));

  r.get('/notifications', requirePerm('alerts', 'read'), ah((req, res) => {
    res.json(all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200'));
  }));

  // ---------------- Dosyalar ----------------
  r.post('/uploads', express.raw({ type: () => true, limit: MAX_UPLOAD }), ah((req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('Dosya boş veya okunamadı', 'EMPTY_FILE');
    const type = FILE_TYPES.find((f) => f.test(buf));
    if (!type) throw bad('Yalnızca PDF, JPEG, PNG, WEBP veya GIF dosyaları yüklenebilir', 'BAD_FILE_TYPE');
    let name = 'dosya' + type.ext;
    try {
      name = decodeURIComponent(String(req.get('X-File-Name') || name));
    } catch { /* varsayılan ad */ }
    name = name.replace(/[\\/\r\n"<>:|?*\x00-\x1f]/g, '_').slice(0, 180) || 'dosya' + type.ext;
    const stored = crypto.randomUUID() + type.ext;
    fs.writeFileSync(path.join(uploadDir, stored), buf);
    const id = insert('uploads', { stored_name: stored, original_name: name, mime: type.mime, size: buf.length, uploaded_by: req.user.id, created_at: nowIso() });
    res.status(201).json({ id, name, mime: type.mime, size: buf.length });
  }));

  r.get('/uploads/:id', ah((req, res) => {
    const f = get('SELECT * FROM uploads WHERE id = ?', idParam(req));
    if (!f) throw notFound('Dosya');
    const file = path.join(uploadDir, path.basename(f.stored_name));
    if (!fs.existsSync(file)) throw notFound('Dosya');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    fs.createReadStream(file).pipe(res);
  }));

  // ---------------- Raporlar ----------------
  const range = (req) => {
    const t = today();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : t.slice(0, 4) + '-01-01';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : t;
    return { from, to };
  };

  function costsReport(req) {
    const { from, to } = range(req);
    const vf = req.query.vehicle_id ? ' AND e.vehicle_id = ' + Number(req.query.vehicle_id) : '';
    const base = `FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id WHERE e.status = 'approved' AND e.date BETWEEN ? AND ?${vf}`;
    const byVehicle = all(`SELECT e.vehicle_id, COALESCE(v.plate, '(Araçsız)') AS plate, v.brand, v.model, COUNT(*) AS count, SUM(e.amount) AS amount,
        SUM(CASE WHEN e.category = 'fuel' THEN e.amount ELSE 0 END) AS fuel,
        SUM(CASE WHEN e.category IN ('maintenance','part','tire','wash') THEN e.amount ELSE 0 END) AS service,
        SUM(CASE WHEN e.category IN ('insurance','casco','inspection') THEN e.amount ELSE 0 END) AS insurance,
        SUM(CASE WHEN e.category NOT IN ('fuel','maintenance','part','tire','wash','insurance','casco','inspection') THEN e.amount ELSE 0 END) AS other
      ${base} GROUP BY e.vehicle_id ORDER BY amount DESC`, from, to);
    const kmRows = all(`SELECT vehicle_id, SUM(end_km - start_km) AS km FROM trips WHERE end_km IS NOT NULL AND date(start_at) BETWEEN ? AND ? GROUP BY vehicle_id`, from, to);
    const kmMap = new Map(kmRows.map((x) => [x.vehicle_id, x.km]));
    for (const row of byVehicle) {
      row.km = kmMap.get(row.vehicle_id) || 0;
      row.cost_per_km = row.km > 0 ? round2(row.amount / row.km) : null;
    }
    const byCategory = all(`SELECT e.category, COUNT(*) AS count, SUM(e.amount) AS amount ${base} GROUP BY e.category ORDER BY amount DESC`, from, to)
      .map((x) => ({ ...x, category_name: EXPENSE_CATEGORIES[x.category] || x.category }));
    const byMonth = all(`SELECT substr(e.date, 1, 7) AS month, COUNT(*) AS count, SUM(e.amount) AS amount ${base} GROUP BY month ORDER BY month`, from, to);
    const total = byCategory.reduce((s, x) => s + x.amount, 0);
    return { from, to, total: round2(total), by_vehicle: byVehicle, by_category: byCategory, by_month: byMonth };
  }

  function driversReport(req) {
    const { from, to } = range(req);
    const own = readScope(req.user, 'drivers') === 'own';
    const users = all(`SELECT id, full_name, username, role, active, license_expiry, src_expiry, license_class FROM users
      WHERE ${own ? 'id = ' + Number(req.user.id) : `(role = 'driver' OR id IN (SELECT driver_id FROM trips))`} ORDER BY active DESC, full_name`);
    const t = today();
    return {
      from, to,
      rows: users.map((u) => {
        const s = get(`SELECT COUNT(*) AS trips, COALESCE(SUM(end_km - start_km), 0) AS km, COUNT(DISTINCT vehicle_id) AS vehicles,
            MAX(start_at) AS last_trip FROM trips WHERE driver_id = ? AND end_km IS NOT NULL AND date(start_at) BETWEEN ? AND ?`, u.id, from, to);
        const exp = get(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE driver_id = ? AND status = 'approved' AND date BETWEEN ? AND ?`, u.id, from, to).s;
        const open = get('SELECT COUNT(*) AS n FROM trips WHERE driver_id = ? AND end_at IS NULL', u.id).n;
        const lic = u.license_expiry ? daysBetween(t, u.license_expiry) : null;
        const src = u.src_expiry ? daysBetween(t, u.src_expiry) : null;
        return {
          ...u,
          trips: s.trips, km: s.km, vehicles: s.vehicles, last_trip: s.last_trip,
          avg_km: s.trips ? Math.round(s.km / s.trips) : 0,
          expense_total: exp, open_trips: open,
          license_days_left: lic, src_days_left: src,
        };
      }),
    };
  }

  function fuelReport(req) {
    const { from, to } = range(req);
    const vehicles = all(`SELECT v.id, v.plate, v.brand, v.model, v.fuel_type, vt.name AS type_name FROM vehicles v JOIN vehicle_types vt ON vt.id = v.type_id ORDER BY v.plate`);
    const rows = [];
    for (const v of vehicles) {
      const km = get(`SELECT COALESCE(SUM(end_km - start_km), 0) AS km FROM trips WHERE vehicle_id = ? AND end_km IS NOT NULL AND date(start_at) BETWEEN ? AND ?`, v.id, from, to).km;
      const e = get(`SELECT COALESCE(SUM(liters), 0) AS liters, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n FROM expenses WHERE vehicle_id = ? AND category = 'fuel' AND status != 'rejected' AND date BETWEEN ? AND ?`, v.id, from, to);
      const tl = get(`SELECT COALESCE(SUM(fuel_liters), 0) AS l FROM trips WHERE vehicle_id = ? AND date(start_at) BETWEEN ? AND ?`, v.id, from, to).l;
      const liters = round2(e.liters + tl);
      if (!km && !liters) continue;
      rows.push({
        ...v,
        km,
        liters,
        fill_count: e.n,
        amount: round2(e.amount),
        l_per_100km: km > 0 && liters > 0 ? round2((liters / km) * 100) : null,
        cost_per_km: km > 0 && e.amount > 0 ? round2(e.amount / km) : null,
      });
    }
    const valid = rows.filter((x) => x.l_per_100km != null);
    const avg = valid.length ? round2(valid.reduce((s, x) => s + x.l_per_100km, 0) / valid.length) : null;
    for (const x of rows) x.deviation = avg && x.l_per_100km != null ? round2(((x.l_per_100km - avg) / avg) * 100) : null;
    return { from, to, fleet_avg_l_per_100km: avg, rows };
  }

  const canCosts = requirePerm('costs', 'read');
  r.get('/reports/costs', requirePerm('reports', 'read'), canCosts, ah((req, res) => res.json(costsReport(req))));
  r.get('/reports/drivers', requirePerm('drivers', ['read', 'read_own']), ah((req, res) => res.json(driversReport(req))));
  r.get('/reports/fuel', requirePerm('reports', 'read'), ah((req, res) => res.json(fuelReport(req))));

  r.get('/reports/drivers/:id', ah((req, res) => {
    const id = idParam(req);
    const scope = readScope(req.user, 'drivers');
    if (!scope || (scope === 'own' && id !== req.user.id)) throw forbidden();
    const u = get('SELECT id, full_name, username, role, phone, email, department, license_no, license_class, license_expiry, src_expiry, active FROM users WHERE id = ?', id);
    if (!u) throw notFound('Şoför');
    const trips = all(`SELECT t.*, v.plate, v.brand, v.model, CASE WHEN t.end_km IS NOT NULL THEN t.end_km - t.start_km END AS distance FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.driver_id = ? ORDER BY t.start_at DESC LIMIT 1000`, id);
    const vehicles = all(`SELECT v.id, v.plate, v.brand, v.model, COUNT(*) AS trips, COALESCE(SUM(t.end_km - t.start_km), 0) AS km FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.driver_id = ? AND t.end_km IS NOT NULL GROUP BY v.id ORDER BY km DESC`, id);
    const expenses = all(`SELECT category, COUNT(*) AS count, SUM(amount) AS amount FROM expenses WHERE driver_id = ? AND status = 'approved' GROUP BY category ORDER BY amount DESC`, id);
    const done = trips.filter((t) => t.distance != null);
    const km = done.reduce((s, t) => s + t.distance, 0);
    const t = today();
    res.json({
      user: { ...u, license_days_left: u.license_expiry ? daysBetween(t, u.license_expiry) : null, src_days_left: u.src_expiry ? daysBetween(t, u.src_expiry) : null },
      stats: { trips: done.length, km, avg_km: done.length ? Math.round(km / done.length) : 0, open_trips: trips.length - done.length, vehicles: vehicles.length },
      trips,
      vehicles,
      expenses: can(req.user, 'costs', 'read') ? expenses.map((x) => ({ ...x, category_name: EXPENSE_CATEGORIES[x.category] })) : [],
    });
  }));

  r.get('/reports/export/:name', ah((req, res) => {
    const name = req.params.name;
    const costs = can(req.user, 'costs', 'read');
    const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR', { timeZone: getSettings().timezone }) : '');
    let columns;
    let rows;
    if (name === 'costs') {
      if (!can(req.user, 'reports', 'read') || !costs) throw forbidden();
      const rep = costsReport(req);
      columns = [
        { label: 'Plaka', key: 'plate' }, { label: 'Marka', key: 'brand' }, { label: 'Model', key: 'model' }, { label: 'Kayıt', key: 'count' },
        { label: 'Yakıt', key: 'fuel' }, { label: 'Bakım/Parça/Lastik', key: 'service' }, { label: 'Sigorta/Muayene', key: 'insurance' },
        { label: 'Diğer', key: 'other' }, { label: 'Toplam', key: 'amount' }, { label: 'Km', key: 'km' }, { label: 'TL/km', key: 'cost_per_km' },
      ];
      rows = rep.by_vehicle;
    } else if (name === 'drivers') {
      if (!readScope(req.user, 'drivers')) throw forbidden();
      rows = driversReport(req).rows;
      columns = [
        { label: 'Ad Soyad', key: 'full_name' }, { label: 'Kullanıcı', key: 'username' }, { label: 'Sefer', key: 'trips' }, { label: 'Toplam km', key: 'km' },
        { label: 'Ort. sefer km', key: 'avg_km' }, { label: 'Kullanılan araç', key: 'vehicles' }, { label: 'Açık sefer', key: 'open_trips' },
        { label: 'Ehliyet bitiş', key: 'license_expiry' }, { label: 'SRC bitiş', key: 'src_expiry' },
        ...(costs ? [{ label: 'Masraf', key: 'expense_total' }] : []),
      ];
    } else if (name === 'fuel') {
      if (!can(req.user, 'reports', 'read')) throw forbidden();
      rows = fuelReport(req).rows;
      columns = [
        { label: 'Plaka', key: 'plate' }, { label: 'Tür', key: 'type_name' }, { label: 'Km', key: 'km' }, { label: 'Litre', key: 'liters' },
        { label: 'L/100 km', key: 'l_per_100km' }, { label: 'Filo ort. sapma %', key: 'deviation' },
        ...(costs ? [{ label: 'Yakıt tutarı', key: 'amount' }, { label: 'TL/km', key: 'cost_per_km' }] : []),
      ];
    } else if (name === 'trips') {
      const scope = readScope(req.user, 'trips');
      if (!scope) throw forbidden();
      const { from, to } = range(req);
      rows = all(`SELECT t.*, v.plate, u.full_name AS driver_name FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = t.driver_id
        WHERE date(t.start_at) BETWEEN ? AND ? ${scope === 'own' ? 'AND t.driver_id = ' + Number(req.user.id) : ''} ORDER BY t.start_at`, from, to);
      columns = [
        { label: 'Plaka', key: 'plate' }, { label: 'Şoför', key: 'driver_name' }, { label: 'Çıkış', value: (x) => fmtDate(x.start_at) },
        { label: 'Dönüş', value: (x) => fmtDate(x.end_at) }, { label: 'Çıkış km', key: 'start_km' }, { label: 'Dönüş km', key: 'end_km' },
        { label: 'Mesafe', value: (x) => (x.end_km != null ? x.end_km - x.start_km : '') }, { label: 'Amaç', key: 'purpose' }, { label: 'Gidilen yer', key: 'destination' },
        { label: 'Yakıt (L)', key: 'fuel_liters' }, { label: 'Zorla çıkış', value: (x) => (x.forced ? 'Evet: ' + (x.force_reason || '') : '') },
      ];
    } else if (name === 'expenses') {
      const scope = readScope(req.user, 'expenses');
      if (!scope) throw forbidden();
      const { from, to } = range(req);
      rows = all(`SELECT e.*, v.plate, u.full_name AS driver_name FROM expenses e LEFT JOIN vehicles v ON v.id = e.vehicle_id LEFT JOIN users u ON u.id = e.driver_id
        WHERE e.date BETWEEN ? AND ? ${scope === 'own' ? 'AND (e.created_by = ' + Number(req.user.id) + ' OR e.driver_id = ' + Number(req.user.id) + ')' : ''} ORDER BY e.date`, from, to);
      const ST = { pending: 'Onay bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi' };
      columns = [
        { label: 'Tarih', key: 'date' }, { label: 'Plaka', key: 'plate' }, { label: 'Şoför', key: 'driver_name' },
        { label: 'Kategori', value: (x) => EXPENSE_CATEGORIES[x.category] }, { label: 'Açıklama', key: 'description' },
        { label: 'Fatura no', key: 'invoice_no' }, { label: 'Litre', key: 'liters' },
        ...(costs ? [{ label: 'Tutar', key: 'amount' }] : []),
        { label: 'Durum', value: (x) => ST[x.status] }, { label: 'Kaynak', key: 'source' },
      ];
    } else {
      throw notFound('Rapor');
    }
    const csv = toCsv(columns, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${today()}.csv"`);
    res.send(csv);
  }));

  r.use(resourcesRouter());
  r.use(domainRouter());

  r.use((req, res, next) => next(notFound('Uç nokta')));
  return r;
}

export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Dosya 10 MB sınırını aşıyor', code: 'TOO_LARGE' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz JSON gövdesi', code: 'BAD_JSON' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
  const msg = String(err?.message || '');
  if (/UNIQUE constraint failed: trips\./.test(msg)) return res.status(409).json({ error: 'Araç veya şoför için zaten açık bir sefer var', code: 'OPEN_TRIP_EXISTS' });
  if (/UNIQUE constraint failed/.test(msg)) return res.status(409).json({ error: 'Bu kayıt zaten mevcut', code: 'DUPLICATE' });
  if (/FOREIGN KEY constraint failed/.test(msg)) return res.status(409).json({ error: 'İlişkili kayıtlar nedeniyle işlem yapılamadı', code: 'FK_CONSTRAINT' });
  console.error('[hata]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Beklenmeyen bir sunucu hatası oluştu', code: 'INTERNAL' });
}
