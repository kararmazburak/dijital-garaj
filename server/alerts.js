// Kural motoru: tüm uyarılar mevcut veriden hesaplanır (saklanmaz).
import { all, get, getSettings } from './db.js';
import { today, daysBetween, addMonths, dotToDate, localDate, trDate } from './util.js';
import { can, readScope } from './perms.js';

export const LEVELS = { info: 1, warning: 2, critical: 3 };

/** Aracın bakım döngüsü durumu. */
export function maintenanceStatus(v, s = getSettings(), t = today()) {
  const intervalKm = v.maint_interval_km ?? s.maint_default_km ?? null;
  const intervalMonths = v.maint_interval_months ?? s.maint_default_months ?? null;
  const last = get(
    `SELECT * FROM maintenance WHERE vehicle_id = ? AND status = 'done' AND kind = 'periodic'
      ORDER BY date DESC, km DESC, id DESC LIMIT 1`,
    v.id,
  );
  const anyRecord = get(`SELECT COUNT(*) AS n FROM maintenance WHERE vehicle_id = ? AND status = 'done'`, v.id).n > 0;
  const st = { interval_km: intervalKm || null, interval_months: intervalMonths || null, last: last || null, any_record: anyRecord, next_km: null, next_date: null, km_left: null, days_left: null, level: null };
  if (!last) return st;
  st.next_km = last.next_km ?? (intervalKm && last.km != null ? last.km + intervalKm : null);
  st.next_date = last.next_date ?? (intervalMonths && last.date ? addMonths(last.date, intervalMonths) : null);
  if (st.next_km != null) st.km_left = st.next_km - v.current_km;
  if (st.next_date) st.days_left = daysBetween(t, st.next_date);
  if ((st.km_left != null && st.km_left <= 0) || (st.days_left != null && st.days_left < 0)) st.level = 'critical';
  else if ((st.km_left != null && st.km_left <= s.maint_warn_km) || (st.days_left != null && st.days_left <= s.maint_warn_days)) st.level = 'warning';
  return st;
}

export function isWinter(date, s = getSettings()) {
  const md = date.slice(5, 10);
  const start = s.winter_start || '11-01';
  const end = s.winter_end || '04-01';
  return start <= end ? md >= start && md < end : md >= start || md < end;
}

export function tireUsage(tire, vehicleKm) {
  const running = tire.status === 'mounted' && tire.mounted_km != null && vehicleKm != null ? Math.max(0, vehicleKm - tire.mounted_km) : 0;
  return (tire.total_km || 0) + running;
}

export function computeAlerts() {
  const s = getSettings();
  const t = today();
  const out = [];
  const push = (a) => out.push({ date: null, vehicle_id: null, user_id: null, plate: null, ...a, key: `${a.key}:${a.level}` });

  // --- Belgeler ---
  const [w1, w2, w3] = (Array.isArray(s.doc_warn_days) ? s.doc_warn_days : [30, 15, 7]).map(Number);
  const docs = all(`
    SELECT d.id, d.vehicle_id, d.end_date, dt.name AS type_name, dt.warn_days, v.plate
      FROM documents d JOIN doc_types dt ON dt.id = d.doc_type_id JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.archived = 0 AND d.end_date IS NOT NULL AND v.status != 'passive'`);
  for (const d of docs) {
    const left = daysBetween(t, d.end_date);
    const first = d.warn_days || w1;
    let level = null;
    let stage = 0;
    if (left < 0) [level, stage] = ['critical', 4];
    else if (left <= w3) [level, stage] = ['critical', 3];
    else if (left <= w2) [level, stage] = ['warning', 2];
    else if (left <= first) [level, stage] = ['warning', 1];
    if (!level) continue;
    push({
      key: `doc:${d.id}:${stage}`,
      level,
      module: 'documents',
      category: 'Belge',
      vehicle_id: d.vehicle_id,
      plate: d.plate,
      title: `${d.plate} · ${d.type_name} ${left < 0 ? 'süresi doldu' : 'bitiyor'}`,
      message: left < 0 ? `${-left} gün önce sona erdi (${trDate(d.end_date)}).` : left === 0 ? `Bugün sona eriyor.` : `${left} gün kaldı (${trDate(d.end_date)}).`,
      date: d.end_date,
      link: `#/vehicles/${d.vehicle_id}?tab=documents`,
    });
  }

  // --- Zorunlu belge eksik ---
  const required = all(`SELECT id, name FROM doc_types WHERE required = 1 AND active = 1`);
  if (required.length) {
    const vehicles = all(`SELECT id, plate FROM vehicles WHERE status != 'passive'`);
    const have = new Set(all(`SELECT DISTINCT vehicle_id || ':' || doc_type_id AS k FROM documents WHERE archived = 0`).map((r) => r.k));
    for (const v of vehicles) {
      for (const dt of required) {
        if (have.has(`${v.id}:${dt.id}`)) continue;
        push({
          key: `docmissing:${v.id}:${dt.id}`,
          level: s.block_on_expired_docs ? 'critical' : 'warning',
          module: 'documents',
          category: 'Belge',
          vehicle_id: v.id,
          plate: v.plate,
          title: `${v.plate} · ${dt.name} kaydı yok`,
          message: 'Zorunlu belge sisteme girilmemiş.',
          link: `#/vehicles/${v.id}?tab=documents`,
        });
      }
    }
  }

  // --- Ehliyet / SRC ---
  const drivers = all(`SELECT id, full_name, license_expiry, src_expiry FROM users WHERE active = 1 AND (license_expiry IS NOT NULL OR src_expiry IS NOT NULL)`);
  for (const u of drivers) {
    for (const [field, label] of [['license_expiry', 'Ehliyet'], ['src_expiry', 'SRC belgesi']]) {
      if (!u[field]) continue;
      const left = daysBetween(t, u[field]);
      let level = null;
      if (left < 0) level = 'critical';
      else if (left <= s.license_warn_days) level = 'warning';
      if (!level) continue;
      push({
        key: `lic:${u.id}:${field}`,
        level,
        module: 'drivers',
        category: 'Şoför',
        user_id: u.id,
        title: `${u.full_name} · ${label} ${left < 0 ? 'süresi doldu' : 'bitiyor'}`,
        message: left < 0 ? `${-left} gün önce sona erdi (${trDate(u[field])}).` : `${left} gün kaldı (${trDate(u[field])}).`,
        date: u[field],
        link: `#/drivers/${u.id}`,
      });
    }
  }

  // --- Bakım döngüsü ---
  const activeVehicles = all(`SELECT * FROM vehicles WHERE status != 'passive'`);
  for (const v of activeVehicles) {
    const st = maintenanceStatus(v, s, t);
    if (!st.any_record) {
      push({
        key: `nomaint:${v.id}`,
        level: 'warning',
        module: 'maintenance',
        category: 'Bakım',
        vehicle_id: v.id,
        plate: v.plate,
        title: `${v.plate} · Bakım kaydı yok`,
        message: 'Bu araç için henüz hiç bakım kaydı girilmemiş; bakım döngüsü hesaplanamıyor.',
        link: `#/vehicles/${v.id}?tab=maintenance`,
      });
      continue;
    }
    if (!st.level) continue;
    const parts = [];
    if (st.km_left != null) parts.push(st.km_left <= 0 ? `${Math.abs(st.km_left).toLocaleString('tr-TR')} km gecikti` : `${st.km_left.toLocaleString('tr-TR')} km kaldı`);
    if (st.days_left != null) parts.push(st.days_left < 0 ? `${-st.days_left} gün gecikti` : `${st.days_left} gün kaldı`);
    push({
      key: `maint:${v.id}:${st.last.id}`,
      level: st.level,
      module: 'maintenance',
      category: 'Bakım',
      vehicle_id: v.id,
      plate: v.plate,
      title: `${v.plate} · Periyodik bakım ${st.level === 'critical' ? 'gecikti' : 'yaklaşıyor'}`,
      message: `Sonraki bakım: ${[st.next_km != null ? st.next_km.toLocaleString('tr-TR') + ' km' : null, trDate(st.next_date)].filter(Boolean).join(' / ')} — ${parts.join(', ')}.`,
      date: st.next_date,
      link: `#/vehicles/${v.id}?tab=maintenance`,
    });
  }

  // --- Planlı bakım ---
  for (const m of all(`SELECT m.*, v.plate, v.current_km FROM maintenance m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.status = 'planned' AND v.status != 'passive'`)) {
    const daysLeft = m.date ? daysBetween(t, m.date) : null;
    const kmLeft = m.km != null ? m.km - m.current_km : null;
    let level = null;
    if ((daysLeft != null && daysLeft < 0) || (kmLeft != null && kmLeft <= 0)) level = 'critical';
    else if ((daysLeft != null && daysLeft <= s.maint_warn_days) || (kmLeft != null && kmLeft <= s.maint_warn_km)) level = 'warning';
    if (!level) continue;
    push({
      key: `plan:${m.id}`,
      level,
      module: 'maintenance',
      category: 'Bakım',
      vehicle_id: m.vehicle_id,
      plate: m.plate,
      title: `${m.plate} · Planlı bakım ${level === 'critical' ? 'zamanı geçti' : 'yaklaşıyor'}`,
      message: [m.description || 'Planlı bakım', m.date ? `tarih ${trDate(m.date)}` : null, m.km != null ? `${m.km.toLocaleString('tr-TR')} km` : null].filter(Boolean).join(' · '),
      date: m.date,
      link: `#/vehicles/${m.vehicle_id}?tab=maintenance`,
    });
  }

  // --- Lastikler ---
  const tires = all(`SELECT tr.*, v.plate, v.current_km FROM tires tr JOIN vehicles v ON v.id = tr.vehicle_id WHERE tr.status = 'mounted' AND v.status != 'passive'`);
  const seasonByVehicle = new Map();
  for (const tr of tires) {
    const label = `${tr.plate} · ${tr.position || 'lastik'} (${[tr.brand, tr.size].filter(Boolean).join(' ') || '#' + tr.id})`;
    const base = { module: 'tires', category: 'Lastik', vehicle_id: tr.vehicle_id, plate: tr.plate, link: `#/vehicles/${tr.vehicle_id}?tab=tires` };
    const prod = dotToDate(tr.dot);
    if (prod) {
      const age = daysBetween(prod, t) / 365.25;
      if (age >= s.tire_max_age_years) push({ ...base, key: `tireage:${tr.id}`, level: 'critical', title: `${label} yaş sınırını aştı`, message: `DOT ${tr.dot}: yaklaşık ${age.toFixed(1)} yaşında (sınır ${s.tire_max_age_years} yıl).` });
      else if (age >= s.tire_max_age_years - 1) push({ ...base, key: `tireage:${tr.id}`, level: 'warning', title: `${label} yaş sınırına yaklaşıyor`, message: `DOT ${tr.dot}: yaklaşık ${age.toFixed(1)} yaşında (sınır ${s.tire_max_age_years} yıl).` });
    }
    if (tr.tread_depth != null) {
      if (tr.tread_depth <= s.tire_min_tread_mm) push({ ...base, key: `tiretread:${tr.id}`, level: 'critical', title: `${label} diş derinliği yetersiz`, message: `${tr.tread_depth} mm (asgari ${s.tire_min_tread_mm} mm).` });
      else if (tr.tread_depth <= s.tire_warn_tread_mm) push({ ...base, key: `tiretread:${tr.id}`, level: 'warning', title: `${label} diş derinliği azaldı`, message: `${tr.tread_depth} mm (uyarı eşiği ${s.tire_warn_tread_mm} mm).` });
    }
    const maxKm = tr.max_km || s.tire_default_max_km;
    if (maxKm) {
      const used = tireUsage(tr, tr.current_km);
      if (used >= maxKm) push({ ...base, key: `tirekm:${tr.id}`, level: 'critical', title: `${label} km sınırını aştı`, message: `${used.toLocaleString('tr-TR')} km kullanıldı (sınır ${maxKm.toLocaleString('tr-TR')} km).` });
      else if (used >= maxKm * 0.9) push({ ...base, key: `tirekm:${tr.id}`, level: 'warning', title: `${label} km sınırına yaklaşıyor`, message: `${used.toLocaleString('tr-TR')} km kullanıldı (sınır ${maxKm.toLocaleString('tr-TR')} km).` });
    }
    if (!seasonByVehicle.has(tr.vehicle_id)) seasonByVehicle.set(tr.vehicle_id, { plate: tr.plate, seasons: new Set() });
    seasonByVehicle.get(tr.vehicle_id).seasons.add(tr.season);
  }
  if (s.winter_check) {
    const winter = isWinter(t, s);
    for (const [vid, info] of seasonByVehicle) {
      if (winter && info.seasons.has('summer')) {
        push({ key: `season:${vid}:w`, level: 'warning', module: 'tires', category: 'Lastik', vehicle_id: vid, plate: info.plate, title: `${info.plate} · Kış döneminde yaz lastiği takılı`, message: `Kış lastiği dönemi (${s.winter_start.split('-').reverse().join('.')} – ${s.winter_end.split('-').reverse().join('.')}) içindeyiz.`, link: `#/vehicles/${vid}?tab=tires` });
      } else if (!winter && info.seasons.has('winter')) {
        push({ key: `season:${vid}:s`, level: 'info', module: 'tires', category: 'Lastik', vehicle_id: vid, plate: info.plate, title: `${info.plate} · Yaz döneminde kış lastiği takılı`, message: 'Mevsimsel lastik değişimi önerilir.', link: `#/vehicles/${vid}?tab=tires` });
      }
    }
  }

  // --- Stok ---
  for (const p of all(`SELECT id, code, name, stock, min_stock, unit FROM parts WHERE active = 1 AND min_stock > 0 AND stock < min_stock`)) {
    push({
      key: `stock:${p.id}`,
      level: p.stock <= 0 ? 'critical' : 'warning',
      module: 'parts',
      category: 'Stok',
      title: `${p.name} (${p.code}) stoğu ${p.stock <= 0 ? 'tükendi' : 'azaldı'}`,
      message: `Mevcut ${p.stock} ${p.unit}, asgari ${p.min_stock} ${p.unit}.`,
      link: `#/parts?id=${p.id}`,
    });
  }

  // --- Açık seferler / km boşluğu / uzun sefer ---
  const nowMs = Date.now();
  for (const tr of all(`SELECT t.*, v.plate, u.full_name FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = t.driver_id WHERE t.end_at IS NULL`)) {
    const hours = (nowMs - Date.parse(tr.start_at)) / 3600000;
    if (hours >= s.trip_open_warn_hours) {
      push({
        key: `opentrip:${tr.id}`,
        level: 'warning',
        module: 'trips',
        category: 'Sefer',
        vehicle_id: tr.vehicle_id,
        user_id: tr.driver_id,
        plate: tr.plate,
        title: `${tr.plate} · Sefer ${Math.floor(hours)} saattir kapanmadı`,
        message: `${tr.full_name} — çıkış ${trDate(localDate(tr.start_at))}. Dönüş kaydı unutulmuş olabilir.`,
        date: localDate(tr.start_at),
        link: `#/trips?id=${tr.id}`,
      });
    }
  }
  const since = new Date(nowMs - 60 * 86400000).toISOString();
  const recent = all(`SELECT t.*, v.plate FROM trips t JOIN vehicles v ON v.id = t.vehicle_id ORDER BY t.vehicle_id, t.start_at, t.id`);
  let prev = null;
  for (const tr of recent) {
    if (prev && prev.vehicle_id === tr.vehicle_id && prev.end_km != null && tr.start_at >= since) {
      const gap = tr.start_km - prev.end_km;
      if (gap > s.km_gap_threshold) {
        push({
          key: `kmgap:${tr.id}`,
          level: 'warning',
          module: 'trips',
          category: 'Sefer',
          vehicle_id: tr.vehicle_id,
          plate: tr.plate,
          title: `${tr.plate} · Kayıt dışı ${gap.toLocaleString('tr-TR')} km`,
          message: `Önceki dönüş ${prev.end_km.toLocaleString('tr-TR')} km, sonraki çıkış ${tr.start_km.toLocaleString('tr-TR')} km. Kayıtsız kullanım olabilir.`,
          date: localDate(tr.start_at),
          link: `#/trips?vehicle_id=${tr.vehicle_id}`,
        });
      }
    }
    if (tr.end_km != null && tr.end_km - tr.start_km > s.trip_long_km && tr.start_at >= since) {
      push({
        key: `longtrip:${tr.id}`,
        level: 'info',
        module: 'trips',
        category: 'Sefer',
        vehicle_id: tr.vehicle_id,
        user_id: tr.driver_id,
        plate: tr.plate,
        title: `${tr.plate} · Olağan dışı uzun sefer`,
        message: `${(tr.end_km - tr.start_km).toLocaleString('tr-TR')} km (eşik ${s.trip_long_km.toLocaleString('tr-TR')} km).`,
        date: localDate(tr.start_at),
        link: `#/trips?id=${tr.id}`,
      });
    }
    prev = tr;
  }

  // --- Arızalar ---
  const SEV = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' };
  for (const i of all(`SELECT i.*, v.plate FROM issues i JOIN vehicles v ON v.id = i.vehicle_id WHERE i.status IN ('open','in_progress')`)) {
    push({
      key: `issue:${i.id}`,
      level: i.severity === 'critical' ? 'critical' : 'warning',
      module: 'issues',
      category: 'Arıza',
      vehicle_id: i.vehicle_id,
      user_id: i.reported_by,
      plate: i.plate,
      title: `${i.plate} · ${i.title}`,
      message: `${SEV[i.severity]} önemde ${i.status === 'open' ? 'açık' : 'işlemde'} arıza bildirimi.`,
      date: localDate(i.created_at),
      link: `#/issues?id=${i.id}`,
    });
  }

  // --- Onay bekleyen masraflar ---
  const pending = get(`SELECT COUNT(*) AS n FROM expenses WHERE status = 'pending'`).n;
  if (pending > 0) {
    push({
      key: `pending:${pending}`,
      level: 'info',
      module: 'expenses',
      require: 'approve',
      category: 'Masraf',
      title: `${pending} masraf onay bekliyor`,
      message: 'Şoförlerin girdiği masraflar onayınızı bekliyor.',
      link: '#/expenses?status=pending',
    });
  }

  out.sort((a, b) => LEVELS[b.level] - LEVELS[a.level] || String(a.date || '9999').localeCompare(String(b.date || '9999')));
  return out;
}

/** Kullanıcının görebileceği uyarılar. */
export function alertsForUser(user, alerts = computeAlerts()) {
  if (!user || !can(user, 'alerts', 'read')) return [];
  if (user.role === 'admin') return alerts;
  return alerts.filter((a) => {
    if (a.require) return can(user, a.module, a.require);
    const scope = readScope(user, a.module);
    if (scope === 'all') return true;
    return scope === 'own' && a.user_id === user.id;
  });
}

export function withReadState(user, alerts) {
  const read = new Set(all('SELECT alert_key FROM alert_reads WHERE user_id = ?', user.id).map((r) => r.alert_key));
  return alerts.map((a) => ({ ...a, read: read.has(a.key) }));
}

export function alertCounts(list) {
  const c = { critical: 0, warning: 0, info: 0, unread: 0, total: list.length };
  for (const a of list) {
    c[a.level]++;
    if (!a.read) c.unread++;
  }
  return c;
}
