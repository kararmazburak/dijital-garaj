// Genel kayıt işlemleri ve denetim kaydı yardımcıları.
import { run, get } from './db.js';
import { notFound, nowIso } from './util.js';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const checkIdent = (s) => {
  if (!IDENT.test(s)) throw new Error(`Geçersiz tanımlayıcı: ${s}`);
  return s;
};

export function insert(table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).map(checkIdent);
  const sql = `INSERT INTO ${checkIdent(table)} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return run(sql, ...keys.map((k) => obj[k])).id;
}

export function update(table, id, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).map(checkIdent);
  if (!keys.length) return 0;
  const sql = `UPDATE ${checkIdent(table)} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  return run(sql, ...keys.map((k) => obj[k]), id).changes;
}

export const byId = (table, id) => get(`SELECT * FROM ${checkIdent(table)} WHERE id = ?`, Number(id));

export function mustGet(table, id, label) {
  const row = byId(table, id);
  if (!row) throw notFound(label);
  return row;
}

/** Yalnızca değişen alanları döndürür: { old: {...}, new: {...} } */
export function diff(oldRow, changes) {
  const o = {};
  const n = {};
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) continue;
    const before = oldRow ? oldRow[k] : undefined;
    if (String(before ?? '') !== String(v ?? '')) {
      o[k] = before ?? null;
      n[k] = v;
    }
  }
  return { old: o, new: n, changed: Object.keys(n).length > 0 };
}

const REDACT = new Set(['password', 'password_hash', 'token_hash']);
function serialize(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return String(v);
  const copy = Array.isArray(v) ? v : { ...v };
  if (!Array.isArray(copy)) for (const k of Object.keys(copy)) if (REDACT.has(k)) copy[k] = '***';
  return JSON.stringify(copy);
}

/** Denetim kaydı: kim, ne zaman, hangi kayıt, eski/yeni değer. */
export function audit(req, action, entity = null, entityId = null, oldValue = null, newValue = null, note = null) {
  const user = req?.user;
  run(
    'INSERT INTO audit_log (user_id, username, action, entity, entity_id, old_value, new_value, note, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    user?.id ?? null,
    user?.username ?? req?.auditUsername ?? null,
    action,
    entity,
    entityId == null ? null : Number(entityId),
    serialize(oldValue),
    serialize(newValue),
    note,
    req?.ip ?? null,
    nowIso(),
  );
}

/** Async/sync rota sarmalayıcı: hataları Express'e iletir. */
export const ah = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.then === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

export const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
};
