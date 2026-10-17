// Panel, Dijital Garaj, Araçlar, Araç detayı, Çıkış / Dönüş.
import { api, qs, fileUrl } from './api.js';
import { state, can, scope, L, C, loadLookups, emit, vehicleLabel } from './state.js';
import {
  h, clear, append, icon, fmtDate, fmtDateTime, fmtNum, fmtKm, fmtMoney, relTime, durationText, badge, statusBadge, levelBadge, daysBadge,
  LEVEL_TONE, STATUS_TONE, toast, errorToast, confirmDialog, openForm, dataTable, pageHeader, emptyState, card, stat, btn, tabs, kv, loading,
  plate, colorDot, barList, fileLink,
} from './ui.js';
import {
  openIssueForm, openExpenseForm, documentsSection, maintenanceSection, tiresSection, partsSection, expensesSection, issuesSection, vehicleOptions, driverOptions,
} from './pages-ops.js';

const FUEL = { diesel: 'Dizel', gasoline: 'Benzin', lpg: 'LPG', hybrid: 'Hibrit', electric: 'Elektrik', other: 'Diğer' };
const GEAR = { manual: 'Manuel', automatic: 'Otomatik', semi: 'Yarı otomatik' };

// =====================================================================  ÇIKIŞ / DÖNÜŞ DİYALOGLARI
export async function openStartTrip({ vehicleId } = {}) {
  await loadLookups();
  const manage = can('trips', 'manage');
  const me = state.me;
  const vehicles = L().vehicles.filter((v) => v.display_status !== 'passive');
  const blockBox = h('div');
  let kmTouched = false;
  let checkSeq = 0;
  const fields = [
    manage ? { name: 'driver_id', label: 'Şoför', type: 'select', numeric: true, required: true, options: driverOptions({ activeOnly: true }), full: true } : null,
    {
      name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, required: true, full: true,
      options: vehicles.map((v) => [v.id, `${vehicleLabel(v)}${v.display_status !== 'available' ? ' · ' + C().statuses[v.display_status] : ''}`, { disabled: v.display_status === 'on_trip' || (!manage && v.display_status !== 'available') }]),
      hint: 'Yalnızca müsait araçlar seçilebilir.',
    },
    {
      name: 'start_km', label: 'Güncel km (çıkış)', type: 'number', required: true, min: 0, step: 1, inputmode: 'numeric',
      validate: (v, d) => {
        const veh = vehicles.find((x) => x.id === d.vehicle_id);
        return veh && v < veh.current_km ? `Km, aracın kayıtlı değerinden (${fmtNum(veh.current_km)}) küçük olamaz` : null;
      },
    },
    { name: 'destination', label: 'Gidilecek yer', maxlength: 300 },
    { name: 'purpose', label: 'Amaç / açıklama', full: true, maxlength: 300 },
    { name: 'notes', label: 'Not', type: 'textarea', full: true, rows: 2 },
    { name: 'force', label: 'Kural ihlaline rağmen zorla çıkış yap (yönetici istisnası)', type: 'checkbox', full: true, show: (d) => manage && d._blocked },
    { name: 'force_reason', label: 'Zorla çıkış gerekçesi', type: 'textarea', full: true, rows: 2, required: true, show: (d) => manage && d._blocked && d.force },
  ].filter(Boolean);

  const showBlocks = (blocks, f) => {
    clear(blockBox);
    f.set('_blocked', !!blocks.length);
    if (!blocks.length) return;
    blockBox.append(h('div', { class: 'callout callout-red' }, icon('warning', 18),
      h('div', null, h('strong', null, 'Bu çıkış kurallara takılıyor'), h('ul', null, blocks.map((b) => h('li', null, b.message))),
        manage ? h('p', { class: 'small' }, 'Yönetici olarak gerekçe yazıp zorla çıkış yapabilirsiniz; işlem denetim kaydına işlenir.') : h('p', { class: 'small' }, 'Lütfen yöneticinize başvurun.'))));
  };

  let lastVehicle = null;
  let lastDriver = null;
  const res = await openForm({
    title: 'Araç Çıkışı Yap',
    subtitle: 'Aracı teslim alırken gösterge km değerini girin.',
    width: 600,
    fields,
    values: { vehicle_id: vehicleId ? Number(vehicleId) : null, driver_id: me.id, start_km: vehicleId ? vehicles.find((v) => v.id === Number(vehicleId))?.current_km : null },
    submitLabel: 'Çıkışı kaydet',
    onChange: async (d, f, ctx) => {
      if (!ctx.extra.contains(blockBox)) ctx.extra.append(blockBox);
      if (d.vehicle_id !== lastVehicle || d.driver_id !== lastDriver) {
        const changedVehicle = d.vehicle_id !== lastVehicle;
        lastVehicle = d.vehicle_id;
        lastDriver = d.driver_id;
        const veh = vehicles.find((x) => x.id === d.vehicle_id);
        if (veh && changedVehicle) {
          if (!kmTouched || d.start_km == null || d.start_km < veh.current_km) f.set('start_km', veh.current_km);
          f.setHint('start_km', `Sistemde kayıtlı km: ${fmtNum(veh.current_km)}`);
        }
        if (veh) {
          const seq = ++checkSeq;
          try {
            const chk = await api.get('/trips/check' + qs({ vehicle_id: veh.id, driver_id: d.driver_id || me.id }));
            if (seq === checkSeq) showBlocks(chk.blocks, f);
          } catch { /* yoksay */ }
        } else showBlocks([], f);
      }
      if (document.activeElement?.name === 'start_km') kmTouched = true;
    },
    onSubmit: async (v) => {
      const body = { ...v };
      if (!manage) delete body.driver_id;
      const trip = await api.post('/trips/start', body);
      return trip;
    },
  });
  if (res) {
    toast('Araç çıkışı kaydedildi. İyi yolculuklar!');
    emit('changed');
    await loadLookups();
  }
  return res;
}

export async function openEndTrip(trip) {
  if (!trip.plate) {
    const list = await api.get('/trips' + qs({ id: trip.id }));
    trip = list[0] || trip;
  }
  const res = await openForm({
    title: 'Dönüş Kaydı',
    subtitle: `${trip.plate} · ${trip.driver_name || ''}`,
    width: 520,
    intro: kv([
      ['Çıkış zamanı', `${fmtDateTime(trip.start_at)} (${durationText(trip.start_at)})`],
      ['Çıkış km', fmtKm(trip.start_km)],
      ['Gidilen yer', trip.destination || '—'],
    ]),
    fields: [
      { name: 'end_km', label: 'Dönüş km', type: 'number', required: true, min: trip.start_km, step: 1, inputmode: 'numeric', full: true,
        hint: `Çıkış km değerinden (${fmtNum(trip.start_km)}) küçük olamaz.`,
        validate: (v) => (v < trip.start_km ? `Dönüş km, çıkış km değerinden (${fmtNum(trip.start_km)}) küçük olamaz` : v - trip.start_km > 5000 ? null : null) },
      { name: 'fuel_liters', label: 'Alınan yakıt (L)', type: 'number', min: 0, hint: 'İsteğe bağlı. Yakıt fişini Masraflar\'dan da girebilirsiniz.' },
      { name: 'end_notes', label: 'Dönüş notu', type: 'textarea', full: true, rows: 2, placeholder: 'Araçta fark ettiğiniz bir sorun varsa yazın' },
    ],
    submitLabel: 'Dönüşü kaydet',
    onChange: (d, f) => {
      if (d.end_km != null && d.end_km >= trip.start_km) f.setHint('end_km', `Bu sefer: ${fmtNum(d.end_km - trip.start_km)} km`);
    },
    onSubmit: (v) => api.post(`/trips/${trip.id}/end`, v),
  });
  if (res) {
    toast(`Dönüş kaydedildi: ${fmtNum(res.end_km - res.start_km)} km`);
    emit('changed');
    await loadLookups();
  }
  return res;
}

async function openCorrectTrip(trip) {
  const res = await openForm({
    title: 'Sefer düzeltme',
    subtitle: `${trip.plate} · ${trip.driver_name} · #${trip.id}`,
    intro: h('div', { class: 'callout callout-orange' }, icon('info', 18), h('div', null, 'Km düzeltmeleri aracın kayıtlı km değerini yeniden hesaplar ve denetim kaydına gerekçesiyle işlenir.')),
    fields: [
      { name: 'start_km', label: 'Çıkış km', type: 'number', min: 0, step: 1, required: true },
      { name: 'end_km', label: 'Dönüş km', type: 'number', min: 0, step: 1, disabled: !trip.end_at, hint: trip.end_at ? null : 'Sefer açık; dönüş km düzeltilemez.' },
      { name: 'destination', label: 'Gidilen yer' },
      { name: 'purpose', label: 'Amaç' },
      { name: 'fuel_liters', label: 'Yakıt (L)', type: 'number', min: 0 },
      { name: 'reason', label: 'Düzeltme gerekçesi', type: 'textarea', required: true, full: true, rows: 2 },
    ],
    values: trip,
    onSubmit: (v) => {
      if (!trip.end_at) delete v.end_km;
      return api.put(`/trips/${trip.id}`, v);
    },
  });
  if (res) {
    toast('Sefer düzeltildi');
    emit('changed');
  }
  return res;
}

async function deleteTrip(trip) {
  const reason = await confirmDialog({
    title: 'Sefer kaydı silinsin mi?',
    message: `${trip.plate} · ${trip.driver_name} · ${fmtDateTime(trip.start_at)}. Bu işlem geri alınamaz; aracın km değeri yeniden hesaplanır.`,
    confirmLabel: 'Sil',
    danger: true,
    input: { label: 'Silme gerekçesi', required: true },
  });
  if (!reason) return false;
  await api.del(`/trips/${trip.id}${qs({ reason })}`);
  toast('Sefer silindi');
  emit('changed');
  return true;
}

export function tripsTable(rows, { onChange, hideVehicle, hideDriver } = {}) {
  const manage = can('trips', 'manage');
  const me = state.me;
  return dataTable({
    rows,
    csvName: 'seferler',
    searchPlaceholder: 'Plaka, şoför, yer ara…',
    sort: null,
    filters: [{ key: 'state', label: 'Durum', options: [['open', 'Açık'], ['closed', 'Kapalı'], ['forced', 'Zorla çıkış'], ['corrected', 'Düzeltilmiş']], match: (r, v) => (v === 'open' ? !r.end_at : v === 'closed' ? !!r.end_at : v === 'forced' ? !!r.forced : !!r.corrected) }],
    rowClass: (r) => (!r.end_at ? 'row-open' : ''),
    columns: [
      hideVehicle ? null : { key: 'plate', label: 'Araç', render: (r) => h('a', { href: `#/vehicles/${r.vehicle_id}`, class: 'link-strong' }, r.plate), text: (r) => r.plate },
      hideDriver ? null : { key: 'driver_name', label: 'Şoför', render: (r) => (scope('drivers') === 'all' ? h('a', { href: `#/drivers/${r.driver_id}` }, r.driver_name) : r.driver_name) },
      { key: 'start_at', label: 'Çıkış', text: (r) => fmtDateTime(r.start_at), sortValue: (r) => r.start_at, nowrap: true, defaultDir: 'desc' },
      { key: 'end_at', label: 'Dönüş', render: (r) => (r.end_at ? fmtDateTime(r.end_at) : badge(`Seferde · ${durationText(r.start_at)}`, 'blue')), text: (r) => (r.end_at ? fmtDateTime(r.end_at) : 'Seferde'), sortValue: (r) => r.end_at || '9999', nowrap: true },
      { key: 'start_km', label: 'Çıkış km', align: 'right', text: (r) => fmtNum(r.start_km), csv: (r) => r.start_km },
      { key: 'end_km', label: 'Dönüş km', align: 'right', text: (r) => fmtNum(r.end_km), csv: (r) => r.end_km ?? '' },
      { key: 'distance', label: 'Mesafe', align: 'right', text: (r) => (r.distance != null ? fmtKm(r.distance) : '—'), csv: (r) => r.distance ?? '' },
      { key: 'destination', label: 'Yer / Amaç', render: (r) => h('div', { class: 'cell-2' }, h('span', null, r.destination || '—'), r.purpose ? h('span', { class: 'muted small' }, r.purpose) : null), text: (r) => [r.destination, r.purpose].filter(Boolean).join(' – '), hideSm: true },
      { key: 'flags', label: 'Not', sortable: false, render: (r) => [r.forced ? badge('Zorla çıkış', 'red', r.force_reason) : null, r.corrected ? badge('Düzeltildi', 'orange') : null, r.fuel_liters ? badge(`${fmtNum(r.fuel_liters, 1)} L`, 'gray') : null], text: (r) => [r.forced ? 'Zorla çıkış: ' + r.force_reason : '', r.corrected ? 'Düzeltildi' : ''].filter(Boolean).join(' / ') },
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          !r.end_at && (r.driver_id === me.id ? can('trips', 'create') : manage) ? btn('Dönüş', { kind: 'primary', size: 'sm', ic: 'enter', onClick: async () => { if (await openEndTrip(r)) onChange?.(); } }) : null,
          manage ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzelt', onClick: async () => { if (await openCorrectTrip(r)) onChange?.(); } }) : null,
          manage ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => { if (await deleteTrip(r)) onChange?.(); } }) : null),
      },
    ],
  });
}

// =====================================================================  PANEL
export async function dashboardPage(main) {
  const d = await api.get('/dashboard');
  clear(main);
  const me = state.me;
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const reload = () => dashboardPage(main);

  const actions = [];
  if (d.my_open_trip) actions.push(btn('Dönüş Yap', { kind: 'primary', ic: 'enter', onClick: async () => { if (await openEndTrip({ ...d.my_open_trip, driver_name: me.full_name })) reload(); } }));
  else if (can('trips', 'create') || can('trips', 'manage')) actions.push(btn('Araç Çıkışı Yap', { kind: 'primary', ic: 'exit', onClick: async () => { if (await openStartTrip()) reload(); } }));
  if (can('issues', 'create')) actions.push(btn('Arıza Bildir', { ic: 'warning', onClick: async () => { if (await openIssueForm()) reload(); } }));
  if (can('expenses', 'create')) actions.push(btn('Masraf Gir', { ic: 'money', onClick: async () => { if (await openExpenseForm()) reload(); } }));
  if (can('garage', 'read')) actions.push(btn('Garajı Aç', { ic: 'cube', href: '#/garage' }));

  main.append(h('div', { class: 'page' },
    pageHeader(`${greet}, ${me.full_name.split(' ')[0]}`, `${d.company_name} · ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`, actions)));
  const page = main.lastChild;

  if (d.my_open_trip) {
    const t = d.my_open_trip;
    page.append(h('div', { class: 'callout callout-blue trip-banner' }, icon('key', 20),
      h('div', null, h('strong', null, `${t.plate} seferdesiniz`), h('div', { class: 'small' }, `Çıkış: ${fmtDateTime(t.start_at)} · ${fmtKm(t.start_km)} · ${durationText(t.start_at)}${t.destination ? ' · ' + t.destination : ''}`)),
      btn('Dönüş yap', { kind: 'primary', size: 'sm', onClick: async () => { if (await openEndTrip({ ...t, driver_name: me.full_name })) reload(); } })));
  }

  const c = d.counts;
  const ac = d.alert_counts;
  page.append(h('div', { class: 'stats' },
    stat('Toplam araç', fmtNum(c.total - c.passive), { ic: 'car', sub: c.passive ? `${c.passive} pasif` : 'aktif filo', href: can('vehicles', 'read') ? '#/vehicles' : null }),
    stat('Müsait', fmtNum(c.available), { tone: 'green', ic: 'check', href: can('garage', 'read') ? '#/garage?status=available' : null }),
    stat('Seferde', fmtNum(c.on_trip), { tone: 'blue', ic: 'key', href: scope('trips') ? '#/trips' : null }),
    stat('Bakımda', fmtNum(c.maintenance), { tone: 'orange', ic: 'wrench', href: can('garage', 'read') ? '#/garage?status=maintenance' : null }),
    stat('Arızalı', fmtNum(c.broken), { tone: 'red', ic: 'warning', href: can('garage', 'read') ? '#/garage?status=broken' : null }),
    can('alerts', 'read') ? stat('Kritik uyarı', fmtNum(ac.critical), { tone: ac.critical ? 'red' : 'gray', ic: 'bell', sub: `${ac.warning} uyarı · ${ac.info} bilgi`, href: '#/alerts' }) : null));

  const grid = h('div', { class: 'dash-grid' });
  page.append(grid);

  if (can('alerts', 'read')) {
    grid.append(card('Öncelikli uyarılar', d.top_alerts.length
      ? h('ul', { class: 'alert-list' }, d.top_alerts.map((a) => h('li', null, h('a', { href: a.link || '#/alerts', class: `alert-item lvl-${a.level}` },
        h('span', { class: `dot dot-${LEVEL_TONE[a.level]}` }), h('span', { class: 'alert-text' }, h('strong', null, a.title), h('span', { class: 'muted small' }, a.message))))))
      : emptyState('check', 'Her şey yolunda', 'Şu an aktif uyarı yok.'),
    { actions: h('a', { href: '#/alerts', class: 'btn btn-sm btn-ghost' }, 'Tümü'), className: 'span-2' }));
  }

  if (d.month) {
    grid.append(card('Bu ay', h('div', { class: 'mini-stats' },
      h('div', null, h('span', { class: 'muted small' }, 'Sefer'), h('strong', null, fmtNum(d.month.trips))),
      h('div', null, h('span', { class: 'muted small' }, 'Kat edilen km'), h('strong', null, fmtNum(d.month.km))),
      d.month.expense_total != null ? h('div', null, h('span', { class: 'muted small' }, 'Onaylı masraf'), h('strong', null, fmtMoney(d.month.expense_total))) : null,
      d.month.fuel_total != null ? h('div', null, h('span', { class: 'muted small' }, 'Yakıt'), h('strong', null, fmtMoney(d.month.fuel_total))) : null,
      d.pending_expenses != null ? h('a', { href: '#/expenses?status=pending' }, h('span', { class: 'muted small' }, 'Onay bekleyen masraf'), h('strong', null, fmtNum(d.pending_expenses))) : null)));
  }

  if (d.open_trips) {
    grid.append(card(scope('trips') === 'own' ? 'Açık seferim' : 'Açık seferler', d.open_trips.length
      ? h('ul', { class: 'simple-list' }, d.open_trips.slice(0, 8).map((t) => h('li', null,
        h('div', null, h('a', { href: `#/vehicles/${t.vehicle_id}`, class: 'link-strong' }, t.plate), ' ', h('span', { class: 'muted' }, t.driver_name)),
        h('span', { class: 'muted small' }, `${durationText(t.start_at)} · ${t.destination || ''}`))))
      : emptyState('key', 'Açık sefer yok', 'Tüm araçlar garajda.'),
    { actions: h('a', { href: '#/trips', class: 'btn btn-sm btn-ghost' }, 'Seferler') }));
  }

  if (d.upcoming) {
    grid.append(card('Yaklaşan belge bitişleri', d.upcoming.length
      ? h('ul', { class: 'simple-list' }, d.upcoming.map((x) => h('li', null,
        h('div', null, h('a', { href: `#/vehicles/${x.vehicle_id}?tab=documents`, class: 'link-strong' }, x.plate), ' ', h('span', null, x.type_name)),
        daysBadge(x.days_left))))
      : emptyState('doc', 'Yaklaşan bitiş yok', '45 gün içinde süresi dolan belge bulunmuyor.'),
    { actions: h('a', { href: '#/documents', class: 'btn btn-sm btn-ghost' }, 'Belgeler') }));
  }

  if (d.open_issues) {
    grid.append(card('Açık arızalar', d.open_issues.length
      ? h('ul', { class: 'simple-list' }, d.open_issues.map((i) => h('li', null,
        h('div', null, h('a', { href: `#/issues?id=${i.id}`, class: 'link-strong' }, i.plate), ' ', h('span', null, i.title)),
        badge(C().severities[i.severity], { critical: 'red', high: 'orange', medium: 'blue', low: 'gray' }[i.severity]))))
      : emptyState('check', 'Açık arıza yok'),
    { actions: h('a', { href: '#/issues', class: 'btn btn-sm btn-ghost' }, 'Arızalar') }));
  }

  if (d.planned_maintenance?.length) {
    grid.append(card('Planlı bakımlar', h('ul', { class: 'simple-list' }, d.planned_maintenance.map((m) => h('li', null,
      h('div', null, h('a', { href: `#/vehicles/${m.vehicle_id}?tab=maintenance`, class: 'link-strong' }, m.plate), ' ', h('span', { class: 'muted' }, m.description?.split('\n')[0] || C().maint_kinds[m.kind])),
      h('span', { class: 'muted small nowrap' }, [m.date ? fmtDate(m.date) : null, m.km ? fmtKm(m.km) : null].filter(Boolean).join(' · '))))),
    { actions: h('a', { href: '#/maintenance?status=planned', class: 'btn btn-sm btn-ghost' }, 'Bakım') }));
  }

  if (d.recent_expenses) {
    grid.append(card('Son masraflar', d.recent_expenses.length
      ? h('ul', { class: 'simple-list' }, d.recent_expenses.map((e) => h('li', null,
        h('div', null, h('span', { class: 'link-strong' }, e.plate || '—'), ' ', h('span', null, C().expense_categories[e.category]), e.status === 'pending' ? [' ', badge('Onay bekliyor', 'orange')] : e.status === 'rejected' ? [' ', badge('Reddedildi', 'red')] : null),
        h('span', { class: 'nowrap' }, e.amount != null ? fmtMoney(e.amount) : fmtDate(e.date)))))
      : emptyState('money', 'Masraf kaydı yok'),
    { actions: h('a', { href: '#/expenses', class: 'btn btn-sm btn-ghost' }, 'Masraflar') }));
  }
}

// =====================================================================  DİJİTAL GARAJ
const VIEW_KEY = 'dg_garage_view';

export async function garagePage(main, { query }) {
  const data = await api.get('/garage');
  clear(main);
  const stConst = C().statuses;
  let vehicles = data.vehicles;
  const filters = { status: query.get('status') || '', type: '', q: '' };
  let view = localStorage.getItem(VIEW_KEY) || 'auto';
  const { webglAvailable } = await import('./garage3d.js');
  const has3d = webglAvailable();
  if (!has3d || (view === 'auto' && window.innerWidth < 640)) view = view === '3d' && has3d ? '3d' : '2d';
  if (view === 'auto') view = '3d';
  let g3d = null;
  let selectedId = query.get('id') ? Number(query.get('id')) : null;

  const counts = () => {
    const c = { '': vehicles.length };
    for (const v of vehicles) c[v.display_status] = (c[v.display_status] || 0) + 1;
    return c;
  };
  const match = (v) => {
    if (filters.status && v.display_status !== filters.status) return false;
    if (filters.type && String(v.type_id) !== filters.type) return false;
    if (filters.q) {
      const s = `${v.plate} ${v.brand || ''} ${v.model || ''} ${v.driver_name || ''} ${v.department || ''} ${v.assigned_to || ''}`.toLocaleLowerCase('tr-TR');
      if (!s.includes(filters.q)) return false;
    }
    return true;
  };

  // ---- Araç çubuğu
  const chipsEl = h('div', { class: 'chips' });
  const renderChips = () => {
    clear(chipsEl);
    const c = counts();
    for (const [k, label] of [['', 'Tümü'], ...Object.entries(stConst)]) {
      if (k && !c[k] && filters.status !== k) continue;
      chipsEl.append(h('button', { type: 'button', class: `chip ${filters.status === k ? 'active' : ''} ${k ? 'chip-' + STATUS_TONE[k] : ''}`, onclick: () => { filters.status = filters.status === k ? '' : k; refreshFilter(); } },
        k ? h('span', { class: `dot dot-${STATUS_TONE[k]}` }) : null, label, h('span', { class: 'chip-count' }, c[k] || 0)));
    }
  };
  const typeSel = h('select', { class: 'input input-sm', 'aria-label': 'Araç türü', onchange: (e) => { filters.type = e.target.value; refreshFilter(); } },
    h('option', { value: '' }, 'Tüm türler'),
    [...new Map(vehicles.map((v) => [v.type_id, v.type_name])).entries()].map(([id, name]) => h('option', { value: String(id) }, name)));
  const searchIn = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Plaka, marka, şoför…', oninput: (e) => { filters.q = e.target.value.trim().toLocaleLowerCase('tr-TR'); refreshFilter(); } });
  const viewBtns = h('div', { class: 'seg' },
    h('button', { type: 'button', class: `seg-btn ${view === '3d' ? 'active' : ''}`, disabled: !has3d, title: has3d ? '3B görünüm' : 'Tarayıcınız WebGL desteklemiyor', onclick: () => setView('3d') }, icon('cube', 16), '3B'),
    h('button', { type: 'button', class: `seg-btn ${view === '2d' ? 'active' : ''}`, onclick: () => setView('2d') }, icon('grid', 16), 'Kart'));
  const resetBtn = btn('', { size: 'sm', kind: 'ghost', ic: 'refresh', title: 'Kamerayı sıfırla', onClick: () => g3d?.resetView() });
  const toolbar = h('div', { class: 'garage-toolbar' }, chipsEl, h('div', { class: 'spacer' }), searchIn, typeSel, viewBtns, resetBtn,
    can('vehicles', 'create') ? btn('Araç ekle', { size: 'sm', ic: 'plus', onClick: () => addVehicle() }) : null);

  const stage = h('div', { class: 'garage-stage' });
  const tooltip = h('div', { class: 'g-tooltip', hidden: true });
  const legend = h('div', { class: 'g-legend' }, Object.entries(stConst).map(([k, l]) => h('span', null, h('span', { class: `dot dot-${STATUS_TONE[k]}` }), l)),
    h('span', { class: 'muted' }, ' · Sürükle: döndür · Tekerlek: yakınlaştır · Sağ tık: kaydır'));
  const cards = h('div', { class: 'garage-cards' });
  const panel = h('aside', { class: 'g-panel', hidden: true });
  const wrap = h('div', { class: 'garage' }, toolbar, h('div', { class: 'garage-body' }, stage, cards, panel));
  main.append(wrap);
  if (!has3d) toolbar.after(h('div', { class: 'callout callout-orange slim' }, icon('info', 16), 'Tarayıcınız veya cihazınız WebGL desteklemediği için garaj kart görünümünde gösteriliyor.'));

  const reload = async () => {
    const fresh = await api.get('/garage');
    vehicles = fresh.vehicles;
    renderChips();
    if (g3d) g3d.setVehicles(vehicles);
    renderCards();
    refreshFilter();
    if (selectedId) {
      const v = vehicles.find((x) => x.id === selectedId);
      if (v) renderPanel(v);
      else closePanel();
    }
  };

  async function addVehicle() {
    const v = await openVehicleForm();
    if (v) {
      selectedId = v.id;
      await reload();
      g3d?.select(v.id);
    }
  }

  function refreshFilter() {
    renderChips();
    const active = filters.status || filters.type || filters.q;
    g3d?.setFilter(active ? match : null);
    for (const el of cards.children) {
      const v = vehicles.find((x) => x.id === Number(el.dataset.id));
      if (v) el.classList.toggle('dimmed', !match(v));
    }
  }

  function renderCards() {
    clear(cards);
    if (!vehicles.length) {
      cards.append(emptyState('car', 'Garaj boş', 'Henüz araç eklenmemiş.', can('vehicles', 'create') ? btn('İlk aracı ekle', { kind: 'primary', ic: 'plus', onClick: addVehicle }) : null));
      return;
    }
    for (const v of vehicles) {
      cards.append(h('button', { type: 'button', class: `v-card st-${v.display_status} ${v.id === selectedId ? 'selected' : ''}`, dataset: { id: v.id }, onclick: () => selectVehicle(v.id) },
        h('div', { class: 'v-card-top' }, h('span', { class: 'v-swatch', style: { background: v.color } }, h('span', null, v.type_icon || '🚗')), plate(v.plate),
          v.alert_level ? h('span', { class: `alert-pip pip-${v.alert_level}`, title: `${v.alerts.length} uyarı` }, v.alerts.length) : null),
        h('div', { class: 'v-card-name' }, [v.brand, v.model].filter(Boolean).join(' ') || v.type_name),
        h('div', { class: 'v-card-meta' }, statusBadge(v.display_status), h('span', { class: 'muted small' }, fmtKm(v.current_km))),
        v.driver_name ? h('div', { class: 'muted small' }, icon('user', 13), ' ', v.driver_name) : null));
    }
    if (can('vehicles', 'create')) cards.append(h('button', { type: 'button', class: 'v-card v-card-add', onclick: addVehicle }, icon('plus', 22), 'Araç ekle'));
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* yoksay */ }
    for (const b of viewBtns.children) b.classList.toggle('active', b.textContent.includes(v === '3d' ? '3B' : 'Kart'));
    stage.hidden = v !== '3d';
    cards.hidden = v === '3d';
    resetBtn.hidden = v !== '3d';
    if (v === '3d' && !g3d) init3d();
  }

  async function init3d() {
    stage.append(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), '3B garaj hazırlanıyor…'));
    const { Garage3D } = await import('./garage3d.js');
    stage.querySelector('.loading')?.remove();
    g3d = new Garage3D(stage, {
      canAdd: can('vehicles', 'create'),
      onAdd: addVehicle,
      onSelect: (v) => (v ? selectVehicle(v.id, { from3d: true }) : closePanel()),
      onHover: (v, e) => {
        if (!v || !e) {
          tooltip.hidden = true;
          return;
        }
        clear(tooltip);
        if (v.add) append(tooltip, h('strong', null, 'Yeni araç ekle'));
        else {
          append(tooltip, [
            h('div', { class: 'tt-head' }, plate(v.plate), statusBadge(v.display_status)),
            h('div', null, [v.brand, v.model, v.year].filter(Boolean).join(' ') || v.type_name),
            h('div', { class: 'muted small' }, `${v.type_name} · ${fmtKm(v.current_km)}`),
            v.driver_name ? h('div', { class: 'small' }, '👤 ', v.driver_name) : null,
            v.alerts.length ? h('div', { class: `small tt-alert lvl-${v.alert_level}` }, `${v.alerts.length} aktif uyarı`) : null,
          ]);
        }
        const r = stage.getBoundingClientRect();
        tooltip.hidden = false;
        const x = Math.min(e.clientX - r.left + 14, r.width - tooltip.offsetWidth - 8);
        const y = Math.min(e.clientY - r.top + 14, r.height - tooltip.offsetHeight - 8);
        tooltip.style.transform = `translate(${x}px, ${y}px)`;
      },
    });
    stage.append(tooltip, legend);
    g3d.setVehicles(vehicles);
    refreshFilter();
    if (selectedId) g3d.select(selectedId, { focus: true, silent: true });
  }

  function selectVehicle(id, { from3d } = {}) {
    selectedId = id;
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    if (g3d && !from3d) g3d.select(id, { silent: true });
    for (const el of cards.children) el.classList.toggle('selected', Number(el.dataset.id) === id);
    renderPanel(v);
    history.replaceState(null, '', `#/garage${qs({ id, status: filters.status || undefined })}`);
  }

  function closePanel() {
    selectedId = null;
    panel.hidden = true;
    wrap.classList.remove('panel-open');
    g3d?.select(null, { silent: true });
    for (const el of cards.children) el.classList.remove('selected');
    history.replaceState(null, '', '#/garage');
  }

  function renderPanel(v) {
    clear(panel);
    panel.hidden = false;
    wrap.classList.add('panel-open');
    const me = state.me;
    const onTrip = v.display_status === 'on_trip';
    const mine = onTrip && v.active_driver_id === me.id;
    const acts = [];
    if (v.display_status === 'available' && (can('trips', 'create') || can('trips', 'manage'))) {
      acts.push(btn('Çıkış yap', { kind: 'primary', ic: 'exit', onClick: async () => { if (await openStartTrip({ vehicleId: v.id })) reload(); } }));
    } else if (['maintenance', 'broken'].includes(v.display_status) && can('trips', 'manage')) {
      acts.push(btn('Çıkış yap', { ic: 'exit', onClick: async () => { if (await openStartTrip({ vehicleId: v.id })) reload(); } }));
    }
    if (onTrip && (mine ? can('trips', 'create') : can('trips', 'manage'))) {
      acts.push(btn('Dönüş yap', { kind: 'primary', ic: 'enter', onClick: async () => { if (await openEndTrip({ id: v.open_trip_id })) reload(); } }));
    }
    if (can('vehicles', 'read')) acts.push(btn('Detay', { ic: 'eye', href: `#/vehicles/${v.id}` }));
    if (can('issues', 'create')) acts.push(btn('Arıza bildir', { ic: 'warning', onClick: async () => { if (await openIssueForm({ vehicle_id: v.id })) reload(); } }));
    const canStatus = can('vehicles', 'update') || can('maintenance', 'create');
    if (canStatus && v.display_status === 'available') acts.push(btn('Bakıma al', { ic: 'wrench', onClick: async () => { if (await setVehicleStatus(v, 'maintenance')) reload(); } }));
    if (canStatus && v.display_status === 'maintenance') acts.push(btn('Bakımdan çıkar', { ic: 'check', onClick: async () => { if (await setVehicleStatus(v, 'available')) reload(); } }));

    panel.append(
      h('div', { class: 'g-panel-head' },
        h('div', null, plate(v.plate), h('h3', null, [v.brand, v.model].filter(Boolean).join(' ') || v.type_name), h('div', { class: 'muted small' }, [v.type_name, v.year, v.fuel_type ? FUEL[v.fuel_type] : null].filter(Boolean).join(' · '))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Kapat', onclick: closePanel }, icon('x'))),
      h('div', { class: 'g-panel-status' }, statusBadge(v.display_status), h('span', { class: 'color-chip' }, colorDot(v.color))),
      kv([
        ['Güncel km', fmtKm(v.current_km)],
        onTrip ? ['Şoför', v.driver_name || '—'] : null,
        v.department ? ['Departman', v.department] : null,
        v.assigned_to ? ['Zimmet', v.assigned_to] : null,
      ]),
      h('div', { class: 'g-panel-actions' }, acts),
      h('h4', null, `Aktif uyarılar (${v.alerts.length})`),
      v.alerts.length
        ? h('ul', { class: 'alert-list compact' }, v.alerts.slice(0, 8).map((a) => h('li', null, h('a', { href: a.link || '#/alerts', class: `alert-item lvl-${a.level}` }, h('span', { class: `dot dot-${LEVEL_TONE[a.level]}` }), h('span', { class: 'alert-text' }, h('strong', null, a.title.replace(v.plate + ' · ', '')), h('span', { class: 'muted small' }, a.message))))))
        : h('p', { class: 'muted small' }, 'Bu araç için aktif uyarı yok.'),
    );
  }

  renderChips();
  renderCards();
  setView(view);
  if (selectedId) selectVehicle(selectedId);
  else refreshFilter();

  const timer = setInterval(() => { if (!document.hidden) reload().catch(() => {}); }, 60000);
  return () => {
    clearInterval(timer);
    g3d?.dispose();
  };
}

async function setVehicleStatus(v, status) {
  const label = { maintenance: 'bakıma alınsın', available: 'bakımdan çıkarılsın', passive: 'pasife alınsın', broken: 'arızalı işaretlensin' }[status];
  const reason = await confirmDialog({
    title: `${v.plate} ${label} mı?`,
    message: status === 'maintenance' ? 'Bakımdaki araç için şoförler çıkış yapamaz.' : status === 'passive' ? 'Pasif araçlar uyarı üretmez ve çıkış yapılamaz; geçmiş kayıtları korunur.' : '',
    confirmLabel: 'Onayla',
    input: { label: 'Açıklama (isteğe bağlı)' },
  });
  if (!reason) return false;
  await api.post(`/vehicles/${v.id}/status`, { status, reason: reason === true ? null : reason });
  toast('Araç durumu güncellendi');
  emit('changed');
  await loadLookups();
  return true;
}

// =====================================================================  ARAÇLAR
export async function openVehicleForm(vehicle = null) {
  const types = L().vehicle_types.filter((t) => t.active || t.id === vehicle?.type_id);
  const costs = can('costs', 'read');
  const isEdit = !!vehicle;
  const fields = [
    { type: 'heading', label: 'Kimlik' },
    { name: 'plate', label: 'Plaka', required: true, placeholder: '34 ABC 123', maxlength: 20 },
    { name: 'type_id', label: 'Araç türü', type: 'select', numeric: true, required: true, options: types.map((t) => [t.id, `${t.icon || ''} ${t.name}`]), hint: 'Yeni tür Ayarlar > Araç türleri bölümünden eklenebilir.' },
    { name: 'brand', label: 'Marka', maxlength: 60 },
    { name: 'model', label: 'Model', maxlength: 60 },
    { name: 'year', label: 'Model yılı', type: 'number', min: 1950, max: 2100, step: 1 },
    { name: 'color', label: 'Renk (3B gövde rengi)', type: 'color' },
    { name: 'vin', label: 'Şasi no', maxlength: 40 },
    { name: 'engine_no', label: 'Motor no', maxlength: 40 },
    { type: 'heading', label: 'Teknik' },
    { name: 'fuel_type', label: 'Yakıt türü', type: 'select', options: Object.entries(FUEL) },
    { name: 'transmission', label: 'Vites', type: 'select', options: Object.entries(GEAR) },
    { name: 'tank_capacity', label: 'Depo kapasitesi (L)', type: 'number', min: 0 },
    { name: 'seats', label: 'Koltuk sayısı', type: 'number', min: 0, step: 1 },
    { name: 'load_capacity', label: 'Yük kapasitesi (kg)', type: 'number', min: 0 },
    { name: 'current_km', label: 'Güncel km', type: 'number', min: 0, step: 1, required: !isEdit, hint: isEdit ? 'Km normalde çıkış/dönüş kayıtlarıyla güncellenir.' : 'Aracın sisteme girildiği andaki gösterge değeri.' },
    { name: 'km_reason', label: 'Km düzeltme gerekçesi', type: 'textarea', rows: 2, full: true, virtual: false, show: (d) => isEdit && d.current_km != null && d.current_km < vehicle.current_km, required: true },
    { type: 'heading', label: 'Satın alma ve zimmet' },
    { name: 'purchase_date', label: 'Satın alma tarihi', type: 'date' },
    costs ? { name: 'purchase_price', label: 'Satın alma bedeli (₺)', type: 'number', min: 0 } : null,
    { name: 'assigned_to', label: 'Zimmetli kişi / birim', maxlength: 120 },
    { name: 'department', label: 'Departman', maxlength: 120 },
    { type: 'heading', label: 'Bakım döngüsü', hint: 'Boş bırakılırsa Ayarlar\'daki varsayılan aralıklar kullanılır.' },
    { name: 'maint_interval_km', label: 'Bakım aralığı (km)', type: 'number', min: 0, step: 500 },
    { name: 'maint_interval_months', label: 'Bakım aralığı (ay)', type: 'number', min: 0, max: 120, step: 1 },
    { type: 'heading', label: 'Diğer' },
    { name: 'photo_file_id', label: 'Fotoğraf', type: 'file', accept: 'image/*', nameField: 'photo_file_name', full: true },
    { name: 'notes', label: 'Notlar', type: 'textarea', full: true },
  ].filter(Boolean);
  const res = await openForm({
    title: isEdit ? `${vehicle.plate} — Düzenle` : 'Yeni araç',
    width: 760,
    fields,
    values: vehicle ? { ...vehicle, photo_file_name: vehicle.photo_file_id ? 'Fotoğraf' : null } : { color: '#9aa3ad', current_km: 0, type_id: types[0]?.id },
    submitLabel: isEdit ? 'Kaydet' : 'Aracı ekle',
    onSubmit: (v) => {
      if (isEdit && v.current_km === vehicle.current_km) delete v.current_km;
      if (!v.km_reason) delete v.km_reason;
      return isEdit ? api.put(`/vehicles/${vehicle.id}`, v) : api.post('/vehicles', v);
    },
  });
  if (res) {
    toast(isEdit ? 'Araç güncellendi' : `${res.plate} garaja eklendi`);
    await loadLookups();
    emit('changed');
  }
  return res;
}

export async function vehiclesPage(main) {
  const rows = await api.get('/vehicles');
  clear(main);
  const reload = async () => table.update(await api.get('/vehicles'));
  const costs = can('costs', 'read');
  const table = dataTable({
    rows,
    csvName: 'araclar',
    searchPlaceholder: 'Plaka, marka, model, şasi…',
    sort: { key: 'plate', dir: 'asc' },
    onRowClick: (r) => (location.hash = `#/vehicles/${r.id}`),
    filters: [
      { key: 'display_status', label: 'Durum', options: Object.entries(C().statuses), value: 'active', match: (r, v) => (v === 'active' ? r.display_status !== 'passive' : r.display_status === v) },
      { key: 'type_id', label: 'Tür', options: L().vehicle_types.map((t) => [t.id, t.name]) },
    ],
    empty: 'Henüz araç eklenmemiş',
    emptyIcon: 'car',
    columns: [
      { key: 'plate', label: 'Plaka', render: (r) => h('span', { class: 'cell-plate' }, colorDot(r.color), plate(r.plate)) },
      { key: 'brand', label: 'Marka / Model', render: (r) => h('div', { class: 'cell-2' }, h('span', null, [r.brand, r.model].filter(Boolean).join(' ') || '—'), h('span', { class: 'muted small' }, [r.year, r.vin].filter(Boolean).join(' · '))), text: (r) => [r.brand, r.model, r.year].filter(Boolean).join(' '), searchText: true },
      { key: 'type_name', label: 'Tür', render: (r) => `${r.type_icon || ''} ${r.type_name}` },
      { key: 'current_km', label: 'Km', align: 'right', text: (r) => fmtNum(r.current_km), csv: (r) => r.current_km },
      { key: 'display_status', label: 'Durum', render: (r) => statusBadge(r.display_status), text: (r) => C().statuses[r.display_status] },
      { key: 'driver_name', label: 'Şoför', text: (r) => r.driver_name || '', hideSm: true },
      { key: 'department', label: 'Departman / Zimmet', text: (r) => [r.department, r.assigned_to].filter(Boolean).join(' · '), hideSm: true },
      costs ? { key: 'purchase_price', label: 'Alış bedeli', align: 'right', text: (r) => (r.purchase_price != null ? fmtMoney(r.purchase_price) : '—'), csv: (r) => r.purchase_price ?? '', hideSm: true } : null,
    ],
  });
  main.append(h('div', { class: 'page' },
    pageHeader('Araçlar', 'Filodaki tüm araçların kimlik ve teknik bilgileri. Bir satıra tıklayarak araç detayına gidin.', [
      can('garage', 'read') ? btn('Garajda gör', { ic: 'cube', href: '#/garage' }) : null,
      can('vehicles', 'create') ? btn('Araç ekle', { kind: 'primary', ic: 'plus', onClick: async () => { const v = await openVehicleForm(); if (v) location.hash = `#/vehicles/${v.id}`; } }) : null,
    ]),
    card(null, table)));
  void reload;
}

export async function vehicleDetailPage(main, { params, query, setTitle }) {
  const id = Number(params[0]);
  const s = await api.get(`/vehicles/${id}/summary`);
  const v = s.vehicle;
  setTitle(`${v.plate}`);
  clear(main);
  const tab = query.get('tab') || 'summary';
  const reload = () => vehicleDetailPage(main, { params, query, setTitle });
  const me = state.me;
  const onTrip = v.display_status === 'on_trip';

  const acts = [];
  if (v.display_status === 'available' && (can('trips', 'create') || can('trips', 'manage'))) acts.push(btn('Çıkış yap', { kind: 'primary', ic: 'exit', onClick: async () => { if (await openStartTrip({ vehicleId: v.id })) reload(); } }));
  if (onTrip && (v.active_driver_id === me.id ? can('trips', 'create') : can('trips', 'manage'))) acts.push(btn('Dönüş yap', { kind: 'primary', ic: 'enter', onClick: async () => { if (await openEndTrip({ id: v.open_trip_id })) reload(); } }));
  if (can('issues', 'create')) acts.push(btn('Arıza bildir', { ic: 'warning', onClick: async () => { if (await openIssueForm({ vehicle_id: v.id })) reload(); } }));
  const canStatus = can('vehicles', 'update') || can('maintenance', 'create');
  if (canStatus && v.display_status === 'available') acts.push(btn('Bakıma al', { ic: 'wrench', onClick: async () => { if (await setVehicleStatus(v, 'maintenance')) reload(); } }));
  if (canStatus && (v.status === 'maintenance' || v.status === 'broken')) acts.push(btn(v.status === 'broken' ? 'Arızalı işaretini kaldır' : 'Bakımdan çıkar', { ic: 'check', onClick: async () => { if (await setVehicleStatus(v, 'available')) reload(); } }));
  if (can('vehicles', 'update')) acts.push(btn('Düzenle', { ic: 'edit', onClick: async () => { if (await openVehicleForm(v)) reload(); } }));
  if (can('vehicles', 'update') && v.status === 'passive') acts.push(btn('Aktifleştir', { ic: 'check', onClick: async () => { if (await setVehicleStatus(v, 'available')) reload(); } }));
  if (can('vehicles', 'delete') && v.status !== 'passive') {
    acts.push(btn('Sil / Pasifleştir', { kind: 'ghost', ic: 'trash', onClick: async () => {
      if (!(await confirmDialog({ title: `${v.plate} silinsin mi?`, message: 'Geçmiş kaydı (sefer, masraf, bakım, belge) olan araçlar silinmez, pasife alınır; geçmiş korunur.', confirmLabel: 'Devam et', danger: true }))) return;
      const r = await api.del(`/vehicles/${v.id}`);
      toast(r.deactivated ? 'Araç pasife alındı (geçmiş korunuyor)' : 'Araç silindi');
      await loadLookups();
      emit('changed');
      if (r.deactivated) reload();
      else location.hash = '#/vehicles';
    } }));
  }

  const header = h('div', { class: 'vd-head' },
    h('div', { class: 'vd-photo', style: { background: v.color } }, v.photo_file_id ? h('img', { src: fileUrl(v.photo_file_id), alt: v.plate }) : h('span', null, v.type_icon || '🚗')),
    h('div', { class: 'vd-title' },
      h('div', { class: 'vd-title-row' }, plate(v.plate), statusBadge(v.display_status)),
      h('h1', null, [v.brand, v.model].filter(Boolean).join(' ') || v.type_name),
      h('p', { class: 'muted' }, [v.type_name, v.year, v.fuel_type ? FUEL[v.fuel_type] : null, fmtKm(v.current_km)].filter(Boolean).join(' · '))),
    h('div', { class: 'page-actions' }, acts));

  const alertCount = s.alerts.length;
  const T = [
    { key: 'summary', label: 'Özet', count: alertCount || null, tone: s.alerts.some((a) => a.level === 'critical') ? 'red' : 'orange' },
    can('documents', 'read') ? { key: 'documents', label: 'Belgeler' } : null,
    can('maintenance', 'read') ? { key: 'maintenance', label: 'Bakım' } : null,
    can('tires', 'read') ? { key: 'tires', label: 'Lastikler' } : null,
    can('parts', 'read') ? { key: 'parts', label: 'Parçalar' } : null,
    scope('trips') ? { key: 'trips', label: 'Seferler' } : null,
    scope('expenses') ? { key: 'expenses', label: 'Masraflar' } : null,
    scope('issues') ? { key: 'issues', label: 'Arızalar' } : null,
  ].filter(Boolean);
  const body = h('div', { class: 'vd-body' });
  main.append(h('div', { class: 'page' },
    h('a', { href: '#/vehicles', class: 'back-link' }, icon('back', 16), 'Araçlar'),
    header,
    tabs(T, tab, (k) => (location.hash = `#/vehicles/${id}${k === 'summary' ? '' : '?tab=' + k}`)),
    body));

  const ctx = { vehicleId: id, vehicle: v, onChange: reload };
  if (tab === 'summary') renderSummary(body, s);
  else if (tab === 'documents') await documentsSection(body, ctx);
  else if (tab === 'maintenance') await maintenanceSection(body, ctx);
  else if (tab === 'tires') await tiresSection(body, ctx);
  else if (tab === 'parts') await partsSection(body, ctx);
  else if (tab === 'expenses') await expensesSection(body, ctx);
  else if (tab === 'issues') await issuesSection(body, ctx);
  else if (tab === 'trips') {
    const rows = await api.get('/trips' + qs({ vehicle_id: id }));
    body.append(card(null, tripsTable(rows, { hideVehicle: true, onChange: reload })));
  }
}

function renderSummary(body, s) {
  const v = s.vehicle;
  const m = s.maintenance;
  const grid = h('div', { class: 'detail-grid' });
  body.append(grid);

  if (s.open_trip) {
    grid.append(h('div', { class: 'callout callout-blue span-2' }, icon('key', 18),
      h('div', null, h('strong', null, `Seferde: ${s.open_trip.driver_name}`), h('div', { class: 'small' }, `${fmtDateTime(s.open_trip.start_at)} · ${fmtKm(s.open_trip.start_km)} · ${durationText(s.open_trip.start_at)}${s.open_trip.destination ? ' · ' + s.open_trip.destination : ''}`))));
  }

  if (s.alerts.length) {
    grid.append(card('Aktif uyarılar', h('ul', { class: 'alert-list' }, s.alerts.map((a) => h('li', null, h('a', { href: a.link || '#/alerts', class: `alert-item lvl-${a.level}` },
      h('span', { class: `dot dot-${LEVEL_TONE[a.level]}` }), h('span', { class: 'alert-text' }, h('strong', null, a.title.replace(v.plate + ' · ', '')), h('span', { class: 'muted small' }, a.message)))))), { className: 'span-2' }));
  }

  grid.append(card('Araç bilgileri', kv([
    ['Plaka', v.plate], ['Tür', v.type_name], ['Marka / Model', [v.brand, v.model].filter(Boolean).join(' ')], ['Model yılı', v.year],
    ['Renk', h('span', { class: 'cell-plate' }, colorDot(v.color), v.color)], ['Şasi no', v.vin], ['Motor no', v.engine_no],
    ['Yakıt', FUEL[v.fuel_type]], ['Vites', GEAR[v.transmission]], ['Depo', v.tank_capacity ? `${fmtNum(v.tank_capacity)} L` : null],
    ['Koltuk', v.seats], ['Yük kapasitesi', v.load_capacity ? `${fmtNum(v.load_capacity)} kg` : null],
    ['Satın alma', [fmtDate(v.purchase_date), s.purchase_price != null ? fmtMoney(s.purchase_price) : null].filter((x) => x && x !== '—').join(' · ')],
    ['Zimmet', v.assigned_to], ['Departman', v.department], ['Notlar', v.notes],
  ])));

  // Bakım döngüsü
  let maintContent;
  if (!m.last) {
    maintContent = [h('p', { class: 'muted' }, m.any_record ? 'Periyodik bakım kaydı yok; döngü ilk periyodik bakımdan sonra hesaplanır.' : 'Henüz bakım kaydı girilmemiş.'),
      kv([['Aralık', [m.interval_km ? fmtKm(m.interval_km) : null, m.interval_months ? `${m.interval_months} ay` : null].filter(Boolean).join(' / ') || 'Tanımsız']])];
  } else {
    const pct = m.interval_km && m.km_left != null ? Math.min(100, Math.max(0, ((m.interval_km - m.km_left) / m.interval_km) * 100)) : null;
    maintContent = [
      kv([
        ['Son periyodik bakım', `${fmtDate(m.last.date)} · ${fmtKm(m.last.km)}`],
        ['Aralık', [m.interval_km ? fmtKm(m.interval_km) : null, m.interval_months ? `${m.interval_months} ay` : null].filter(Boolean).join(' / ') || 'Tanımsız'],
        ['Sonraki bakım', [m.next_km != null ? fmtKm(m.next_km) : null, m.next_date ? fmtDate(m.next_date) : null].filter(Boolean).join(' / ') || '—'],
        ['Kalan', [m.km_left != null ? (m.km_left < 0 ? `${fmtNum(-m.km_left)} km gecikti` : `${fmtNum(m.km_left)} km`) : null, m.days_left != null ? (m.days_left < 0 ? `${-m.days_left} gün gecikti` : `${m.days_left} gün`) : null].filter(Boolean).join(' · ') || '—'],
      ]),
      pct != null ? h('div', { class: 'progress' }, h('div', { class: `progress-fill tone-${m.level === 'critical' ? 'red' : m.level === 'warning' ? 'orange' : 'green'}`, style: { width: pct + '%' } })) : null,
    ];
  }
  grid.append(card('Bakım döngüsü', maintContent, { actions: m.level ? levelBadge(m.level) : badge('Zamanında', 'green') }));

  if (s.documents) {
    grid.append(card('Belgeler', s.documents.length
      ? h('ul', { class: 'simple-list' }, s.documents.map((d) => h('li', null, h('span', null, d.type_name, d.required ? h('span', { class: 'req' }, ' *') : null), d.end_date ? daysBadge(d.days_left) : badge('Süresiz', 'gray'))))
      : emptyState('doc', 'Belge yok'), { actions: h('a', { class: 'btn btn-sm btn-ghost', href: `#/vehicles/${v.id}?tab=documents` }, 'Yönet') }));
  }

  grid.append(card('Kullanım', h('div', { class: 'mini-stats' },
    h('div', null, h('span', { class: 'muted small' }, 'Sefer'), h('strong', null, fmtNum(s.stats.trip_count))),
    h('div', null, h('span', { class: 'muted small' }, 'Seferlerde km'), h('strong', null, fmtNum(s.stats.total_km))),
    h('div', null, h('span', { class: 'muted small' }, 'Şoför'), h('strong', null, fmtNum(s.stats.driver_count))),
    h('div', null, h('span', { class: 'muted small' }, 'Ort. tüketim'), h('strong', null, s.stats.consumption ? `${fmtNum(s.stats.consumption, 1)} L/100km` : '—')))));

  if (s.costs) {
    grid.append(card('Maliyet', [
      h('div', { class: 'mini-stats' },
        h('div', null, h('span', { class: 'muted small' }, 'Toplam (onaylı)'), h('strong', null, fmtMoney(s.costs.total))),
        h('div', null, h('span', { class: 'muted small' }, 'Bu yıl'), h('strong', null, fmtMoney(s.costs.year)))),
      s.costs.by_category.length ? barList(s.costs.by_category.map((c) => ({ label: C().expense_categories[c.category], value: c.amount })), { format: fmtMoney }) : null,
    ]));
  }
}

export async function tripsPage(main, { query }) {
  const load = () => api.get('/trips' + qs({ vehicle_id: query.get('vehicle_id'), id: query.get('id') }));
  const rows = await load();
  clear(main);
  const me = state.me;
  const reload = async () => {
    const fresh = await load();
    table.update(fresh);
    renderOpen(fresh);
  };
  const openBox = h('div');
  const renderOpen = (list) => {
    clear(openBox);
    const open = list.filter((t) => !t.end_at);
    if (!open.length) return;
    openBox.append(h('div', { class: 'open-trips' }, open.map((t) => h('div', { class: `open-trip ${t.driver_id === me.id ? 'mine' : ''}` },
      h('div', { class: 'open-trip-head' }, plate(t.plate), badge(durationText(t.start_at), 'blue')),
      h('div', { class: 'small' }, t.driver_name, t.destination ? ` · ${t.destination}` : ''),
      h('div', { class: 'muted small' }, `Çıkış ${fmtDateTime(t.start_at)} · ${fmtKm(t.start_km)}`),
      (t.driver_id === me.id ? can('trips', 'create') : can('trips', 'manage')) ? btn('Dönüş yap', { kind: 'primary', size: 'sm', ic: 'enter', onClick: async () => { if (await openEndTrip(t)) reload(); } }) : null))));
  };
  const table = tripsTable(rows, { onChange: reload });
  renderOpen(rows);
  const myOpen = rows.find((t) => !t.end_at && t.driver_id === me.id);
  main.append(h('div', { class: 'page' },
    pageHeader('Çıkış / Dönüş', scope('trips') === 'own' ? 'Kendi seferleriniz. Aracı teslim alırken çıkış, bırakırken dönüş kaydı yapın.' : 'Tüm araç çıkış ve dönüş kayıtları. Km düzeltmeleri denetim kaydına işlenir.', [
      query.get('vehicle_id') || query.get('id') ? btn('Filtreyi kaldır', { ic: 'x', href: '#/trips' }) : null,
      !myOpen && (can('trips', 'create') || can('trips', 'manage')) ? btn('Araç Çıkışı Yap', { kind: 'primary', ic: 'exit', onClick: async () => { if (await openStartTrip()) reload(); } }) : null,
    ]),
    openBox,
    card(null, table)));
}
