import { createHmac, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { getCustomer, upsertCustomer } from './db.js';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const google = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
export const googleEnabled = () => !!google;
export const googleClientId = () => GOOGLE_CLIENT_ID;

// ---------- signed cookies ----------
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(data).digest('base64url');
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  // Cross-site cookies (pages on GitHub Pages, API elsewhere) need SameSite=None; Secure.
  const crossSite = !!process.env.CORS_ORIGIN;
  const secure = crossSite || (process.env.PUBLIC_URL || '').startsWith('https://') ? '; Secure' : '';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${crossSite ? 'None' : 'Lax'}; Max-Age=${maxAgeSec}${secure}`);
}
export function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------- customer sessions (step 3: sign up with Gmail) ----------
const CUSTOMER_COOKIE = 'mspace_customer';
const CUSTOMER_TTL = 180 * 86400; // 6 months

export function customerFromRequest(req) {
  const payload = verify(parseCookies(req)[CUSTOMER_COOKIE]);
  return payload?.cid ? getCustomer(payload.cid) || null : null;
}
export function loginCustomer(res, customer) {
  setCookie(res, CUSTOMER_COOKIE, sign({ cid: customer.id, exp: Date.now() + CUSTOMER_TTL * 1000 }), CUSTOMER_TTL);
}
export function logoutCustomer(res) { clearCookie(res, CUSTOMER_COOKIE); }

/** Verify a Google ID token (from the "Sign in with Google" button) and upsert the customer. */
export async function signInWithGoogle(credential) {
  if (!google) throw new Error('Google sign-in is not configured.');
  const ticket = await google.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) throw new Error('Google account email is not verified.');
  return upsertCustomer({
    email: payload.email,
    name: payload.name || '',
    picture: payload.picture || '',
    google_sub: payload.sub,
    provider: 'google',
  });
}
/** Fallback sign-up when Google is not configured: name + email (+ phone). */
export function signUpWithEmail({ name, email, phone }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new Error('Please enter a valid email address.');
  if (!name || name.trim().length < 2) throw new Error('Please enter your full name.');
  return upsertCustomer({ email, name: name.trim(), phone: (phone || '').trim(), provider: 'email' });
}

// ---------- admin session ----------
const ADMIN_COOKIE = 'mspace_admin';
const ADMIN_TTL = 12 * 3600;
export function adminLogin(res, password) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) throw new Error('ADMIN_PASSWORD is not set in .env');
  const a = Buffer.from(String(password)); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  setCookie(res, ADMIN_COOKIE, sign({ admin: true, exp: Date.now() + ADMIN_TTL * 1000 }), ADMIN_TTL);
  return true;
}
export function isAdmin(req) { return !!verify(parseCookies(req)[ADMIN_COOKIE])?.admin; }
export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Admin login required' });
}
export function adminLogout(res) { clearCookie(res, ADMIN_COOKIE); }
