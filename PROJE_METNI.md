# DİJİTAL GARAJ — Kurumsal Araç Filosu Takip Sistemi
## Kapsamlı Proje Metni

---

## 1. Proje Özeti

**Dijital Garaj**, bir şirketin sahip olduğu tüm araçların (otomobil, SUV, minivan, pikap, minibüs, otobüs, kamyon, traktör, römork, forklift, iş makinesi, motosiklet ve diğerleri) tek bir web uygulamasından izlenmesini sağlayan tam yığın (full stack) bir filo yönetim sistemidir.

Sistemin merkezinde **3 boyutlu (3B) Dijital Garaj** vardır. Filodaki her araç, garajda kendi türüne uygun 3B modeliyle, kendi park yuvasında görünür. Araç durumu (müsait, seferde, bakımda, arızalı, pasif) renkli zeminle, açık uyarılar araç üstündeki işaretçilerle anlık gösterilir. Filo büyüdükçe garaj otomatik olarak yeni sıra ve yuvalar açarak genişler.

### Kullanılan Teknolojiler (Dil ve Yığın)
| Katman | Teknoloji |
|---|---|
| Programlama dili | **JavaScript** (hem sunucu hem istemci) |
| Sunucu (Back-end) | **Node.js 22.13+** + **Express 4** |
| Veritabanı | **SQLite** (Node.js'in yerleşik `node:sqlite` modülü, WAL modu, yabancı anahtar kısıtları açık) |
| İstemci (Front-end) | Saf (vanilla) JavaScript ES modülleri, hash tabanlı yönlendirici, HTML5 + CSS3 (açık/işlevsel tema); derleme adımı yok |
| 3B Garaj | **Three.js** (prosedürel araç modelleri, OrbitControls, ışın izleme ile seçim) |
| E-posta bildirimi | Nodemailer (isteğe bağlı SMTP) |
| Kimlik doğrulama | scrypt ile parola özeti + HttpOnly çerez oturumu |

---

## 2. Amaç ve Kapsam

### 2.1 Amaçlar
1. Araçların kim tarafından, ne zaman, kaç km ile kullanıldığını eksiksiz kaydetmek.
2. Belge (sigorta, kasko, muayene, ruhsat vb.) bitişlerinin kaçırılmasını önlemek ve yöneticiyi zamanında uyarmak.
3. Bakım, yedek parça, lastik ve masraf kayıtlarını araç bazında tarihçeli tutmak.
4. Şoför bazlı kullanım ve maliyet raporları sunmak.
5. Filoyu görsel, sezgisel ve etkileşimli bir 3B garaj ile yönetilebilir kılmak.

### 2.2 Kapsam Dışı / Gelecek Çalışma
GPS/telematik cihaz entegrasyonu, mobil yerel uygulama, OBD verisi okuma, SMS bildirimi ve çoklu şirket (multi-tenant) desteği yol haritasında yer alır (bkz. Bölüm 14).

---

## 3. Kullanıcı Rolleri ve Yetkilendirme

Dört temel rol vardır. Roller yöneticiye aittir; **Rol Yetkileri** ekranında bir **yetki matrisi** ile her rolün her modüldeki işlemleri (görüntüle, kendi kayıtlarını görüntüle, ekle, düzenle, sil, onayla, yönet) değiştirilebilir. Yönetici her zaman tüm yetkilere sahiptir. "Varsayılana dön" ile fabrika ayarları geri yüklenir. Değişiklikler sunucuda anında uygulanır.

| Rol | Varsayılan sorumluluk |
|---|---|
| **Yönetici** | Tam yetki. Kullanıcı ve rol yönetimi, araç/belge/bakım tanımları, ayarlar, denetim kaydı, kural istisnaları (zorla çıkış, km düzeltme). |
| **Şoför** | Araç çıkış/dönüş kaydı, kendi seferlerini görme, arıza bildirme, masraf (yakıt vb.) girme (onaya düşer), kendisiyle ilgili uyarıları görme. |
| **Finans Yöneticisi** | Tüm masrafları, maliyet alanlarını (satın alma bedeli, işçilik, parça tutarı) ve raporları görme; masraf onaylama/reddetme. |
| **Gözlemci** | Salt okunur izleme (garaj, araçlar, belgeler, bakım, lastik, parça, raporlar). Maliyet alanları varsayılan olarak gizli. |

**Maliyet gizleme:** `costs.read` yetkisi olmayan rollerde `purchase_price, cost, labor_cost, parts_total, other_cost, total_cost, unit_price, amount, expense_total` alanları sunucu tarafından yanıttan çıkarılır; yani gizleme sadece arayüzde değil, API düzeyindedir. İstisna: kullanıcının kendi oluşturduğu kayıtlar (ör. şoförün girdiği yakıt fişi) tutarıyla birlikte döner.

**Personel ekleme:** Yönetici *Kullanıcılar* ekranından yeni personel oluşturur; kullanıcı adı + geçici parola atar, rolünü seçer. Pasif yapma, parola sıfırlama ve silme (geçmişi olanlar için pasifleştirme) desteklenir. Sistemde en az bir aktif yönetici kalması zorunludur.

---

## 4. İş Süreci: Araç Çıkış / Dönüş

1. Çıkış yapacak personel **Araç Çıkışı Yap** düğmesini (panel, garaj yan paneli, araç detayı veya Çıkış/Dönüş sayfası) kullanır.
2. Listeden **müsait aracı** seçer; **güncel km** değerini girer, gidilecek yeri / amacı yazar. Araç seçildiği anda kurallar ön kontrol edilir ve engel varsa form içinde gösterilir.
3. Sistem kuralları denetler:
   - Girilen km, aracın sistemdeki mevcut km değerinden **küçük olamaz**.
   - Bir şoförün aynı anda **yalnızca bir açık seferi** olabilir; bir aracın da tek açık seferi olabilir (veritabanında kısmi tekil indeksle de garanti edilir).
   - Süresi geçmiş **ehliyet/SRC** olan şoför çıkış yapamaz (ayarlanabilir).
   - **Zorunlu belgesi** eksik veya süresi geçmiş araç çıkış yapamaz (ayarlanabilir).
   - Bakımda veya açık kritik arızası olan araç çıkış yapamaz.
   - Yönetici gerekçe yazarak `force` (zorla çıkış) ile istisna tanıyabilir; km ve tek açık sefer kuralları aşılamaz.
4. Araç durumu **Seferde** olur; 3B garajda araç saydam (hayalet) görünür, zemin rengi değişir.
5. Dönüşte kullanıcı **dönüş km** değerini (ve isteğe bağlı yakıt/notları) girer. Dönüş km, çıkış km'den küçük olamaz. Araç **Müsait** olur, aracın km değeri güncellenir.
6. Yönetici hatalı km girişlerini gerekçe yazarak **düzeltebilir**; aracın km değeri tüm kayıtlardan yeniden hesaplanır ve işlem denetim kaydına işlenir.

Ek denetimler: uzun süredir kapanmayan seferler, beklenmeyen km farkları (son dönüş km ile yeni çıkış km arasında boşluk) ve olağan dışı uzun seferler uyarı olarak üretilir.

---

## 5. Modüller

### 5.1 Dijital Garaj (3B)
- **Dinamik yerleşim:** Araç sayısına göre sıralar otomatik oluşur; her sıra, içindeki en uzun araca göre kendi derinliğine uyum sağlar. Filo büyüdükçe garaj genişler; sonda "+ Araç ekle" yuvası bulunur. Kamera, yerleşimi ekran oranına göre çerçeveler.
- **Prosedürel modeller:** Otomobil, SUV, van, pikap, minibüs, otobüs, kamyon, traktör, römork, forklift, iş makinesi, motosiklet ve genel araç. Her aracın gövde rengi kendi kaydındaki renk alanından gelir; model, türün tanımlı uzunluğuna göre ölçeklenir.
- **Durum zemini:** Müsait (yeşil), seferde (mavi), bakımda (turuncu), arızalı (kırmızı), pasif (gri).
- **Plaka etiketi** ve açık **uyarı işaretçisi** (uyarı sayısı ve en yüksek seviye rengiyle) her aracın üzerindedir.
- **Etkileşim:** Üzerine gelince bilgi balonu, tıklayınca seçim çerçevesi + yan panel (durum, km, şoför, aktif uyarılar, hızlı eylemler: çıkış yap, dönüş yap, detay, arıza bildir, bakıma al/çıkar). Fare ile döndür/yakınlaştır/kaydır; seçilen araca kamera animasyonu.
- **Filtreler:** Durum, tür ve arama; eşleşmeyen araçlar soluklaştırılır.
- **2B kart görünümü:** WebGL desteklemeyen cihazlar veya tercih için alternatif (tercih tarayıcıda hatırlanır).

### 5.2 Panel
Hoş geldiniz özeti, rol bazlı hızlı eylemler, açık seferim bandı, filo durum sayıları, kritik/uyarı sayaçları, öncelikli uyarılar, yaklaşan bitişler, açık seferler, açık arızalar, planlı bakımlar, son masraflar ve aylık özet.

### 5.3 Araç Yönetimi
Yönetici her aracı elle ekler: plaka, marka, model, yıl, **araç türü**, renk, şasi no, motor no, yakıt türü, depo kapasitesi, vites, koltuk sayısı, yük kapasitesi, **güncel km**, satın alma tarihi/bedeli, zimmet/departman, bakım aralıkları (km ve ay), notlar ve fotoğraf. **Araç türleri ve belge türleri** Ayarlar'dan yeni eklenebilir (3B gövde tipi seçilerek).
Araç detay sayfasında sekmeler: Özet · Belgeler · Bakım · Lastikler · Parçalar · Seferler · Masraflar · Arızalar.

### 5.4 Belge Takibi (araç bazlı)
- Her araca belge yüklenir (PDF/görsel, ≤ 10 MB) — **Trafik Sigortası, Kasko, Muayene, Ruhsat, Egzoz Emisyon, Yeşil Kart, Yetki Belgesi, Taşıma/Yük Sigortası** vb. (14 varsayılan tür, genişletilebilir).
- Başlangıç/bitiş tarihi, poliçe/belge no, firma, prim/tutar.
- Bitişe kalan gün hesaplanır; eşikler (varsayılan 30/15/7 gün) Ayarlar'dan, ilk uyarı süresi belge türü bazında değiştirilir.
- **Zorunlu belge** eksikliği ayrıca uyarı üretir; araç detayında eksik zorunlu belgeler tek tıkla eklenebilir.
- Belge tutarı otomatik **masraf** kaydı oluşturur (senkron; tutar değişirse masraf güncellenir, belge silinirse masraf silinir).
- **Yenileme:** Yeni dönem belgesi eklendiğinde eskisi arşive geçer, geçmiş korunur. Güncel belge silinirse önceki dönem yeniden geçerli olur.

### 5.5 Bakım Geçmişi ve Bakım Döngüsü
- Bakım türleri: periyodik, onarım, kaza onarımı, yıkama, diğer.
- Servis, işçilik, parça tutarı, diğer tutar, toplam, yapılan işlem, fatura no.
- **Kullanılan yedek parçalar** bakım kaydına eklenir ve stoktan otomatik düşer; yetersiz stokta işlem bütünüyle geri alınır.
- **Döngü kuralı:** Her aracın bakım aralığı (km ve/veya ay) tanımlıdır (boşsa Ayarlar'daki varsayılan); son periyodik bakım kaydından hesaplanan bir sonraki bakım km/tarihi gösterilir. Yaklaşınca *uyarı*, aşılınca *kritik* alarm.
- **Planlı bakım:** Gelecek tarihli/km'li bakım planı; "Tamamla" ile yapılan bakıma dönüşür.
- Bakım kaydı masrafa otomatik yansır; kayıt silinirse stok ve masraf geri alınır.

### 5.6 Lastik Takibi
- Lastik envanteri: marka/model, ebat, **DOT üretim tarihi**, tür (yaz/kış/dört mevsim), diş derinliği, konum (ön sol, ön sağ…), durum (takılı / depoda / hurda).
- **Takma / sökme** işlemleri km ile kaydedilir; lastiğin yaptığı km hesaplanır, her lastiğin hareket geçmişi tutulur.
- **Mevsimsel değişim** (yaz↔kış) toplu işlem: araçtaki tüm lastikleri tek seferde söküp araca ait depodaki diğer mevsim lastiklerini aynı konumlara takar.
- Uyarılar: km sınırı, **yaş sınırı (DOT'tan, örn. 6 yıl)**, minimum diş derinliği, **kış lastiği takvimi (1 Kasım – 1 Nisan)**.

### 5.7 Yedek Parça Stoğu
Parça kodu, adı, kategori, uyumlu araç (veya ortak), birim, stok, **asgari stok seviyesi**, birim fiyat, raf/tedarikçi. Stok hareketleri (giriş, çıkış, sayım düzeltme, bakımda kullanım, bakım iadesi) tarihçeli tutulur. Asgari seviyenin altı **düşük stok** uyarısı verir.

### 5.8 Masraf Takibi
Kategoriler: yakıt, bakım, parça, lastik, sigorta, kasko, muayene, otopark/köprü-otoyol, ceza, yıkama, diğer. Tutar, tarih, araç, şoför, fatura, litre/km (yakıt), ek dosya. Şoför girişleri **onay bekler**; finans yöneticisi tek tek veya toplu **onaylar/reddeder** (ret gerekçesi zorunlu). Belge/bakım/lastik kaynaklı masraflar otomatik oluşur ve yalnızca kaynak kayıttan değiştirilebilir.

### 5.9 Arıza / Hasar Bildirimleri
Şoför foto ve açıklamayla arıza bildirir (önem derecesi: düşük/orta/yüksek/kritik). Yönetici durumu günceller; tek tıkla **bakım kaydına** dönüştürür (bakım tamamlandığında arıza otomatik çözülür). Açık kritik arıza aracı garajda arızalı olarak işaretler ve çıkışı engeller.

### 5.10 Şoför Bazlı Kullanım
Şoför bazında sefer sayısı, toplam km, ortalama sefer km'si, kullanılan araçlar, masraflar, ehliyet/SRC durumu. Şoför detayında sefer geçmişi ve araç bazında kullanım.

### 5.11 Uyarılar ve Bildirimler
Tüm uyarılar kural motoruyla **hesaplanır**, böylece veri değiştikçe otomatik güncellenir (bkz. Bölüm 8). Kullanıcı başına "okundu" durumu tutulur; her kullanıcı yalnızca yetkili olduğu modüllerin (ve kendisiyle ilgili) uyarılarını görür. Üst çubukta çan simgesi ve menüde sayaç bulunur. Arka plandaki tarayıcı (varsayılan 30 dk) yeni kritik uyarıları bildirim tablosuna yazar ve SMTP ayarlıysa **yöneticilere e-posta** gönderir.

### 5.12 Raporlar
Maliyet raporu (araç/kategori/ay, ₺/km), şoför kullanım raporu, yakıt tüketimi (L/100 km, filo ortalamasına göre sapma) — tümü ekranda tablo ve grafik olarak ve **CSV dışa aktarım** (Excel uyumlu) olarak.

### 5.13 Denetim Kaydı
Giriş/çıkış ve başarısız girişler, yetki değişiklikleri, kullanıcı işlemleri, silme, km düzeltme, zorla çıkış ve tüm kritik değişiklikler; kim, ne zaman, hangi kayıt, eski/yeni değer, gerekçe ve IP.

### 5.14 Ayarlar
Şirket adı, saat dilimi, uyarı eşikleri, bakım varsayılanları, lastik yaş/diş/km sınırları ve kış dönemi, zorunlu belgeler, sefer kuralları, bildirim e-postaları, araç türleri ve belge türleri yönetimi.

---

## 6. Gözden Kaçabilecek Noktalar İçin Eklenen Özellikler

- Ehliyet ve SRC bitiş takibi, süresi geçmişse çıkış engeli
- Zorunlu belgesi eksik/bitmiş araca çıkış engeli
- Kapanmayan (unutulan) sefer uyarısı
- Dönüş km ile sonraki çıkış km arasındaki **km boşluğu** (kaçak kullanım şüphesi) uyarısı
- Olağan dışı uzun sefer uyarısı
- Yakıt tüketimi analizi
- Planlı bakım ve bakımı hiç yapılmamış araç uyarısı
- Lastik yaşı (DOT), diş derinliği ve mevsim penceresi
- Düşük stok uyarısı
- Onay bekleyen masraf uyarısı, açık arıza uyarısı
- Hatalı girişin yönetici tarafından düzeltilmesi ve denetim izi
- Pasif/satılmış araç durumu (geçmiş silinmeden saklanır)
- Dosya ekleri (belge, fatura, arıza fotoğrafı)
- CSV dışa aktarım, arama/filtre/sıralama her listede
- Mobil uyumlu arayüz (şoförler telefondan çıkış/dönüş girebilir; tablolar küçük ekranda karta dönüşür)

---

## 7. Veri Modeli

| Tablo | Açıklama |
|---|---|
| `users` | Personel: kullanıcı adı, parola özeti, rol, ehliyet no/sınıf/bitiş, SRC bitiş, telefon, e-posta, aktiflik, zorunlu parola değişimi |
| `sessions` | Oturum belirteci (özet), kullanıcı, son kullanım |
| `uploads` | Yüklenen dosyalar (doğrulanmış tür, boyut, yükleyen) |
| `vehicle_types` | Araç türü, ikon, 3B gövde tipi, varsayılan uzunluk |
| `doc_types` | Belge türü, zorunluluk, süreli/süresiz, uyarı süresi, masraf kategorisi |
| `vehicles` | Araç kimlik/teknik bilgileri, durum, güncel km, bakım aralıkları, aktif şoför |
| `trips` | Sefer: araç, şoför, çıkış/dönüş km-zaman, amaç, hedef, yakıt, notlar, zorla çıkış/düzeltme işaretleri |
| `documents` | Araç belgeleri, tarihler, tutar, dosya, arşiv durumu |
| `maintenance` | Bakım kayıtları (yapılan/planlı), servis, işçilik, parça toplamı, sonraki bakım |
| `maintenance_parts` | Bakımda kullanılan parçalar |
| `parts` / `part_moves` | Parça kataloğu/stok ve stok hareketleri |
| `tires` / `tire_events` | Lastik envanteri ve takma/sökme/ölçüm geçmişi |
| `expenses` | Masraflar (kaynağı: manuel/belge/bakım/lastik), onay durumu |
| `issues` | Arıza/hasar bildirimleri |
| `notifications` | Arka plan tarayıcının ürettiği bildirimler |
| `alert_reads` | Kullanıcı başına okundu bilgisi |
| `audit_log` | Denetim kaydı |
| `settings` | Anahtar–değer ayarlar (rol matrisi dahil, JSON) |

---

## 8. Uyarı Kuralları (Kural Motoru)

| Kural | Seviye |
|---|---|
| Belge süresi doldu (sigorta/kasko/muayene/diğer) | Kritik |
| Belge bitişine ≤ eşik gün (30/15/7) | Uyarı → Kritik |
| Zorunlu belge hiç yok | Kritik/Uyarı (çıkış engeli ayarına göre) |
| Ehliyet/SRC doldu veya yaklaşıyor | Kritik/Uyarı |
| Periyodik bakım km/tarihi geldi veya gecikti | Uyarı/Kritik |
| Bakım kaydı hiç yok | Uyarı |
| Planlı bakım tarihi/km'si yaklaştı/geçti | Uyarı/Kritik |
| Lastik km/yaş/diş sınırı aşıldı | Uyarı/Kritik |
| Kış lastiği dönemi (1 Kas–1 Nis) uyumsuzluğu | Uyarı (kışta yaz lastiği) / Bilgi (yazda kış lastiği) |
| Stok asgari seviyenin altında | Uyarı (tükendiyse Kritik) |
| Açık sefer çok uzun süredir kapanmadı | Uyarı |
| Km boşluğu / uzun sefer | Uyarı / Bilgi |
| Açık arıza bildirimi | Uyarı/Kritik |
| Onay bekleyen masraf | Bilgi |

---

## 9. Güvenlik

- Parolalar **scrypt** + rastgele tuz ile saklanır; düz metin tutulmaz. Kullanıcı yokken de sabit süreli doğrulama yapılır.
- Parola politikası: en az 8 karakter, harf ve rakam.
- İlk girişte (varsayılan `admin` / `Admin123!`) ve parola sıfırlamadan sonra **zorunlu parola değişimi**; değişene kadar API kullanılamaz.
- Oturum çerezi: `HttpOnly`, `SameSite=Lax` (HTTPS'te `Secure`); belirteç veritabanında özetlenmiş saklanır; 12 saat hareketsizlik / 7 gün mutlak ömür.
- Durum değiştiren isteklerde özel başlık zorunluluğu (CSRF savunması).
- Giriş denemelerine **hız sınırı** (kullanıcı + IP bazında).
- Her istekte sunucu tarafı yetki denetimi; gizli alanlar sunucuda çıkarılır.
- Parametreli SQL sorguları (SQL enjeksiyonuna karşı), girdi doğrulama, işlem (transaction) bütünlüğü.
- Dosya yüklemelerinde içerik (sihirli bayt) ve boyut kontrolü; dosyalar oturum gerektiren uç noktadan, kum havuzlu CSP ile sunulur.
- Güvenlik başlıkları (CSP, X-Frame-Options, nosniff, Referrer-Policy) ve denetim kaydı. CSV dışa aktarımında formül enjeksiyonu önlenir.

---

## 10. API Özeti (REST, JSON)

Önek: `/api`

- **Kimlik:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `GET /auth/sessions`
- **Genel:** `GET /lookups`, `GET /garage`, `GET /dashboard`, `GET /alerts`, `GET /alerts/count`, `POST /alerts/read`, `GET /notifications`, `GET /health`
- **Dosyalar:** `POST /uploads` (ham gövde, ≤ 10 MB), `GET /uploads/:id`
- **Araçlar:** `GET|POST /vehicles`, `GET|PUT|DELETE /vehicles/:id`, `GET /vehicles/:id/summary`, `POST /vehicles/:id/status`
- **Seferler:** `GET /trips`, `GET /trips/check`, `POST /trips/start`, `POST /trips/:id/end`, `PUT /trips/:id` (düzeltme), `DELETE /trips/:id`
- **Belgeler:** `/documents` (CRUD + dosya)
- **Bakım:** `GET|POST /maintenance`, `GET|PUT|DELETE /maintenance/:id`
- **Lastikler:** `/tires` (CRUD), `POST /tires/:id/mount`, `POST /tires/:id/dismount`, `GET /tires/:id/events`, `POST /tires/seasonal-change`
- **Parçalar:** `/parts` (CRUD), `POST /parts/:id/adjust`, `GET /parts/:id/moves`
- **Masraflar:** `/expenses` (CRUD), `POST /expenses/:id/approve|reject`, `POST /expenses/approve-bulk`
- **Arızalar:** `/issues` (CRUD), `POST /issues/:id/convert`
- **Tanımlar:** `/vehicle-types`, `/doc-types`
- **Yönetim:** `/users` (CRUD), `POST /users/:id/reset-password`, `GET|PUT /roles`, `POST /roles/reset`, `GET|PUT /settings`, `GET /audit`
- **Raporlar:** `GET /reports/costs`, `/reports/drivers`, `/reports/drivers/:id`, `/reports/fuel`, `/reports/export/:name` (CSV: costs, drivers, fuel, trips, expenses)

---

## 11. Arayüz ve Tasarım İlkeleri

- **Açık, ferah, işlevsel tema:** beyaz/açık gri yüzeyler, tek vurgu rengi, durum için tutarlı renk dili (yeşil/mavi/turuncu/kırmızı).
- Soldan menü (rol bazlı filtrelenir), üstte başlık + uyarı çanı + kullanıcı menüsü.
- Her listede arama, filtre, sıralama, CSV, boş durum mesajı ve açıklayıcı alt başlık.
- Formlarda alan ipuçları ve doğrulama mesajları; tehlikeli işlemlerde onay.
- Türkçe arayüz; tarih/sayı/para biçimleri Türkiye yerel ayarı.
- Mobil uyumlu: açılır menü, tek sütun düzen, büyük dokunma alanları, alttan açılan pencereler.

---

## 12. Proje Yapısı

```
dijital-garaj/
├─ package.json
├─ server/            Express API, veritabanı, kural motoru, bildirim tarayıcısı
│   ├─ index.js db.js auth.js perms.js security.js util.js
│   ├─ crud.js resources.js api.js domain.js alerts.js notifier.js
├─ public/            İstemci
│   ├─ index.html favicon.svg css/style.css
│   └─ js/ app.js api.js ui.js state.js modules.js
│          pages-core.js pages-ops.js pages-admin.js garage3d.js
├─ scripts/           smoke-test.js (otomatik test), seed-demo.js (demo veri)
└─ data/              Çalışma anında oluşur (garaj.db, uploads/)
```

---

## 13. Kurulum ve Çalıştırma

```bash
# Gereksinim: Node.js 22.13 veya üzeri
npm install
npm start                       # http://localhost:3000
npm run seed:demo               # (isteğe bağlı) 16 araçlık örnek veri + demo kullanıcılar
npm run seed:demo -- --force    # filo verisini silip demo veriyi yeniden yükler
npm test                        # otomatik uçtan uca API testleri
```

İlk giriş: **admin / Admin123!** → sistem parola değiştirmenizi zorunlu kılar.
Demo kullanıcılar (`seed:demo` sonrası, parola `Demo1234!`): `ahmet`, `mehmet`, `ayse`, `mustafa` (şoför), `elif` (finans), `cem` (gözlemci).

Ortam değişkenleri: `PORT`, `DG_DATA_DIR`, `DG_DB`, `TZ`, `TRUST_PROXY`, `DG_SECURE_COOKIE`, e-posta için `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`.

Canlıya alırken: HTTPS arkasında (ters vekil sunucu) çalıştırın, `DG_SECURE_COOKIE=1` ve `TRUST_PROXY=1` tanımlayın, `data/` klasörünü düzenli yedekleyin.

---

## 14. Yol Haritası

1. GPS/telematik entegrasyonu ve canlı konum
2. Mobil PWA (çevrimdışı çıkış/dönüş girişi, kamera ile belge/arıza fotoğrafı)
3. SMS / WhatsApp bildirimi
4. Yakıt kartı ve otoyol (HGS/OGS) verisi içe aktarma
5. Çok şirketli / çok şubeli yapı, şube bazlı garaj
6. İki aşamalı doğrulama (2FA)
7. Araç rezervasyon takvimi ve onay akışı
8. Amortisman, toplam sahip olma maliyeti (TCO) ve filo yenileme önerileri
9. PostgreSQL desteği (büyük filolar için)

---

## 15. Test ve Doğrulama

- `npm test`: sunucuyu geçici veritabanıyla başlatıp **131 doğrulamalı** uçtan uca API testi çalıştırır (giriş ve zorunlu parola değişimi, CSRF, yetki matrisi, maliyet gizleme, sefer kuralları, km düzeltme, zorla çıkış, belge yenileme, belge/bakım/lastik/parça/masraf senkronları, stok bütünlüğü, arıza→bakım akışı, uyarı motoru ve görünürlüğü, raporlar, CSV, dosya yükleme, hız sınırı, bildirim tarayıcı).
- Arayüz, başsız Chromium ile tüm sayfalar ve dört rol için gezilmiş; JavaScript hatası olmadığı doğrulanmış; 3B garajın araç türleri, tıklamayla seçim, ipucu, yan panel, filtre, 2B görünüm, diyaloglar ve mobil görünüm ekran görüntüleriyle kontrol edilmiştir.
- **Not:** SMTP e-posta gönderimi gerçek bir posta sunucusuyla test edilmemiştir; kurulumda kendi SMTP bilgilerinizle denemeniz önerilir.
