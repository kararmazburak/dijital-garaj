// Dijital Garaj sunucusu: Express uygulaması, statik istemci, Three.js dağıtımı.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb, getSettings } from './db.js';
import { setTimezone } from './util.js';
import { securityHeaders } from './security.js';
import { apiRouter, errorHandler } from './api.js';
import { startNotifier } from './notifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// node:sqlite deneysel uyarısını bir kez sessizce yut (diğer uyarılar görünür kalır).
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (/SQLite is an experimental feature/i.test(String(text))) return;
  return origEmit.call(this, warning, ...args);
};

export function createApp({ dataDir = process.env.DG_DATA_DIR || path.join(ROOT, 'data'), dbFile = process.env.DG_DB } = {}) {
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  openDb(dbFile || path.join(dataDir, 'garaj.db'));
  setTimezone(process.env.TZ || getSettings().timezone);

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
  app.use(securityHeaders);

  app.use('/api', apiRouter({ uploadDir }));

  // Three.js: çekirdek derlemesi ve eklentiler ('three' çıplak içe aktarımı yerel yola çevrilir; import map/CSP gerekmez).
  const threeDir = path.join(ROOT, 'node_modules', 'three');
  app.use('/vendor/three/build', express.static(path.join(threeDir, 'build'), { maxAge: '7d', immutable: true }));
  app.get(/^\/vendor\/three\/addons\/(.+\.js)$/, (req, res, next) => {
    const rel = path.normalize(req.params[0]).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(threeDir, 'examples', 'jsm', rel);
    if (!file.startsWith(path.join(threeDir, 'examples', 'jsm'))) return next();
    fs.readFile(file, 'utf8', (err, src) => {
      if (err) return next();
      res.type('application/javascript').setHeader('Cache-Control', 'public, max-age=604800');
      res.send(src.replace(/from\s+['"]three['"]/g, "from '/vendor/three/build/three.module.js'"));
    });
  });

  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: 0 }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));
  app.use(errorHandler);
  return app;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Dijital Garaj çalışıyor: http://localhost:${port}`);
    console.log('İlk giriş: admin / Admin123! (ilk girişte parola değişimi zorunludur)');
    if (!process.env.SMTP_HOST) console.log('Not: SMTP_HOST tanımlı değil; e-posta bildirimleri kapalı.');
  });
  startNotifier();
}
