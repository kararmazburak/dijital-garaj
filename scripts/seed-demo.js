// Demo veri: 16 araç (tüm türler), demo kullanıcılar, 90 günlük sefer geçmişi, belgeler, bakım, lastik, parça, masraf, arıza.
// Kullanım: npm run seed:demo           (veritabanında araç varsa durur)
//           npm run seed:demo -- --force (mevcut filo verisini silip yeniden oluşturur; kullanıcılar korunur)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, closeDb, all, get, run, tx } from '../server/db.js';
import { insert } from '../server/crud.js';
import { hashPassword } from '../server/security.js';
import { today, addDays, setTimezone } from '../server/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DG_DATA_DIR || path.join(ROOT, 'data');
openDb(process.env.DG_DB || path.join(dataDir, 'garaj.db'));
setTimezone(process.env.TZ || 'Europe/Istanbul');

const force = process.argv.includes('--force');
if (get('SELECT COUNT(*) AS n FROM vehicles').n > 0 && !force) {
  console.log('Veritabanında zaten araç var. Filo verisini silip demo veriyi yeniden yüklemek için: npm run seed:demo -- --force');
  closeDb();
  process.exit(0);
}

// Tekrarlanabilir sözde rastgele
let seed = 20261016;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));

const T = today();
const now = () => new Date().toISOString();
const isoAt = (date, hour, min = 0) => new Date(`${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+03:00`).toISOString();

tx(() => {
  if (force) {
    for (const t of ['alert_reads', 'notifications', 'maintenance_parts', 'part_moves', 'tire_events', 'expenses', 'issues', 'maintenance', 'tires', 'parts', 'documents', 'trips']) run(`DELETE FROM ${t}`);
    run('DELETE FROM vehicles');
  }

  // ---------------------------------------------------------------- Kullanıcılar
  const admin = get(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  const pw = hashPassword('Demo1234!');
  const users = [
    ['ahmet', 'Ahmet Yılmaz', 'driver', { license_class: 'B, C', license_expiry: addDays(T, 900), src_expiry: addDays(T, 500), phone: '0532 000 00 01', department: 'Saha Operasyon' }],
    ['mehmet', 'Mehmet Demir', 'driver', { license_class: 'B, C, D, E', license_expiry: addDays(T, 1200), src_expiry: addDays(T, 12), phone: '0532 000 00 02', department: 'Lojistik' }],
    ['ayse', 'Ayşe Kaya', 'driver', { license_class: 'B', license_expiry: addDays(T, 700), phone: '0532 000 00 03', department: 'Satış' }],
    ['mustafa', 'Mustafa Çelik', 'driver', { license_class: 'B, C, G', license_expiry: addDays(T, 20), phone: '0532 000 00 04', department: 'Şantiye' }],
    ['elif', 'Elif Şahin', 'finance', { email: 'elif@example.com', department: 'Finans' }],
    ['cem', 'Cem Arslan', 'observer', { department: 'Yönetim' }],
  ];
  const U = {};
  for (const [username, full_name, role, extra] of users) {
    const ex = get('SELECT id FROM users WHERE username = ?', username);
    if (ex) {
      run('UPDATE users SET full_name = ?, role = ?, password_hash = ?, active = 1, must_change_password = 0 WHERE id = ?', full_name, role, pw, ex.id);
      U[username] = ex.id;
    } else {
      U[username] = insert('users', { username, full_name, role, password_hash: pw, must_change_password: 0, created_at: now(), ...extra });
    }
  }
  const drivers = ['ahmet', 'mehmet', 'ayse', 'mustafa'].map((u) => U[u]);

  // ---------------------------------------------------------------- Araçlar
  const TY = Object.fromEntries(all('SELECT id, code FROM vehicle_types').map((t) => [t.code, t.id]));
  const DT = Object.fromEntries(all('SELECT id, code FROM doc_types').map((t) => [t.code, t.id]));
  const fleet = [
    ['34 FLT 001', 'Renault', 'Clio', 2022, 'car', '#c0392b', 'gasoline', 42500, 'Satış'],
    ['34 FLT 002', 'Toyota', 'Corolla Hybrid', 2023, 'car', '#f4f6f7', 'hybrid', 28100, 'Satış'],
    ['34 FLT 003', 'Fiat', 'Egea', 2021, 'car', '#7f8c8d', 'diesel', 88700, 'Teknik Servis'],
    ['34 FLT 004', 'Dacia', 'Duster', 2022, 'suv', '#e67e22', 'diesel', 61200, 'Saha Operasyon'],
    ['34 FLT 005', 'Volkswagen', 'Tiguan', 2020, 'suv', '#1f3a5f', 'diesel', 118400, 'Yönetim'],
    ['34 FLT 006', 'Ford', 'Transit Custom', 2021, 'van', '#ecf0f1', 'diesel', 97300, 'Teknik Servis'],
    ['34 FLT 007', 'Fiat', 'Doblo', 2019, 'van', '#bdc3c7', 'diesel', 143900, 'Lojistik'],
    ['34 FLT 008', 'Toyota', 'Hilux', 2022, 'pickup', '#566573', 'diesel', 54600, 'Şantiye'],
    ['34 FLT 009', 'Mercedes-Benz', 'Sprinter', 2021, 'minibus', '#fdfefe', 'diesel', 132800, 'Personel Servisi'],
    ['34 FLT 010', 'Mercedes-Benz', 'Tourismo', 2019, 'bus', '#2e86c1', 'diesel', 412000, 'Personel Servisi'],
    ['34 FLT 011', 'Ford Trucks', 'Cargo 1846', 2020, 'truck', '#a93226', 'diesel', 286500, 'Lojistik'],
    ['34 FLT 012', 'New Holland', 'T6.180', 2021, 'tractor', '#2471a3', 'diesel', 4300, 'Şantiye'],
    ['34 FLT 013', 'Tırsan', 'Tenteli Römork', 2018, 'trailer', '#909497', 'other', 0, 'Lojistik'],
    ['34 FLT 014', 'Toyota', '8FBE20 Forklift', 2022, 'forklift', '#f1c40f', 'electric', 3100, 'Depo'],
    ['34 FLT 015', 'Caterpillar', '320 GC', 2021, 'excavator', '#f39c12', 'diesel', 6800, 'Şantiye'],
    ['34 FLT 016', 'Honda', 'PCX 125', 2023, 'motorcycle', '#17202a', 'gasoline', 9800, 'Kurye'],
  ];
  const V = [];
  for (const [plate, brand, model, year, type, color, fuel, km, dept] of fleet) {
    const id = insert('vehicles', {
      plate, brand, model, year, type_id: TY[type], color, fuel_type: fuel, department: dept,
      transmission: ['bus', 'truck', 'tractor', 'excavator', 'forklift', 'trailer', 'motorcycle'].includes(type) ? null : pick(['manual', 'automatic']),
      seats: { car: 5, suv: 5, van: 3, pickup: 5, minibus: 17, bus: 46, truck: 3, tractor: 1, forklift: 1, excavator: 1, motorcycle: 2 }[type] ?? null,
      tank_capacity: { car: 45, suv: 55, van: 70, pickup: 80, minibus: 75, bus: 400, truck: 400, tractor: 250, excavator: 410, motorcycle: 8 }[type] ?? null,
      load_capacity: { van: 1100, pickup: 1000, truck: 11000, trailer: 24000, forklift: 2000 }[type] ?? null,
      initial_km: Math.max(0, km - 6000), current_km: km, purchase_date: `${year}-0${between(1, 9)}-1${between(0, 9)}`,
      purchase_price: { car: 900000, suv: 1600000, van: 1300000, pickup: 1700000, minibus: 2600000, bus: 9500000, truck: 4200000, tractor: 2800000, trailer: 1200000, forklift: 900000, excavator: 6500000, motorcycle: 120000 }[type],
      maint_interval_km: ['tractor', 'excavator', 'forklift'].includes(type) ? null : type === 'bus' || type === 'truck' ? 30000 : 15000,
      maint_interval_months: 12, status: 'available', vin: `NMT${year}${String(V.length + 1).padStart(3, '0')}X${between(100000, 999999)}`,
      assigned_to: type === 'car' ? pick(['Satış Ekibi', 'Bölge Müdürü', 'Ortak havuz']) : null, created_at: now(),
    });
    V.push({ id, plate, type, km, startKm: Math.max(0, km - 6000) });
  }

  // ---------------------------------------------------------------- Belgeler (+ otomatik masraf)
  const docTypeInfo = Object.fromEntries(all('SELECT id, code, name, expense_category FROM doc_types').map((d) => [d.code, d]));
  const addDoc = (v, code, endOffset, amount, provider) => {
    const end = endOffset == null ? null : addDays(T, endOffset);
    const start = end ? addDays(end, -365) : addDays(T, -800);
    const id = insert('documents', { vehicle_id: v.id, doc_type_id: DT[code], start_date: start, end_date: end, amount, provider, doc_no: `${code.slice(0, 3).toUpperCase()}-${between(100000, 999999)}`, created_by: admin.id, created_at: now() });
    if (amount) {
      const dt = docTypeInfo[code];
      insert('expenses', { vehicle_id: v.id, category: dt.expense_category, amount, date: start, description: `${dt.name} — ${provider}`, source: 'document', source_id: id, status: 'approved', approved_by: admin.id, approved_at: now(), created_by: admin.id, created_at: now() });
    }
    return id;
  };
  V.forEach((v, i) => {
    const motor = v.type !== 'forklift' && v.type !== 'excavator';
    if (motor) {
      addDoc(v, 'traffic_insurance', i === 6 ? 6 : between(40, 330), between(3000, 14000), pick(['Anadolu Sigorta', 'Allianz', 'Axa Sigorta']));
      addDoc(v, 'inspection', i === 2 ? -5 : between(60, 700), between(900, 2500), 'TÜVTÜRK');
    }
    addDoc(v, 'registration', null, null, 'Emniyet');
    if (['car', 'suv', 'van', 'pickup', 'truck', 'bus', 'minibus'].includes(v.type)) addDoc(v, 'casco', i === 10 ? 20 : between(35, 350), between(15000, 60000), pick(['Allianz', 'Sompo', 'Türkiye Sigorta']));
    if (['bus', 'minibus'].includes(v.type)) addDoc(v, 'seat_insurance', between(60, 300), between(2000, 5000), 'Anadolu Sigorta');
    if (['truck', 'trailer'].includes(v.type)) addDoc(v, 'cargo_insurance', between(60, 300), between(5000, 12000), 'Axa Sigorta');
    if (['truck', 'bus'].includes(v.type)) addDoc(v, 'tachograph', i === 9 ? 25 : between(90, 400), between(1500, 3000), 'Takograf Servisi');
  });
  // Doblo için arşivlenmiş eski dönem sigorta (geçmiş korunur örneği)
  insert('documents', { vehicle_id: V[6].id, doc_type_id: DT.traffic_insurance, start_date: addDays(T, -724), end_date: addDays(T, -359), amount: 6400, provider: 'Allianz', doc_no: 'TRA-OLD', archived: 1, created_by: admin.id, created_at: now() });
  // Yük taşıyan araçların zorunlu belgeleri olmasın diye forklift/iş makinesine trafik sigortası zorunluluğu yok; uyarılar bunu gösterir.

  // ---------------------------------------------------------------- Seferler (90 gün)
  const destinations = ['Gebze OSB', 'Ankara Şube', 'Tuzla Depo', 'Kadıköy Müşteri', 'Esenyurt Şantiye', 'Bursa Fabrika', 'Havalimanı', 'Ümraniye Merkez', 'İzmit Liman', 'Sakarya Bayi'];
  const purposes = ['Müşteri ziyareti', 'Malzeme teslimi', 'Servis çağrısı', 'Personel taşıma', 'Şantiye sevkiyatı', 'Toplantı', 'Numune teslimi'];
  const tripVehicles = V.filter((v) => !['trailer', 'forklift', 'excavator', 'tractor'].includes(v.type));
  for (const v of tripVehicles) {
    let km = v.startKm;
    const perDay = { bus: 180, truck: 260, minibus: 140, motorcycle: 45 }[v.type] || 75;
    for (let d = 88; d >= 1; d -= between(1, 3)) {
      const date = addDays(T, -d);
      const dist = Math.max(8, Math.round(perDay * (0.4 + rnd() * 1.3)));
      const driver = pick(drivers);
      const startHour = between(7, 13);
      const hours = Math.max(1, Math.round(dist / 55));
      let startKm = km;
      if (v.plate === '34 FLT 006' && d < 30 && d > 25) startKm += 140; // kayıt dışı km örneği
      const endKm = startKm + dist;
      insert('trips', {
        vehicle_id: v.id, driver_id: driver, start_km: startKm, end_km: endKm,
        start_at: isoAt(date, startHour), end_at: isoAt(date, Math.min(22, startHour + hours), between(0, 59)),
        purpose: pick(purposes), destination: pick(destinations), fuel_liters: null, created_by: driver, created_at: isoAt(date, startHour),
      });
      km = endKm;
      // yakıt fişi (yaklaşık her 450 km'de)
      if (rnd() < dist / 450) {
        const liters = Math.round(dist * ({ bus: 0.32, truck: 0.3, minibus: 0.13, suv: 0.08, van: 0.09, pickup: 0.095, motorcycle: 0.025 }[v.type] || 0.065) * (2 + rnd() * 3));
        insert('expenses', {
          vehicle_id: v.id, driver_id: driver, category: 'fuel', amount: Math.round(liters * (v.type === 'motorcycle' ? 46.5 : 44.8) * 100) / 100, liters, km: endKm, date,
          description: 'Akaryakıt', invoice_no: `FİŞ-${between(10000, 99999)}`, source: 'manual', status: d < 4 ? 'pending' : 'approved',
          approved_by: d < 4 ? null : U.elif, approved_at: d < 4 ? null : isoAt(date, 18), created_by: driver, created_at: isoAt(date, 17),
        });
      }
    }
    run('UPDATE vehicles SET current_km = ? WHERE id = ?', km, v.id);
    v.km = km;
  }
  // Açık seferler
  const openTrip = (v, driver, hoursAgo, dest) => {
    const start = new Date(Date.now() - hoursAgo * 3600000).toISOString();
    insert('trips', { vehicle_id: v.id, driver_id: driver, start_km: v.km, start_at: start, purpose: pick(purposes), destination: dest, created_by: driver, created_at: start });
    run('UPDATE vehicles SET active_driver_id = ? WHERE id = ?', driver, v.id);
  };
  openTrip(V[1], U.ahmet, 3, 'Ankara Şube');
  openTrip(V[8], U.mehmet, 30, 'Bursa Fabrika'); // 24 saati aşan açık sefer uyarısı
  openTrip(V[15], U.ayse, 1, 'Kadıköy Müşteri');

  // ---------------------------------------------------------------- Yedek parçalar
  const parts = [
    ['YF-0101', 'Yağ filtresi (binek)', 'Filtre', 24, 10, 285, 'A-1'],
    ['HF-0102', 'Hava filtresi (binek)', 'Filtre', 14, 8, 340, 'A-1'],
    ['PF-0103', 'Polen filtresi', 'Filtre', 3, 6, 210, 'A-2'],
    ['MY-5W30', 'Motor yağı 5W-30 (L)', 'Yağ', 240, 60, 410, 'B-1'],
    ['FB-0201', 'Fren balatası ön takım', 'Fren', 8, 4, 1650, 'C-3'],
    ['SL-0301', 'Silecek süpürgesi', 'Aksesuar', 18, 6, 260, 'D-1'],
    ['AK-12V70', 'Akü 12V 70Ah', 'Elektrik', 2, 2, 3950, 'E-1'],
    ['AD-10L', 'AdBlue (10 L)', 'Sıvı', 30, 12, 320, 'B-2'],
  ];
  const P = {};
  for (const [code, name, category, stock, min, price, shelf] of parts) {
    P[code] = insert('parts', { code, name, category, stock, min_stock: min, unit_price: price, unit: code === 'MY-5W30' ? 'L' : 'adet', shelf, supplier: pick(['Bosch Car Service', 'Oto Yedek A.Ş.', 'Mann Filter']), created_at: now() });
    insert('part_moves', { part_id: P[code], kind: 'in', qty: stock, stock_after: stock, unit_price: price, note: 'Açılış stoğu', created_by: admin.id, created_at: now() });
  }

  // ---------------------------------------------------------------- Bakım
  const addMaint = (v, { daysAgo, km, kind = 'periodic', labor, parts: used = [], status = 'done', description, nextDays }) => {
    const date = addDays(T, status === 'planned' ? nextDays : -daysAgo);
    let partsTotal = 0;
    const mid = insert('maintenance', {
      vehicle_id: v.id, kind, status, date, km, service_name: pick(['Yetkili Servis', 'Oto Bakım Merkezi', 'Mobil Servis']),
      description: description || (kind === 'periodic' ? 'Periyodik bakım: yağ ve filtre değişimi, genel kontrol' : 'Onarım'),
      labor_cost: status === 'done' ? labor : 0, invoice_no: status === 'done' ? `FTR-${between(10000, 99999)}` : null, created_by: admin.id, created_at: now(),
    });
    if (status === 'done') {
      for (const [code, qty] of used) {
        const p = get('SELECT * FROM parts WHERE id = ?', P[code]);
        insert('maintenance_parts', { maintenance_id: mid, part_id: p.id, qty, unit_price: p.unit_price });
        run('UPDATE parts SET stock = stock - ? WHERE id = ?', qty, p.id);
        insert('part_moves', { part_id: p.id, kind: 'maintenance', qty: -qty, stock_after: p.stock - qty, unit_price: p.unit_price, ref_type: 'maintenance', ref_id: mid, created_by: admin.id, created_at: now() });
        partsTotal += qty * p.unit_price;
      }
      const total = labor + partsTotal;
      run('UPDATE maintenance SET parts_total = ?, total_cost = ? WHERE id = ?', partsTotal, total, mid);
      insert('expenses', { vehicle_id: v.id, category: kind === 'wash' ? 'wash' : 'maintenance', amount: total, date, description: `Bakım (${v.plate})`, source: 'maintenance', source_id: mid, status: 'approved', approved_by: admin.id, approved_at: now(), created_by: admin.id, created_at: now() });
    }
    return mid;
  };
  V.forEach((v, i) => {
    if (v.type === 'trailer') return; // hiç bakım kaydı yok → uyarı
    const interval = { bus: 30000, truck: 30000 }[v.type] || 15000;
    let lastKm;
    if (i === 4) lastKm = v.km - interval - 1800; // Tiguan: bakım km'si geçti (kritik)
    else if (i === 0) lastKm = v.km - interval + 600; // Clio: bakım yaklaşıyor
    else lastKm = Math.max(0, v.km - between(1500, Math.round(interval * 0.6)));
    const daysAgo = i === 6 ? 380 : between(40, 200); // Doblo: tarih bazında gecikmiş
    addMaint(v, { daysAgo, km: lastKm, labor: between(900, 3500), parts: v.type === 'car' || v.type === 'suv' ? [['YF-0101', 1], ['HF-0102', 1], ['MY-5W30', 4]] : [['MY-5W30', v.type === 'bus' || v.type === 'truck' ? 18 : 6]] });
  });
  addMaint(V[9], { status: 'planned', nextDays: 6, km: null, kind: 'periodic', description: 'Klima bakımı ve fren kontrolü' });
  addMaint(V[2], { daysAgo: 20, km: V[2].km - 900, kind: 'repair', labor: 2400, parts: [['FB-0201', 1]], description: 'Ön fren balataları değiştirildi' });

  // ---------------------------------------------------------------- Lastikler
  const POS = ['Ön Sol', 'Ön Sağ', 'Arka Sol', 'Arka Sağ'];
  const addTire = (v, pos, season, dot, tread, mounted, extraKm = 0, brand = 'Michelin') => {
    const id = insert('tires', {
      vehicle_id: v.id, brand, model: season === 'winter' ? 'Alpin 6' : 'Primacy 4', size: v.type === 'suv' ? '215/65 R16' : '205/55 R16', dot, season, tread_depth: tread,
      position: pos, status: mounted ? 'mounted' : 'stored', mounted_km: mounted ? v.km - extraKm : null, mount_date: mounted ? addDays(T, -150) : null, total_km: between(5000, 20000),
      cost: 3200, purchase_date: addDays(T, -400), created_at: now(),
    });
    insert('tire_events', { tire_id: id, vehicle_id: v.id, kind: mounted ? 'mount' : 'dismount', km: v.km - extraKm, date: addDays(T, -150), position: pos, created_by: admin.id, created_at: now() });
  };
  for (const v of [V[0], V[1], V[3], V[4]]) {
    for (const pos of POS) {
      const worn = v === V[3] && pos.startsWith('Ön');
      addTire(v, pos, 'summer', v === V[4] ? '1218' : '2223', worn ? 1.4 : between(40, 70) / 10, true, 8000, worn ? 'Lassa' : 'Michelin');
      addTire(v, pos, 'winter', '3823', between(60, 80) / 10, false, 0, 'Bridgestone');
    }
  }

  // ---------------------------------------------------------------- Arızalar
  insert('issues', { vehicle_id: V[13].id, reported_by: U.mustafa, severity: 'critical', title: 'Hidrolik yağ kaçağı', description: 'Kaldırma pistonundan yağ sızıyor, çatal yükü tutmuyor.', status: 'open', created_at: new Date(Date.now() - 5 * 3600000).toISOString() });
  insert('issues', { vehicle_id: V[5].id, reported_by: U.ahmet, severity: 'medium', title: 'Sol sürgülü kapı zor kapanıyor', description: 'Kapı rayında ses var.', status: 'open', created_at: new Date(Date.now() - 2 * 86400000).toISOString() });
  insert('issues', { vehicle_id: V[0].id, reported_by: U.ayse, severity: 'low', title: 'Torpido lambası yanmıyor', status: 'resolved', resolution: 'Ampul değiştirildi', created_at: new Date(Date.now() - 20 * 86400000).toISOString(), resolved_at: new Date(Date.now() - 18 * 86400000).toISOString() });

  // ---------------------------------------------------------------- Durumlar ve diğer masraflar
  run(`UPDATE vehicles SET status = 'maintenance' WHERE id = ?`, V[11].id);
  for (const [v, cat, amount, desc, driver] of [
    [V[0], 'toll_parking', 185, 'Köprü geçişi', U.ayse],
    [V[10], 'toll_parking', 1240, 'Otoyol geçişi', U.mehmet],
    [V[3], 'fine', 993, 'Hız ihlali cezası', U.mustafa],
    [V[5], 'wash', 450, 'İç-dış yıkama', U.ahmet],
  ]) {
    insert('expenses', { vehicle_id: v.id, driver_id: driver, category: cat, amount, date: addDays(T, -between(1, 25)), description: desc, source: 'manual', status: 'approved', approved_by: U.elif, approved_at: now(), created_by: driver, created_at: now() });
  }
  insert('expenses', { vehicle_id: V[6].id, driver_id: U.mehmet, category: 'toll_parking', amount: 320, date: addDays(T, -1), description: 'Otopark', source: 'manual', status: 'pending', created_by: U.mehmet, created_at: now() });

  run(`INSERT INTO audit_log (user_id, username, action, entity, note, created_at) VALUES (?, 'admin', 'seed_demo', 'system', 'Demo veri yüklendi', ?)`, admin.id, now());
});

const counts = get(`SELECT (SELECT COUNT(*) FROM vehicles) AS v, (SELECT COUNT(*) FROM trips) AS t, (SELECT COUNT(*) FROM documents) AS d, (SELECT COUNT(*) FROM expenses) AS e, (SELECT COUNT(*) FROM maintenance) AS m`);
console.log(`Demo veri yüklendi: ${counts.v} araç, ${counts.t} sefer, ${counts.d} belge, ${counts.m} bakım, ${counts.e} masraf.`);
console.log('Demo kullanıcılar (parola Demo1234!): ahmet, mehmet, ayse, mustafa (şoför) · elif (finans) · cem (gözlemci)');
closeDb();
