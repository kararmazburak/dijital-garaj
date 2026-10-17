// Uçtan uca API testi: geçici veritabanıyla sunucuyu başlatır, iş kurallarını ve yetkileri doğrular.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-test-'));
process.env.DG_DATA_DIR = tmp;
delete process.env.SMTP_HOST;

const { createApp } = await import('../server/index.js');
const { scanOnce } = await import('../server/notifier.js');
const { closeDb } = await import('../server/db.js');

const app = createApp({ dataDir: tmp });
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) {
    passed++;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } else {
    failed++;
    failures.push(name);
    process.stdout.write(`  \x1b[31m✗ ${name}\x1b[0m${info !== undefined ? '  → ' + JSON.stringify(info).slice(0, 300) : ''}\n`);
  }
}
const section = (t) => process.stdout.write(`\n\x1b[1m${t}\x1b[0m\n`);

class Client {
  constructor() {
    this.cookie = '';
  }
  async req(method, url, body, { raw, headers = {}, csrf = true } = {}) {
    const hd = { ...headers };
    if (csrf) hd['X-Requested-With'] = 'dijital-garaj';
    if (this.cookie) hd.cookie = this.cookie;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      hd['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers: hd, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) {
      const m = /dg_sid=([^;]*)/.exec(sc);
      if (m) this.cookie = m[1] ? `dg_sid=${m[1]}` : '';
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
  async login(username, password) {
    return this.post('/api/auth/login', { username, password });
  }
}

const addDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

try {
  const admin = new Client();
  const today = (await admin.get('/api/health')).data.today;

  // ------------------------------------------------------------------
  section('Kimlik doğrulama');
  check('Sağlık uç noktası yanıt veriyor', !!today);
  let r = await admin.login('admin', 'yanlis-parola1');
  check('Hatalı parola reddedilir (401)', r.status === 401, r.data);
  r = await admin.login('admin', 'Admin123!');
  check('Varsayılan yönetici girişi', r.status === 200 && r.data.user.role === 'admin', r.data);
  check('İlk girişte parola değişimi zorunlu', r.data.user.must_change_password === true);
  check('Oturum çerezi HttpOnly + SameSite=Lax', /HttpOnly/i.test(r.headers.get('set-cookie')) && /SameSite=Lax/i.test(r.headers.get('set-cookie')));
  r = await admin.get('/api/lookups');
  check('Parola değişmeden API kullanılamaz', r.status === 403 && r.data.code === 'PASSWORD_CHANGE_REQUIRED', r.data);
  r = await admin.post('/api/auth/change-password', { current_password: 'Admin123!', new_password: 'kisa' });
  check('Zayıf parola reddedilir', r.status === 400, r.data);
  r = await admin.post('/api/auth/change-password', { current_password: 'Admin123!', new_password: 'YeniParola2026' });
  check('Parola değiştirilir', r.status === 200 && r.data.user.must_change_password === false, r.data);
  r = await admin.req('POST', '/api/vehicles', { plate: 'X' }, { csrf: false });
  check('CSRF başlığı olmayan istek reddedilir', r.status === 403 && r.data.code === 'CSRF', r.data);
  r = await admin.get('/api/lookups');
  check('Sözlükler: 13 araç türü, 14 belge türü', r.data.vehicle_types.length === 13 && r.data.doc_types.length === 14, [r.data.vehicle_types?.length, r.data.doc_types?.length]);
  const T = Object.fromEntries(r.data.vehicle_types.map((t) => [t.code, t.id]));
  const D = Object.fromEntries(r.data.doc_types.map((t) => [t.code, t.id]));

  // ------------------------------------------------------------------
  section('Kullanıcılar');
  const mk = async (username, role, extra = {}) => (await admin.post('/api/users', { username, full_name: username.toUpperCase(), role, password: 'Gecici123', must_change_password: false, ...extra })).data;
  const uDriver = await mk('sofor1', 'driver', { license_expiry: addDays(today, 400), license_class: 'B' });
  const uDriver2 = await mk('sofor2', 'driver', { license_expiry: addDays(today, 400) });
  const uFin = await mk('finans', 'finance', { email: 'finans@example.com' });
  const uObs = await mk('gozlem', 'observer');
  check('Personel eklenir (4 rol)', uDriver.id && uDriver2.id && uFin.id && uObs.id);
  r = await admin.post('/api/users', { username: 'sofor1', full_name: 'X', role: 'driver', password: 'Gecici123' });
  check('Aynı kullanıcı adı reddedilir (409)', r.status === 409, r.data);
  r = await admin.post('/api/users', { username: 'zayif', full_name: 'X', role: 'driver', password: '12345678' });
  check('Harf içermeyen parola reddedilir', r.status === 400 && r.data.code === 'WEAK_PASSWORD', r.data);

  const driver = new Client();
  const driver2 = new Client();
  const fin = new Client();
  const obs = new Client();
  await driver.login('sofor1', 'Gecici123');
  await driver2.login('sofor2', 'Gecici123');
  await fin.login('finans', 'Gecici123');
  await obs.login('gozlem', 'Gecici123');

  // ------------------------------------------------------------------
  section('Araçlar ve maliyet gizleme');
  r = await admin.post('/api/vehicles', { plate: '34 abc 123', brand: 'Renault', model: 'Clio', year: 2022, type_id: T.car, color: '#c0392b', current_km: 10000, purchase_price: 850000, maint_interval_km: 10000, maint_interval_months: 12 });
  check('Araç eklenir, plaka büyük harfe çevrilir', r.status === 201 && r.data.plate === '34 ABC 123', r.data);
  const v1 = r.data;
  r = await admin.post('/api/vehicles', { plate: '34 ABC 123', type_id: T.car });
  check('Aynı plaka reddedilir (409)', r.status === 409, r.data);
  r = await admin.post('/api/vehicles', { plate: '06 ZZ 1', type_id: T.car, color: 'kırmızı' });
  check('Geçersiz renk reddedilir (400)', r.status === 400, r.data);
  const v2 = (await admin.post('/api/vehicles', { plate: '06 BUS 06', brand: 'Mercedes', model: 'Tourismo', type_id: T.bus, color: '#2c3e50', current_km: 120000, purchase_price: 5000000 })).data;
  const v3 = (await admin.post('/api/vehicles', { plate: '35 TR 350', brand: 'Ford', model: 'Cargo', type_id: T.truck, color: '#ecf0f1', current_km: 50000 })).data;
  check('Farklı türde araçlar eklenir', v2.id && v3.id && v2.body === 'bus' && v3.body === 'truck');
  r = await driver.post('/api/vehicles', { plate: '01 A 1', type_id: T.car });
  check('Şoför araç ekleyemez (403)', r.status === 403, r.data);
  r = await obs.get(`/api/vehicles/${v1.id}`);
  check('Gözlemci satın alma bedelini göremez (API düzeyinde)', r.status === 200 && !('purchase_price' in r.data), r.data);
  r = await fin.get(`/api/vehicles/${v1.id}`);
  check('Finans satın alma bedelini görür', r.data.purchase_price === 850000, r.data);

  // ------------------------------------------------------------------
  section('Belgeler');
  r = await driver.post('/api/trips/start', { vehicle_id: v1.id, start_km: 10010 });
  check('Zorunlu belgesi olmayan araca çıkış engellenir', r.status === 403 && r.data.code === 'TRIP_BLOCKED' && r.data.blocks.some((b) => b.code === 'DOC_MISSING'), r.data);
  check('Şoföre zorla çıkış seçeneği sunulmaz', r.data.can_force === false);
  r = await admin.post('/api/documents', { vehicle_id: v1.id, doc_type_id: D.traffic_insurance, start_date: addDays(today, -300), end_date: addDays(today, 10), amount: 4500, provider: 'Sigorta A.Ş.' });
  check('Trafik sigortası eklenir', r.status === 201, r.data);
  const docIns = r.data;
  r = await admin.post('/api/documents', { vehicle_id: v1.id, doc_type_id: D.inspection, start_date: addDays(today, -700), end_date: addDays(today, -1) });
  const docInsp = r.data;
  r = await admin.post('/api/documents', { vehicle_id: v1.id, doc_type_id: D.registration });
  check('Süresiz belge (ruhsat) bitiş tarihsiz eklenir', r.status === 201, r.data);
  r = await admin.post('/api/documents', { vehicle_id: v1.id, doc_type_id: D.casco, start_date: today });
  check('Süreli belge bitiş tarihsiz reddedilir', r.status === 400, r.data);
  r = await admin.get(`/api/expenses?source=document&vehicle_id=${v1.id}`);
  check('Belge tutarı otomatik masrafa yansır (onaylı)', r.data.length === 1 && r.data[0].amount === 4500 && r.data[0].category === 'insurance' && r.data[0].status === 'approved', r.data);
  let alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Süresi dolmuş muayene kritik uyarı üretir', alerts.some((a) => a.key.startsWith(`doc:${docInsp.id}:`) && a.level === 'critical'), alerts.map((a) => a.key));
  check('10 gün kalan sigorta uyarı üretir', alerts.some((a) => a.key.startsWith(`doc:${docIns.id}:`) && a.level === 'warning'));
  r = await driver.post('/api/trips/start', { vehicle_id: v1.id, start_km: 10010 });
  check('Süresi dolmuş zorunlu belge çıkışı engeller', r.status === 403 && r.data.blocks.some((b) => b.code === 'DOC_EXPIRED'), r.data);
  r = await admin.post('/api/documents', { vehicle_id: v1.id, doc_type_id: D.inspection, start_date: today, end_date: addDays(today, 730), amount: 1200 });
  check('Belge yenilenir', r.status === 201, r.data);
  const docInsp2 = r.data;
  r = await admin.get(`/api/documents?vehicle_id=${v1.id}&archived=all`);
  check('Yenilemede eski belge arşive geçer', r.data.find((d) => d.id === docInsp.id)?.archived === 1 && r.data.find((d) => d.id === docInsp2.id)?.archived === 0, r.data.map((d) => [d.id, d.archived]));
  r = await admin.put(`/api/documents/${docInsp2.id}`, { amount: 1500 });
  r = await admin.get(`/api/expenses?source=document&vehicle_id=${v1.id}`);
  check('Belge tutarı değişince masraf senkronlanır', r.data.some((e) => e.source_id === docInsp2.id && e.amount === 1500), r.data);

  // ------------------------------------------------------------------
  section('Sefer kuralları');
  r = await driver.post('/api/trips/start', { vehicle_id: v1.id, start_km: 9000 });
  check('Çıkış km mevcut km\'den küçük olamaz', r.status === 400 && r.data.code === 'KM_TOO_LOW', r.data);
  r = await driver.post('/api/trips/start', { vehicle_id: v1.id, start_km: 10000, destination: 'Ankara', purpose: 'Müşteri ziyareti' });
  check('Şoför araç çıkışı yapar', r.status === 201, r.data);
  const trip1 = r.data;
  r = await admin.get('/api/garage');
  check('Garajda araç "seferde" görünür', r.data.vehicles.find((v) => v.id === v1.id).display_status === 'on_trip');
  r = await driver.post('/api/trips/start', { vehicle_id: v3.id, start_km: 50000 });
  check('Şoförün aynı anda tek açık seferi olabilir', r.status === 409 && r.data.code === 'DRIVER_HAS_OPEN_TRIP', r.data);
  r = await driver2.post('/api/trips/start', { vehicle_id: v1.id, start_km: 10000 });
  check('Seferdeki araca ikinci çıkış yapılamaz', r.status === 409 && r.data.code === 'VEHICLE_ON_TRIP', r.data);
  r = await driver2.post(`/api/trips/${trip1.id}/end`, { end_km: 10200 });
  check('Başkasının seferini şoför kapatamaz', r.status === 403, r.data);
  r = await driver.post(`/api/trips/${trip1.id}/end`, { end_km: 9999 });
  check('Dönüş km çıkış km\'den küçük olamaz', r.status === 400 && r.data.code === 'KM_TOO_LOW', r.data);
  r = await driver.post(`/api/trips/${trip1.id}/end`, { end_km: 10450, fuel_liters: 30 });
  check('Dönüş kaydı yapılır', r.status === 200 && r.data.end_km === 10450, r.data);
  r = await admin.get(`/api/vehicles/${v1.id}`);
  check('Dönüşte aracın km değeri güncellenir, araç müsait olur', r.data.current_km === 10450 && r.data.display_status === 'available' && r.data.active_driver_id === null, r.data);
  r = await driver2.post('/api/trips/start', { vehicle_id: v1.id, start_km: 10700 });
  check('Km boşluğu olan çıkış kabul edilir', r.status === 201, r.data);
  const trip2 = r.data;
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Km boşluğu (kayıt dışı kullanım) uyarısı üretilir', alerts.some((a) => a.key.startsWith(`kmgap:${trip2.id}`)), alerts.map((a) => a.key));
  r = await driver2.post(`/api/trips/${trip2.id}/end`, { end_km: 12000 });
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Olağan dışı uzun sefer bilgi uyarısı üretilir', alerts.some((a) => a.key.startsWith(`longtrip:${trip2.id}`) && a.level === 'info'));
  r = await driver.get('/api/trips');
  check('Şoför yalnızca kendi seferlerini görür', r.data.length === 1 && r.data.every((t) => t.driver_id === uDriver.id), r.data.map((t) => t.driver_id));
  r = await driver.put(`/api/trips/${trip2.id}`, { end_km: 11000, reason: 'x' });
  check('Şoför km düzeltemez (403)', r.status === 403, r.data);
  r = await admin.put(`/api/trips/${trip2.id}`, { end_km: 11000 });
  check('Km düzeltme gerekçesiz yapılamaz', r.status === 400, r.data);
  r = await admin.put(`/api/trips/${trip2.id}`, { end_km: 11000, reason: 'Gösterge yanlış okundu' });
  check('Yönetici km düzeltir', r.status === 200 && r.data.corrected === 1, r.data);
  r = await admin.get(`/api/vehicles/${v1.id}`);
  check('Düzeltme sonrası araç km yeniden hesaplanır', r.data.current_km === 11000, r.data.current_km);
  r = await admin.get('/api/audit?action=km_correct');
  check('Km düzeltme denetim kaydına gerekçesiyle işlenir', r.data.length >= 1 && r.data[0].note === 'Gösterge yanlış okundu', r.data);
  r = await admin.post('/api/trips/start', { vehicle_id: v2.id, start_km: 120000, driver_id: uDriver2.id, force: true });
  check('Zorla çıkış gerekçe ister', r.status === 400 && r.data.code === 'FORCE_REASON_REQUIRED', r.data);
  r = await admin.post('/api/trips/start', { vehicle_id: v2.id, start_km: 120000, driver_id: uDriver2.id, force: true, force_reason: 'Acil servis aracı' });
  check('Yönetici gerekçeyle zorla çıkış yapar', r.status === 201 && r.data.forced === 1, r.data);
  const trip3 = r.data;
  r = await admin.get('/api/audit?action=trip_force_start');
  check('Zorla çıkış denetim kaydında', r.data.length === 1);
  await admin.post(`/api/trips/${trip3.id}/end`, { end_km: 120100 });
  await admin.put(`/api/users/${uDriver2.id}`, { license_expiry: addDays(today, -3) });
  r = await driver2.post('/api/trips/start', { vehicle_id: v1.id, start_km: 11000 });
  check('Ehliyeti dolmuş şoför çıkış yapamaz', r.status === 403 && r.data.blocks.some((b) => b.code === 'LICENSE_EXPIRED'), r.data);
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Ehliyet süresi dolmuş kritik uyarısı', alerts.some((a) => a.key.startsWith(`lic:${uDriver2.id}:license_expiry`) && a.level === 'critical'));
  await admin.put(`/api/users/${uDriver2.id}`, { license_expiry: addDays(today, 400) });

  // ------------------------------------------------------------------
  section('Yedek parça ve bakım');
  r = await admin.post('/api/parts', { code: 'YF-001', name: 'Yağ filtresi', category: 'Filtre', stock: 10, min_stock: 5, unit_price: 250 });
  check('Parça açılış stoğuyla eklenir', r.status === 201 && r.data.stock === 10, r.data);
  const part = r.data;
  r = await admin.post('/api/maintenance', { vehicle_id: v1.id, kind: 'periodic', date: today, km: 11000, labor_cost: 1000, service_name: 'Yetkili Servis', parts: [{ part_id: part.id, qty: 3 }] });
  check('Bakım kaydı parça ile eklenir', r.status === 201 && r.data.parts_total === 750 && r.data.total_cost === 1750, r.data);
  const m1 = r.data;
  r = await admin.get('/api/parts');
  check('Kullanılan parça stoktan düşer', r.data.find((p) => p.id === part.id).stock === 7);
  r = await admin.get(`/api/expenses?source=maintenance&vehicle_id=${v1.id}`);
  check('Bakım toplamı masrafa yansır', r.data.length === 1 && r.data[0].amount === 1750, r.data);
  r = await admin.post('/api/maintenance', { vehicle_id: v1.id, kind: 'repair', date: today, km: 11000, parts: [{ part_id: part.id, qty: 50 }] });
  check('Yetersiz stokta bakım reddedilir', r.status === 400 && r.data.code === 'INSUFFICIENT_STOCK', r.data);
  r = await admin.get('/api/parts');
  check('Reddedilen işlem stoğu değiştirmez (işlem bütünlüğü)', r.data.find((p) => p.id === part.id).stock === 7);
  r = await admin.get(`/api/vehicles/${v1.id}/summary`);
  check('Bakım döngüsü sonraki km\'yi hesaplar', r.data.maintenance.next_km === 21000, r.data.maintenance);
  r = await admin.del(`/api/maintenance/${m1.id}`);
  r = await admin.get('/api/parts');
  const exp = await admin.get(`/api/expenses?source=maintenance&vehicle_id=${v1.id}`);
  check('Bakım silinince stok ve masraf geri alınır', r.data.find((p) => p.id === part.id).stock === 10 && exp.data.length === 0, [r.data.find((p) => p.id === part.id).stock, exp.data.length]);
  r = await admin.post('/api/maintenance', { vehicle_id: v1.id, kind: 'periodic', date: addDays(today, -400), km: 500 });
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Gecikmiş periyodik bakım kritik uyarı üretir', alerts.some((a) => a.key.startsWith(`maint:${v1.id}:`) && a.level === 'critical'), alerts.filter((a) => a.vehicle_id === v1.id).map((a) => a.key));
  check('Bakım kaydı olmayan araç için uyarı', alerts.some((a) => a.key.startsWith(`nomaint:${v3.id}`)));
  r = await admin.post('/api/maintenance', { vehicle_id: v3.id, kind: 'periodic', status: 'planned', date: addDays(today, -2), description: 'Yağ değişimi' });
  const planned = r.data;
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Tarihi geçen planlı bakım kritik uyarı', alerts.some((a) => a.key.startsWith(`plan:${planned.id}`) && a.level === 'critical'));
  r = await admin.put(`/api/maintenance/${planned.id}`, { status: 'done', date: today, km: 50000, labor_cost: 500 });
  check('Planlı bakım tamamlanır', r.status === 200 && r.data.status === 'done', r.data);
  r = await admin.post(`/api/parts/${part.id}/adjust`, { kind: 'out', qty: 8, note: 'Fire' });
  check('Stok çıkışı yapılır', r.status === 200 && r.data.stock === 2, r.data);
  r = await admin.post(`/api/parts/${part.id}/adjust`, { kind: 'out', qty: 5 });
  check('Stoktan fazla çıkış reddedilir', r.status === 400, r.data);
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('Asgari seviye altı düşük stok uyarısı', alerts.some((a) => a.key.startsWith(`stock:${part.id}`)));
  r = await admin.get(`/api/parts/${part.id}/moves`);
  check('Stok hareketleri tarihçeli tutulur (açılış, bakım, iade, çıkış)', r.data.length === 4 && r.data.some((m) => m.kind === 'maintenance_revert'), r.data.length);

  // ------------------------------------------------------------------
  section('Lastikler');
  r = await admin.post('/api/tires', { vehicle_id: v1.id, brand: 'Michelin', size: '205/55 R16', season: 'summer', dot: '0115', tread_depth: 1.2, mount: true, position: 'Ön Sol' });
  check('Lastik takılı olarak eklenir', r.status === 201 && r.data.status === 'mounted' && r.data.mounted_km === 11000, r.data);
  const tire1 = r.data;
  alerts = (await admin.get('/api/alerts')).data.alerts;
  check('DOT yaşı sınırı aşan lastik kritik uyarı', alerts.some((a) => a.key.startsWith(`tireage:${tire1.id}`) && a.level === 'critical'));
  check('Diş derinliği yetersiz lastik kritik uyarı', alerts.some((a) => a.key.startsWith(`tiretread:${tire1.id}`) && a.level === 'critical'));
  r = await admin.post('/api/tires', { vehicle_id: v1.id, brand: 'Pirelli', season: 'summer', mount: true, position: 'Ön Sol' });
  check('Aynı konuma ikinci lastik takılamaz', r.status === 409 && r.data.code === 'POSITION_TAKEN', r.data);
  r = await admin.post(`/api/tires/${tire1.id}/dismount`, { km: 11500, to: 'stored' });
  check('Lastik sökülür, yaptığı km hesaplanır', r.status === 200 && r.data.total_km === 500 && r.data.status === 'stored', r.data);
  for (const pos of ['Ön Sol', 'Ön Sağ', 'Arka Sol', 'Arka Sağ']) await admin.post('/api/tires', { vehicle_id: v1.id, brand: 'Kış', season: 'winter', position: pos, dot: '3024' });
  r = await admin.post('/api/tires/seasonal-change', { vehicle_id: v1.id, to_season: 'winter', km: 11000 });
  check('Mevsimsel değişim: kış lastikleri takılır', r.status === 200 && r.data.mounted === 4, r.data);
  r = await admin.get(`/api/tires?vehicle_id=${v1.id}&status=mounted`);
  check('Takılı lastiklerin hepsi kış lastiği', r.data.length === 4 && r.data.every((t) => t.season === 'winter'), r.data.map((t) => t.season));

  // ------------------------------------------------------------------
  section('Masraflar ve onay');
  r = await driver.post('/api/expenses', { vehicle_id: v1.id, category: 'fuel', amount: 2000, liters: 45, date: today });
  check('Şoför masrafı onaya düşer', r.status === 201 && r.data.status === 'pending' && r.data.driver_id === uDriver.id, r.data);
  const e1 = r.data;
  check('Şoför kendi girdiği masraf tutarını görür', r.data.amount === 2000);
  r = await driver.post('/api/expenses', { vehicle_id: v1.id, category: 'fuel', amount: 100, date: addDays(today, 3) });
  check('İleri tarihli masraf reddedilir', r.status === 400, r.data);
  const e2 = (await driver.post('/api/expenses', { vehicle_id: v1.id, category: 'toll_parking', amount: 150, date: today })).data;
  const e3 = (await driver.post('/api/expenses', { vehicle_id: v1.id, category: 'wash', amount: 300, date: today })).data;
  r = await obs.get('/api/expenses');
  check('Gözlemci masraflara erişemez (403)', r.status === 403, r.data);
  r = await driver.post(`/api/expenses/${e1.id}/approve`);
  check('Şoför masraf onaylayamaz (403)', r.status === 403, r.data);
  alerts = (await fin.get('/api/alerts')).data.alerts;
  check('Finans "onay bekleyen masraf" uyarısını görür', alerts.some((a) => a.key.startsWith('pending:')));
  r = await fin.post(`/api/expenses/${e1.id}/approve`);
  check('Finans masrafı onaylar', r.status === 200 && r.data.status === 'approved', r.data);
  r = await fin.post(`/api/expenses/${e1.id}/approve`);
  check('Onaylanmış masraf tekrar onaylanamaz', r.status === 409, r.data);
  r = await fin.post(`/api/expenses/${e2.id}/reject`, {});
  check('Ret gerekçe ister', r.status === 400, r.data);
  r = await fin.post('/api/expenses/approve-bulk', { ids: [e2.id, e3.id], action: 'approve' });
  check('Toplu onay', r.status === 200 && r.data.count === 2, r.data);
  r = await driver.put(`/api/expenses/${e1.id}`, { amount: 5 });
  check('Şoför onaylanmış masrafını düzenleyemez', r.status === 403, r.data);
  const autoExp = (await admin.get('/api/expenses?source=document')).data[0];
  r = await admin.put(`/api/expenses/${autoExp.id}`, { amount: 1 });
  check('Otomatik masraf doğrudan düzenlenemez', r.status === 400 && r.data.code === 'AUTO_EXPENSE', r.data);

  // ------------------------------------------------------------------
  section('Arızalar');
  r = await driver.post('/api/issues', { vehicle_id: v3.id, severity: 'critical', title: 'Fren arızası', description: 'Fren pedalı boşa çıkıyor' });
  check('Şoför arıza bildirir', r.status === 201, r.data);
  const iss = r.data;
  r = await admin.get('/api/garage');
  check('Açık kritik arıza aracı "arızalı" işaretler', r.data.vehicles.find((v) => v.id === v3.id).display_status === 'broken');
  r = await driver2.post('/api/trips/start', { vehicle_id: v3.id, start_km: 50000 });
  check('Arızalı araca çıkış engellenir', r.status === 403 && r.data.blocks.some((b) => b.code === 'VEHICLE_BROKEN'), r.data);
  r = await admin.post(`/api/issues/${iss.id}/convert`);
  check('Arıza tek tıkla bakım kaydına dönüşür', r.status === 201 && r.data.status === 'planned' && r.data.issue_id === iss.id, r.data);
  const convMaint = r.data;
  r = await admin.put(`/api/maintenance/${convMaint.id}`, { status: 'done', date: today, km: 50000, labor_cost: 3000 });
  r = await admin.get(`/api/issues?vehicle_id=${v3.id}`);
  check('Bakım tamamlanınca arıza çözülür', r.data[0].status === 'resolved', r.data[0]);
  r = await admin.get('/api/garage');
  check('Arıza çözülünce araç müsait olur', r.data.vehicles.find((v) => v.id === v3.id).display_status === 'available');

  // ------------------------------------------------------------------
  section('Uyarı görünürlüğü');
  const drvAlerts = (await driver.get('/api/alerts')).data.alerts;
  check('Şoför stok/belge uyarılarını görmez', !drvAlerts.some((a) => a.module === 'parts' || a.module === 'documents'), drvAlerts.map((a) => a.module));
  const obsAlerts = (await obs.get('/api/alerts')).data.alerts;
  check('Gözlemci onay bekleyen masraf uyarısını görmez', !obsAlerts.some((a) => a.key.startsWith('pending:')));
  const someKey = (await admin.get('/api/alerts')).data.alerts[0].key;
  await admin.post('/api/alerts/read', { keys: [someKey] });
  r = await admin.get('/api/alerts');
  check('Uyarı okundu durumu kullanıcı başına tutulur', r.data.alerts.find((a) => a.key === someKey).read === true && (await fin.get('/api/alerts')).data.alerts.every((a) => a.key !== someKey || !a.read));

  // ------------------------------------------------------------------
  section('Rol yetki matrisi');
  r = await admin.get('/api/roles');
  const matrix = r.data.matrix;
  matrix.driver.issues = ['read_own'];
  matrix.observer.costs = ['read'];
  r = await admin.put('/api/roles', { matrix });
  check('Yetki matrisi güncellenir', r.status === 200 && !r.data.matrix.driver.issues.includes('create'));
  r = await driver.post('/api/issues', { vehicle_id: v1.id, severity: 'low', title: 'Test' });
  check('Kaldırılan yetki anında uygulanır', r.status === 403, r.data);
  r = await obs.get(`/api/vehicles/${v1.id}`);
  check('Maliyet yetkisi verilen gözlemci bedeli görür', r.data.purchase_price === 850000, r.data);
  r = await fin.put('/api/roles', { matrix });
  check('Finans rol matrisini değiştiremez', r.status === 403);
  r = await admin.post('/api/roles/reset');
  check('Varsayılana dönülür', r.data.matrix.driver.issues.includes('create') && !r.data.matrix.observer.costs);
  r = await admin.get('/api/audit?action=role_matrix_update');
  check('Yetki değişikliği denetim kaydında', r.data.length === 1);

  // ------------------------------------------------------------------
  section('Raporlar ve dışa aktarım');
  r = await fin.get(`/api/reports/costs?from=${addDays(today, -800)}&to=${today}`);
  check('Maliyet raporu (finans)', r.status === 200 && r.data.total > 0 && r.data.by_vehicle.length > 0, r.data);
  r = await obs.get('/api/reports/costs');
  check('Maliyet yetkisi olmayan rol maliyet raporunu alamaz', r.status === 403);
  r = await obs.get(`/api/reports/fuel?from=${addDays(today, -30)}&to=${today}`);
  check('Yakıt raporu L/100 km hesaplar', r.status === 200 && r.data.rows.some((x) => x.l_per_100km > 0) && r.data.rows.every((x) => !('amount' in x)), r.data);
  r = await admin.get('/api/reports/drivers');
  check('Şoför kullanım raporu', r.data.rows.find((x) => x.id === uDriver.id)?.km === 450, r.data.rows);
  r = await driver.get(`/api/reports/drivers/${uDriver2.id}`);
  check('Şoför başka şoförün detayını göremez', r.status === 403);
  // fetch().text() BOM'u ayıkladığı için ham baytlar kontrol edilir
  const csvRes = await fetch(base + `/api/reports/export/trips?from=${addDays(today, -1)}&to=${today}`, { headers: { cookie: admin.cookie } });
  const csvBytes = Buffer.from(await csvRes.arrayBuffer());
  check('CSV dışa aktarım (UTF-8 BOM, ; ayraç)', csvRes.status === 200 && /text\/csv/.test(csvRes.headers.get('content-type')) && csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && csvBytes.toString('utf8').includes('Plaka;'));

  // ------------------------------------------------------------------
  section('Dosyalar');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  r = await admin.req('POST', '/api/uploads', undefined, { raw: pdf, headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('poliçe.pdf') } });
  check('PDF yüklenir', r.status === 201 && r.data.mime === 'application/pdf' && r.data.name === 'poliçe.pdf', r.data);
  const fileId = r.data.id;
  r = await admin.req('POST', '/api/uploads', undefined, { raw: Buffer.from('<script>alert(1)</script>'), headers: { 'Content-Type': 'text/html' } });
  check('İzin verilmeyen dosya türü reddedilir', r.status === 400 && r.data.code === 'BAD_FILE_TYPE', r.data);
  r = await new Client().get(`/api/uploads/${fileId}`);
  check('Dosya oturumsuz indirilemez (401)', r.status === 401);
  r = await admin.get(`/api/uploads/${fileId}`);
  check('Dosya yetkili uç noktadan sunulur', r.status === 200 && r.headers.get('content-type') === 'application/pdf');

  // ------------------------------------------------------------------
  section('Yönetim');
  r = await admin.put('/api/settings', { doc_warn_days: [7, 15, 30] });
  check('Geçersiz uyarı eşikleri reddedilir', r.status === 400, r.data);
  r = await admin.put('/api/settings', { doc_warn_days: [45, 20, 10], company_name: 'Test Lojistik' });
  check('Ayarlar güncellenir', r.status === 200 && r.data.settings.company_name === 'Test Lojistik' && r.data.settings.doc_warn_days[0] === 45, r.data);
  r = await admin.post('/api/vehicle-types', { name: 'Golf arabası', body: 'car', length: 2.5, icon: '⛳' });
  check('Yeni araç türü (3B gövdeyle) eklenir', r.status === 201, r.data);
  r = await admin.post('/api/doc-types', { name: 'Özel İzin Belgesi', required: false, has_expiry: true, warn_days: 20 });
  check('Yeni belge türü eklenir', r.status === 201, r.data);
  r = await admin.del(`/api/vehicles/${v2.id}`);
  check('Geçmişi olan araç silinmez, pasife alınır', r.status === 200 && r.data.deactivated === true, r.data);
  r = await admin.del(`/api/users/${uDriver2.id}`);
  check('Geçmişi olan kullanıcı pasifleştirilir', r.data.deactivated === true, r.data);
  r = await new Client().login('sofor2', 'Gecici123');
  check('Pasif kullanıcı giriş yapamaz', r.status === 401, r.data);
  r = await admin.put('/api/users/1', { role: 'driver' });
  check('Son yönetici rolünü kaybedemez', r.status === 409, r.data);
  r = await admin.get('/api/audit');
  check('Denetim kaydı giriş, silme, yetki işlemlerini içerir', ['login', 'login_failed', 'user_create', 'deactivate', 'settings_update'].every((a) => r.data.some((x) => x.action === a)), [...new Set(r.data.map((x) => x.action))]);

  // ------------------------------------------------------------------
  section('Bildirim tarayıcı, panel, istemci');
  const n = await scanOnce();
  check('Arka plan tarayıcı yeni kritik uyarıları kaydeder', n > 0, n);
  check('Aynı uyarı ikinci kez kaydedilmez', (await scanOnce()) === 0);
  r = await admin.get('/api/dashboard');
  check('Panel verisi', r.status === 200 && r.data.counts.total === 3 && r.data.alert_counts.total > 0, r.data.counts);
  r = await driver.get('/api/dashboard');
  check('Şoför panelinde maliyet toplamı yok', r.status === 200 && r.data.month?.expense_total === undefined, r.data.month);
  r = await fetch(base + '/');
  check('İstemci sunulur, CSP başlığı var', r.status === 200 && (r.headers.get('content-security-policy') || '').includes("script-src 'self'"));
  r = await fetch(base + '/vendor/three/addons/controls/OrbitControls.js');
  const orbit = await r.text();
  check('Three.js eklentisi yerel yola çevrilerek sunulur', r.status === 200 && orbit.includes("/vendor/three/build/three.module.js") && !/from\s+['"]three['"]/.test(orbit));
  const lim = new Client();
  let last;
  for (let i = 0; i < 9; i++) last = await lim.login('finans', 'yanlis' + i + 'x');
  check('Giriş denemelerine hız sınırı (429)', last.status === 429, last.data);
} catch (e) {
  failed++;
  failures.push('Beklenmeyen hata: ' + e.message);
  console.error(e);
} finally {
  server.close();
  closeDb();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch { /* Windows'ta WAL dosyası kilitli kalabilir */ }
}

console.log(`\n${passed} başarılı, ${failed} başarısız (toplam ${passed + failed} doğrulama)`);
if (failed) {
  console.log('Başarısız: \n - ' + failures.join('\n - '));
  process.exit(1);
}
process.exit(0);
