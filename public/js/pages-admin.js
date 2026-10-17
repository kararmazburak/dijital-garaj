// Kullanıcılar, Rol yetkileri, Ayarlar (tanımlar dahil), Denetim kaydı, Profil.
import { api, qs } from './api.js';
import { state, can, L, C, loadLookups, emit } from './state.js';
import {
  h, clear, icon, fmtDate, fmtDateTime, fmtNum, relTime, badge, daysBadge, toast, confirmDialog, openForm, modal, dataTable, pageHeader, emptyState,
  card, btn, tabs, kv, buildForm, todayStr,
} from './ui.js';

const ROLE_TONE = { admin: 'purple', driver: 'blue', finance: 'green', observer: 'gray' };

// =====================================================================  KULLANICILAR
async function openUserForm(user = null) {
  const roles = Object.entries(C().roles);
  const res = await openForm({
    title: user ? `${user.full_name} — Düzenle` : 'Yeni personel',
    width: 720,
    fields: [
      { type: 'heading', label: 'Hesap' },
      { name: 'full_name', label: 'Ad soyad', required: true, maxlength: 120 },
      { name: 'username', label: 'Kullanıcı adı', required: true, maxlength: 40, hint: '3–40 karakter: harf, rakam, nokta, tire, alt çizgi', validate: (v) => (v && !/^[a-zA-Z0-9._-]{3,40}$/.test(v) ? 'Geçersiz kullanıcı adı' : null) },
      { name: 'role', label: 'Rol', type: 'select', required: true, options: roles },
      user ? { name: 'active', label: 'Hesap aktif', type: 'checkbox' } : null,
      user ? null : { name: 'password', label: 'Geçici parola', type: 'password', required: true, autocomplete: 'new-password', hint: 'En az 8 karakter, harf ve rakam. Kullanıcıya iletin.',
        validate: (v) => (v && (v.length < 8 || !/\d/.test(v) || !/\p{L}/u.test(v)) ? 'En az 8 karakter; harf ve rakam içermeli' : null) },
      user ? null : { name: 'must_change_password', label: 'İlk girişte parola değiştirmesini zorunlu kıl', type: 'checkbox' },
      { type: 'heading', label: 'İletişim' },
      { name: 'phone', label: 'Telefon', type: 'tel', maxlength: 40 },
      { name: 'email', label: 'E-posta', type: 'email', maxlength: 160, hint: 'Yöneticiler kritik uyarı e-postalarını bu adrese alır.' },
      { name: 'department', label: 'Departman', maxlength: 120 },
      { type: 'heading', label: 'Ehliyet ve SRC', hint: 'Süresi geçmiş ehliyet/SRC ile araç çıkışı engellenir (Ayarlar\'dan değiştirilebilir).' },
      { name: 'license_no', label: 'Ehliyet no', maxlength: 40 },
      { name: 'license_class', label: 'Ehliyet sınıfı', maxlength: 40, placeholder: 'B, C, D, E…' },
      { name: 'license_expiry', label: 'Ehliyet geçerlilik bitişi', type: 'date' },
      { name: 'src_expiry', label: 'SRC belgesi bitişi', type: 'date' },
      { name: 'notes', label: 'Not', type: 'textarea', full: true, rows: 2 },
    ].filter(Boolean),
    values: user ? { ...user, active: !!user.active } : { role: 'driver', must_change_password: true },
    onSubmit: (v) => (user ? api.put(`/users/${user.id}`, v) : api.post('/users', v)),
  });
  if (res) {
    toast(user ? 'Kullanıcı güncellendi' : `${res.full_name} eklendi`);
    await loadLookups();
  }
  return res;
}

async function resetPassword(u) {
  const res = await openForm({
    title: 'Parola sıfırla',
    subtitle: `${u.full_name} (${u.username})`,
    width: 460,
    intro: h('p', { class: 'muted' }, 'Kullanıcının tüm oturumları kapatılır; ilk girişte yeni parola belirlemesi istenir.'),
    fields: [{ name: 'password', label: 'Geçici parola', type: 'password', required: true, full: true, autocomplete: 'new-password',
      validate: (v) => (v && (v.length < 8 || !/\d/.test(v) || !/\p{L}/u.test(v)) ? 'En az 8 karakter; harf ve rakam içermeli' : null) }],
    submitLabel: 'Sıfırla',
    onSubmit: (v) => api.post(`/users/${u.id}/reset-password`, v),
  });
  if (res) toast('Parola sıfırlandı');
}

export async function usersPage(main) {
  const rows = await api.get('/users');
  clear(main);
  const manage = can('users', 'manage');
  const me = state.me;
  const reload = async () => table.update(await api.get('/users'));
  const table = dataTable({
    rows,
    csvName: 'kullanicilar',
    sort: { key: 'full_name', dir: 'asc' },
    filters: [
      { key: 'role', label: 'Rol', options: Object.entries(C().roles) },
      { key: 'active', label: 'Hesap', options: [['1', 'Aktif'], ['0', 'Pasif']], value: '1', match: (r, v) => String(r.active) === v },
    ],
    rowClass: (r) => (!r.active ? 'row-muted' : ''),
    columns: [
      { key: 'full_name', label: 'Ad soyad', render: (r) => h('div', { class: 'cell-2' }, h('strong', null, r.full_name, r.id === me.id ? h('span', { class: 'muted' }, ' (siz)') : null), h('span', { class: 'muted small' }, r.username)), text: (r) => `${r.full_name} ${r.username}` },
      { key: 'role', label: 'Rol', render: (r) => badge(C().roles[r.role], ROLE_TONE[r.role]), text: (r) => C().roles[r.role] },
      { key: 'contact', label: 'İletişim', text: (r) => [r.phone, r.email].filter(Boolean).join(' · ') || '—', hideSm: true },
      { key: 'license_expiry', label: 'Ehliyet', render: (r) => (r.license_expiry ? h('div', { class: 'cell-2' }, h('span', null, fmtDate(r.license_expiry), r.license_class ? ` · ${r.license_class}` : ''), r.src_expiry ? h('span', { class: 'muted small' }, `SRC ${fmtDate(r.src_expiry)}`) : null) : '—'), text: (r) => r.license_expiry || '' },
      { key: 'trip_count', label: 'Sefer', align: 'right', text: (r) => fmtNum(r.trip_count), hideSm: true },
      { key: 'active', label: 'Durum', render: (r) => h('div', { class: 'cell-2' }, r.active ? badge('Aktif', 'green') : badge('Pasif', 'gray'), r.must_change_password ? h('span', { class: 'muted small' }, 'Parola değişimi bekliyor') : null), text: (r) => (r.active ? 'Aktif' : 'Pasif') },
      { key: 'last_login_at', label: 'Son giriş', text: (r) => (r.last_login_at ? relTime(r.last_login_at) : 'Hiç'), sortValue: (r) => r.last_login_at || '', hideSm: true },
      manage ? {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: async () => { if (await openUserForm(r)) reload(); } }),
          btn('', { size: 'sm', kind: 'ghost', ic: 'lock', title: 'Parola sıfırla', onClick: () => resetPassword(r) }),
          r.id !== me.id ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil / pasifleştir', onClick: async () => {
            if (!(await confirmDialog({ title: `${r.full_name} silinsin mi?`, message: 'Geçmiş kaydı (sefer, masraf vb.) olan kullanıcılar silinmez, pasifleştirilir.', confirmLabel: 'Devam et', danger: true }))) return;
            const res = await api.del(`/users/${r.id}`);
            toast(res.deactivated ? 'Kullanıcı pasifleştirildi (geçmiş korunuyor)' : 'Kullanıcı silindi');
            await loadLookups();
            reload();
          } }) : null),
      } : null,
    ],
  });
  main.append(h('div', { class: 'page' },
    pageHeader('Kullanıcılar', 'Personel hesapları, roller ve ehliyet bilgileri. Yetkileri "Rol Yetkileri" ekranından düzenleyin.', [
      manage ? btn('Personel ekle', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openUserForm()) reload(); } }) : null,
    ]),
    card(null, table)));
}

// =====================================================================  ROL YETKİLERİ
export async function rolesPage(main) {
  let data = await api.get('/roles');
  clear(main);
  let matrix = structuredClone(data.matrix);
  let dirty = false;
  const editable = Object.keys(data.matrix); // admin hariç
  const wrap = h('div');
  const saveBtn = btn('Değişiklikleri kaydet', { kind: 'primary', ic: 'check', onClick: async () => {
    data = await api.put('/roles', { matrix });
    matrix = structuredClone(data.matrix);
    dirty = false;
    render();
    toast('Rol yetkileri kaydedildi');
    emit('changed');
  } });
  const render = () => {
    clear(wrap);
    saveBtn.disabled = !dirty;
    const table = h('table', { class: 'table matrix' });
    table.append(h('thead', null, h('tr', null, h('th', null, 'Modül'), h('th', null, h('span', null, data.roles.admin), h('div', { class: 'muted small' }, 'her zaman tam yetki')),
      editable.map((r) => h('th', null, data.roles[r])))));
    const tb = h('tbody');
    for (const m of data.modules) {
      const tr = h('tr', null, h('td', null, h('strong', null, m.label), m.hint ? h('div', { class: 'muted small' }, m.hint) : null), h('td', { class: 'muted small' }, 'Tümü'));
      for (const role of editable) {
        const cell = h('td');
        for (const a of m.actions) {
          const on = (matrix[role][m.key] || []).includes(a);
          cell.append(h('label', { class: `perm ${on ? 'on' : ''}` },
            h('input', { type: 'checkbox', checked: on, onchange: (e) => {
              const set = new Set(matrix[role][m.key] || []);
              e.target.checked ? set.add(a) : set.delete(a);
              matrix[role][m.key] = [...set];
              dirty = true;
              render();
            } }),
            h('span', null, data.actions[a])));
        }
        tr.append(cell);
      }
      tb.append(tr);
    }
    table.append(tb);
    wrap.append(h('div', { class: 'table-wrap' }, table));
  };
  render();
  main.append(h('div', { class: 'page' },
    pageHeader('Rol Yetkileri', 'Her rolün her modüldeki işlemlerini belirleyin. "Maliyet Alanları" kapalı rollerde tutarlar sunucu tarafından gizlenir.', [
      btn('Varsayılana dön', { ic: 'refresh', onClick: async () => {
        if (!(await confirmDialog({ title: 'Varsayılan yetkiler geri yüklensin mi?', message: 'Tüm roller fabrika ayarlarına döner.', confirmLabel: 'Geri yükle', danger: true }))) return;
        data = await api.post('/roles/reset', {});
        matrix = structuredClone(data.matrix);
        dirty = false;
        render();
        toast('Varsayılan yetkiler geri yüklendi');
      } }),
      saveBtn,
    ]),
    h('div', { class: 'callout callout-blue' }, icon('info', 18), h('div', null, '"Görüntüle" tüm kayıtları, "Kendi kayıtlarını görüntüle" yalnızca kullanıcının kendi kayıtlarını gösterir. Değişiklikler kullanıcıların bir sonraki sayfa yenilemesinde geçerli olur.')),
    card(null, wrap)));
  return () => {
    if (dirty) toast('Kaydedilmemiş rol değişiklikleri vardı', 'info');
  };
}

// =====================================================================  AYARLAR
export async function settingsPage(main, { query }) {
  const data = await api.get('/settings');
  clear(main);
  const manage = can('settings', 'manage');
  const tab = query.get('tab') || 'general';
  const T = [
    { key: 'general', label: 'Genel' },
    { key: 'alerts', label: 'Uyarı eşikleri' },
    { key: 'maintenance', label: 'Bakım' },
    { key: 'tires', label: 'Lastik' },
    { key: 'trips', label: 'Sefer kuralları' },
    { key: 'notify', label: 'Bildirim' },
    { key: 'vtypes', label: 'Araç türleri' },
    { key: 'dtypes', label: 'Belge türleri / zorunlu belgeler' },
  ];
  const body = h('div');
  main.append(h('div', { class: 'page' },
    pageHeader('Ayarlar', manage ? 'Sistem genelindeki kurallar, eşikler ve tanımlar.' : 'Ayarları yalnızca görüntüleyebilirsiniz.'),
    tabs(T, tab, (k) => (location.hash = `#/settings?tab=${k}`)),
    body));

  const s = data.settings;
  const sections = {
    general: [
      { name: 'company_name', label: 'Şirket adı', required: true, maxlength: 120 },
      { name: 'timezone', label: 'Saat dilimi', placeholder: 'Europe/Istanbul', hint: 'IANA saat dilimi adı. Gün hesapları bu dilime göre yapılır.' },
    ],
    alerts: [
      { name: 'w1', label: 'Belge: ilk uyarı (gün)', type: 'number', min: 0, max: 365, step: 1, required: true, virtual: true },
      { name: 'w2', label: 'Belge: hatırlatma (gün)', type: 'number', min: 0, max: 365, step: 1, required: true, virtual: true },
      { name: 'w3', label: 'Belge: kritik (gün)', type: 'number', min: 0, max: 365, step: 1, required: true, virtual: true, hint: 'Bu sürenin altında uyarı kritik olur.' },
      { name: 'license_warn_days', label: 'Ehliyet / SRC uyarı süresi (gün)', type: 'number', min: 1, max: 365, step: 1 },
    ],
    maintenance: [
      { name: 'maint_default_km', label: 'Varsayılan bakım aralığı (km)', type: 'number', min: 0, step: 500, hint: 'Araçta aralık tanımlı değilse kullanılır.' },
      { name: 'maint_default_months', label: 'Varsayılan bakım aralığı (ay)', type: 'number', min: 0, max: 120, step: 1 },
      { name: 'maint_warn_km', label: 'Bakım yaklaşıyor uyarısı (km kala)', type: 'number', min: 0, step: 100 },
      { name: 'maint_warn_days', label: 'Bakım yaklaşıyor uyarısı (gün kala)', type: 'number', min: 0, step: 1 },
    ],
    tires: [
      { name: 'tire_max_age_years', label: 'Lastik yaş sınırı (yıl, DOT\'tan)', type: 'number', min: 1, max: 20, step: 0.5 },
      { name: 'tire_default_max_km', label: 'Varsayılan lastik km sınırı', type: 'number', min: 0, step: 1000 },
      { name: 'tire_min_tread_mm', label: 'Asgari diş derinliği (mm) — kritik', type: 'number', min: 0, max: 10, step: 0.1 },
      { name: 'tire_warn_tread_mm', label: 'Diş derinliği uyarı eşiği (mm)', type: 'number', min: 0, max: 15, step: 0.1 },
      { name: 'winter_check', label: 'Kış lastiği dönemi denetimi', type: 'checkbox', full: true },
      { name: 'winter_start', label: 'Kış dönemi başlangıcı (AA-GG)', placeholder: '11-01', validate: (v) => (v && !/^\d{2}-\d{2}$/.test(v) ? 'AA-GG biçiminde olmalı' : null) },
      { name: 'winter_end', label: 'Kış dönemi bitişi (AA-GG)', placeholder: '04-01', validate: (v) => (v && !/^\d{2}-\d{2}$/.test(v) ? 'AA-GG biçiminde olmalı' : null) },
    ],
    trips: [
      { name: 'block_on_expired_docs', label: 'Zorunlu belgesi eksik veya süresi dolmuş araca çıkış verme', type: 'checkbox', full: true },
      { name: 'block_on_expired_license', label: 'Ehliyeti / SRC\'si dolmuş şoföre çıkış verme', type: 'checkbox', full: true },
      { name: 'trip_open_warn_hours', label: 'Kapanmayan sefer uyarısı (saat)', type: 'number', min: 1, max: 720, step: 1 },
      { name: 'trip_long_km', label: 'Olağan dışı uzun sefer eşiği (km)', type: 'number', min: 1, step: 50 },
      { name: 'km_gap_threshold', label: 'Km boşluğu uyarı eşiği (km)', type: 'number', min: 0, step: 10, hint: 'Önceki dönüş ile sonraki çıkış arasındaki fark bu değeri aşarsa uyarı üretilir.' },
    ],
    notify: [
      { name: 'notify_emails', label: 'Ek bildirim e-postaları', type: 'textarea', full: true, rows: 2, placeholder: 'filo@sirket.com, mudur@sirket.com', hint: 'Aktif yöneticilerin e-postalarına ek olarak. Virgülle ayırın.' },
      { name: 'scan_interval_min', label: 'Tarama aralığı (dakika)', type: 'number', min: 5, max: 1440, step: 5 },
    ],
  };

  if (sections[tab]) {
    const values = { ...s, w1: s.doc_warn_days[0], w2: s.doc_warn_days[1], w3: s.doc_warn_days[2] };
    const fields = sections[tab].map((f) => ({ ...f, disabled: !manage }));
    const f = buildForm(fields, values);
    const errBox = h('div', { class: 'form-alert', hidden: true });
    const save = manage ? btn('Kaydet', { kind: 'primary', ic: 'check', onClick: async () => {
      errBox.hidden = true;
      if (!f.validate()) return;
      const v = f.values();
      const body2 = {};
      for (const fd of sections[tab]) if (!fd.virtual) body2[fd.name] = v[fd.name];
      if (tab === 'alerts') body2.doc_warn_days = [f.data.w1, f.data.w2, f.data.w3];
      for (const k of ['winter_check', 'block_on_expired_docs', 'block_on_expired_license']) if (k in body2) body2[k] = !!body2[k];
      try {
        await api.put('/settings', body2);
        toast('Ayarlar kaydedildi');
        await loadLookups();
        window.__dg_warn = L().settings.doc_warn_days;
        emit('changed');
      } catch (e) {
        if (!(e.data?.field && f.setError(e.data.field === 'doc_warn_days' ? 'w1' : e.data.field, e.message))) {
          errBox.textContent = e.message;
          errBox.hidden = false;
        }
      }
    } }) : null;
    const extra = tab === 'notify' ? h('div', { class: `callout ${data.smtp_configured ? 'callout-green' : 'callout-orange'}` }, icon('info', 18),
      h('div', null, data.smtp_configured ? 'SMTP yapılandırılmış: yeni kritik uyarılar e-postayla gönderilir.' : 'SMTP yapılandırılmamış. E-posta için sunucuda SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ve MAIL_FROM ortam değişkenlerini tanımlayın. Bildirimler yine de sistem içinde kaydedilir.'))
      : tab === 'alerts' ? h('p', { class: 'muted small' }, 'Örnek 30 / 15 / 7: bitişe 30 gün kala uyarı, 15 günde hatırlatma, 7 günde kritik. Belge türü bazında ilk uyarı süresi "Belge türleri" sekmesinden değiştirilebilir.') : null;
    body.append(card(T.find((x) => x.key === tab).label, [extra, errBox, f.form, save ? h('div', { class: 'form-buttons' }, save) : null]));
  } else if (tab === 'vtypes') {
    await vehicleTypesSection(body, data.body_types, manage);
  } else if (tab === 'dtypes') {
    await docTypesSection(body, manage);
  }
}

async function vehicleTypesSection(body, bodyTypes, manage) {
  const rows = await api.get('/vehicle-types');
  const reload = async () => {
    table.update(await api.get('/vehicle-types'));
    await loadLookups();
  };
  const form = async (t = null) => {
    const res = await openForm({
      title: t ? 'Araç türünü düzenle' : 'Yeni araç türü',
      width: 560,
      fields: [
        { name: 'name', label: 'Tür adı', required: true, maxlength: 60 },
        { name: 'icon', label: 'Simge (emoji)', maxlength: 8, placeholder: '🚗' },
        { name: 'body', label: '3B gövde tipi', type: 'select', required: true, options: Object.entries(bodyTypes), hint: 'Garajda bu türün hangi modelle çizileceği.' },
        { name: 'length', label: 'Varsayılan uzunluk (m)', type: 'number', min: 1, max: 25, step: 0.1, hint: 'Model bu uzunluğa göre ölçeklenir ve yuva boyutu belirlenir.' },
        { name: 'sort', label: 'Sıra', type: 'number', min: 0, step: 1 },
        { name: 'active', label: 'Aktif', type: 'checkbox' },
      ],
      values: t ? { ...t, active: !!t.active } : { body: 'car', length: 4.5, sort: 500, active: true },
      onSubmit: (v) => (t ? api.put(`/vehicle-types/${t.id}`, v) : api.post('/vehicle-types', v)),
    });
    if (res) {
      toast('Araç türü kaydedildi');
      reload();
    }
  };
  const table = dataTable({
    rows,
    csvName: 'arac-turleri',
    sort: { key: 'sort', dir: 'asc' },
    columns: [
      { key: 'name', label: 'Tür', render: (r) => `${r.icon || ''} ${r.name}` },
      { key: 'body', label: '3B gövde', text: (r) => bodyTypes[r.body] || r.body },
      { key: 'length', label: 'Uzunluk', align: 'right', text: (r) => `${fmtNum(r.length, 1)} m` },
      { key: 'vehicle_count', label: 'Araç', align: 'right', text: (r) => fmtNum(r.vehicle_count) },
      { key: 'active', label: 'Durum', render: (r) => (r.active ? badge('Aktif', 'green') : badge('Pasif', 'gray')), text: (r) => (r.active ? 'Aktif' : 'Pasif') },
      { key: 'sort', label: 'Sıra', align: 'right', text: (r) => String(r.sort) },
      manage ? { key: 'actions', label: '', sortable: false, csv: false, align: 'right', render: (r) => h('div', { class: 'row-actions' },
        btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: () => form(r) }),
        !r.vehicle_count ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
          if (!(await confirmDialog({ title: `${r.name} silinsin mi?`, confirmLabel: 'Sil', danger: true }))) return;
          await api.del(`/vehicle-types/${r.id}`);
          toast('Araç türü silindi');
          reload();
        } }) : null) } : null,
    ],
  });
  body.append(card('Araç türleri', table, { subtitle: 'Yeni tür eklerken 3B gövde tipini seçin.', actions: manage ? btn('Tür ekle', { size: 'sm', kind: 'primary', ic: 'plus', onClick: () => form() }) : null }));
}

async function docTypesSection(body, manage) {
  const rows = await api.get('/doc-types');
  const reload = async () => {
    table.update(await api.get('/doc-types'));
    await loadLookups();
  };
  const CAT = { insurance: 'Sigorta', casco: 'Kasko', inspection: 'Muayene', other: 'Diğer' };
  const form = async (t = null) => {
    const res = await openForm({
      title: t ? 'Belge türünü düzenle' : 'Yeni belge türü',
      width: 560,
      fields: [
        { name: 'name', label: 'Belge türü', required: true, maxlength: 80, full: true },
        { name: 'required', label: 'Zorunlu belge (her aktif araçta bulunmalı)', type: 'checkbox', full: true },
        { name: 'has_expiry', label: 'Bitiş tarihi var', type: 'checkbox', full: true },
        { name: 'warn_days', label: 'İlk uyarı süresi (gün)', type: 'number', min: 1, max: 365, step: 1, hint: 'Boşsa genel eşik kullanılır.' },
        { name: 'expense_category', label: 'Masraf kategorisi', type: 'select', required: true, options: Object.entries(CAT) },
        { name: 'sort', label: 'Sıra', type: 'number', min: 0, step: 1 },
        { name: 'active', label: 'Aktif', type: 'checkbox' },
      ],
      values: t ? { ...t, required: !!t.required, has_expiry: !!t.has_expiry, active: !!t.active } : { has_expiry: true, expense_category: 'other', sort: 500, active: true },
      onSubmit: (v) => (t ? api.put(`/doc-types/${t.id}`, v) : api.post('/doc-types', v)),
    });
    if (res) {
      toast('Belge türü kaydedildi');
      reload();
    }
  };
  const table = dataTable({
    rows,
    csvName: 'belge-turleri',
    sort: { key: 'sort', dir: 'asc' },
    columns: [
      { key: 'name', label: 'Belge türü' },
      { key: 'required', label: 'Zorunlu', render: (r) => (manage ? h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!r.required, onchange: async (e) => {
        try {
          await api.put(`/doc-types/${r.id}`, { required: e.target.checked });
          toast(`${r.name} ${e.target.checked ? 'zorunlu yapıldı' : 'zorunlu olmaktan çıkarıldı'}`);
          reload();
          emit('changed');
        } catch (err) {
          e.target.checked = !e.target.checked;
          toast(err.message, 'error');
        }
      } }), h('span', null)) : r.required ? badge('Zorunlu', 'red') : '—'), text: (r) => (r.required ? 'Evet' : 'Hayır') },
      { key: 'has_expiry', label: 'Süreli', text: (r) => (r.has_expiry ? 'Evet' : 'Süresiz') },
      { key: 'warn_days', label: 'İlk uyarı', align: 'right', text: (r) => (r.warn_days ? `${r.warn_days} gün` : 'Genel') },
      { key: 'expense_category', label: 'Masraf', text: (r) => CAT[r.expense_category] || r.expense_category },
      { key: 'doc_count', label: 'Belge', align: 'right', text: (r) => fmtNum(r.doc_count) },
      { key: 'active', label: 'Durum', render: (r) => (r.active ? badge('Aktif', 'green') : badge('Pasif', 'gray')), text: (r) => (r.active ? 'Aktif' : 'Pasif') },
      manage ? { key: 'actions', label: '', sortable: false, csv: false, align: 'right', render: (r) => h('div', { class: 'row-actions' },
        btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: () => form(r) }),
        !r.doc_count ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
          if (!(await confirmDialog({ title: `${r.name} silinsin mi?`, confirmLabel: 'Sil', danger: true }))) return;
          await api.del(`/doc-types/${r.id}`);
          toast('Belge türü silindi');
          reload();
        } }) : null) } : null,
    ],
  });
  body.append(card('Belge türleri', table, { subtitle: 'Zorunlu belgeler eksik veya süresi dolmuşsa uyarı üretilir ve (ayara bağlı olarak) araç çıkışı engellenir.', actions: manage ? btn('Tür ekle', { size: 'sm', kind: 'primary', ic: 'plus', onClick: () => form() }) : null }));
}

// =====================================================================  DENETİM KAYDI
const ACTION_LABELS = {
  login: 'Giriş', login_failed: 'Başarısız giriş', logout: 'Çıkış', password_change: 'Parola değişikliği', password_reset: 'Parola sıfırlama',
  create: 'Oluşturma', update: 'Güncelleme', delete: 'Silme', deactivate: 'Pasifleştirme',
  user_create: 'Kullanıcı ekleme', user_update: 'Kullanıcı güncelleme', user_delete: 'Kullanıcı silme', user_deactivate: 'Kullanıcı pasifleştirme', role_change: 'Rol değişikliği',
  role_matrix_update: 'Yetki matrisi değişikliği', role_matrix_reset: 'Yetkiler varsayılana döndü', settings_update: 'Ayar değişikliği',
  trip_start: 'Araç çıkışı', trip_force_start: 'Zorla çıkış', trip_end: 'Araç dönüşü', trip_update: 'Sefer güncelleme', km_correct: 'Km düzeltme',
  document_renew: 'Belge yenileme', maintenance_complete: 'Bakım tamamlama', vehicle_status: 'Araç durumu', issue_convert: 'Arıza → bakım',
  expense_approve: 'Masraf onayı', expense_reject: 'Masraf reddi', tire_mount: 'Lastik takma', tire_dismount: 'Lastik sökme', tire_scrap: 'Lastik hurda', tire_seasonal_change: 'Mevsimsel lastik değişimi',
  stock_in: 'Stok girişi', stock_out: 'Stok çıkışı', stock_count: 'Sayım düzeltmesi',
};
const ENTITY_LABELS = { user: 'Kullanıcı', vehicle: 'Araç', trip: 'Sefer', document: 'Belge', maintenance: 'Bakım', tire: 'Lastik', part: 'Parça', expense: 'Masraf', issue: 'Arıza', vehicle_type: 'Araç türü', doc_type: 'Belge türü', roles: 'Roller', settings: 'Ayarlar' };
const ENTITY_LINK = { vehicle: (id) => `#/vehicles/${id}`, user: () => '#/users', trip: (id) => `#/trips?id=${id}` };

function parseJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function changeSummary(r) {
  const o = parseJson(r.old_value);
  const n = parseJson(r.new_value);
  if (o && n && typeof o === 'object' && typeof n === 'object' && !Array.isArray(o)) {
    const keys = Object.keys(n).filter((k) => typeof n[k] !== 'object');
    if (keys.length && keys.length <= 4) return keys.map((k) => `${k}: ${o[k] ?? '—'} → ${n[k] ?? '—'}`).join(' · ');
  }
  if (n && typeof n === 'object') return Object.entries(n).filter(([, v]) => typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return '';
}

export async function auditPage(main) {
  const rows = await api.get('/audit' + qs({ limit: 3000 }));
  clear(main);
  const table = dataTable({
    rows,
    csvName: 'denetim-kaydi',
    searchPlaceholder: 'Kullanıcı, işlem, not…',
    sort: { key: 'created_at', dir: 'desc' },
    filters: [
      { key: 'action', label: 'İşlem', options: [...new Set(rows.map((r) => r.action))].map((a) => [a, ACTION_LABELS[a] || a]).sort((a, b) => a[1].localeCompare(b[1], 'tr')) },
      { key: 'entity', label: 'Kayıt', options: [...new Set(rows.map((r) => r.entity).filter(Boolean))].map((e) => [e, ENTITY_LABELS[e] || e]) },
    ],
    onRowClick: (r) => modal({
      title: ACTION_LABELS[r.action] || r.action,
      subtitle: `${fmtDateTime(r.created_at)} · ${r.username || 'sistem'}`,
      width: 720,
      content: [
        kv([['Kayıt', r.entity ? `${ENTITY_LABELS[r.entity] || r.entity} #${r.entity_id ?? ''}` : '—'], ['Not / gerekçe', r.note], ['IP', r.ip]]),
        r.old_value ? h('div', null, h('h4', null, 'Eski değer'), h('pre', { class: 'json' }, JSON.stringify(parseJson(r.old_value), null, 2))) : null,
        r.new_value ? h('div', null, h('h4', null, 'Yeni değer'), h('pre', { class: 'json' }, JSON.stringify(parseJson(r.new_value), null, 2))) : null,
      ],
    }),
    rowClass: (r) => (['login_failed', 'trip_force_start', 'km_correct', 'delete', 'user_delete'].includes(r.action) ? 'row-pending' : ''),
    columns: [
      { key: 'created_at', label: 'Zaman', text: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at, nowrap: true },
      { key: 'username', label: 'Kullanıcı', text: (r) => r.username || 'sistem' },
      { key: 'action', label: 'İşlem', render: (r) => badge(ACTION_LABELS[r.action] || r.action, r.action.includes('delete') || r.action === 'login_failed' || r.action === 'trip_force_start' ? 'red' : r.action === 'km_correct' ? 'orange' : 'gray'), text: (r) => ACTION_LABELS[r.action] || r.action },
      { key: 'entity', label: 'Kayıt', render: (r) => (r.entity ? (ENTITY_LINK[r.entity] && r.entity_id ? h('a', { href: ENTITY_LINK[r.entity](r.entity_id), onclick: (e) => e.stopPropagation() }, `${ENTITY_LABELS[r.entity] || r.entity} #${r.entity_id}`) : `${ENTITY_LABELS[r.entity] || r.entity}${r.entity_id ? ' #' + r.entity_id : ''}`) : '—'), text: (r) => `${ENTITY_LABELS[r.entity] || r.entity || ''} ${r.entity_id ?? ''}` },
      { key: 'summary', label: 'Değişiklik / not', sortable: false, render: (r) => h('div', { class: 'cell-2' }, h('span', { class: 'small' }, changeSummary(r) || '—'), r.note ? h('span', { class: 'muted small' }, r.note) : null), text: (r) => [changeSummary(r), r.note].filter(Boolean).join(' | ') },
      { key: 'ip', label: 'IP', text: (r) => r.ip || '', hideSm: true },
    ],
  });
  main.append(h('div', { class: 'page' },
    pageHeader('Denetim Kaydı', 'Giriş/çıkış, yetki ve kullanıcı değişiklikleri, silmeler, km düzeltmeleri ve tüm kritik işlemler. Ayrıntı için satıra tıklayın.'),
    card(null, table)));
}

// =====================================================================  PROFİL
export async function profilePage(main) {
  const sessions = await api.get('/auth/sessions');
  clear(main);
  const me = state.me;
  const { openPasswordDialog } = await import('./app.js');
  main.append(h('div', { class: 'page' },
    pageHeader(me.full_name, `${me.username} · ${me.role_name}`, [btn('Parolamı değiştir', { ic: 'lock', onClick: () => openPasswordDialog() })]),
    h('div', { class: 'detail-grid' },
      card('Bilgilerim', kv([
        ['Kullanıcı adı', me.username], ['Rol', me.role_name], ['E-posta', me.email], ['Telefon', me.phone], ['Departman', me.department],
        ['Ehliyet bitiş', me.license_expiry ? h('span', null, fmtDate(me.license_expiry), ' ', daysBadge(Math.round((Date.parse(me.license_expiry) - Date.parse(todayStr())) / 86400000))) : null],
        ['SRC bitiş', me.src_expiry ? fmtDate(me.src_expiry) : null],
      ]), { subtitle: 'Bilgilerinizi değiştirmek için yöneticinize başvurun.' }),
      card('Açık oturumlarım', h('ul', { class: 'simple-list' }, sessions.map((s) => h('li', null,
        h('div', { class: 'cell-2' }, h('span', { class: 'small' }, cutUa(s.user_agent)), h('span', { class: 'muted small' }, `${s.ip || ''} · başlangıç ${fmtDateTime(s.created_at)}`)),
        h('span', { class: 'muted small' }, relTime(s.last_seen_at)))))))));
}

const cutUa = (ua) => {
  if (!ua) return 'Bilinmeyen tarayıcı';
  const m = /(Edg|Chrome|Firefox|Safari)\/[\d.]+/.exec(ua);
  const os = /(Windows|Android|iPhone|Mac OS X|Linux)/.exec(ua);
  return [m ? m[0].replace('Edg', 'Edge') : 'Tarayıcı', os ? os[1] : null].filter(Boolean).join(' · ');
};
