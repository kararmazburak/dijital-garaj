// SQLite (node:sqlite) erişim katmanı, şema ve varsayılan veriler.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso } from './util.js';
import { hashPassword } from './security.js';

export let db = null;
const stmtCache = new Map();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','driver','finance','observer')),
  phone TEXT,
  email TEXT,
  department TEXT,
  license_no TEXT,
  license_class TEXT,
  license_expiry TEXT,
  src_expiry TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stored_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicle_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT,
  body TEXT NOT NULL,
  length REAL NOT NULL DEFAULT 4.5,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS doc_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  required INTEGER NOT NULL DEFAULT 0,
  has_expiry INTEGER NOT NULL DEFAULT 1,
  warn_days INTEGER,
  expense_category TEXT NOT NULL DEFAULT 'other',
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL UNIQUE COLLATE NOCASE,
  brand TEXT,
  model TEXT,
  year INTEGER,
  type_id INTEGER NOT NULL REFERENCES vehicle_types(id),
  color TEXT NOT NULL DEFAULT '#9aa3ad',
  vin TEXT,
  engine_no TEXT,
  fuel_type TEXT,
  tank_capacity REAL,
  transmission TEXT,
  seats INTEGER,
  load_capacity REAL,
  initial_km INTEGER NOT NULL DEFAULT 0,
  current_km INTEGER NOT NULL DEFAULT 0,
  purchase_date TEXT,
  purchase_price REAL,
  assigned_to TEXT,
  department TEXT,
  maint_interval_km INTEGER,
  maint_interval_months INTEGER,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance','broken','passive')),
  active_driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  photo_file_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  driver_id INTEGER NOT NULL REFERENCES users(id),
  start_km INTEGER NOT NULL,
  end_km INTEGER,
  start_at TEXT NOT NULL,
  end_at TEXT,
  purpose TEXT,
  destination TEXT,
  fuel_liters REAL,
  notes TEXT,
  end_notes TEXT,
  forced INTEGER NOT NULL DEFAULT 0,
  force_reason TEXT,
  corrected INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_trips_open_vehicle ON trips(vehicle_id) WHERE end_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_trips_open_driver ON trips(driver_id) WHERE end_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_trips_vehicle ON trips(vehicle_id, start_at);
CREATE INDEX IF NOT EXISTS ix_trips_driver ON trips(driver_id, start_at);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type_id INTEGER NOT NULL REFERENCES doc_types(id),
  doc_no TEXT,
  provider TEXT,
  start_date TEXT,
  end_date TEXT,
  amount REAL,
  file_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_documents_vehicle ON documents(vehicle_id, doc_type_id, archived);

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category TEXT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'adet',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  unit_price REAL,
  shelf TEXT,
  supplier TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS part_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('in','out','count','maintenance','maintenance_revert')),
  qty REAL NOT NULL,
  stock_after REAL NOT NULL,
  unit_price REAL,
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_part_moves_part ON part_moves(part_id, created_at);

CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('periodic','repair','accident','wash','other')),
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','planned')),
  date TEXT,
  km INTEGER,
  service_name TEXT,
  description TEXT,
  labor_cost REAL NOT NULL DEFAULT 0,
  parts_total REAL NOT NULL DEFAULT 0,
  other_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  invoice_no TEXT,
  next_km INTEGER,
  next_date TEXT,
  issue_id INTEGER,
  file_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_maintenance_vehicle ON maintenance(vehicle_id, status, date);

CREATE TABLE IF NOT EXISTS maintenance_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_id INTEGER NOT NULL REFERENCES maintenance(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty REAL NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  brand TEXT,
  model TEXT,
  size TEXT,
  dot TEXT,
  season TEXT NOT NULL DEFAULT 'summer' CHECK (season IN ('summer','winter','all')),
  tread_depth REAL,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('mounted','stored','scrap')),
  mounted_km INTEGER,
  mount_date TEXT,
  total_km INTEGER NOT NULL DEFAULT 0,
  max_km INTEGER,
  cost REAL,
  purchase_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_tires_vehicle ON tires(vehicle_id, status);

CREATE TABLE IF NOT EXISTS tire_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tire_id INTEGER NOT NULL REFERENCES tires(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mount','dismount','scrap','tread')),
  km INTEGER,
  date TEXT NOT NULL,
  position TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  invoice_no TEXT,
  liters REAL,
  km INTEGER,
  file_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','document','maintenance','tire')),
  source_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  reject_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_expenses_vehicle ON expenses(vehicle_id, date);
CREATE INDEX IF NOT EXISTS ix_expenses_source ON expenses(source, source_id);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reported_by INTEGER REFERENCES users(id),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title TEXT NOT NULL,
  description TEXT,
  km INTEGER,
  file_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','rejected')),
  resolution TEXT,
  maintenance_id INTEGER REFERENCES maintenance(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL UNIQUE,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  vehicle_id INTEGER,
  emailed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, alert_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  note TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);
`;

export const VEHICLE_TYPES = [
  ['car', 'Otomobil', '🚗', 'car', 4.5],
  ['suv', 'SUV', '🚙', 'suv', 4.8],
  ['van', 'Minivan / Panelvan', '🚐', 'van', 5.0],
  ['pickup', 'Pikap', '🛻', 'pickup', 5.3],
  ['minibus', 'Minibüs', '🚌', 'minibus', 7.0],
  ['bus', 'Otobüs', '🚍', 'bus', 12.0],
  ['truck', 'Kamyon', '🚚', 'truck', 8.5],
  ['tractor', 'Traktör', '🚜', 'tractor', 4.2],
  ['trailer', 'Römork', '🛒', 'trailer', 8.0],
  ['forklift', 'Forklift', '🏗️', 'forklift', 3.2],
  ['excavator', 'İş Makinesi', '🚧', 'excavator', 7.0],
  ['motorcycle', 'Motosiklet', '🏍️', 'motorcycle', 2.2],
  ['other', 'Diğer', '🚘', 'generic', 4.5],
];

// code, ad, zorunlu, bitiş tarihi var mı, masraf kategorisi
export const DOC_TYPES = [
  ['traffic_insurance', 'Trafik Sigortası', 1, 1, 'insurance'],
  ['casco', 'Kasko', 0, 1, 'casco'],
  ['inspection', 'Muayene', 1, 1, 'inspection'],
  ['registration', 'Ruhsat', 1, 0, 'other'],
  ['emission', 'Egzoz Emisyon', 0, 1, 'inspection'],
  ['green_card', 'Yeşil Kart', 0, 1, 'insurance'],
  ['authority', 'Yetki Belgesi', 0, 1, 'other'],
  ['cargo_insurance', 'Taşıma / Yük Sigortası', 0, 1, 'insurance'],
  ['seat_insurance', 'Koltuk Ferdi Kaza Sigortası', 0, 1, 'insurance'],
  ['tachograph', 'Takograf Kalibrasyonu', 0, 1, 'inspection'],
  ['adr', 'Tehlikeli Madde (ADR) Belgesi', 0, 1, 'other'],
  ['lease', 'Kiralama / Leasing Sözleşmesi', 0, 1, 'other'],
  ['warranty', 'Garanti Belgesi', 0, 1, 'other'],
  ['other', 'Diğer Belge', 0, 1, 'other'],
];

export const DEFAULT_SETTINGS = {
  company_name: 'Şirketim A.Ş.',
  timezone: 'Europe/Istanbul',
  doc_warn_days: [30, 15, 7],
  license_warn_days: 30,
  maint_default_km: 15000,
  maint_default_months: 12,
  maint_warn_km: 1000,
  maint_warn_days: 15,
  tire_max_age_years: 6,
  tire_min_tread_mm: 1.6,
  tire_warn_tread_mm: 3,
  tire_default_max_km: 60000,
  winter_start: '11-01',
  winter_end: '04-01',
  winter_check: true,
  block_on_expired_docs: true,
  block_on_expired_license: true,
  trip_open_warn_hours: 24,
  trip_long_km: 1000,
  km_gap_threshold: 50,
  notify_emails: '',
  scan_interval_min: 30,
};

let settingsCache = null;

function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export const all = (sql, ...params) => stmt(sql).all(...params.map(norm));
export const get = (sql, ...params) => stmt(sql).get(...params.map(norm));
export function run(sql, ...params) {
  const r = stmt(sql).run(...params.map(norm));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

let txDepth = 0;
/** İç içe çağrılabilen işlem (savepoint). */
export function tx(fn) {
  const sp = `sp_${txDepth}`;
  if (txDepth === 0) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    if (txDepth === 0) db.exec('COMMIT');
    else db.exec(`RELEASE ${sp}`);
    return r;
  } catch (e) {
    txDepth--;
    if (txDepth === 0) db.exec('ROLLBACK');
    else db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export function getSettings() {
  if (!settingsCache) {
    const s = { ...DEFAULT_SETTINGS };
    for (const row of all('SELECT key, value FROM settings')) {
      try {
        s[row.key] = JSON.parse(row.value);
      } catch { /* bozuk değer: varsayılan kalır */ }
    }
    settingsCache = s;
  }
  return settingsCache;
}

export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  settingsCache = null;
}

export function deleteSetting(key) {
  run('DELETE FROM settings WHERE key = ?', key);
  settingsCache = null;
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  stmtCache.clear();
  settingsCache = null;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  seedDefaults();
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    stmtCache.clear();
  }
}

function seedDefaults() {
  const now = nowIso();
  if (!get('SELECT 1 AS x FROM vehicle_types LIMIT 1')) {
    VEHICLE_TYPES.forEach(([code, name, icon, body, length], i) =>
      run('INSERT INTO vehicle_types (code, name, icon, body, length, sort) VALUES (?,?,?,?,?,?)', code, name, icon, body, length, (i + 1) * 10));
  }
  if (!get('SELECT 1 AS x FROM doc_types LIMIT 1')) {
    DOC_TYPES.forEach(([code, name, required, hasExpiry, cat], i) =>
      run('INSERT INTO doc_types (code, name, required, has_expiry, expense_category, sort) VALUES (?,?,?,?,?,?)', code, name, required, hasExpiry, cat, (i + 1) * 10));
  }
  if (!get('SELECT 1 AS x FROM users LIMIT 1')) {
    run('INSERT INTO users (username, full_name, password_hash, role, must_change_password, created_at) VALUES (?,?,?,?,1,?)',
      'admin', 'Sistem Yöneticisi', hashPassword('Admin123!'), 'admin', now);
  }
}
