# Dijital Garaj

Şirket araç filosu için 3B dijital garajlı takip sistemi. **JavaScript** (Node.js 22.13+ · Express · yerleşik `node:sqlite`; istemci: vanilla JS + Three.js). Derleme adımı yoktur.

```bash
npm install
npm start            # http://localhost:3000   (ilk giriş: admin / Admin123! → parola değişimi zorunlu)
npm run seed:demo    # 16 araçlık örnek veri (demo kullanıcı parolası: Demo1234!)
npm test             # uçtan uca API testleri (131 doğrulama, geçici veritabanıyla)
```

- Demo kullanıcılar: `ahmet`, `mehmet`, `ayse`, `mustafa` (şoför) · `elif` (finans) · `cem` (gözlemci)
- `npm run seed:demo -- --force` mevcut filo verisini silip demo veriyi yeniden yükler (kullanıcılar korunur).
- Veri `data/` klasöründe tutulur (`garaj.db` + `uploads/`). Yedekleme için bu klasörü kopyalamanız yeterlidir.

## Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `PORT` | Sunucu portu (varsayılan 3000) |
| `DG_DATA_DIR`, `DG_DB` | Veri klasörü / veritabanı dosyası yolu |
| `TZ` | Saat dilimi (varsayılan: Ayarlar'daki değer, `Europe/Istanbul`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | Kritik uyarı e-postaları (isteğe bağlı) |
| `TRUST_PROXY`, `DG_SECURE_COOKIE=1` | Ters vekil sunucu (HTTPS) arkasında çalışırken |

Canlıya alırken HTTPS sunan bir ters vekil sunucu arkasında çalıştırın, `DG_SECURE_COOKIE=1` ve `TRUST_PROXY=1` tanımlayın ve `data/` klasörünü düzenli yedekleyin.

Ayrıntılı proje metni: [`PROJE_METNI.md`](PROJE_METNI.md)
