// Ortak yardımcılar: hata tipleri, tarih işlemleri, girdi doğrulama.

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const bad = (msg, code = 'VALIDATION', extra) => new HttpError(400, msg, code, extra);
export const notFound = (what = 'Kayıt') => new HttpError(404, `${what} bulunamadı`, 'NOT_FOUND');
export const forbidden = (msg = 'Bu işlem için yetkiniz yok', code = 'FORBIDDEN', extra) => new HttpError(403, msg, code, extra);
export const conflict = (msg, code = 'CONFLICT', extra) => new HttpError(409, msg, code, extra);

// ---- Tarih ----
let TZ = 'Europe/Istanbul';
export function setTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    TZ = tz;
  } catch { /* geçersiz saat dilimi: mevcut kalır */ }
}
export const getTimezone = () => TZ;
export const nowIso = () => new Date().toISOString();

/** Ayarlı saat diliminde bugünün tarihi (YYYY-MM-DD). */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Ayarlı saat diliminde bir zaman damgasının tarihi. */
export function localDate(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function ymd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}

/** b - a (gün). */
export function daysBetween(a, b) {
  return Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000);
}

export function addDays(date, n) {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m, d + n)).toISOString().slice(0, 10);
}

export function addMonths(date, n) {
  const [y, m, d] = ymd(date);
  const first = new Date(Date.UTC(y, m + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** DOT kodundan (HHYY: hafta+yıl) yaklaşık üretim tarihi. */
export function dotToDate(dot) {
  const m = /^(\d{2})(\d{2})$/.exec(String(dot || '').trim());
  if (!m) return null;
  const week = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (week < 1 || week > 53) return null;
  return new Date(Date.UTC(year, 0, 1 + (week - 1) * 7)).toISOString().slice(0, 10);
}

// ---- Doğrulama ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Gövdeyi şemaya göre temizler. Şema: { alan: { type, label, required, min, max, values, upper, default } }
 * type: str | int | num | date | datetime | bool | enum | id | color
 * partial=true: yalnızca gönderilen alanlar işlenir (güncelleme).
 */
export function clean(body, schema, { partial = false } = {}) {
  body = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    const label = rule.label || key;
    const has = Object.prototype.hasOwnProperty.call(body, key);
    if (!has) {
      if (partial) continue;
      if (rule.required) throw bad(`${label} zorunludur`, 'VALIDATION', { field: key });
      if ('default' in rule) out[key] = rule.default;
      continue;
    }
    let v = body[key];
    if (typeof v === 'string' && rule.type !== 'str') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (rule.required) throw bad(`${label} zorunludur`, 'VALIDATION', { field: key });
      out[key] = rule.type === 'bool' ? 0 : null;
      continue;
    }
    switch (rule.type) {
      case 'str': {
        v = String(v).trim();
        if (!v) {
          if (rule.required) throw bad(`${label} zorunludur`, 'VALIDATION', { field: key });
          v = null;
          break;
        }
        if (v.length > (rule.max || 2000)) throw bad(`${label} en fazla ${rule.max || 2000} karakter olabilir`, 'VALIDATION', { field: key });
        if (rule.upper) v = v.toLocaleUpperCase('tr-TR');
        if (rule.pattern && !rule.pattern.test(v)) throw bad(`${label} biçimi geçersiz`, 'VALIDATION', { field: key });
        break;
      }
      case 'int':
      case 'num': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(n)) throw bad(`${label} sayı olmalıdır`, 'VALIDATION', { field: key });
        if (rule.type === 'int' && !Number.isInteger(n)) throw bad(`${label} tam sayı olmalıdır`, 'VALIDATION', { field: key });
        if (rule.min != null && n < rule.min) throw bad(`${label} en az ${rule.min} olmalıdır`, 'VALIDATION', { field: key });
        if (rule.max != null && n > rule.max) throw bad(`${label} en fazla ${rule.max} olabilir`, 'VALIDATION', { field: key });
        v = n;
        break;
      }
      case 'date':
        v = String(v).slice(0, 10);
        if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${label} geçerli bir tarih olmalıdır`, 'VALIDATION', { field: key });
        break;
      case 'datetime': {
        const t = Date.parse(v);
        if (Number.isNaN(t)) throw bad(`${label} geçerli bir zaman olmalıdır`, 'VALIDATION', { field: key });
        v = new Date(t).toISOString();
        break;
      }
      case 'bool':
        v = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
        break;
      case 'enum':
        if (!rule.values.includes(v)) throw bad(`${label} geçersiz`, 'VALIDATION', { field: key });
        break;
      case 'id': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) throw bad(`${label} geçersiz`, 'VALIDATION', { field: key });
        v = n;
        break;
      }
      case 'color':
        if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw bad(`${label} #RRGGBB biçiminde olmalıdır`, 'VALIDATION', { field: key });
        v = String(v).toLowerCase();
        break;
      default:
        break;
    }
    out[key] = v;
  }
  return out;
}

/** YYYY-AA-GG → GG.AA.YYYY (mesaj metinleri için). */
export const trDate = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '');

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** CSV (Excel için ; ayraçlı, UTF-8 BOM'lu). */
export function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = "'" + s; // formül enjeksiyonuna karşı
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(';')];
  for (const r of rows) lines.push(columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(';'));
  return '﻿' + lines.join('\r\n');
}
