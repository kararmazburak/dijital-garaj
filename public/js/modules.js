// Menü ve rota tanımları (rol bazlı filtrelenir).
import { can, scope } from './state.js';
import * as core from './pages-core.js';
import * as ops from './pages-ops.js';
import * as admin from './pages-admin.js';

export const NAV = [
  {
    group: 'Genel',
    items: [
      { path: 'dashboard', label: 'Panel', icon: 'dashboard', show: () => true, page: core.dashboardPage },
      { path: 'garage', label: 'Dijital Garaj', icon: 'garage', show: () => can('garage', 'read'), page: core.garagePage },
      { path: 'alerts', label: 'Uyarılar', icon: 'bell', show: () => can('alerts', 'read'), page: ops.alertsPage, badge: 'alerts' },
    ],
  },
  {
    group: 'Operasyon',
    items: [
      { path: 'trips', label: 'Çıkış / Dönüş', icon: 'key', show: () => !!scope('trips') || can('trips', 'create'), page: core.tripsPage },
      { path: 'vehicles', label: 'Araçlar', icon: 'car', show: () => can('vehicles', 'read'), page: core.vehiclesPage },
      { path: 'documents', label: 'Belgeler', icon: 'doc', show: () => can('documents', 'read'), page: ops.documentsPage },
      { path: 'maintenance', label: 'Bakım', icon: 'wrench', show: () => can('maintenance', 'read'), page: ops.maintenancePage },
      { path: 'tires', label: 'Lastikler', icon: 'tire', show: () => can('tires', 'read'), page: ops.tiresPage },
      { path: 'parts', label: 'Yedek Parça', icon: 'box', show: () => can('parts', 'read'), page: ops.partsPage },
      { path: 'expenses', label: 'Masraflar', icon: 'money', show: () => !!scope('expenses'), page: ops.expensesPage, badge: 'expenses' },
      { path: 'issues', label: 'Arıza / Hasar', icon: 'warning', show: () => !!scope('issues') || can('issues', 'create'), page: ops.issuesPage },
    ],
  },
  {
    group: 'Analiz',
    items: [
      { path: 'drivers', label: 'Şoför Kullanımı', icon: 'user', show: () => !!scope('drivers'), page: ops.driversPage },
      { path: 'reports', label: 'Raporlar', icon: 'chart', show: () => can('reports', 'read'), page: ops.reportsPage },
    ],
  },
  {
    group: 'Yönetim',
    items: [
      { path: 'users', label: 'Kullanıcılar', icon: 'users', show: () => can('users', 'read') || can('users', 'manage'), page: admin.usersPage },
      { path: 'roles', label: 'Rol Yetkileri', icon: 'shield', show: () => can('roles', 'manage'), page: admin.rolesPage },
      { path: 'settings', label: 'Ayarlar', icon: 'gear', show: () => can('settings', 'read') || can('settings', 'manage'), page: admin.settingsPage },
      { path: 'audit', label: 'Denetim Kaydı', icon: 'list', show: () => can('audit', 'read'), page: admin.auditPage },
    ],
  },
];

/** Alt sayfalar (menüde görünmez). */
export const SUBROUTES = [
  { pattern: /^vehicles\/(\d+)$/, parent: 'vehicles', page: core.vehicleDetailPage },
  { pattern: /^drivers\/(\d+)$/, parent: 'drivers', page: ops.driverDetailPage },
  { pattern: /^profile$/, parent: null, page: admin.profilePage, title: 'Profilim' },
];

export function resolveRoute(path) {
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.path === path) return it.show() ? { item: it, params: [] } : { denied: true, item: it };
    }
  }
  for (const s of SUBROUTES) {
    const m = s.pattern.exec(path);
    if (m) {
      const parent = s.parent ? NAV.flatMap((g) => g.items).find((i) => i.path === s.parent) : null;
      if (parent && !parent.show()) return { denied: true, item: parent };
      return { item: { ...(parent || {}), path, label: s.title || parent?.label, page: s.page, active: s.parent }, params: m.slice(1) };
    }
  }
  return null;
}

export function defaultPath() {
  if (can('garage', 'read')) return 'dashboard';
  return 'dashboard';
}
