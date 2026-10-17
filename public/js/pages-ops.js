// Belgeler, Bakım, Lastikler, Yedek Parça, Masraflar, Arızalar, Şoförler, Uyarılar, Raporlar.
import { api, qs } from './api.js';
import { state, can, scope, L, C, loadLookups, emit, vehicleLabel } from './state.js';
import {
  h, clear, append, icon, fmtDate, fmtDateTime, fmtNum, fmtKm, fmtMoney, relTime, durationText, todayStr, badge, statusBadge, levelBadge, daysBadge,
  LEVEL_TONE, LEVEL_LABEL, toast, confirmDialog, openForm, modal, dataTable, pageHeader, emptyState, card, stat, btn, tabs, kv, loading, plate, barList, fileLink,
} from './ui.js';

const SEV_TONE = { critical: 'red', high: 'orange', medium: 'blue', low: 'gray' };
const ISSUE_STATUS = { open: 'Açık', in_progress: 'İşlemde', resolved: 'Çözüldü', rejected: 'Reddedildi' };
const ISSUE_TONE = { open: 'red', in_progress: 'orange', resolved: 'green', rejected: 'gray' };
const EXP_STATUS = { pending: 'Onay bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi' };
const EXP_TONE = { pending: 'orange', approved: 'green', rejected: 'red' };
const SOURCE = { manual: 'Elle', document: 'Belge', maintenance: 'Bakım', tire: 'Lastik' };
const SEASON = { summer: 'Yaz', winter: 'Kış', all: 'Dört mevsim' };
const TIRE_STATUS = { mounted: 'Takılı', stored: 'Depoda', scrap: 'Hurda' };
const TIRE_TONE = { mounted: 'green', stored: 'blue', scrap: 'gray' };

// ---------------------------------------------------------------- Ortak seçenekler
export function vehicleOptions({ includePassive = false } = {}) {
  return (L()?.vehicles || []).filter((v) => includePassive || v.display_status !== 'passive').map((v) => [v.id, vehicleLabel(v)]);
}

export function driverOptions({ activeOnly = true } = {}) {
  return (L()?.drivers || []).filter((d) => !activeOnly || d.active).map((d) => [d.id, `${d.full_name}${d.role !== 'driver' ? ' (' + (C().roles?.[d.role] || d.role) + ')' : ''}`]);
}

const vehicleCell = (r) => (r.plate ? h('a', { href: `#/vehicles/${r.vehicle_id}`, class: 'link-strong', onclick: (e) => e.stopPropagation() }, r.plate) : '—');
const costs = () => can('costs', 'read');
const cut = (s, n = 80) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

function vehicleFilter() {
  return { key: 'vehicle_id', label: 'Araç', options: vehicleOptions({ includePassive: true }), match: (r, v) => String(r.vehicle_id) === String(v) };
}

// =====================================================================  BELGELER
async function openDocForm({ doc = null, vehicleId = null, renew = null } = {}) {
  const types = L().doc_types.filter((t) => t.active || t.id === doc?.doc_type_id);
  const typeById = (id) => types.find((t) => t.id === Number(id));
  const base = renew || doc;
  let values;
  if (doc) values = { ...doc };
  else if (renew) {
    const start = renew.end_date || todayStr();
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    values = { vehicle_id: renew.vehicle_id, doc_type_id: renew.doc_type_id, provider: renew.provider, start_date: start, end_date: end.toISOString().slice(0, 10) };
  } else values = { vehicle_id: vehicleId, start_date: todayStr() };
  const res = await openForm({
    title: doc ? 'Belgeyi düzenle' : renew ? `${renew.type_name} yenileme` : 'Belge ekle',
    subtitle: base?.plate,
    intro: !doc ? h('div', { class: 'callout callout-blue' }, icon('info', 18), h('div', null, 'Aynı türde yeni dönem belgesi eklendiğinde araçtaki mevcut belge arşive taşınır; geçmiş korunur. Tutar girilirse masraflara otomatik işlenir.')) : null,
    fields: [
      { name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, required: true, options: vehicleOptions({ includePassive: !!doc }), disabled: !!doc || !!renew || !!vehicleId, full: true },
      { name: 'doc_type_id', label: 'Belge türü', type: 'select', numeric: true, required: true, options: types.map((t) => [t.id, `${t.name}${t.required ? ' (zorunlu)' : ''}`]), disabled: !!renew },
      { name: 'doc_no', label: 'Poliçe / belge no', maxlength: 100 },
      { name: 'provider', label: 'Firma / kurum', maxlength: 200 },
      costs() ? { name: 'amount', label: 'Prim / tutar (₺)', type: 'number', min: 0 } : null,
      { name: 'start_date', label: 'Başlangıç tarihi', type: 'date' },
      { name: 'end_date', label: 'Bitiş tarihi', type: 'date', hint: (d) => (typeById(d.doc_type_id)?.has_expiry === 0 ? 'Bu belge türü süresizdir.' : 'Uyarılar bu tarihe göre üretilir.'),
        validate: (v, d) => (typeById(d.doc_type_id)?.has_expiry && !v ? 'Bu belge türü için bitiş tarihi zorunludur' : v && d.start_date && v < d.start_date ? 'Bitiş başlangıçtan önce olamaz' : null) },
      { name: 'file_id', label: 'Belge dosyası (PDF / görsel)', type: 'file', full: true },
      { name: 'notes', label: 'Not', type: 'textarea', full: true, rows: 2 },
    ].filter(Boolean),
    values,
    onSubmit: (v) => {
      if (doc) {
        delete v.vehicle_id;
        return api.put(`/documents/${doc.id}`, v);
      }
      return api.post('/documents', { ...v, vehicle_id: v.vehicle_id ?? values.vehicle_id, doc_type_id: v.doc_type_id ?? values.doc_type_id });
    },
  });
  if (res) {
    toast(doc ? 'Belge güncellendi' : renew ? 'Belge yenilendi; eski dönem arşive taşındı' : 'Belge eklendi');
    emit('changed');
  }
  return res;
}

function docsTable(rows, { reload, hideVehicle } = {}) {
  return dataTable({
    rows,
    csvName: 'belgeler',
    searchPlaceholder: 'Plaka, belge türü, poliçe no, firma…',
    sort: { key: 'end_date', dir: 'asc' },
    filters: [
      hideVehicle ? null : vehicleFilter(),
      { key: 'doc_type_id', label: 'Tür', options: L().doc_types.map((t) => [t.id, t.name]) },
      { key: 'state', label: 'Durum', options: [['expired', 'Süresi dolmuş'], ['soon', `${(window.__dg_warn || [30])[0]} gün içinde`], ['ok', 'Geçerli'], ['none', 'Süresiz']],
        match: (r, v) => (v === 'expired' ? r.days_left != null && r.days_left < 0 : v === 'soon' ? r.days_left != null && r.days_left >= 0 && r.days_left <= (window.__dg_warn || [30])[0] : v === 'ok' ? r.days_left != null && r.days_left > (window.__dg_warn || [30])[0] : r.days_left == null) },
    ].filter(Boolean),
    rowClass: (r) => (r.archived ? 'row-muted' : r.days_left != null && r.days_left < 0 ? 'row-danger' : ''),
    empty: 'Belge kaydı yok',
    emptyIcon: 'doc',
    columns: [
      hideVehicle ? null : { key: 'plate', label: 'Araç', render: vehicleCell },
      { key: 'type_name', label: 'Belge', render: (r) => h('div', { class: 'cell-2' }, h('span', null, r.type_name, r.required ? h('span', { class: 'req' }, ' *') : null, r.archived ? [' ', badge('Arşiv', 'gray')] : null), h('span', { class: 'muted small' }, [r.doc_no, r.provider].filter(Boolean).join(' · '))), text: (r) => `${r.type_name} ${r.doc_no || ''} ${r.provider || ''}` },
      { key: 'start_date', label: 'Başlangıç', text: (r) => fmtDate(r.start_date), sortValue: (r) => r.start_date, nowrap: true, hideSm: true },
      { key: 'end_date', label: 'Bitiş', text: (r) => fmtDate(r.end_date), sortValue: (r) => r.end_date || '9999', nowrap: true },
      { key: 'days_left', label: 'Kalan', render: (r) => (r.archived ? badge('Arşiv', 'gray') : daysBadge(r.days_left)), text: (r) => (r.days_left == null ? 'Süresiz' : String(r.days_left)), sortValue: (r) => r.days_left ?? 99999 },
      costs() ? { key: 'amount', label: 'Tutar', align: 'right', text: (r) => (r.amount != null ? fmtMoney(r.amount) : '—'), csv: (r) => r.amount ?? '' } : null,
      { key: 'file', label: 'Dosya', sortable: false, render: (r) => fileLink(r.file_id, r.file_name), text: (r) => r.file_name || '' },
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          can('documents', 'create') && !r.archived && r.has_expiry ? btn('Yenile', { size: 'sm', ic: 'refresh', onClick: async () => { if (await openDocForm({ renew: r })) reload(); } }) : null,
          can('documents', 'update') ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: async () => { if (await openDocForm({ doc: r })) reload(); } }) : null,
          can('documents', 'delete') ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
            if (!(await confirmDialog({ title: 'Belge silinsin mi?', message: `${r.plate} · ${r.type_name}. Bağlı otomatik masraf da silinir${r.archived ? '' : '; varsa önceki dönem belgesi tekrar geçerli olur'}.`, confirmLabel: 'Sil', danger: true }))) return;
            await api.del(`/documents/${r.id}`);
            toast('Belge silindi');
            emit('changed');
            reload();
          } }) : null),
      },
    ],
  });
}

export async function documentsPage(main, { query }) {
  let archived = query.get('archived') === '1';
  const load = () => api.get('/documents' + qs({ archived: archived ? 'all' : undefined }));
  const rows = await load();
  clear(main);
  const reload = async () => table.update(await load());
  const table = docsTable(rows, { reload });
  const arch = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: archived, onchange: async (e) => { archived = e.target.checked; await reload(); } }), h('span', null, 'Arşivi göster'));
  main.append(h('div', { class: 'page' },
    pageHeader('Belgeler', 'Sigorta, kasko, muayene, ruhsat ve diğer araç belgeleri. Bitişe kalan gün eşiklere göre renklenir.', [
      arch,
      can('documents', 'create') ? btn('Belge ekle', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openDocForm()) reload(); } }) : null,
    ]),
    card(null, table)));
}

export async function documentsSection(body, { vehicleId, vehicle }) {
  const rows = await api.get('/documents' + qs({ vehicle_id: vehicleId, archived: 'all' }));
  const reload = async () => {
    const fresh = await api.get('/documents' + qs({ vehicle_id: vehicleId, archived: 'all' }));
    table.update(fresh);
    renderMissing(fresh);
  };
  const missingBox = h('div');
  const renderMissing = (list) => {
    clear(missingBox);
    const have = new Set(list.filter((d) => !d.archived).map((d) => d.doc_type_id));
    const missing = L().doc_types.filter((t) => t.required && t.active && !have.has(t.id));
    if (missing.length) {
      missingBox.append(h('div', { class: 'callout callout-red' }, icon('warning', 18), h('div', null, h('strong', null, 'Eksik zorunlu belgeler: '), missing.map((t) => t.name).join(', '),
        can('documents', 'create') ? h('div', { class: 'callout-actions' }, missing.map((t) => btn(`${t.name} ekle`, { size: 'sm', onClick: async () => { if (await openDocForm({ renew: { vehicle_id: vehicleId, doc_type_id: t.id, type_name: t.name, plate: vehicle.plate } })) reload(); } }))) : null)));
    }
  };
  renderMissing(rows);
  const table = docsTable(rows, { reload, hideVehicle: true });
  body.append(missingBox, card('Belgeler', table, { actions: can('documents', 'create') ? btn('Belge ekle', { size: 'sm', kind: 'primary', ic: 'plus', onClick: async () => { if (await openDocForm({ vehicleId })) reload(); } }) : null }));
}

// =====================================================================  BAKIM
function partsEditor(parts) {
  return (data, set) => {
    const wrap = h('div', { class: 'parts-editor' });
    const list = data.parts ? data.parts.map((p) => ({ ...p })) : [];
    const render = () => {
      clear(wrap);
      if (!list.length) wrap.append(h('p', { class: 'muted small' }, 'Bu bakımda stoktan parça kullanılmadı.'));
      list.forEach((row, i) => {
        const part = parts.find((p) => p.id === row.part_id);
        const sel = h('select', { class: 'input input-sm', onchange: (e) => { row.part_id = Number(e.target.value) || null; const p = parts.find((x) => x.id === row.part_id); if (p && row.unit_price == null) row.unit_price = p.unit_price; sync(); render(); } },
          h('option', { value: '' }, '— Parça seçin —'),
          parts.map((p) => h('option', { value: String(p.id) }, `${p.code} · ${p.name} (stok ${fmtNum(p.stock, 2)} ${p.unit})`)));
        sel.value = row.part_id ? String(row.part_id) : '';
        const qty = h('input', { class: 'input input-sm', type: 'number', min: 0, step: 'any', value: row.qty ?? 1, 'aria-label': 'Miktar', oninput: (e) => { row.qty = Number(e.target.value); sync(); totalEl.textContent = totalText(); } });
        const price = costs() ? h('input', { class: 'input input-sm', type: 'number', min: 0, step: 'any', value: row.unit_price ?? '', placeholder: 'Birim fiyat', 'aria-label': 'Birim fiyat', oninput: (e) => { row.unit_price = e.target.value === '' ? null : Number(e.target.value); sync(); totalEl.textContent = totalText(); } }) : null;
        wrap.append(h('div', { class: 'parts-row' }, sel, qty, h('span', { class: 'muted small' }, part?.unit || ''), price,
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Kaldır', onclick: () => { list.splice(i, 1); sync(); render(); } }, icon('x', 16))));
      });
      wrap.append(h('div', { class: 'parts-foot' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { list.push({ part_id: null, qty: 1, unit_price: null }); render(); } }, icon('plus', 15), 'Parça ekle'),
        totalEl));
      totalEl.textContent = totalText();
    };
    const totalEl = h('span', { class: 'muted small' });
    const totalText = () => (costs() ? `Parça toplamı: ${fmtMoney(list.reduce((s, r) => s + (r.qty || 0) * (r.unit_price || 0), 0))}` : '');
    const sync = () => set(list.filter((r) => r.part_id && r.qty > 0).map((r) => ({ part_id: r.part_id, qty: r.qty, unit_price: r.unit_price })));
    render();
    sync();
    return wrap;
  };
}

export async function openMaintForm({ record = null, vehicleId = null, issueId = null, status = null } = {}) {
  const full = record ? await api.get(`/maintenance/${record.id}`) : null;
  const parts = (await api.get('/parts')).filter((p) => p.active || full?.parts.some((x) => x.part_id === p.id));
  const kinds = Object.entries(C().maint_kinds);
  const values = full ? { ...full, parts: full.parts.map((p) => ({ part_id: p.part_id, qty: p.qty, unit_price: p.unit_price })), file_name: full.file_name } : {
    vehicle_id: vehicleId, issue_id: issueId, kind: issueId ? 'repair' : 'periodic', status: status || 'done', date: todayStr(),
    km: vehicleId ? L().vehicles.find((v) => v.id === Number(vehicleId))?.current_km : null, labor_cost: 0, other_cost: 0, parts: [],
  };
  if (status) values.status = status;
  const res = await openForm({
    title: record ? (status === 'done' && record.status === 'planned' ? 'Planlı bakımı tamamla' : 'Bakım kaydını düzenle') : 'Bakım kaydı ekle',
    subtitle: record?.plate,
    width: 760,
    intro: h('div', { class: 'callout callout-blue' }, icon('info', 18), h('div', null, 'Yapılan bakımda kullanılan parçalar stoktan otomatik düşer; toplam tutar masraflara işlenir. Kayıt silinirse stok ve masraf geri alınır.')),
    fields: [
      { name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, required: true, options: vehicleOptions({ includePassive: !!record }), disabled: !!record || !!vehicleId, full: true },
      { name: 'kind', label: 'Bakım türü', type: 'select', required: true, options: kinds },
      { name: 'status', label: 'Durum', type: 'select', required: true, options: [['done', 'Yapıldı'], ['planned', 'Planlı (ileri tarihli)']] },
      { name: 'date', label: 'Tarih', type: 'date', validate: (v, d) => (d.status === 'done' && !v ? 'Yapılan bakım için tarih zorunludur' : d.status === 'done' && v > todayStr() ? 'İleri tarihli bakımı "Planlı" olarak kaydedin' : null) },
      { name: 'km', label: 'Km', type: 'number', min: 0, step: 1, validate: (v, d) => (d.status === 'planned' && v == null && !d.date ? 'Planlı bakım için tarih veya km girin' : null) },
      { name: 'service_name', label: 'Servis', maxlength: 200, show: (d) => d.status === 'done' || true },
      { name: 'invoice_no', label: 'Fatura no', maxlength: 100 },
      { name: 'description', label: 'Yapılan / yapılacak işlem', type: 'textarea', full: true, rows: 3 },
      { type: 'heading', label: 'Kullanılan yedek parçalar', hint: 'Stokta kayıtlı parçalar' },
      { name: 'parts', label: 'Parçalar', type: 'custom', full: true, render: partsEditor(parts) },
      costs() ? { type: 'heading', label: 'Tutar' } : null,
      costs() ? { name: 'labor_cost', label: 'İşçilik (₺)', type: 'number', min: 0 } : null,
      costs() ? { name: 'other_cost', label: 'Diğer tutar (₺)', type: 'number', min: 0, hint: 'Stok dışı malzeme, yağ vb.' } : null,
      { type: 'heading', label: 'Sonraki bakım', hint: 'Boş bırakılırsa aracın bakım aralığından hesaplanır.' },
      { name: 'next_km', label: 'Sonraki bakım km', type: 'number', min: 0, step: 1 },
      { name: 'next_date', label: 'Sonraki bakım tarihi', type: 'date' },
      { name: 'file_id', label: 'Fatura / servis formu', type: 'file', full: true },
    ].filter(Boolean),
    values,
    submitLabel: status === 'done' ? 'Tamamlandı olarak kaydet' : 'Kaydet',
    onSubmit: (v) => {
      const body = { ...v, parts: v.parts || [] };
      if (!body.issue_id && values.issue_id) body.issue_id = values.issue_id;
      if (record) {
        delete body.vehicle_id;
        return api.put(`/maintenance/${record.id}`, body);
      }
      return api.post('/maintenance', { ...body, vehicle_id: v.vehicle_id ?? values.vehicle_id });
    },
  });
  if (res) {
    toast(record ? 'Bakım kaydı güncellendi' : 'Bakım kaydı eklendi');
    emit('changed');
    await loadLookups();
  }
  return res;
}

function maintTable(rows, { reload, hideVehicle } = {}) {
  return dataTable({
    rows,
    csvName: 'bakim',
    searchPlaceholder: 'Plaka, servis, işlem, fatura…',
    filters: [
      hideVehicle ? null : vehicleFilter(),
      { key: 'status', label: 'Durum', options: [['done', 'Yapıldı'], ['planned', 'Planlı']] },
      { key: 'kind', label: 'Tür', options: Object.entries(C().maint_kinds) },
    ].filter(Boolean),
    rowClass: (r) => (r.status === 'planned' ? 'row-planned' : ''),
    empty: 'Bakım kaydı yok',
    emptyIcon: 'wrench',
    columns: [
      { key: 'date', label: 'Tarih', text: (r) => fmtDate(r.date), sortValue: (r) => r.date, nowrap: true, defaultDir: 'desc' },
      hideVehicle ? null : { key: 'plate', label: 'Araç', render: vehicleCell },
      { key: 'kind', label: 'Tür', render: (r) => h('div', { class: 'cell-2' }, h('span', null, C().maint_kinds[r.kind]), r.status === 'planned' ? badge('Planlı', 'purple') : null), text: (r) => C().maint_kinds[r.kind] + (r.status === 'planned' ? ' (planlı)' : '') },
      { key: 'km', label: 'Km', align: 'right', text: (r) => fmtNum(r.km), csv: (r) => r.km ?? '' },
      { key: 'service_name', label: 'Servis / İşlem', render: (r) => h('div', { class: 'cell-2' }, h('span', null, r.service_name || '—'), h('span', { class: 'muted small' }, cut(r.description))), text: (r) => [r.service_name, r.description].filter(Boolean).join(' – ') },
      { key: 'part_count', label: 'Parça', align: 'right', text: (r) => (r.part_count ? String(r.part_count) : '—'), hideSm: true },
      costs() ? { key: 'total_cost', label: 'Toplam', align: 'right', text: (r) => (r.total_cost ? fmtMoney(r.total_cost) : '—'), csv: (r) => r.total_cost ?? '' } : null,
      { key: 'next', label: 'Sonraki', text: (r) => [r.next_km != null ? fmtKm(r.next_km) : null, r.next_date ? fmtDate(r.next_date) : null].filter(Boolean).join(' / ') || '—', hideSm: true },
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          r.status === 'planned' && can('maintenance', 'update') ? btn('Tamamla', { size: 'sm', kind: 'primary', ic: 'check', onClick: async () => { if (await openMaintForm({ record: r, status: 'done' })) reload(); } }) : null,
          can('maintenance', 'update') ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: async () => { if (await openMaintForm({ record: r })) reload(); } }) : btn('', { size: 'sm', kind: 'ghost', ic: 'eye', title: 'Görüntüle', onClick: () => showMaint(r) }),
          can('maintenance', 'delete') ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
            if (!(await confirmDialog({ title: 'Bakım kaydı silinsin mi?', message: 'Kullanılan parçalar stoğa geri eklenir, bağlı masraf silinir.', confirmLabel: 'Sil', danger: true }))) return;
            await api.del(`/maintenance/${r.id}`);
            toast('Bakım kaydı silindi; stok ve masraf geri alındı');
            emit('changed');
            reload();
          } }) : null),
      },
    ],
  });
}

async function showMaint(r) {
  const m = await api.get(`/maintenance/${r.id}`);
  modal({
    title: `${m.plate} · ${C().maint_kinds[m.kind]}`,
    content: [
      kv([['Durum', m.status === 'planned' ? 'Planlı' : 'Yapıldı'], ['Tarih', fmtDate(m.date)], ['Km', fmtKm(m.km)], ['Servis', m.service_name], ['Fatura no', m.invoice_no],
        ['İşlem', m.description], costs() ? ['İşçilik', fmtMoney(m.labor_cost)] : null, costs() ? ['Parça', fmtMoney(m.parts_total)] : null, costs() ? ['Toplam', fmtMoney(m.total_cost)] : null,
        ['Dosya', fileLink(m.file_id, m.file_name)]]),
      m.parts.length ? h('div', null, h('h4', null, 'Kullanılan parçalar'), h('ul', { class: 'simple-list' }, m.parts.map((p) => h('li', null, `${p.code} · ${p.name}`, h('span', null, `${fmtNum(p.qty, 2)} ${p.unit}`))))) : null,
    ],
  });
}

export async function maintenancePage(main, { query }) {
  const rows = await api.get('/maintenance');
  clear(main);
  const reload = async () => table.update(await api.get('/maintenance'));
  const table = maintTable(rows, { reload });
  main.append(h('div', { class: 'page' },
    pageHeader('Bakım', 'Periyodik bakım, onarım ve planlı bakım kayıtları. Bakım döngüsü her aracın son periyodik bakımından hesaplanır.', [
      can('maintenance', 'create') ? btn('Planlı bakım', { ic: 'plus', onClick: async () => { if (await openMaintForm({ status: 'planned' })) reload(); } }) : null,
      can('maintenance', 'create') ? btn('Bakım kaydı ekle', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openMaintForm()) reload(); } }) : null,
    ]),
    card(null, table)));
  if (query.get('status')) {
    const sel = table.querySelector('select[aria-label=Durum]');
    if (sel) {
      sel.value = query.get('status');
      sel.dispatchEvent(new Event('change'));
    }
  }
}

export async function maintenanceSection(body, { vehicleId }) {
  const rows = await api.get('/maintenance' + qs({ vehicle_id: vehicleId }));
  const reload = async () => {
    table.update(await api.get('/maintenance' + qs({ vehicle_id: vehicleId })));
  };
  const table = maintTable(rows, { reload, hideVehicle: true });
  body.append(card('Bakım geçmişi', table, {
    actions: can('maintenance', 'create') ? [
      btn('Planlı bakım', { size: 'sm', ic: 'plus', onClick: async () => { if (await openMaintForm({ vehicleId, status: 'planned' })) reload(); } }),
      btn('Bakım ekle', { size: 'sm', kind: 'primary', ic: 'plus', onClick: async () => { if (await openMaintForm({ vehicleId })) reload(); } }),
    ] : null,
  }));
}

// =====================================================================  LASTİKLER
function treadBadge(mm) {
  if (mm == null) return '—';
  const s = L().settings;
  const tone = mm <= s.tire_min_tread_mm ? 'red' : mm <= s.tire_warn_tread_mm ? 'orange' : 'green';
  return badge(`${fmtNum(mm, 1)} mm`, tone);
}

function ageBadge(y) {
  if (y == null) return '—';
  const max = L().settings.tire_max_age_years;
  return badge(`${fmtNum(y, 1)} yıl`, y >= max ? 'red' : y >= max - 1 ? 'orange' : 'gray');
}

async function openTireForm({ tire = null, vehicleId = null } = {}) {
  const positions = C().tire_positions;
  const res = await openForm({
    title: tire ? 'Lastiği düzenle' : 'Lastik ekle',
    width: 680,
    fields: [
      { name: 'vehicle_id', label: 'Ait olduğu araç', type: 'select', numeric: true, options: vehicleOptions(), hint: 'Boş bırakılırsa genel depo stoğu olur.', disabled: tire?.status === 'mounted', full: true },
      { name: 'brand', label: 'Marka', maxlength: 100 },
      { name: 'model', label: 'Model', maxlength: 100 },
      { name: 'size', label: 'Ebat', placeholder: '205/55 R16', maxlength: 50 },
      { name: 'season', label: 'Tür', type: 'select', required: true, options: Object.entries(SEASON) },
      { name: 'dot', label: 'DOT üretim (HHYY)', placeholder: '2323', maxlength: 4, hint: 'Hafta + yıl, ör. 2323 = 2023\'ün 23. haftası', validate: (v) => (v && !/^\d{4}$/.test(v) ? '4 haneli olmalı (HHYY)' : null) },
      { name: 'tread_depth', label: 'Diş derinliği (mm)', type: 'number', min: 0, max: 30, step: 0.1 },
      { name: 'max_km', label: 'Km sınırı', type: 'number', min: 0, step: 1000, hint: `Boşsa varsayılan: ${fmtNum(L().settings.tire_default_max_km)} km` },
      { name: 'purchase_date', label: 'Alım tarihi', type: 'date' },
      costs() ? { name: 'cost', label: 'Tutar (₺)', type: 'number', min: 0, hint: 'Girilirse masraflara otomatik işlenir.' } : null,
      tire ? null : { name: 'total_km', label: 'Önceden yapılan km', type: 'number', min: 0, step: 1 },
      tire ? (tire.status === 'mounted' ? { name: 'position', label: 'Konum', type: 'select', required: true, options: positions.map((p) => [p, p]) } : null)
        : { name: 'mount', label: 'Hemen araca tak', type: 'checkbox', full: true },
      tire ? null : { name: 'position', label: 'Konum', type: 'select', options: positions.map((p) => [p, p]), show: (d) => d.mount, required: true },
      tire ? null : { name: 'mounted_km', label: 'Takma km', type: 'number', min: 0, step: 1, show: (d) => d.mount, hint: 'Boşsa aracın güncel km değeri' },
      { name: 'notes', label: 'Not', type: 'textarea', full: true, rows: 2 },
    ].filter(Boolean),
    values: tire ? { ...tire } : { vehicle_id: vehicleId, season: 'summer', mount: false },
    onSubmit: (v) => (tire ? api.put(`/tires/${tire.id}`, v) : api.post('/tires', v)),
  });
  if (res) {
    toast(tire ? 'Lastik güncellendi' : 'Lastik eklendi');
    emit('changed');
  }
  return res;
}

async function openMount(t) {
  const res = await openForm({
    title: 'Lastik tak',
    subtitle: [t.brand, t.model, t.size].filter(Boolean).join(' '),
    width: 520,
    fields: [
      { name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, required: true, options: vehicleOptions(), full: true },
      { name: 'position', label: 'Konum', type: 'select', required: true, options: C().tire_positions.map((p) => [p, p]) },
      { name: 'km', label: 'Takma km', type: 'number', min: 0, step: 1, hint: 'Boşsa aracın güncel km değeri' },
      { name: 'date', label: 'Tarih', type: 'date' },
    ],
    values: { vehicle_id: t.vehicle_id, position: t.position, date: todayStr() },
    onChange: (d, f) => {
      const v = L().vehicles.find((x) => x.id === d.vehicle_id);
      if (v) f.setHint('km', `Aracın güncel km değeri: ${fmtNum(v.current_km)}`);
    },
    onSubmit: (v) => api.post(`/tires/${t.id}/mount`, v),
  });
  if (res) {
    toast('Lastik takıldı');
    emit('changed');
  }
  return res;
}

async function openDismount(t) {
  const res = await openForm({
    title: t.status === 'mounted' ? 'Lastik sök' : 'Hurdaya ayır',
    subtitle: `${t.plate || ''} ${t.position || ''} · ${[t.brand, t.size].filter(Boolean).join(' ')}`,
    width: 520,
    fields: [
      t.status === 'mounted' ? { name: 'km', label: 'Sökme km', type: 'number', min: t.mounted_km || 0, step: 1, hint: `Takma km: ${fmtNum(t.mounted_km)} · boşsa aracın güncel km değeri` } : null,
      { name: 'to', label: 'Lastiğin durumu', type: 'select', required: true, options: t.status === 'mounted' ? [['stored', 'Depoya kaldır'], ['scrap', 'Hurdaya ayır']] : [['scrap', 'Hurdaya ayır']] },
      { name: 'tread_depth', label: 'Ölçülen diş derinliği (mm)', type: 'number', min: 0, max: 30, step: 0.1 },
      { name: 'date', label: 'Tarih', type: 'date' },
      { name: 'note', label: 'Not', type: 'textarea', full: true, rows: 2 },
    ].filter(Boolean),
    values: { to: t.status === 'mounted' ? 'stored' : 'scrap', date: todayStr(), tread_depth: t.tread_depth },
    onSubmit: (v) => api.post(`/tires/${t.id}/dismount`, v),
  });
  if (res) {
    toast(res.status === 'scrap' ? 'Lastik hurdaya ayrıldı' : 'Lastik söküldü ve depoya alındı');
    emit('changed');
  }
  return res;
}

async function openSeasonal(vehicleId) {
  const now = todayStr().slice(5);
  const s = L().settings;
  const winter = s.winter_start <= s.winter_end ? now >= s.winter_start && now < s.winter_end : now >= s.winter_start || now < s.winter_end;
  const res = await openForm({
    title: 'Mevsimsel lastik değişimi',
    width: 540,
    intro: h('div', { class: 'callout callout-blue' }, icon('info', 18), h('div', null, 'Araçtaki takılı tüm lastikler sökülüp depoya alınır; araca ait depodaki seçilen mevsim (ve dört mevsim) lastikleri aynı konumlara takılır.')),
    fields: [
      { name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, required: true, options: vehicleOptions(), disabled: !!vehicleId, full: true },
      { name: 'to_season', label: 'Takılacak lastikler', type: 'select', required: true, options: [['winter', 'Kış lastikleri'], ['summer', 'Yaz lastikleri']] },
      { name: 'km', label: 'Km', type: 'number', min: 0, step: 1, hint: 'Boşsa aracın güncel km değeri' },
      { name: 'date', label: 'Tarih', type: 'date' },
    ],
    values: { vehicle_id: vehicleId, to_season: winter ? 'winter' : 'summer', date: todayStr() },
    onSubmit: (v) => api.post('/tires/seasonal-change', { ...v, vehicle_id: v.vehicle_id ?? vehicleId }),
  });
  if (res) {
    toast(`Değişim tamamlandı: ${res.dismounted} söküldü, ${res.mounted} takıldı`);
    emit('changed');
  }
  return res;
}

async function showTireEvents(t) {
  const ev = await api.get(`/tires/${t.id}/events`);
  const KIND = { mount: 'Takıldı', dismount: 'Söküldü', scrap: 'Hurdaya ayrıldı', tread: 'Diş ölçümü' };
  modal({
    title: 'Lastik geçmişi',
    subtitle: [t.brand, t.model, t.size, t.dot ? 'DOT ' + t.dot : null].filter(Boolean).join(' · '),
    content: [
      kv([['Toplam kullanım', fmtKm(t.used_km)], ['Durum', TIRE_STATUS[t.status]], ['Araç', t.plate], ['Konum', t.position]]),
      ev.length ? h('ul', { class: 'timeline' }, ev.map((e) => h('li', null, h('strong', null, KIND[e.kind]), ' ', h('span', { class: 'muted' }, [fmtDate(e.date), e.plate, e.position, e.km != null ? fmtKm(e.km) : null, e.user_name].filter(Boolean).join(' · ')), e.note ? h('div', { class: 'small' }, e.note) : null)))
        : h('p', { class: 'muted' }, 'Hareket yok.'),
    ],
  });
}

function tiresTable(rows, { reload, hideVehicle } = {}) {
  return dataTable({
    rows,
    csvName: 'lastikler',
    searchPlaceholder: 'Plaka, marka, ebat, DOT…',
    filters: [
      hideVehicle ? null : vehicleFilter(),
      { key: 'status', label: 'Durum', options: Object.entries(TIRE_STATUS), value: 'active', match: (r, v) => (v === 'active' ? r.status !== 'scrap' : r.status === v) },
      { key: 'season', label: 'Tür', options: Object.entries(SEASON) },
    ].filter(Boolean),
    empty: 'Lastik kaydı yok',
    emptyIcon: 'tire',
    rowClass: (r) => (r.status === 'scrap' ? 'row-muted' : ''),
    columns: [
      hideVehicle ? null : { key: 'plate', label: 'Araç', render: vehicleCell },
      { key: 'position', label: 'Konum', text: (r) => r.position || '—' },
      { key: 'brand', label: 'Lastik', render: (r) => h('div', { class: 'cell-2' }, h('span', null, [r.brand, r.model].filter(Boolean).join(' ') || '—'), h('span', { class: 'muted small' }, r.size || '')), text: (r) => [r.brand, r.model, r.size].filter(Boolean).join(' ') },
      { key: 'season', label: 'Tür', render: (r) => badge(SEASON[r.season], r.season === 'winter' ? 'blue' : r.season === 'summer' ? 'orange' : 'gray'), text: (r) => SEASON[r.season] },
      { key: 'age_years', label: 'DOT / Yaş', render: (r) => h('div', { class: 'cell-2' }, h('span', null, r.dot || '—'), ageBadge(r.age_years)), text: (r) => `${r.dot || ''} ${r.age_years ?? ''}` },
      { key: 'tread_depth', label: 'Diş', render: (r) => treadBadge(r.tread_depth), text: (r) => (r.tread_depth != null ? String(r.tread_depth) : '') },
      { key: 'used_km', label: 'Kullanım', align: 'right', render: (r) => { const max = r.max_km || L().settings.tire_default_max_km; return h('div', { class: 'cell-2 right' }, h('span', null, fmtKm(r.used_km)), max ? h('span', { class: `small ${r.used_km >= max ? 'text-red' : 'muted'}` }, `/ ${fmtNum(max)}`) : null); }, text: (r) => String(r.used_km) },
      { key: 'status', label: 'Durum', render: (r) => badge(TIRE_STATUS[r.status], TIRE_TONE[r.status]), text: (r) => TIRE_STATUS[r.status] },
      costs() ? { key: 'cost', label: 'Tutar', align: 'right', text: (r) => (r.cost != null ? fmtMoney(r.cost) : '—'), hideSm: true } : null,
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          can('tires', 'update') && r.status === 'stored' ? btn('Tak', { size: 'sm', onClick: async () => { if (await openMount(r)) reload(); } }) : null,
          can('tires', 'update') && r.status === 'mounted' ? btn('Sök', { size: 'sm', onClick: async () => { if (await openDismount(r)) reload(); } }) : null,
          btn('', { size: 'sm', kind: 'ghost', ic: 'list', title: 'Geçmiş', onClick: () => showTireEvents(r) }),
          can('tires', 'update') ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: async () => { if (await openTireForm({ tire: r })) reload(); } }) : null,
          can('tires', 'update') && r.status === 'stored' ? btn('', { size: 'sm', kind: 'ghost', ic: 'x', title: 'Hurdaya ayır', onClick: async () => { if (await openDismount(r)) reload(); } }) : null,
          can('tires', 'delete') ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
            if (!(await confirmDialog({ title: 'Lastik kaydı silinsin mi?', message: 'Lastiğin tüm takma/sökme geçmişi ve bağlı masrafı silinir. Kullanılmayan lastik için "Hurdaya ayır" tercih edin.', confirmLabel: 'Sil', danger: true }))) return;
            await api.del(`/tires/${r.id}`);
            toast('Lastik silindi');
            reload();
          } }) : null),
      },
    ],
  });
}

export async function tiresPage(main) {
  const rows = await api.get('/tires');
  clear(main);
  const reload = async () => table.update(await api.get('/tires'));
  const table = tiresTable(rows, { reload });
  main.append(h('div', { class: 'page' },
    pageHeader('Lastikler', `Lastik envanteri, takma/sökme geçmişi ve mevsimsel değişim. Kış lastiği dönemi: ${L().settings.winter_start.split('-').reverse().join('.')} – ${L().settings.winter_end.split('-').reverse().join('.')}.`, [
      can('tires', 'update') ? btn('Mevsimsel değişim', { ic: 'refresh', onClick: async () => { if (await openSeasonal()) reload(); } }) : null,
      can('tires', 'create') ? btn('Lastik ekle', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openTireForm()) reload(); } }) : null,
    ]),
    card(null, table)));
}

export async function tiresSection(body, { vehicleId }) {
  const load = () => api.get('/tires' + qs({ vehicle_id: vehicleId }));
  const rows = await load();
  const diagram = h('div');
  const renderDiagram = (list) => {
    clear(diagram);
    const mounted = list.filter((t) => t.status === 'mounted');
    if (!mounted.length) return;
    diagram.append(h('div', { class: 'tire-grid' }, mounted.map((t) => h('div', { class: 'tire-slot' },
      h('div', { class: 'tire-pos' }, t.position || '—'),
      h('div', { class: 'small' }, [t.brand, t.size].filter(Boolean).join(' ') || '—'),
      h('div', { class: 'tire-badges' }, badge(SEASON[t.season], t.season === 'winter' ? 'blue' : t.season === 'summer' ? 'orange' : 'gray'), treadBadge(t.tread_depth), ageBadge(t.age_years))))));
  };
  const reload = async () => {
    const fresh = await load();
    table.update(fresh);
    renderDiagram(fresh);
  };
  renderDiagram(rows);
  const table = tiresTable(rows, { reload, hideVehicle: true });
  body.append(card('Takılı lastikler', diagram.childNodes.length ? diagram : h('p', { class: 'muted' }, 'Bu araçta takılı lastik kaydı yok.'), {
    actions: [
      can('tires', 'update') ? btn('Mevsimsel değişim', { size: 'sm', ic: 'refresh', onClick: async () => { if (await openSeasonal(vehicleId)) reload(); } }) : null,
      can('tires', 'create') ? btn('Lastik ekle', { size: 'sm', kind: 'primary', ic: 'plus', onClick: async () => { if (await openTireForm({ vehicleId })) reload(); } }) : null,
    ],
  }), card('Lastik envanteri', table));
}

// =====================================================================  YEDEK PARÇA
async function openPartForm(part = null, defaults = {}) {
  const res = await openForm({
    title: part ? 'Parçayı düzenle' : 'Parça ekle',
    width: 680,
    fields: [
      { name: 'code', label: 'Parça kodu', required: true, maxlength: 60 },
      { name: 'name', label: 'Parça adı', required: true, maxlength: 200 },
      { name: 'category', label: 'Kategori', maxlength: 100, placeholder: 'Filtre, fren, yağ…' },
      { name: 'vehicle_id', label: 'Uyumlu araç', type: 'select', numeric: true, options: vehicleOptions(), placeholder: '— Ortak (tüm araçlar) —' },
      { name: 'unit', label: 'Birim', maxlength: 20 },
      part ? null : { name: 'stock', label: 'Başlangıç stoğu', type: 'number', min: 0 },
      { name: 'min_stock', label: 'Asgari stok seviyesi', type: 'number', min: 0, hint: 'Altına düşünce uyarı üretilir.' },
      costs() ? { name: 'unit_price', label: 'Birim fiyat (₺)', type: 'number', min: 0 } : null,
      { name: 'shelf', label: 'Raf / konum', maxlength: 100 },
      { name: 'supplier', label: 'Tedarikçi', maxlength: 200 },
      part ? { name: 'active', label: 'Aktif', type: 'checkbox' } : null,
      { name: 'notes', label: 'Not', type: 'textarea', full: true, rows: 2 },
    ].filter(Boolean),
    values: part ? { ...part, active: !!part.active } : { unit: 'adet', min_stock: 0, stock: 0, ...defaults },
    onSubmit: (v) => (part ? api.put(`/parts/${part.id}`, v) : api.post('/parts', v)),
  });
  if (res) {
    toast(part ? 'Parça güncellendi' : 'Parça eklendi');
    emit('changed');
  }
  return res;
}

async function openAdjust(p) {
  const res = await openForm({
    title: 'Stok hareketi',
    subtitle: `${p.code} · ${p.name} — mevcut ${fmtNum(p.stock, 2)} ${p.unit}`,
    width: 500,
    fields: [
      { name: 'kind', label: 'Hareket', type: 'select', required: true, options: [['in', 'Giriş (satın alma / iade)'], ['out', 'Çıkış (kullanım / fire)'], ['count', 'Sayım düzeltmesi (yeni stok)']] },
      { name: 'qty', label: 'Miktar', type: 'number', min: 0, required: true, hint: (d) => (d.kind === 'count' ? 'Sayımda bulunan gerçek miktarı girin.' : '') },
      costs() ? { name: 'unit_price', label: 'Birim fiyat (₺)', type: 'number', min: 0, show: (d) => d.kind === 'in' } : null,
      { name: 'note', label: 'Açıklama', maxlength: 500, full: true },
    ].filter(Boolean),
    values: { kind: 'in', unit_price: p.unit_price },
    onSubmit: (v) => api.post(`/parts/${p.id}/adjust`, v),
  });
  if (res) {
    toast(`Stok güncellendi: ${fmtNum(res.stock, 2)} ${res.unit}`);
    emit('changed');
  }
  return res;
}

async function showMoves(p) {
  const moves = await api.get(`/parts/${p.id}/moves`);
  const KIND = { in: 'Giriş', out: 'Çıkış', count: 'Sayım', maintenance: 'Bakımda kullanım', maintenance_revert: 'Bakım iadesi' };
  modal({
    title: 'Stok hareketleri',
    subtitle: `${p.code} · ${p.name}`,
    width: 760,
    content: dataTable({
      rows: moves,
      csvName: `stok-${p.code}`,
      search: false,
      columns: [
        { key: 'created_at', label: 'Zaman', text: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at },
        { key: 'kind', label: 'Hareket', text: (r) => KIND[r.kind] },
        { key: 'qty', label: 'Miktar', align: 'right', render: (r) => h('span', { class: r.qty < 0 ? 'text-red' : 'text-green' }, (r.qty > 0 ? '+' : '') + fmtNum(r.qty, 2)), text: (r) => String(r.qty) },
        { key: 'stock_after', label: 'Sonra', align: 'right', text: (r) => fmtNum(r.stock_after, 2) },
        { key: 'ref', label: 'İlgili', text: (r) => (r.plate ? `${r.plate} bakım #${r.ref_id}` : r.note || '') },
        { key: 'user_name', label: 'Kullanıcı', text: (r) => r.user_name || '' },
      ],
    }),
  });
}

function partsTable(rows, { reload }) {
  return dataTable({
    rows,
    csvName: 'yedek-parca',
    searchPlaceholder: 'Kod, ad, kategori, tedarikçi…',
    sort: { key: 'name', dir: 'asc' },
    filters: [
      { key: 'low', label: 'Stok', options: [['low', 'Asgari seviyenin altında'], ['zero', 'Tükendi']], match: (r, v) => (v === 'low' ? r.min_stock > 0 && r.stock < r.min_stock : r.stock <= 0) },
      { key: 'category', label: 'Kategori', options: [...new Set(rows.map((r) => r.category).filter(Boolean))].map((c) => [c, c]) },
    ],
    rowClass: (r) => (r.min_stock > 0 && r.stock < r.min_stock ? 'row-danger' : !r.active ? 'row-muted' : ''),
    empty: 'Parça kaydı yok',
    emptyIcon: 'box',
    columns: [
      { key: 'code', label: 'Kod', render: (r) => h('code', null, r.code) },
      { key: 'name', label: 'Parça', render: (r) => h('div', { class: 'cell-2' }, h('span', null, r.name, !r.active ? [' ', badge('Pasif', 'gray')] : null), h('span', { class: 'muted small' }, r.category || '')), text: (r) => `${r.name} ${r.category || ''}` },
      { key: 'vehicle_plate', label: 'Uyumlu', text: (r) => r.vehicle_plate || 'Ortak', hideSm: true },
      { key: 'stock', label: 'Stok', align: 'right', render: (r) => badge(`${fmtNum(r.stock, 2)} ${r.unit}`, r.stock <= 0 ? 'red' : r.min_stock > 0 && r.stock < r.min_stock ? 'orange' : 'green'), text: (r) => String(r.stock) },
      { key: 'min_stock', label: 'Asgari', align: 'right', text: (r) => fmtNum(r.min_stock, 2), hideSm: true },
      costs() ? { key: 'unit_price', label: 'Birim fiyat', align: 'right', text: (r) => (r.unit_price != null ? fmtMoney(r.unit_price) : '—'), csv: (r) => r.unit_price ?? '' } : null,
      { key: 'shelf', label: 'Raf / Tedarikçi', text: (r) => [r.shelf, r.supplier].filter(Boolean).join(' · ') || '—', hideSm: true },
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          can('parts', 'update') ? btn('Stok', { size: 'sm', ic: 'refresh', onClick: async () => { if (await openAdjust(r)) reload(); } }) : null,
          btn('', { size: 'sm', kind: 'ghost', ic: 'list', title: 'Hareketler', onClick: () => showMoves(r) }),
          can('parts', 'update') ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: async () => { if (await openPartForm(r)) reload(); } }) : null,
          can('parts', 'delete') ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
            if (!(await confirmDialog({ title: 'Parça silinsin mi?', message: 'Bakım kayıtlarında kullanılmış parçalar silinmez, pasifleştirilir.', confirmLabel: 'Sil', danger: true }))) return;
            const res = await api.del(`/parts/${r.id}`);
            toast(res.deactivated ? 'Parça pasifleştirildi' : 'Parça silindi');
            reload();
          } }) : null),
      },
    ],
  });
}

export async function partsPage(main, { query }) {
  const load = () => api.get('/parts' + qs({ active: 'all' }));
  const rows = await load();
  clear(main);
  const reload = async () => table.update(await load());
  const table = partsTable(rows, { reload });
  main.append(h('div', { class: 'page' },
    pageHeader('Yedek Parça', 'Parça kataloğu ve stok. Bakım kayıtlarında kullanılan parçalar stoktan otomatik düşer.', [
      can('parts', 'create') ? btn('Parça ekle', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openPartForm()) reload(); } }) : null,
    ]),
    card(null, table)));
  const id = Number(query.get('id'));
  if (id) {
    const p = rows.find((x) => x.id === id);
    if (p) showMoves(p);
  }
}

export async function partsSection(body, { vehicleId }) {
  const load = () => api.get('/parts' + qs({ vehicle_id: vehicleId }));
  const rows = await load();
  const reload = async () => table.update(await load());
  const table = partsTable(rows, { reload });
  body.append(card('Bu araçla uyumlu parçalar', table, {
    subtitle: 'Araca özel tanımlı parçalar ve ortak parçalar.',
    actions: can('parts', 'create') ? btn('Parça ekle', { size: 'sm', kind: 'primary', ic: 'plus', onClick: async () => { if (await openPartForm(null, { vehicle_id: vehicleId })) reload(); } }) : null,
  }));
}

// =====================================================================  MASRAFLAR
export async function openExpenseForm({ expense = null, vehicleId = null } = {}) {
  const all = scope('expenses') === 'all';
  const approver = can('expenses', 'approve');
  const res = await openForm({
    title: expense ? 'Masrafı düzenle' : 'Masraf gir',
    width: 640,
    intro: !approver ? h('div', { class: 'callout callout-orange' }, icon('info', 18), h('div', null, 'Girdiğiniz masraf finans onayına düşer.')) : null,
    fields: [
      { name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, options: vehicleOptions(), full: !all },
      all ? { name: 'driver_id', label: 'Şoför', type: 'select', numeric: true, options: driverOptions({ activeOnly: false }) } : null,
      { name: 'category', label: 'Kategori', type: 'select', required: true, options: Object.entries(C().expense_categories) },
      { name: 'amount', label: 'Tutar (₺)', type: 'number', min: 0.01, required: true },
      { name: 'date', label: 'Tarih', type: 'date', required: true, max: todayStr() },
      { name: 'liters', label: 'Litre', type: 'number', min: 0, show: (d) => d.category === 'fuel' },
      { name: 'km', label: 'Gösterge km', type: 'number', min: 0, step: 1, show: (d) => d.category === 'fuel' },
      { name: 'invoice_no', label: 'Fatura / fiş no', maxlength: 100 },
      { name: 'description', label: 'Açıklama', maxlength: 1000, full: true },
      { name: 'file_id', label: 'Fiş / fatura', type: 'file', full: true },
    ].filter(Boolean),
    values: expense ? { ...expense } : { vehicle_id: vehicleId, date: todayStr(), category: 'fuel', driver_id: all ? null : state.me.id },
    onSubmit: (v) => (expense ? api.put(`/expenses/${expense.id}`, v) : api.post('/expenses', v)),
  });
  if (res) {
    toast(res.status === 'pending' ? 'Masraf kaydedildi; onay bekliyor' : 'Masraf kaydedildi');
    emit('changed');
  }
  return res;
}

async function decideExpense(e, action) {
  if (action === 'reject') {
    const reason = await confirmDialog({ title: 'Masraf reddedilsin mi?', message: `${e.plate || ''} · ${C().expense_categories[e.category]} · ${fmtMoney(e.amount)}`, confirmLabel: 'Reddet', danger: true, input: { label: 'Ret gerekçesi', required: true } });
    if (!reason) return false;
    await api.post(`/expenses/${e.id}/reject`, { reason });
    toast('Masraf reddedildi');
  } else {
    await api.post(`/expenses/${e.id}/approve`, {});
    toast('Masraf onaylandı');
  }
  emit('changed');
  return true;
}

function expensesTable(rows, { reload, hideVehicle } = {}) {
  const approver = can('expenses', 'approve');
  const me = state.me;
  const canEdit = (r) => r.source === 'manual' && (can('expenses', 'update') || (r.created_by === me.id && r.status === 'pending'));
  const canDel = (r) => r.source === 'manual' && (can('expenses', 'delete') || (r.created_by === me.id && r.status === 'pending'));
  return dataTable({
    rows,
    csvName: 'masraflar',
    searchPlaceholder: 'Plaka, şoför, açıklama, fatura…',
    filters: [
      hideVehicle ? null : vehicleFilter(),
      { key: 'status', label: 'Onay', options: Object.entries(EXP_STATUS) },
      { key: 'category', label: 'Kategori', options: Object.entries(C().expense_categories) },
      { key: 'source', label: 'Kaynak', options: Object.entries(SOURCE) },
    ].filter(Boolean),
    selectable: approver ? (r) => r.status === 'pending' : null,
    bulkActions: approver ? (ids, done) => [
      btn('Seçilenleri onayla', { size: 'sm', kind: 'primary', ic: 'check', onClick: async () => { const r = await api.post('/expenses/approve-bulk', { ids, action: 'approve' }); toast(`${r.count} masraf onaylandı`); done(); emit('changed'); reload(); } }),
      btn('Seçilenleri reddet', { size: 'sm', kind: 'danger', onClick: async () => {
        const reason = await confirmDialog({ title: `${ids.length} masraf reddedilsin mi?`, confirmLabel: 'Reddet', danger: true, input: { label: 'Ret gerekçesi', required: true } });
        if (!reason) return;
        const r = await api.post('/expenses/approve-bulk', { ids, action: 'reject', reason });
        toast(`${r.count} masraf reddedildi`);
        done();
        emit('changed');
        reload();
      } }),
    ] : null,
    rowClass: (r) => (r.status === 'pending' ? 'row-pending' : r.status === 'rejected' ? 'row-muted' : ''),
    empty: 'Masraf kaydı yok',
    emptyIcon: 'money',
    columns: [
      { key: 'date', label: 'Tarih', text: (r) => fmtDate(r.date), sortValue: (r) => r.date, nowrap: true, defaultDir: 'desc' },
      hideVehicle ? null : { key: 'plate', label: 'Araç', render: vehicleCell },
      { key: 'category', label: 'Kategori', render: (r) => h('div', { class: 'cell-2' }, h('span', null, C().expense_categories[r.category]), r.source !== 'manual' ? h('span', { class: 'muted small' }, `Otomatik · ${SOURCE[r.source]}`) : null), text: (r) => C().expense_categories[r.category] },
      { key: 'description', label: 'Açıklama', render: (r) => h('div', { class: 'cell-2' }, h('span', null, cut(r.description, 60) || '—'), h('span', { class: 'muted small' }, [r.driver_name, r.invoice_no, r.liters ? `${fmtNum(r.liters, 1)} L` : null].filter(Boolean).join(' · '))), text: (r) => [r.description, r.driver_name, r.invoice_no].filter(Boolean).join(' ') },
      { key: 'amount', label: 'Tutar', align: 'right', text: (r) => (r.amount != null ? fmtMoney(r.amount) : '—'), csv: (r) => r.amount ?? '' },
      { key: 'status', label: 'Onay', render: (r) => h('span', { title: r.reject_reason || (r.approved_by_name ? `${r.approved_by_name} · ${fmtDateTime(r.approved_at)}` : '') }, badge(EXP_STATUS[r.status], EXP_TONE[r.status])), text: (r) => EXP_STATUS[r.status] + (r.reject_reason ? ': ' + r.reject_reason : '') },
      { key: 'file', label: 'Fiş', sortable: false, render: (r) => fileLink(r.file_id, r.file_name), text: (r) => r.file_name || '', hideSm: true },
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          approver && r.status === 'pending' ? btn('Onayla', { size: 'sm', kind: 'primary', onClick: async () => { if (await decideExpense(r, 'approve')) reload(); } }) : null,
          approver && r.status === 'pending' ? btn('Reddet', { size: 'sm', onClick: async () => { if (await decideExpense(r, 'reject')) reload(); } }) : null,
          canEdit(r) ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Düzenle', onClick: async () => { if (await openExpenseForm({ expense: r })) reload(); } }) : null,
          canDel(r) ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
            if (!(await confirmDialog({ title: 'Masraf silinsin mi?', confirmLabel: 'Sil', danger: true }))) return;
            await api.del(`/expenses/${r.id}`);
            toast('Masraf silindi');
            emit('changed');
            reload();
          } }) : null),
      },
    ],
  });
}

export async function expensesPage(main, { query }) {
  const rows = await api.get('/expenses');
  clear(main);
  const summary = h('div', { class: 'stats' });
  const renderSummary = (list) => {
    clear(summary);
    if (!costs() && scope('expenses') === 'all') return;
    const month = todayStr().slice(0, 7);
    const approvedMonth = list.filter((e) => e.status === 'approved' && e.date.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
    const pending = list.filter((e) => e.status === 'pending');
    summary.append(
      stat('Bu ay onaylı', fmtMoney(approvedMonth), { ic: 'money' }),
      stat('Onay bekleyen', fmtNum(pending.length), { tone: pending.length ? 'orange' : 'gray', ic: 'info', sub: pending.length ? fmtMoney(pending.reduce((s, e) => s + (e.amount || 0), 0)) : null }),
      stat('Bu ay yakıt', fmtMoney(list.filter((e) => e.status === 'approved' && e.category === 'fuel' && e.date.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0)), { ic: 'fuel' }));
  };
  const reload = async () => {
    const fresh = await api.get('/expenses');
    table.update(fresh);
    renderSummary(fresh);
  };
  renderSummary(rows);
  const table = expensesTable(rows, { reload });
  main.append(h('div', { class: 'page' },
    pageHeader('Masraflar', can('expenses', 'approve') ? 'Tüm masraflar. Şoför girişleri onayınızı bekler; belge, bakım ve lastik masrafları otomatik oluşur.' : 'Girdiğiniz masraflar ve onay durumları.', [
      can('expenses', 'create') ? btn('Masraf gir', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openExpenseForm()) reload(); } }) : null,
    ]),
    summary,
    card(null, table)));
  if (query.get('status')) {
    const sel = table.querySelector('select[aria-label=Onay]');
    if (sel) {
      sel.value = query.get('status');
      sel.dispatchEvent(new Event('change'));
    }
  }
}

export async function expensesSection(body, { vehicleId }) {
  const load = () => api.get('/expenses' + qs({ vehicle_id: vehicleId }));
  const rows = await load();
  const reload = async () => table.update(await load());
  const table = expensesTable(rows, { reload, hideVehicle: true });
  body.append(card('Masraflar', table, { actions: can('expenses', 'create') ? btn('Masraf gir', { size: 'sm', kind: 'primary', ic: 'plus', onClick: async () => { if (await openExpenseForm({ vehicleId })) reload(); } }) : null }));
}

// =====================================================================  ARIZALAR
export async function openIssueForm({ vehicle_id = null } = {}) {
  await loadLookups();
  const res = await openForm({
    title: 'Arıza / hasar bildir',
    width: 600,
    intro: h('div', { class: 'callout callout-blue' }, icon('info', 18), h('div', null, 'Kritik önemdeki açık arıza, aracı garajda "Arızalı" olarak işaretler ve çıkışı engeller.')),
    fields: [
      { name: 'vehicle_id', label: 'Araç', type: 'select', numeric: true, required: true, options: vehicleOptions(), disabled: !!vehicle_id, full: true },
      { name: 'severity', label: 'Önem derecesi', type: 'select', required: true, options: Object.entries(C().severities) },
      { name: 'km', label: 'Km', type: 'number', min: 0, step: 1 },
      { name: 'title', label: 'Kısa başlık', required: true, maxlength: 200, full: true, placeholder: 'Ör. Sol ön lastik patladı, fren sesi' },
      { name: 'description', label: 'Açıklama', type: 'textarea', full: true, rows: 4 },
      { name: 'file_id', label: 'Fotoğraf', type: 'file', accept: 'image/*,application/pdf', capture: 'environment', full: true },
    ],
    values: { vehicle_id, severity: 'medium' },
    submitLabel: 'Bildir',
    onSubmit: (v) => api.post('/issues', { ...v, vehicle_id: v.vehicle_id ?? vehicle_id }),
  });
  if (res) {
    toast('Arıza bildirildi');
    emit('changed');
    await loadLookups();
  }
  return res;
}

async function openIssueUpdate(i) {
  const res = await openForm({
    title: 'Arıza durumunu güncelle',
    subtitle: `${i.plate} · ${i.title}`,
    width: 560,
    fields: [
      { name: 'status', label: 'Durum', type: 'select', required: true, options: Object.entries(ISSUE_STATUS) },
      { name: 'severity', label: 'Önem', type: 'select', required: true, options: Object.entries(C().severities) },
      { name: 'resolution', label: 'Çözüm / açıklama', type: 'textarea', full: true, rows: 3 },
    ],
    values: i,
    onSubmit: (v) => api.put(`/issues/${i.id}`, v),
  });
  if (res) {
    toast('Arıza güncellendi');
    emit('changed');
  }
  return res;
}

function issuesTable(rows, { reload, hideVehicle } = {}) {
  return dataTable({
    rows,
    csvName: 'arizalar',
    searchPlaceholder: 'Plaka, başlık, bildiren…',
    filters: [
      hideVehicle ? null : vehicleFilter(),
      { key: 'status', label: 'Durum', options: [['active', 'Açık + işlemde'], ...Object.entries(ISSUE_STATUS)], value: 'active', match: (r, v) => (v === 'active' ? ['open', 'in_progress'].includes(r.status) : r.status === v) },
      { key: 'severity', label: 'Önem', options: Object.entries(C().severities) },
    ].filter(Boolean),
    empty: 'Arıza bildirimi yok',
    emptyIcon: 'warning',
    columns: [
      { key: 'created_at', label: 'Tarih', text: (r) => fmtDateTime(r.created_at), sortValue: (r) => r.created_at, nowrap: true, defaultDir: 'desc' },
      hideVehicle ? null : { key: 'plate', label: 'Araç', render: vehicleCell },
      { key: 'title', label: 'Arıza', render: (r) => h('div', { class: 'cell-2' }, h('strong', null, r.title), h('span', { class: 'muted small' }, cut(r.description, 90))), text: (r) => `${r.title} ${r.description || ''}` },
      { key: 'severity', label: 'Önem', render: (r) => badge(C().severities[r.severity], SEV_TONE[r.severity]), text: (r) => C().severities[r.severity], sortValue: (r) => ({ critical: 0, high: 1, medium: 2, low: 3 })[r.severity] },
      { key: 'status', label: 'Durum', render: (r) => h('div', { class: 'cell-2' }, badge(ISSUE_STATUS[r.status], ISSUE_TONE[r.status]), r.maintenance_id ? h('span', { class: 'muted small' }, `Bakım #${r.maintenance_id}`) : null), text: (r) => ISSUE_STATUS[r.status] },
      { key: 'reporter_name', label: 'Bildiren', text: (r) => r.reporter_name || '—', hideSm: true },
      { key: 'file', label: 'Foto', sortable: false, render: (r) => (r.file_id ? (r.file_mime?.startsWith('image/') ? h('a', { href: `/api/uploads/${r.file_id}`, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, h('img', { class: 'thumb', src: `/api/uploads/${r.file_id}`, alt: 'Arıza fotoğrafı', loading: 'lazy' })) : fileLink(r.file_id, r.file_name)) : '—'), text: (r) => r.file_name || '' },
      {
        key: 'actions', label: '', sortable: false, csv: false, align: 'right',
        render: (r) => h('div', { class: 'row-actions' },
          can('maintenance', 'create') && can('issues', 'update') && !r.maintenance_id && ['open', 'in_progress'].includes(r.status) ? btn('Bakıma dönüştür', { size: 'sm', ic: 'wrench', onClick: async () => {
            const m = await api.post(`/issues/${r.id}/convert`, {});
            toast('Planlı onarım kaydı oluşturuldu; bakım tamamlandığında arıza otomatik kapanır');
            emit('changed');
            await openMaintForm({ record: m, status: 'done' });
            reload();
          } }) : null,
          can('issues', 'update') ? btn('', { size: 'sm', kind: 'ghost', ic: 'edit', title: 'Durum güncelle', onClick: async () => { if (await openIssueUpdate(r)) reload(); } }) : null,
          can('issues', 'delete') ? btn('', { size: 'sm', kind: 'ghost', ic: 'trash', title: 'Sil', onClick: async () => {
            if (!(await confirmDialog({ title: 'Arıza kaydı silinsin mi?', confirmLabel: 'Sil', danger: true }))) return;
            await api.del(`/issues/${r.id}`);
            toast('Arıza silindi');
            emit('changed');
            reload();
          } }) : null),
      },
    ],
  });
}

export async function issuesPage(main, { query }) {
  const load = () => (scope('issues') ? api.get('/issues') : Promise.resolve([]));
  const rows = await load();
  clear(main);
  const reload = async () => table.update(await load());
  const table = issuesTable(rows, { reload });
  main.append(h('div', { class: 'page' },
    pageHeader('Arıza / Hasar', scope('issues') === 'own' ? 'Bildirdiğiniz arızalar ve durumları.' : 'Şoförlerin bildirdiği arıza ve hasarlar. Tek tıkla bakım kaydına dönüştürülebilir.', [
      can('issues', 'create') ? btn('Arıza bildir', { kind: 'primary', ic: 'plus', onClick: async () => { if (await openIssueForm()) reload(); } }) : null,
    ]),
    scope('issues') ? card(null, table) : emptyState('warning', 'Bildirim yapabilirsiniz', 'Arıza listesini görüntüleme yetkiniz yok; ancak yeni arıza bildirebilirsiniz.')));
  const id = Number(query.get('id'));
  if (id) {
    const it = rows.find((r) => r.id === id);
    if (it) {
      const sel = table.querySelector('select[aria-label=Durum]');
      if (sel) {
        sel.value = '';
        sel.dispatchEvent(new Event('change'));
      }
      const s = table.querySelector('input[type=search]');
      if (s) {
        s.value = it.title;
        s.dispatchEvent(new Event('input'));
      }
    }
  }
}

export async function issuesSection(body, { vehicleId }) {
  const load = () => api.get('/issues' + qs({ vehicle_id: vehicleId }));
  const rows = await load();
  const reload = async () => table.update(await load());
  const table = issuesTable(rows, { reload, hideVehicle: true });
  body.append(card('Arıza / hasar bildirimleri', table, { actions: can('issues', 'create') ? btn('Arıza bildir', { size: 'sm', kind: 'primary', ic: 'plus', onClick: async () => { if (await openIssueForm({ vehicle_id: vehicleId })) reload(); } }) : null }));
}

// =====================================================================  ŞOFÖRLER
function rangePicker(from, to, onChange) {
  const t = todayStr();
  const presets = [
    ['Bu ay', t.slice(0, 8) + '01', t],
    ['Bu yıl', t.slice(0, 5) + '01-01', t],
    ['Son 12 ay', `${Number(t.slice(0, 4)) - 1}${t.slice(4)}`, t],
    ['Tümü', '2000-01-01', t],
  ];
  const f = h('input', { class: 'input input-sm', type: 'date', value: from, 'aria-label': 'Başlangıç' });
  const e = h('input', { class: 'input input-sm', type: 'date', value: to, 'aria-label': 'Bitiş' });
  const fire = () => f.value && e.value && onChange(f.value, e.value);
  f.addEventListener('change', fire);
  e.addEventListener('change', fire);
  return h('div', { class: 'range' }, f, h('span', { class: 'muted' }, '–'), e,
    presets.map(([label, a, b]) => h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { f.value = a; e.value = b; fire(); } }, label)));
}

export async function driversPage(main, { query }) {
  const t = todayStr();
  let from = query.get('from') || t.slice(0, 5) + '01-01';
  let to = query.get('to') || t;
  const rep = await api.get('/reports/drivers' + qs({ from, to }));
  clear(main);
  const lic = (d) => (d == null ? badge('Girilmemiş', 'gray') : daysBadge(d));
  const table = dataTable({
    rows: rep.rows,
    csvName: 'sofor-kullanim',
    sort: { key: 'km', dir: 'desc' },
    onRowClick: (r) => (location.hash = `#/drivers/${r.id}`),
    filters: [{ key: 'active', label: 'Hesap', options: [['1', 'Aktif'], ['0', 'Pasif']], value: '1', match: (r, v) => String(r.active) === v }],
    empty: 'Şoför yok',
    emptyIcon: 'user',
    columns: [
      { key: 'full_name', label: 'Şoför', render: (r) => h('div', { class: 'cell-2' }, h('strong', null, r.full_name), h('span', { class: 'muted small' }, `${r.username}${r.license_class ? ' · ' + r.license_class : ''}`)) },
      { key: 'trips', label: 'Sefer', align: 'right', text: (r) => fmtNum(r.trips) },
      { key: 'km', label: 'Toplam km', align: 'right', text: (r) => fmtNum(r.km), csv: (r) => r.km },
      { key: 'avg_km', label: 'Ort. sefer', align: 'right', text: (r) => fmtKm(r.avg_km), csv: (r) => r.avg_km, hideSm: true },
      { key: 'vehicles', label: 'Araç', align: 'right', text: (r) => fmtNum(r.vehicles), hideSm: true },
      { key: 'open_trips', label: 'Açık', align: 'right', render: (r) => (r.open_trips ? badge('Seferde', 'blue') : '—'), text: (r) => String(r.open_trips) },
      { key: 'license_days_left', label: 'Ehliyet', render: (r) => lic(r.license_days_left), text: (r) => r.license_expiry || '', sortValue: (r) => r.license_days_left ?? 99999 },
      { key: 'src_days_left', label: 'SRC', render: (r) => (r.src_expiry ? lic(r.src_days_left) : '—'), text: (r) => r.src_expiry || '', sortValue: (r) => r.src_days_left ?? 99999, hideSm: true },
      costs() ? { key: 'expense_total', label: 'Masraf', align: 'right', text: (r) => fmtMoney(r.expense_total), csv: (r) => r.expense_total } : null,
    ],
  });
  main.append(h('div', { class: 'page' },
    pageHeader('Şoför Kullanımı', 'Şoför bazında sefer sayısı, kat edilen km, kullanılan araçlar ve ehliyet/SRC durumu.', [
      rangePicker(from, to, (a, b) => { location.hash = `#/drivers${qs({ from: a, to: b })}`; }),
    ]),
    card(null, table)));
}

export async function driverDetailPage(main, { params, setTitle }) {
  const id = Number(params[0]);
  const d = await api.get(`/reports/drivers/${id}`);
  const u = d.user;
  setTitle(u.full_name);
  clear(main);
  const trips = dataTable({
    rows: d.trips,
    csvName: `seferler-${u.username}`,
    columns: [
      { key: 'plate', label: 'Araç', render: vehicleCell },
      { key: 'start_at', label: 'Çıkış', text: (r) => fmtDateTime(r.start_at), sortValue: (r) => r.start_at, defaultDir: 'desc' },
      { key: 'end_at', label: 'Dönüş', render: (r) => (r.end_at ? fmtDateTime(r.end_at) : badge('Seferde', 'blue')), text: (r) => fmtDateTime(r.end_at), sortValue: (r) => r.end_at || '9999' },
      { key: 'start_km', label: 'Çıkış km', align: 'right', text: (r) => fmtNum(r.start_km) },
      { key: 'end_km', label: 'Dönüş km', align: 'right', text: (r) => fmtNum(r.end_km) },
      { key: 'distance', label: 'Mesafe', align: 'right', text: (r) => (r.distance != null ? fmtKm(r.distance) : '—') },
      { key: 'destination', label: 'Yer / Amaç', text: (r) => [r.destination, r.purpose].filter(Boolean).join(' – ') || '—', hideSm: true },
    ],
  });
  main.append(h('div', { class: 'page' },
    scope('drivers') === 'all' ? h('a', { href: '#/drivers', class: 'back-link' }, icon('back', 16), 'Şoförler') : null,
    pageHeader(u.full_name, `${u.username} · ${C().roles[u.role]}${u.department ? ' · ' + u.department : ''}${u.active ? '' : ' · Pasif'}`),
    h('div', { class: 'stats' },
      stat('Sefer', fmtNum(d.stats.trips), { ic: 'key', sub: d.stats.open_trips ? `${d.stats.open_trips} açık` : null }),
      stat('Toplam km', fmtNum(d.stats.km), { ic: 'car' }),
      stat('Ort. sefer', fmtKm(d.stats.avg_km), { ic: 'chart' }),
      stat('Ehliyet', u.license_expiry ? fmtDate(u.license_expiry) : 'Girilmemiş', { tone: u.license_days_left == null ? 'gray' : u.license_days_left < 0 ? 'red' : u.license_days_left <= 30 ? 'orange' : 'green', ic: 'user', sub: u.license_class || null }),
      u.src_expiry ? stat('SRC', fmtDate(u.src_expiry), { tone: u.src_days_left < 0 ? 'red' : u.src_days_left <= 30 ? 'orange' : 'green', ic: 'doc' }) : null),
    h('div', { class: 'detail-grid' },
      card('Kullandığı araçlar', d.vehicles.length ? barList(d.vehicles.map((v) => ({ label: v.plate, value: v.km, sub: `${v.trips} sefer` })), { format: (n) => fmtKm(n) }) : emptyState('car', 'Henüz sefer yok')),
      d.expenses.length ? card('Masraflar (onaylı)', barList(d.expenses.map((x) => ({ label: x.category_name, value: x.amount, sub: `${x.count} kayıt` })), { format: fmtMoney })) : null),
    card('Sefer geçmişi', trips)));
}

// =====================================================================  UYARILAR
export async function alertsPage(main) {
  let data = await api.get('/alerts');
  clear(main);
  let level = '';
  let category = '';
  let onlyUnread = false;
  const list = h('div', { class: 'alert-page-list' });
  const filterBar = h('div', { class: 'chips' });
  const reload = async () => {
    data = await api.get('/alerts');
    render();
    emit('changed');
  };
  const markRead = async (keys, unread = false) => {
    await api.post('/alerts/read', { keys, unread });
    await reload();
  };
  function render() {
    clear(filterBar);
    const c = data.counts;
    for (const [k, l] of [['', `Tümü (${c.total})`], ['critical', `Kritik (${c.critical})`], ['warning', `Uyarı (${c.warning})`], ['info', `Bilgi (${c.info})`]]) {
      filterBar.append(h('button', { type: 'button', class: `chip ${level === k ? 'active' : ''} ${k ? 'chip-' + LEVEL_TONE[k] : ''}`, onclick: () => { level = k; render(); } }, k ? h('span', { class: `dot dot-${LEVEL_TONE[k]}` }) : null, l));
    }
    const cats = [...new Set(data.alerts.map((a) => a.category))];
    const catSel = h('select', { class: 'input input-sm', onchange: (e) => { category = e.target.value; render(); } }, h('option', { value: '' }, 'Tüm kategoriler'), cats.map((x) => h('option', { value: x }, x)));
    catSel.value = category;
    filterBar.append(catSel, h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: onlyUnread, onchange: (e) => { onlyUnread = e.target.checked; render(); } }), h('span', null, 'Yalnızca okunmamış')));

    clear(list);
    const items = data.alerts.filter((a) => (!level || a.level === level) && (!category || a.category === category) && (!onlyUnread || !a.read));
    if (!items.length) {
      list.append(emptyState('check', data.alerts.length ? 'Bu filtrede uyarı yok' : 'Aktif uyarı yok', 'Uyarılar veriler değiştikçe otomatik hesaplanır.'));
      return;
    }
    for (const a of items) {
      list.append(h('div', { class: `alert-row lvl-${a.level} ${a.read ? 'read' : ''}` },
        h('span', { class: `dot dot-${LEVEL_TONE[a.level]}` }),
        h('div', { class: 'alert-row-main' },
          h('div', { class: 'alert-row-title' }, a.link ? h('a', { href: a.link, onclick: () => { if (!a.read) api.post('/alerts/read', { keys: [a.key] }).then(() => emit('changed')); } }, a.title) : a.title),
          h('div', { class: 'muted small' }, a.message)),
        h('div', { class: 'alert-row-meta' }, levelBadge(a.level), h('span', { class: 'muted small' }, a.category)),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: a.read ? 'Okunmadı yap' : 'Okundu say', onclick: () => markRead([a.key], a.read) }, a.read ? 'Okunmadı' : 'Okundu')));
    }
  }
  render();
  main.append(h('div', { class: 'page' },
    pageHeader('Uyarılar', 'Belge, bakım, lastik, stok, sefer ve arıza kurallarından otomatik üretilen uyarılar. Veri düzeldiğinde uyarı kendiliğinden kaybolur.', [
      btn('Tümünü okundu say', { ic: 'check', onClick: async () => { await api.post('/alerts/read', { all: true }); await reload(); } }),
    ]),
    card(null, [filterBar, list])));
}

// =====================================================================  RAPORLAR
export async function reportsPage(main, { query }) {
  const t = todayStr();
  const from = query.get('from') || t.slice(0, 5) + '01-01';
  const to = query.get('to') || t;
  const tabList = [
    costs() ? { key: 'costs', label: 'Maliyet' } : null,
    scope('drivers') ? { key: 'drivers', label: 'Şoför kullanımı' } : null,
    { key: 'fuel', label: 'Yakıt tüketimi' },
    { key: 'exports', label: 'Dışa aktarım' },
  ].filter(Boolean);
  const tab = tabList.some((x) => x.key === query.get('tab')) ? query.get('tab') : tabList[0].key;
  const go = (p) => (location.hash = `#/reports${qs({ tab, from, to, ...p })}`);
  clear(main);
  const body = h('div');
  const exportBtn = (name) => h('a', { class: 'btn btn-sm', href: `/api/reports/export/${name}${qs({ from, to })}`, download: true }, icon('download', 15), 'CSV indir');
  main.append(h('div', { class: 'page' },
    pageHeader('Raporlar', `${fmtDate(from)} – ${fmtDate(to)} dönemi`, [rangePicker(from, to, (a, b) => go({ from: a, to: b }))]),
    tabs(tabList, tab, (k) => go({ tab: k })),
    body));
  body.append(loading());

  if (tab === 'costs') {
    const r = await api.get('/reports/costs' + qs({ from, to }));
    clear(body);
    body.append(
      h('div', { class: 'stats' },
        stat('Toplam onaylı masraf', fmtMoney(r.total), { ic: 'money' }),
        stat('Araç sayısı', fmtNum(r.by_vehicle.filter((x) => x.vehicle_id).length), { ic: 'car' }),
        stat('Kategori', fmtNum(r.by_category.length), { ic: 'list' })),
      h('div', { class: 'detail-grid' },
        card('Kategoriye göre', r.by_category.length ? barList(r.by_category.map((x) => ({ label: x.category_name, value: x.amount, sub: `${x.count}` })), { format: fmtMoney }) : emptyState('money', 'Bu dönemde masraf yok')),
        card('Aylara göre', r.by_month.length ? barList(r.by_month.map((x) => ({ label: x.month.split('-').reverse().join('.'), value: x.amount })), { format: fmtMoney, tone: 'blue' }) : emptyState('chart', 'Veri yok'))),
      card('Araca göre maliyet', dataTable({
        rows: r.by_vehicle,
        csvName: 'maliyet-arac',
        sort: { key: 'amount', dir: 'desc' },
        actions: exportBtn('costs'),
        columns: [
          { key: 'plate', label: 'Araç', render: (x) => (x.vehicle_id ? vehicleCell(x) : x.plate) },
          { key: 'fuel', label: 'Yakıt', align: 'right', text: (x) => fmtMoney(x.fuel), csv: (x) => x.fuel },
          { key: 'service', label: 'Bakım / Parça / Lastik', align: 'right', text: (x) => fmtMoney(x.service), csv: (x) => x.service },
          { key: 'insurance', label: 'Sigorta / Muayene', align: 'right', text: (x) => fmtMoney(x.insurance), csv: (x) => x.insurance, hideSm: true },
          { key: 'other', label: 'Diğer', align: 'right', text: (x) => fmtMoney(x.other), csv: (x) => x.other, hideSm: true },
          { key: 'amount', label: 'Toplam', align: 'right', render: (x) => h('strong', null, fmtMoney(x.amount)), text: (x) => fmtMoney(x.amount), csv: (x) => x.amount },
          { key: 'km', label: 'Km', align: 'right', text: (x) => fmtNum(x.km), csv: (x) => x.km },
          { key: 'cost_per_km', label: '₺/km', align: 'right', text: (x) => (x.cost_per_km != null ? fmtNum(x.cost_per_km, 2) : '—'), csv: (x) => x.cost_per_km ?? '' },
        ],
      })));
  } else if (tab === 'drivers') {
    const r = await api.get('/reports/drivers' + qs({ from, to }));
    clear(body);
    const active = r.rows.filter((x) => x.trips > 0);
    body.append(
      h('div', { class: 'detail-grid' },
        card('Km sıralaması', active.length ? barList([...active].sort((a, b) => b.km - a.km).slice(0, 12).map((x) => ({ label: x.full_name, value: x.km, sub: `${x.trips} sefer` })), { format: fmtKm }) : emptyState('user', 'Bu dönemde sefer yok')),
        card('Sefer sayısı', active.length ? barList([...active].sort((a, b) => b.trips - a.trips).slice(0, 12).map((x) => ({ label: x.full_name, value: x.trips })), { tone: 'blue' }) : emptyState('key', 'Veri yok'))),
      card('Şoför kullanım tablosu', dataTable({
        rows: r.rows,
        csvName: 'sofor-raporu',
        sort: { key: 'km', dir: 'desc' },
        actions: exportBtn('drivers'),
        onRowClick: (x) => (location.hash = `#/drivers/${x.id}`),
        columns: [
          { key: 'full_name', label: 'Şoför' },
          { key: 'trips', label: 'Sefer', align: 'right', text: (x) => fmtNum(x.trips) },
          { key: 'km', label: 'Km', align: 'right', text: (x) => fmtNum(x.km), csv: (x) => x.km },
          { key: 'avg_km', label: 'Ort. km', align: 'right', text: (x) => fmtNum(x.avg_km), csv: (x) => x.avg_km },
          { key: 'vehicles', label: 'Araç', align: 'right', text: (x) => fmtNum(x.vehicles) },
          costs() ? { key: 'expense_total', label: 'Masraf', align: 'right', text: (x) => fmtMoney(x.expense_total), csv: (x) => x.expense_total } : null,
          { key: 'license_expiry', label: 'Ehliyet bitiş', text: (x) => fmtDate(x.license_expiry), sortValue: (x) => x.license_expiry },
        ],
      })));
  } else if (tab === 'fuel') {
    const r = await api.get('/reports/fuel' + qs({ from, to }));
    clear(body);
    body.append(
      h('div', { class: 'stats' },
        stat('Filo ortalaması', r.fleet_avg_l_per_100km != null ? `${fmtNum(r.fleet_avg_l_per_100km, 1)} L/100km` : '—', { ic: 'fuel' }),
        stat('Toplam yakıt', `${fmtNum(r.rows.reduce((s, x) => s + x.liters, 0), 0)} L`, { ic: 'fuel' }),
        stat('Toplam km', fmtNum(r.rows.reduce((s, x) => s + x.km, 0)), { ic: 'car' })),
      h('p', { class: 'muted small' }, 'Tüketim; dönem içindeki sefer km toplamı ile yakıt masraflarındaki ve dönüş kayıtlarındaki litre toplamından hesaplanır. Sapma, filo ortalamasına göre yüzdedir.'),
      card('Araç bazlı yakıt tüketimi', dataTable({
        rows: r.rows,
        csvName: 'yakit-tuketimi',
        sort: { key: 'l_per_100km', dir: 'desc' },
        actions: exportBtn('fuel'),
        empty: 'Bu dönemde yakıt veya sefer verisi yok',
        columns: [
          { key: 'plate', label: 'Araç', render: (x) => h('a', { href: `#/vehicles/${x.id}`, class: 'link-strong' }, x.plate) },
          { key: 'type_name', label: 'Tür', hideSm: true },
          { key: 'km', label: 'Km', align: 'right', text: (x) => fmtNum(x.km), csv: (x) => x.km },
          { key: 'liters', label: 'Litre', align: 'right', text: (x) => fmtNum(x.liters, 1), csv: (x) => x.liters },
          { key: 'l_per_100km', label: 'L/100 km', align: 'right', render: (x) => (x.l_per_100km != null ? h('strong', null, fmtNum(x.l_per_100km, 1)) : '—'), text: (x) => (x.l_per_100km != null ? fmtNum(x.l_per_100km, 1) : ''), csv: (x) => x.l_per_100km ?? '' },
          { key: 'deviation', label: 'Sapma', align: 'right', render: (x) => (x.deviation != null ? badge(`${x.deviation > 0 ? '+' : ''}${fmtNum(x.deviation, 0)}%`, x.deviation > 20 ? 'red' : x.deviation > 10 ? 'orange' : x.deviation < -10 ? 'blue' : 'gray') : '—'), text: (x) => (x.deviation != null ? String(x.deviation) : '') },
          costs() ? { key: 'amount', label: 'Tutar', align: 'right', text: (x) => fmtMoney(x.amount), csv: (x) => x.amount } : null,
          costs() ? { key: 'cost_per_km', label: '₺/km', align: 'right', text: (x) => (x.cost_per_km != null ? fmtNum(x.cost_per_km, 2) : '—'), hideSm: true } : null,
        ],
      })));
  } else {
    clear(body);
    const items = [
      costs() ? ['costs', 'Maliyet raporu', 'Araç bazında kategori toplamları, km ve ₺/km'] : null,
      scope('drivers') ? ['drivers', 'Şoför kullanım raporu', 'Sefer, km, araç sayısı, ehliyet bitişleri'] : null,
      ['fuel', 'Yakıt tüketimi', 'Araç bazında L/100 km ve filo sapması'],
      scope('trips') ? ['trips', 'Sefer listesi', 'Tüm çıkış/dönüş kayıtları'] : null,
      scope('expenses') ? ['expenses', 'Masraf listesi', 'Tüm masraf kayıtları ve onay durumları'] : null,
    ].filter(Boolean);
    body.append(card('CSV dışa aktarım', h('ul', { class: 'export-list' }, items.map(([k, title, desc]) => h('li', null,
      h('div', null, h('strong', null, title), h('div', { class: 'muted small' }, desc)), exportBtn(k)))), { subtitle: 'Dosyalar Excel ile uyumludur (UTF-8, noktalı virgül ayraçlı). Seçili tarih aralığı uygulanır.' }));
  }
}
