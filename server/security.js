// Parola özeti, oturum belirteçleri, hız sınırı ve güvenlik başlıkları.
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Kullanıcı yokken de aynı sürede yanıt vermek için sahte özet.
const DUMMY_HASH = hashPassword('zamanlama-esitleme-' + crypto.randomBytes(8).toString('hex'));
export const dummyVerify = (pw) => verifyPassword(pw, DUMMY_HASH);

/** Parola politikası: ≥ 8 karakter, en az bir harf ve bir rakam. Hata mesajı ya da null döner. */
export function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Parola en az 8 karakter olmalıdır';
  if (pw.length > 200) return 'Parola çok uzun';
  if (!/\p{L}/u.test(pw)) return 'Parola en az bir harf içermelidir';
  if (!/\d/.test(pw)) return 'Parola en az bir rakam içermelidir';
  return null;
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/** Basit bellek içi hız sınırlayıcı (sabit pencere). */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return {
    check(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || now - e.start > windowMs) return { ok: true };
      if (e.count >= max) return { ok: false, retryAfter: Math.ceil((windowMs - (now - e.start)) / 1000) };
      return { ok: true };
    },
    fail(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || now - e.start > windowMs) hits.set(key, { start: now, count: 1 });
      else e.count++;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}
