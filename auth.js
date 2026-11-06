// Admin login: one shared password from the ADMIN_PASSWORD setting and a signed cookie.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'admin_session';
const SESSION_MS = 1000 * 60 * 60 * 12;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 1000 * 60 * 15;
const attempts = new Map();

const sha = (value) => createHash('sha256').update(value).digest();
const password = () => process.env.ADMIN_PASSWORD || '';
// Changing the password signs everyone out, because it also changes the signing key.
const sign = (value) => createHmac('sha256', sha(`90archive-session:${password()}`)).update(value).digest('base64url');

export const adminConfigured = () => password().length >= 12;

function readCookie(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return '';
}

export function isSignedIn(req) {
  if (!adminConfigured()) return false;
  const [expires, signature] = readCookie(req).split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(expires));
  return a.length === b.length && timingSafeEqual(a, b);
}

const cookieFlags = (req) => `HttpOnly; SameSite=Strict; Path=/${req.secure ? '; Secure' : ''}`;

export function login(req, res) {
  if (!adminConfigured()) return res.status(503).json({ error: 'Admin login is not set up yet. ADMIN_PASSWORD must be at least 12 characters.' });
  const key = req.ip || 'unknown';
  const now = Date.now();
  const record = attempts.get(key);
  const recent = record && now - record.first < WINDOW_MS ? record : { first: now, count: 0 };
  if (recent.count >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

  const ok = timingSafeEqual(sha(String(req.body?.password ?? '')), sha(password()));
  if (!ok) {
    attempts.set(key, { first: recent.first, count: recent.count + 1 });
    return res.status(401).json({ error: 'That password is not correct.' });
  }
  attempts.delete(key);
  const expires = String(now + SESSION_MS);
  res.setHeader('Set-Cookie', `${COOKIE}=${expires}.${sign(expires)}; Max-Age=${SESSION_MS / 1000}; ${cookieFlags(req)}`);
  return res.json({ ok: true });
}

export function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
  res.json({ ok: true });
}

export function requireAdmin(req, res, next) {
  if (!isSignedIn(req)) return res.status(401).json({ error: 'Please sign in.' });
  return next();
}

// Blocks changes that another website tries to send using a signed-in browser.
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Blocked request.' });
  return next();
}

export function resetLoginAttempts() {
  attempts.clear();
}
