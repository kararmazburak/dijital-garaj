// Oturum yönetimi ve kimlik uç noktaları.
import express from 'express';
import { get, run, all } from './db.js';
import { HttpError, bad, nowIso } from './util.js';
import { verifyPassword, dummyVerify, hashPassword, passwordProblem, newToken, hashToken, parseCookies, createRateLimiter } from './security.js';
import { permsFor, ROLES } from './perms.js';
import { audit, ah } from './crud.js';

export const COOKIE = 'dg_sid';
const IDLE_MS = 12 * 60 * 60 * 1000; // 12 saat hareketsizlik
const ABS_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün mutlak ömür

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });
const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40 });

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    role: u.role,
    role_name: ROLES[u.role],
    email: u.email,
    phone: u.phone,
    department: u.department,
    license_expiry: u.license_expiry,
    src_expiry: u.src_expiry,
    must_change_password: !!u.must_change_password,
  };
}

function cookieOpts(req) {
  const secure = process.env.DG_SECURE_COOKIE === '1' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function setSessionCookie(req, res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieOpts(req)}; Max-Age=${Math.floor(ABS_MS / 1000)}`);
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOpts(req)}; Max-Age=0`);
}

/** Çerezden kullanıcıyı çözer; req.user atar (yoksa null). */
export function authenticate(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const th = hashToken(token);
  const row = get(
    `SELECT s.token_hash, s.created_at AS s_created, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    th,
  );
  if (!row) return next();
  const now = Date.now();
  if (!row.active || now - Date.parse(row.last_seen_at) > IDLE_MS || now - Date.parse(row.s_created) > ABS_MS) {
    run('DELETE FROM sessions WHERE token_hash = ?', th);
    return next();
  }
  if (now - Date.parse(row.last_seen_at) > 60 * 1000) run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', nowIso(), th);
  delete row.password_hash;
  req.user = row;
  req.sessionHash = th;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Oturum açmanız gerekiyor', 'UNAUTHENTICATED'));
  next();
}

/** Zorunlu parola değişimi bekleyen kullanıcı yalnızca kimlik uç noktalarını kullanabilir. */
export function requirePasswordFresh(req, res, next) {
  if (req.user?.must_change_password) return next(new HttpError(403, 'Devam etmek için parolanızı değiştirmelisiniz', 'PASSWORD_CHANGE_REQUIRED'));
  next();
}

export function purgeSessions() {
  const idle = new Date(Date.now() - IDLE_MS).toISOString();
  const abs = new Date(Date.now() - ABS_MS).toISOString();
  run('DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?', idle, abs);
}

export function authRouter() {
  const r = express.Router();

  r.post('/login', ah((req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) throw bad('Kullanıcı adı ve parola gereklidir');
    const key = `${req.ip}|${username.toLowerCase()}`;
    const lim = loginLimiter.check(key);
    const ipLim = ipLimiter.check(req.ip);
    if (!lim.ok || !ipLim.ok) {
      res.setHeader('Retry-After', String(lim.retryAfter || ipLim.retryAfter));
      throw new HttpError(429, `Çok fazla başarısız deneme. ${Math.ceil((lim.retryAfter || ipLim.retryAfter) / 60)} dakika sonra tekrar deneyin.`, 'RATE_LIMITED');
    }
    const user = get('SELECT * FROM users WHERE username = ?', username);
    const ok = user ? verifyPassword(password, user.password_hash) : dummyVerify(password);
    if (!user || !ok || !user.active) {
      loginLimiter.fail(key);
      ipLimiter.fail(req.ip);
      req.auditUsername = username;
      audit(req, 'login_failed', 'user', user?.id ?? null, null, null, !user ? 'bilinmeyen kullanıcı' : !ok ? 'hatalı parola' : 'pasif hesap');
      throw new HttpError(401, user && ok && !user.active ? 'Hesabınız pasif durumda. Yöneticinize başvurun.' : 'Kullanıcı adı veya parola hatalı', 'INVALID_CREDENTIALS');
    }
    loginLimiter.reset(key);
    const token = newToken();
    const now = nowIso();
    run('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
      hashToken(token), user.id, now, now, req.ip, String(req.headers['user-agent'] || '').slice(0, 300));
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now, user.id);
    setSessionCookie(req, res, token);
    req.user = user;
    audit(req, 'login', 'user', user.id);
    res.json({ user: publicUser(user), perms: permsFor(user) });
  }));

  r.post('/logout', ah((req, res) => {
    if (req.sessionHash) {
      run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
      audit(req, 'logout', 'user', req.user.id);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  }));

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user), perms: permsFor(req.user) });
  });

  r.post('/change-password', requireAuth, ah((req, res) => {
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');
    const row = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(current, row.password_hash)) throw bad('Mevcut parola hatalı', 'INVALID_PASSWORD');
    const problem = passwordProblem(next);
    if (problem) throw bad(problem, 'WEAK_PASSWORD');
    if (current === next) throw bad('Yeni parola mevcut paroladan farklı olmalıdır', 'WEAK_PASSWORD');
    run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', hashPassword(next), nowIso(), req.user.id);
    // Diğer oturumları kapat
    run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', req.user.id, req.sessionHash);
    audit(req, 'password_change', 'user', req.user.id);
    const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ user: publicUser(user), perms: permsFor(user) });
  }));

  r.get('/sessions', requireAuth, (req, res) => {
    res.json(all('SELECT created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', req.user.id));
  });

  return r;
}
