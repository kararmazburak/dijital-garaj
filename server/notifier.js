// Arka plan tarayıcı: yeni kritik uyarıları bildirim tablosuna yazar, SMTP varsa yöneticilere e-posta atar.
import { all, get, run, getSettings } from './db.js';
import { nowIso } from './util.js';
import { computeAlerts } from './alerts.js';
import { purgeSessions } from './auth.js';

let timer = null;
let transporter = null;
let transporterTried = false;

async function getTransporter() {
  if (transporterTried) return transporter;
  transporterTried = true;
  if (!process.env.SMTP_HOST) return null;
  try {
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  } catch (e) {
    console.error('[bildirim] SMTP yapılandırılamadı:', e.message);
    transporter = null;
  }
  return transporter;
}

function recipients() {
  const s = getSettings();
  const set = new Set(String(s.notify_emails || '').split(/[,;\s]+/).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)));
  for (const u of all(`SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email IS NOT NULL AND email != ''`)) set.add(u.email);
  return [...set];
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Bir tarama turu. Yeni kritik uyarı sayısını döndürür. */
export async function scanOnce() {
  purgeSessions();
  const critical = computeAlerts().filter((a) => a.level === 'critical');
  const fresh = [];
  for (const a of critical) {
    if (get('SELECT 1 AS x FROM notifications WHERE alert_key = ?', a.key)) continue;
    run('INSERT INTO notifications (alert_key, level, title, message, vehicle_id, created_at) VALUES (?,?,?,?,?,?)', a.key, a.level, a.title, a.message, a.vehicle_id, nowIso());
    fresh.push(a);
  }
  if (!fresh.length) return 0;
  const tr = await getTransporter();
  const to = recipients();
  if (tr && to.length) {
    const s = getSettings();
    try {
      await tr.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER || 'dijital-garaj@localhost',
        to: to.join(', '),
        subject: `[Dijital Garaj] ${fresh.length} yeni kritik uyarı — ${s.company_name}`,
        text: fresh.map((a) => `• ${a.title}\n  ${a.message || ''}`).join('\n\n'),
        html: `<h2 style="font-family:sans-serif">${esc(s.company_name)} — yeni kritik uyarılar</h2><ul style="font-family:sans-serif">${fresh
          .map((a) => `<li><b>${esc(a.title)}</b><br>${esc(a.message)}</li>`)
          .join('')}</ul>`,
      });
      for (const a of fresh) run('UPDATE notifications SET emailed = 1 WHERE alert_key = ?', a.key);
    } catch (e) {
      console.error('[bildirim] E-posta gönderilemedi:', e.message);
    }
  }
  return fresh.length;
}

export function startNotifier() {
  const tick = () => scanOnce().catch((e) => console.error('[bildirim] Tarama hatası:', e));
  const schedule = () => {
    const minutes = Math.max(5, Number(getSettings().scan_interval_min) || 30);
    timer = setTimeout(() => {
      tick();
      schedule();
    }, minutes * 60 * 1000);
    timer.unref();
  };
  setTimeout(tick, 5000).unref();
  schedule();
}

export function stopNotifier() {
  if (timer) clearTimeout(timer);
  timer = null;
}
