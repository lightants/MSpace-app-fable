import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const DATA_DIR = path.resolve('data');
mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'mspace.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',   -- new | pending | confirmed | rejected | checked_out | expired | cancelled
  payment_method TEXT,
  payment_ref TEXT,
  proof_path TEXT,
  keybox_code TEXT,
  agreed_at INTEGER,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  confirmed_at INTEGER,
  checked_out_at INTEGER,
  checkout_checklist TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  UNIQUE(booking_id, kind)
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  status TEXT NOT NULL,   -- sent | dry-run | failed
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  picture TEXT,
  google_sub TEXT UNIQUE,
  provider TEXT NOT NULL DEFAULT 'email',  -- google | email
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
`);
try { db.exec('ALTER TABLE bookings ADD COLUMN customer_id TEXT'); } catch { /* column exists */ }


// ---------- settings ----------
const DEFAULT_SETTINGS = {
  keybox_code: '',                    // current physical keybox combination
  checkout_code: '',                  // code customers must enter at checkout (defaults to keybox_code when blank)
  gcash_name: 'MSpace (CL**E MA***N A.)',
  gcash_number: '+63 917 134 ••••',
  instapay_name: 'MSpace',
  instapay_bank: 'GCash via QR Ph / InstaPay',
  instapay_number: '+63 917 134 ••••',
  gcash_qr: '',                       // uploaded file name under data/uploads
  instapay_qr: '',
  wifi_name: '',
  wifi_password: '',
  address: 'Mlang, Cotabato',
  maps_url: '',
};
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const putSetting = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

export function setting(key) {
  const row = getSetting.get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? '');
}
export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = setting(k);
  return out;
}
export function saveSettings(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (k in DEFAULT_SETTINGS) putSetting.run(k, String(v ?? ''));
  }
}

// ---------- customers (sign-up step) ----------
const selCustomerByEmail = db.prepare('SELECT * FROM customers WHERE email = ?');
const selCustomerById = db.prepare('SELECT * FROM customers WHERE id = ?');
export const getCustomer = (id) => selCustomerById.get(id);
export const getCustomerByEmail = (e) => selCustomerByEmail.get(String(e).toLowerCase().trim());

/** Create or refresh a customer record on sign-in. Returns the customer row. */
export function upsertCustomer({ email, name, phone, picture, google_sub, provider }) {
  email = String(email).toLowerCase().trim();
  const now = Date.now();
  const existing = selCustomerByEmail.get(email);
  if (existing) {
    db.prepare(`UPDATE customers SET
        name = COALESCE(NULLIF(?, ''), name),
        phone = COALESCE(NULLIF(?, ''), phone),
        picture = COALESCE(NULLIF(?, ''), picture),
        google_sub = COALESCE(?, google_sub),
        provider = CASE WHEN ? = 'google' THEN 'google' ELSE provider END,
        last_login_at = ?, visits = visits + 1
      WHERE id = ?`).run(name ?? '', phone ?? '', picture ?? '', google_sub ?? null, provider, now, existing.id);
    return selCustomerById.get(existing.id);
  }
  const id = 'C-' + randomBytes(4).toString('hex').toUpperCase();
  db.prepare(`INSERT INTO customers(id, email, name, phone, picture, google_sub, provider, created_at, last_login_at, visits)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, email, name || email.split('@')[0], phone ?? null, picture ?? null, google_sub ?? null, provider, now, now);
  return selCustomerById.get(id);
}
export function updateCustomer(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getCustomer(id);
  db.prepare(`UPDATE customers SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  return getCustomer(id);
}
export function listCustomers() {
  return db.prepare(`SELECT c.*, 
      (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id AND b.status IN ('confirmed','checked_out','expired')) AS passes,
      (SELECT COALESCE(SUM(amount),0) FROM bookings b WHERE b.customer_id = c.id AND b.confirmed_at IS NOT NULL) AS spent
    FROM customers c ORDER BY last_login_at DESC`).all();
}

// ---------- bookings ----------
const insertBooking = db.prepare(`
  INSERT INTO bookings (id, token, customer_id, name, email, phone, plan, amount, start_at, end_at, status, agreed_at, created_at)
  VALUES (@id, @token, @customer_id, @name, @email, @phone, @plan, @amount, @start_at, @end_at, 'new', @agreed_at, @created_at)`);

export function createBooking(b) {
  const id = 'MS-' + randomBytes(3).toString('hex').toUpperCase();   // e.g. MS-4F9A2C, shown to customer
  const token = randomUUID().replace(/-/g, '');                         // secret link for the pass page
  insertBooking.run({ ...b, id, token, created_at: Date.now() });
  return getBooking(id);
}
const selById = db.prepare('SELECT * FROM bookings WHERE id = ?');
const selByToken = db.prepare('SELECT * FROM bookings WHERE token = ?');
export const getBooking = (id) => selById.get(id);
export const getBookingByToken = (t) => selByToken.get(t);

export function updateBooking(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getBooking(id);
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE bookings SET ${sets} WHERE id = @id`).run({ ...fields, id });
  return getBooking(id);
}
export function listBookings({ status } = {}) {
  if (status && status !== 'all') {
    return db.prepare('SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 500').all();
}
export function activeBookings() {
  return db.prepare("SELECT * FROM bookings WHERE status = 'confirmed'").all();
}
export function stalePending(olderThanMs) {
  return db.prepare("SELECT * FROM bookings WHERE status = 'new' AND created_at < ?").all(Date.now() - olderThanMs);
}

// ---------- notifications (send-once guard) ----------
const insNotif = db.prepare('INSERT OR IGNORE INTO notifications(booking_id, kind, sent_at) VALUES (?, ?, ?)');
/** Returns true the first time a (booking, kind) pair is claimed. */
export function claimNotification(bookingId, kind) {
  return insNotif.run(bookingId, kind, Date.now()).changes > 0;
}
export function notificationsFor(bookingId) {
  return db.prepare('SELECT kind, sent_at FROM notifications WHERE booking_id = ? ORDER BY sent_at').all(bookingId);
}

// ---------- outbox ----------
const insOutbox = db.prepare('INSERT INTO outbox(booking_id, to_addr, subject, html, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
export function logEmail({ bookingId, to, subject, html, status, error }) {
  insOutbox.run(bookingId ?? null, to, subject, html, status, error ?? null, Date.now());
}
export function listOutbox(limit = 100) {
  return db.prepare('SELECT id, booking_id, to_addr, subject, status, error, created_at FROM outbox ORDER BY id DESC LIMIT ?').all(limit);
}
export function getOutboxItem(id) {
  return db.prepare('SELECT * FROM outbox WHERE id = ?').get(id);
}

export function stats() {
  const now = Date.now();
  const row = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    pending: row("SELECT COUNT(*) c FROM bookings WHERE status = 'pending'").c,
    active: row("SELECT COUNT(*) c FROM bookings WHERE status = 'confirmed' AND start_at <= ? AND end_at > ?", now, now).c,
    upcoming: row("SELECT COUNT(*) c FROM bookings WHERE status = 'confirmed' AND start_at > ?", now).c,
    revenue30: row("SELECT COALESCE(SUM(amount),0) s FROM bookings WHERE confirmed_at > ?", now - 30 * 86400000).s,
    customers: row('SELECT COUNT(*) c FROM customers').c,
  };
}
