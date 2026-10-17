// Rol yetki matrisi, yetki denetimi ve maliyet alanlarının gizlenmesi.
import { getSettings, setSetting, deleteSetting } from './db.js';
import { forbidden } from './util.js';

export const ROLES = {
  admin: 'Yönetici',
  driver: 'Şoför',
  finance: 'Finans Yöneticisi',
  observer: 'Gözlemci',
};

export const ACTIONS = {
  read: 'Görüntüle',
  read_own: 'Kendi kayıtlarını görüntüle',
  create: 'Ekle',
  update: 'Düzenle',
  delete: 'Sil',
  approve: 'Onayla',
  manage: 'Yönet',
};

export const MODULES = [
  { key: 'garage', label: 'Dijital Garaj', actions: ['read'] },
  { key: 'vehicles', label: 'Araçlar', actions: ['read', 'create', 'update', 'delete'] },
  { key: 'trips', label: 'Çıkış / Dönüş', actions: ['read', 'read_own', 'create', 'manage'], hint: 'Ekle: kendi adına çıkış/dönüş. Yönet: başkası adına işlem, zorla çıkış, km düzeltme, silme.' },
  { key: 'documents', label: 'Belgeler', actions: ['read', 'create', 'update', 'delete'] },
  { key: 'maintenance', label: 'Bakım', actions: ['read', 'create', 'update', 'delete'] },
  { key: 'tires', label: 'Lastikler', actions: ['read', 'create', 'update', 'delete'] },
  { key: 'parts', label: 'Yedek Parça', actions: ['read', 'create', 'update', 'delete'] },
  { key: 'expenses', label: 'Masraflar', actions: ['read', 'read_own', 'create', 'update', 'delete', 'approve'] },
  { key: 'issues', label: 'Arıza / Hasar', actions: ['read', 'read_own', 'create', 'update', 'delete'] },
  { key: 'drivers', label: 'Şoför Kullanımı', actions: ['read', 'read_own'] },
  { key: 'alerts', label: 'Uyarılar', actions: ['read'] },
  { key: 'reports', label: 'Raporlar', actions: ['read'] },
  { key: 'costs', label: 'Maliyet Alanları', actions: ['read'], hint: 'Satın alma bedeli, işçilik, parça tutarı, masraf tutarı gibi alanlar.' },
  { key: 'users', label: 'Kullanıcılar', actions: ['read', 'manage'] },
  { key: 'roles', label: 'Rol Yetkileri', actions: ['manage'] },
  { key: 'settings', label: 'Ayarlar ve Tanımlar', actions: ['read', 'manage'] },
  { key: 'audit', label: 'Denetim Kaydı', actions: ['read'] },
];

export const DEFAULT_MATRIX = {
  driver: {
    garage: ['read'],
    vehicles: ['read'],
    trips: ['read_own', 'create'],
    expenses: ['read_own', 'create'],
    issues: ['read_own', 'create'],
    drivers: ['read_own'],
    alerts: ['read'],
  },
  finance: {
    garage: ['read'],
    vehicles: ['read'],
    trips: ['read'],
    documents: ['read'],
    maintenance: ['read'],
    tires: ['read'],
    parts: ['read'],
    expenses: ['read', 'create', 'update', 'delete', 'approve'],
    issues: ['read'],
    drivers: ['read'],
    alerts: ['read'],
    reports: ['read'],
    costs: ['read'],
  },
  observer: {
    garage: ['read'],
    vehicles: ['read'],
    trips: ['read'],
    documents: ['read'],
    maintenance: ['read'],
    tires: ['read'],
    parts: ['read'],
    issues: ['read'],
    drivers: ['read'],
    alerts: ['read'],
    reports: ['read'],
  },
};

export const COST_FIELDS = new Set(['purchase_price', 'cost', 'labor_cost', 'parts_total', 'other_cost', 'total_cost', 'unit_price', 'amount', 'expense_total', 'cost_total']);

const MODULE_MAP = new Map(MODULES.map((m) => [m.key, m]));

export function getMatrix() {
  const stored = getSettings().role_matrix;
  const out = {};
  for (const role of Object.keys(DEFAULT_MATRIX)) out[role] = sanitizeRole(stored?.[role] ?? DEFAULT_MATRIX[role]);
  return out;
}

function sanitizeRole(obj) {
  const out = {};
  for (const m of MODULES) {
    const acts = Array.isArray(obj?.[m.key]) ? obj[m.key].filter((a) => m.actions.includes(a)) : [];
    if (acts.length) out[m.key] = [...new Set(acts)];
  }
  return out;
}

export function saveMatrix(matrix) {
  const clean = {};
  for (const role of Object.keys(DEFAULT_MATRIX)) clean[role] = sanitizeRole(matrix?.[role] ?? {});
  setSetting('role_matrix', clean);
  return clean;
}

export function resetMatrix() {
  deleteSetting('role_matrix');
  return getMatrix();
}

/** Kullanıcının etkin yetkileri: { modül: [eylemler] } */
export function permsFor(user) {
  if (!user) return {};
  if (user.role === 'admin') {
    const all = {};
    for (const m of MODULES) all[m.key] = [...m.actions];
    return all;
  }
  return getMatrix()[user.role] || {};
}

export function can(user, mod, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const acts = permsFor(user)[mod] || [];
  if (acts.includes(action)) return true;
  if (action === 'read_own' && acts.includes('read')) return true;
  return false;
}

/** 'all' | 'own' | false */
export function readScope(user, mod) {
  if (can(user, mod, 'read')) return 'all';
  if (can(user, mod, 'read_own')) return 'own';
  return false;
}

export function assertCan(user, mod, action) {
  if (!can(user, mod, action)) {
    const m = MODULE_MAP.get(mod);
    throw forbidden(`Bu işlem için yetkiniz yok (${m?.label || mod}: ${ACTIONS[action] || action})`);
  }
}

/** Express ara yazılımı: herhangi bir eylem yeterliyse dizi verin. */
export function requirePerm(mod, actions) {
  const list = Array.isArray(actions) ? actions : [actions];
  return (req, res, next) => {
    if (list.some((a) => can(req.user, mod, a))) return next();
    const m = MODULE_MAP.get(mod);
    next(forbidden(`Bu işlem için yetkiniz yok (${m?.label || mod})`));
  };
}

/**
 * Maliyet alanlarını yanıttan çıkarır (yerinde). Kullanıcının kendi oluşturduğu
 * kayıtların (ör. şoförün girdiği yakıt masrafı) tutarları korunur.
 */
export function stripCosts(data, userId) {
  const seen = new WeakSet();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const own = node.created_by != null && node.created_by === userId;
    for (const k of Object.keys(node)) {
      if (!own && COST_FIELDS.has(k)) delete node[k];
      else walk(node[k]);
    }
  };
  walk(data);
  return data;
}
