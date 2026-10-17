// Uygulama kabuğu: giriş, zorunlu parola değişimi, menü, üst çubuk, yönlendirici.
import { api } from './api.js';
import { state, setSession, loadLookups, can, on } from './state.js';
import { h, clear, icon, toast, errorToast, buildForm, append, LEVEL_TONE, emptyState, loading, modal } from './ui.js';
import { NAV, resolveRoute, defaultPath } from './modules.js';

const root = document.getElementById('app');
let cleanup = null;
let badgeTimer = null;
let shell = null;
let alertCache = [];

// ---------------------------------------------------------------- Giriş
function authLayout(content) {
  clear(root);
  root.append(h('div', { class: 'auth' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'brand brand-lg' }, h('span', { class: 'brand-mark' }, icon('garage', 22)), h('span', null, 'Dijital Garaj')),
      content),
    h('p', { class: 'auth-foot muted' }, 'Kurumsal araç filosu takip sistemi')));
}

function showLogin(message) {
  stopShell();
  const err = h('div', { class: 'form-alert', hidden: !message }, message ? [icon('warning', 16), h('span', null, message)] : null);
  const f = buildForm([
    { name: 'username', label: 'Kullanıcı adı', required: true, full: true, autocomplete: 'username' },
    { name: 'password', label: 'Parola', type: 'password', required: true, full: true, autocomplete: 'current-password' },
  ]);
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Giriş yap');
  f.form.append(h('div', { class: 'full' }, submit));
  f.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.validate()) return;
    submit.disabled = true;
    err.hidden = true;
    try {
      const res = await api.post('/auth/login', f.values(), { quiet: true });
      setSession(res);
      if (res.user.must_change_password) showChangePassword(true);
      else await startApp();
    } catch (ex) {
      clear(err);
      append(err, [icon('warning', 16), h('span', null, ex.message)]);
      err.hidden = false;
      submit.disabled = false;
      f.controls.get('password').select();
    }
  });
  authLayout([h('h1', { class: 'auth-title' }, 'Giriş yapın'), h('p', { class: 'muted' }, 'Hesabınız yoksa yöneticinizden kullanıcı adı ve parola isteyin.'), err, f.form]);
}

function passwordForm({ forced, onDone, onCancel }) {
  const err = h('div', { class: 'form-alert', hidden: true });
  const f = buildForm([
    { name: 'current_password', label: forced ? 'Geçici / mevcut parola' : 'Mevcut parola', type: 'password', required: true, full: true, autocomplete: 'current-password' },
    { name: 'new_password', label: 'Yeni parola', type: 'password', required: true, full: true, autocomplete: 'new-password', hint: 'En az 8 karakter; en az bir harf ve bir rakam içermeli.' },
    { name: 'new_password2', label: 'Yeni parola (tekrar)', type: 'password', required: true, full: true, autocomplete: 'new-password', validate: (v, d) => (v !== d.new_password ? 'Parolalar eşleşmiyor' : null) },
  ]);
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Parolayı değiştir');
  f.form.append(h('div', { class: 'full form-buttons' }, onCancel ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: onCancel }, 'Vazgeç') : null, submit));
  f.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.validate()) return;
    submit.disabled = true;
    err.hidden = true;
    try {
      const v = f.values();
      const res = await api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password });
      setSession(res);
      toast('Parolanız değiştirildi');
      await onDone();
    } catch (ex) {
      clear(err);
      append(err, [icon('warning', 16), h('span', null, ex.message)]);
      err.hidden = false;
      submit.disabled = false;
    }
  });
  return [err, f.form];
}

function showChangePassword(forced) {
  stopShell();
  authLayout([
    h('h1', { class: 'auth-title' }, 'Parolanızı belirleyin'),
    h('p', { class: 'muted' }, forced ? 'Güvenliğiniz için ilk girişte (veya parola sıfırlamasından sonra) yeni bir parola belirlemeniz gerekiyor.' : ''),
    passwordForm({ forced, onDone: startApp }),
    h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: logout }, 'Çıkış yap'),
  ]);
}

export function openPasswordDialog() {
  const m = modal({ title: 'Parolamı değiştir', width: 440, content: passwordForm({ forced: false, onDone: async () => m.close(), onCancel: () => m.close() }) });
}

async function logout() {
  try {
    await api.post('/auth/logout', {}, { quiet: true });
  } catch { /* yoksay */ }
  state.me = null;
  showLogin();
}

// ---------------------------------------------------------------- Kabuk
function stopShell() {
  if (cleanup) {
    try { cleanup(); } catch { /* yoksay */ }
    cleanup = null;
  }
  clearInterval(badgeTimer);
  window.removeEventListener('hashchange', route);
  shell = null;
}

async function startApp() {
  clear(root);
  root.append(loading('Uygulama hazırlanıyor…'));
  try {
    await loadLookups();
  } catch (e) {
    if (e.status === 401) return showLogin();
    if (e.code === 'PASSWORD_CHANGE_REQUIRED') return showChangePassword(true);
    clear(root);
    root.append(emptyState('warning', 'Uygulama yüklenemedi', e.message, h('button', { class: 'btn', onclick: () => startApp() }, 'Tekrar dene')));
    return;
  }
  window.__dg_warn = state.lookups.settings.doc_warn_days;
  renderShell();
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
  refreshBadges();
  clearInterval(badgeTimer);
  badgeTimer = setInterval(refreshBadges, 60000);
}

function renderShell() {
  clear(root);
  const nav = h('nav', { class: 'nav', 'aria-label': 'Ana menü' });
  for (const g of NAV) {
    const items = g.items.filter((i) => i.show());
    if (!items.length) continue;
    nav.append(h('div', { class: 'nav-group' }, g.group));
    for (const it of items) {
      nav.append(h('a', { class: 'nav-item', href: '#/' + it.path, dataset: { path: it.path } },
        icon(it.icon, 18), h('span', null, it.label), it.badge ? h('span', { class: 'nav-badge', dataset: { badge: it.badge }, hidden: true }) : null));
    }
  }
  const me = state.me;
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '#/dashboard' }, h('span', { class: 'brand-mark' }, icon('garage', 18)), h('span', null, 'Dijital Garaj')),
    h('div', { class: 'company muted small' }, state.lookups.company_name),
    nav,
    h('div', { class: 'sidebar-foot muted small' }, 'v1.0 · ', me.role_name));

  const title = h('h2', { class: 'top-title' });
  const bellCount = h('span', { class: 'bell-count', hidden: true });
  const bellPanel = h('div', { class: 'dropdown bell-panel', hidden: true });
  const bell = can('alerts', 'read')
    ? h('div', { class: 'dd-wrap' },
      h('button', { class: 'icon-btn bell', type: 'button', 'aria-label': 'Uyarılar', onclick: (e) => { e.stopPropagation(); toggle(bellPanel); renderBellPanel(); } }, icon('bell', 20), bellCount),
      bellPanel)
    : null;
  const userPanel = h('div', { class: 'dropdown user-panel', hidden: true },
    h('div', { class: 'dd-head' }, h('strong', null, me.full_name), h('div', { class: 'muted small' }, `${me.username} · ${me.role_name}`)),
    h('a', { class: 'dd-item', href: '#/profile' }, icon('user', 16), 'Profilim'),
    h('button', { class: 'dd-item', type: 'button', onclick: () => { userPanel.hidden = true; openPasswordDialog(); } }, icon('lock', 16), 'Parolamı değiştir'),
    h('button', { class: 'dd-item', type: 'button', onclick: logout }, icon('logout', 16), 'Çıkış yap'));
  const userBtn = h('div', { class: 'dd-wrap' },
    h('button', { class: 'user-btn', type: 'button', onclick: (e) => { e.stopPropagation(); toggle(userPanel); } },
      h('span', { class: 'avatar' }, initials(me.full_name)), h('span', { class: 'user-name' }, me.full_name)),
    userPanel);
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Menü', onclick: () => document.body.classList.toggle('nav-open') }, icon('menu', 20)),
    title, h('div', { class: 'spacer' }), bell, userBtn);
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const scrim = h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') });
  root.append(h('div', { class: 'layout' }, sidebar, scrim, h('div', { class: 'content' }, topbar, main)));
  shell = { main, title, nav, bellCount, bellPanel };

  document.addEventListener('click', closeDropdowns);
}

function closeDropdowns(e) {
  for (const d of document.querySelectorAll('.dropdown')) if (!d.hidden && !d.contains(e.target)) d.hidden = true;
}

function toggle(panel) {
  const was = panel.hidden;
  for (const d of document.querySelectorAll('.dropdown')) d.hidden = true;
  panel.hidden = !was;
}

const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toLocaleUpperCase('tr-TR')).join('');

function renderBellPanel() {
  const p = shell.bellPanel;
  clear(p);
  const unread = alertCache.filter((a) => !a.read);
  p.append(h('div', { class: 'dd-head row' }, h('strong', null, 'Uyarılar'), h('span', { class: 'muted small' }, `${unread.length} okunmamış`)));
  if (!unread.length) p.append(h('div', { class: 'dd-empty muted' }, 'Okunmamış uyarı yok.'));
  for (const a of unread.slice(0, 7)) {
    p.append(h('a', { class: 'dd-alert', href: a.link || '#/alerts', onclick: () => { api.post('/alerts/read', { keys: [a.key] }).then(refreshBadges).catch(() => {}); } },
      h('span', { class: `dot dot-${LEVEL_TONE[a.level]}` }),
      h('span', null, h('span', { class: 'dd-alert-title' }, a.title), h('span', { class: 'muted small' }, a.message))));
  }
  p.append(h('div', { class: 'dd-foot' },
    h('a', { href: '#/alerts', class: 'btn btn-sm btn-ghost' }, 'Tümünü gör'),
    unread.length ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: async (e) => { e.stopPropagation(); await api.post('/alerts/read', { all: true }); refreshBadges(); p.hidden = true; } }, 'Tümünü okundu say') : null));
}

export async function refreshBadges() {
  if (!shell || !can('alerts', 'read')) return;
  try {
    const { alerts, counts } = await api.get('/alerts', { quiet: true });
    alertCache = alerts;
    shell.bellCount.hidden = !counts.unread;
    shell.bellCount.textContent = counts.unread > 99 ? '99+' : counts.unread;
    shell.bellCount.className = `bell-count ${alerts.some((a) => !a.read && a.level === 'critical') ? 'crit' : ''}`;
    const navAlert = shell.nav.querySelector('[data-badge=alerts]');
    if (navAlert) {
      const crit = counts.critical;
      navAlert.hidden = !(crit || counts.warning);
      navAlert.textContent = crit || counts.warning;
      navAlert.className = `nav-badge ${crit ? 'crit' : 'warn'}`;
    }
    const navExp = shell.nav.querySelector('[data-badge=expenses]');
    if (navExp) {
      const pend = alerts.find((a) => a.module === 'expenses' && a.key.startsWith('pending:'));
      const n = pend ? Number(pend.key.split(':')[1]) : 0;
      navExp.hidden = !n;
      navExp.textContent = n;
      navExp.className = 'nav-badge info';
    }
  } catch { /* sessiz */ }
}

// ---------------------------------------------------------------- Yönlendirici
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, q] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: new URLSearchParams(q || '') };
}

let routeSeq = 0;
async function route() {
  if (!shell) return;
  const seq = ++routeSeq;
  document.body.classList.remove('nav-open');
  const { path, query } = parseHash();
  if (!path) {
    location.replace('#/' + defaultPath());
    return;
  }
  if (cleanup) {
    try { cleanup(); } catch { /* yoksay */ }
    cleanup = null;
  }
  const main = shell.main;
  clear(main);
  const r = resolveRoute(path);
  for (const a of shell.nav.querySelectorAll('.nav-item')) a.classList.toggle('active', !!r?.item && (a.dataset.path === r.item.path || a.dataset.path === r.item.active));
  if (!r) {
    shell.title.textContent = 'Sayfa bulunamadı';
    main.append(emptyState('info', 'Sayfa bulunamadı', 'Aradığınız sayfa mevcut değil.', h('a', { class: 'btn', href: '#/dashboard' }, 'Panele dön')));
    return;
  }
  if (r.denied) {
    shell.title.textContent = r.item.label;
    main.append(emptyState('lock', 'Bu sayfaya erişim yetkiniz yok', 'Rolünüz bu modülü görüntülemeye izin vermiyor. Gerekirse yöneticinize başvurun.', h('a', { class: 'btn', href: '#/dashboard' }, 'Panele dön')));
    return;
  }
  shell.title.textContent = r.item.label;
  document.title = `${r.item.label} · Dijital Garaj`;
  main.classList.toggle('main-flush', r.item.path === 'garage');
  window.scrollTo(0, 0);
  main.append(loading());
  try {
    const ret = await r.item.page(main, { params: r.params, query, setTitle: (t) => (shell.title.textContent = t) });
    if (seq !== routeSeq) {
      if (typeof ret === 'function') ret();
      return;
    }
    main.querySelector(':scope > .loading')?.remove();
    if (typeof ret === 'function') cleanup = ret;
    main.focus({ preventScroll: true });
  } catch (e) {
    if (seq !== routeSeq) return;
    clear(main);
    if (e.status === 403) main.append(emptyState('lock', 'Erişim yok', e.message));
    else if (e.status === 404) main.append(emptyState('info', 'Kayıt bulunamadı', e.message, h('button', { class: 'btn', type: 'button', onclick: () => history.back() }, 'Geri dön')));
    else {
      main.append(emptyState('warning', 'Sayfa yüklenemedi', e.message, h('button', { class: 'btn', onclick: route }, 'Tekrar dene')));
      console.error(e);
    }
  }
}

export function rerender() {
  route();
}

// ---------------------------------------------------------------- Başlat
window.addEventListener('dg:unauthorized', () => {
  if (state.me) {
    state.me = null;
    showLogin('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
  }
});
window.addEventListener('dg:password-change', () => showChangePassword(true));
on('changed', () => refreshBadges());
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.status) {
    errorToast(e.reason);
    e.preventDefault();
  }
});

(async function boot() {
  try {
    const me = await api.get('/auth/me', { quiet: true });
    setSession(me);
  } catch (e) {
    if (e.code === 'NETWORK') {
      authLayout([emptyState('warning', 'Sunucuya ulaşılamadı', 'Sunucunun çalıştığından emin olun.', h('button', { class: 'btn', onclick: () => location.reload() }, 'Tekrar dene'))]);
      return;
    }
    return showLogin();
  }
  if (state.me.must_change_password) return showChangePassword(true);
  await startApp();
})();
