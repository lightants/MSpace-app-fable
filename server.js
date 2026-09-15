process.env.TZ = 'Asia/Manila';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  allSettings, saveSettings, setting, createBooking, getBooking, getBookingByToken, updateBooking, listBookings,
  listOutbox, getOutboxItem, notificationsFor, stats, listCustomers, updateCustomer, getCustomer,
} from './src/db.js';
import { BUSINESS, HOURS, PLANS, POLICIES, HOUSE_RULES, CHECKOUT_CHECKLIST, PAYMENT_METHODS } from './src/content.js';
import { computeWindow, todayStr, peso, fmtDateTime } from './src/time.js';
import { sendTemplate, sendMail, templates, mailEnabled } from './src/mailer.js';
import {
  googleEnabled, googleClientId, customerFromRequest, loginCustomer, logoutCustomer, signInWithGoogle, signUpWithEmail,
  adminLogin, adminLogout, isAdmin, requireAdmin,
} from './src/auth.js';
import { startScheduler } from './src/scheduler.js';

const PORT = Number(process.env.PORT || 4600);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PUBLIC_DIR = path.resolve('public');
const UPLOAD_DIR = path.resolve('data/uploads');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase().slice(0, 6)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const publicBooking = (b, { full = false } = {}) => ({
  id: b.id, name: b.name, email: b.email, phone: b.phone, plan: b.plan, planName: PLANS[b.plan]?.name, amount: b.amount,
  start_at: b.start_at, end_at: b.end_at, status: b.status, payment_method: b.payment_method, payment_ref: b.payment_ref,
  created_at: b.created_at, confirmed_at: b.confirmed_at, checked_out_at: b.checked_out_at,
  checkout_checklist: b.checkout_checklist ? JSON.parse(b.checkout_checklist) : null,
  keybox_code: b.status === 'confirmed' ? (b.keybox_code || setting('keybox_code')) : null,
  ...(full ? { token: b.token, proof_path: b.proof_path, notes: b.notes, customer_id: b.customer_id, notifications: notificationsFor(b.id) } : {}),
});

// ---------- pages ----------
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/pass/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pass.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// ---------- public config ----------
app.get('/api/config', (req, res) => {
  const s = allSettings();
  res.json({
    business: BUSINESS, hours: HOURS, plans: Object.values(PLANS), policies: POLICIES, houseRules: HOUSE_RULES,
    checklist: CHECKOUT_CHECKLIST, paymentMethods: Object.values(PAYMENT_METHODS), today: todayStr(),
    payment: {
      gcash: { name: s.gcash_name, number: s.gcash_number, qr: '/payment-qr/gcash' },
      instapay: { name: s.instapay_name, bank: s.instapay_bank, number: s.instapay_number, qr: '/payment-qr/instapay' },
    },
    address: s.address, mapsUrl: s.maps_url,
    googleClientId: googleEnabled() ? googleClientId() : null,
  });
});
app.get('/payment-qr/:method', (req, res) => {
  // Uploaded image from Settings wins; otherwise the bundled MSpace GCash / QR Ph code is used for both methods.
  const file = setting(req.params.method === 'gcash' ? 'gcash_qr' : 'instapay_qr');
  const uploaded = file && path.join(UPLOAD_DIR, path.basename(file));
  res.sendFile(uploaded && existsSync(uploaded) ? uploaded : path.join(PUBLIC_DIR, 'img', 'gcash-qr.png'));
});

// ---------- step 3: customer sign-up / sign-in ----------
const publicCustomer = (c) => c && ({ id: c.id, email: c.email, name: c.name, phone: c.phone, picture: c.picture, provider: c.provider });
app.get('/api/me', (req, res) => res.json({ customer: publicCustomer(customerFromRequest(req)) }));
app.post('/api/auth/google', async (req, res) => {
  try {
    const c = await signInWithGoogle(req.body?.credential);
    loginCustomer(res, c);
    res.json({ customer: publicCustomer(c) });
  } catch (e) { bad(res, e.message || 'Google sign-in failed.', 401); }
});
app.post('/api/auth/email', (req, res) => {
  try {
    const c = signUpWithEmail(req.body || {});
    loginCustomer(res, c);
    res.json({ customer: publicCustomer(c) });
  } catch (e) { bad(res, e.message); }
});
app.post('/api/auth/logout', (req, res) => { logoutCustomer(res); res.json({ ok: true }); });
app.post('/api/me', (req, res) => {
  const c = customerFromRequest(req);
  if (!c) return bad(res, 'Please sign in first.', 401);
  const phone = String(req.body?.phone || '').trim().slice(0, 30);
  const name = String(req.body?.name || c.name).trim().slice(0, 80);
  res.json({ customer: publicCustomer(updateCustomer(c.id, { phone, name: name || c.name })) });
});
app.get('/api/my-bookings', (req, res) => {
  const c = customerFromRequest(req);
  if (!c) return bad(res, 'Please sign in first.', 401);
  res.json({ bookings: listBookings().filter((b) => b.customer_id === c.id).map((b) => publicBooking(b, { full: true })) });
});

// ---------- steps 4–5: booking + payment ----------
app.post('/api/bookings', (req, res) => {
  const c = customerFromRequest(req);
  if (!c) return bad(res, 'Please sign in first.', 401);
  const { plan, startDate, phone, agreed } = req.body || {};
  if (!agreed) return bad(res, 'Please agree to the policies and house rules.');
  try {
    const { start, end } = computeWindow(plan, startDate);
    const cleanPhone = String(phone || c.phone || '').trim().slice(0, 30);
    if (cleanPhone && cleanPhone !== c.phone) updateCustomer(c.id, { phone: cleanPhone });
    const b = createBooking({
      customer_id: c.id, name: c.name, email: c.email, phone: cleanPhone, plan, amount: PLANS[plan].price,
      start_at: start.getTime(), end_at: end.getTime(), agreed_at: Date.now(),
    });
    res.json({ booking: publicBooking(b, { full: true }) });
  } catch (e) { bad(res, e.message); }
});

app.post('/api/bookings/:id/payment', upload.single('proof'), async (req, res) => {
  const c = customerFromRequest(req);
  const b = getBooking(req.params.id);
  if (!b || !c || b.customer_id !== c.id) return bad(res, 'Booking not found.', 404);
  if (b.status !== 'new' && b.status !== 'pending') return bad(res, 'This booking can no longer be edited.');
  const method = String(req.body.method || '');
  if (!PAYMENT_METHODS[method]) return bad(res, 'Please choose GCash or InstaPay.');
  if (!req.file) return bad(res, 'Please attach a screenshot of your payment receipt (PNG or JPG).');
  const updated = updateBooking(b.id, {
    status: 'pending', payment_method: method, payment_ref: null, paid_at: Date.now(), proof_path: req.file.filename,
  });
  sendTemplate('paymentReceived', updated).catch(() => {});
  if (process.env.OWNER_EMAIL) {
    const t = templates.ownerNewPayment(updated);
    sendMail({ to: process.env.OWNER_EMAIL, subject: t.subject, html: t.html, bookingId: b.id }).catch(() => {});
  }
  res.json({ booking: publicBooking(updated, { full: true }) });
});

// ---------- steps 6–8: pass page (timer, keybox code, checkout) ----------
app.get('/api/pass/:token', (req, res) => {
  const b = getBookingByToken(req.params.token);
  if (!b) return bad(res, 'Pass not found.', 404);
  res.json({ booking: publicBooking(b), checklist: CHECKOUT_CHECKLIST, hours: HOURS, now: Date.now(), wifi: b.status === 'confirmed' ? { name: setting('wifi_name'), password: setting('wifi_password') } : null });
});
app.post('/api/pass/:token/checkout', (req, res) => {
  const b = getBookingByToken(req.params.token);
  if (!b) return bad(res, 'Pass not found.', 404);
  if (!['confirmed', 'expired'].includes(b.status)) return bad(res, 'This pass is not active.');
  const done = req.body?.checklist || {};
  const missing = CHECKOUT_CHECKLIST.filter((c) => !done[c.id]);
  if (missing.length) return bad(res, 'Please tick every item on the checkout list.');
  const expected = setting('checkout_code') || b.keybox_code || setting('keybox_code');
  const entered = String(req.body?.keyboxCode || '').replace(/\s+/g, '');
  if (expected && entered !== String(expected).replace(/\s+/g, '')) return bad(res, 'The keybox code is incorrect. Enter the code from your email to confirm you returned the keys.');
  const updated = updateBooking(b.id, { status: 'checked_out', checked_out_at: Date.now(), checkout_checklist: JSON.stringify(done) });
  res.json({ booking: publicBooking(updated) });
});

// ---------- admin ----------
app.post('/api/admin/login', (req, res) => {
  try {
    if (adminLogin(res, req.body?.password || '')) return res.json({ ok: true });
    bad(res, 'Wrong password.', 401);
  } catch (e) { bad(res, e.message, 500); }
});
app.post('/api/admin/logout', (req, res) => { adminLogout(res); res.json({ ok: true }); });
app.get('/api/admin/session', (req, res) => res.json({ admin: isAdmin(req), mailEnabled: mailEnabled(), googleEnabled: googleEnabled(), publicUrl: PUBLIC_URL }));

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  res.json({ stats: stats(), bookings: listBookings({ status: req.query.status }).map((b) => publicBooking(b, { full: true })), settings: allSettings() });
});
app.get('/api/admin/customers', requireAdmin, (req, res) => res.json({ customers: listCustomers() }));
app.get('/api/admin/customers.csv', requireAdmin, (req, res) => {
  const rows = [['id', 'name', 'email', 'phone', 'provider', 'signed_up', 'last_login', 'visits', 'passes', 'spent']];
  for (const c of listCustomers()) rows.push([c.id, c.name, c.email, c.phone || '', c.provider, new Date(c.created_at).toISOString(), new Date(c.last_login_at).toISOString(), c.visits, c.passes, c.spent]);
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="mspace-customers.csv"');
  res.send(rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));
});
app.get('/api/admin/proof/:id', requireAdmin, (req, res) => {
  const b = getBooking(req.params.id);
  const full = b?.proof_path && path.join(UPLOAD_DIR, path.basename(b.proof_path));
  if (!full || !existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});
app.post('/api/admin/bookings/:id/confirm', requireAdmin, async (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  const code = String(req.body?.keyboxCode || '').trim() || null;
  if (!code && !setting('keybox_code')) return bad(res, 'Set the keybox code in Settings first (or type one for this booking).');
  const updated = updateBooking(b.id, { status: 'confirmed', confirmed_at: Date.now(), keybox_code: code, notes: req.body?.notes ?? b.notes });
  const mail = await sendTemplate('confirmed', updated);
  res.json({ booking: publicBooking(updated, { full: true }), mail });
});
app.post('/api/admin/bookings/:id/reject', requireAdmin, async (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  const updated = updateBooking(b.id, { status: 'rejected', notes: req.body?.reason ?? b.notes });
  const mail = await sendTemplate('rejected', updated, req.body?.reason || '');
  res.json({ booking: publicBooking(updated, { full: true }), mail });
});
app.post('/api/admin/bookings/:id/resend', requireAdmin, async (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || b.status !== 'confirmed') return bad(res, 'Only confirmed bookings can be resent.');
  res.json({ mail: await sendTemplate('confirmed', b) });
});
app.post('/api/admin/bookings/:id/checkout', requireAdmin, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  res.json({ booking: publicBooking(updateBooking(b.id, { status: 'checked_out', checked_out_at: Date.now(), notes: 'Checked out by staff' }), { full: true }) });
});
app.post('/api/admin/bookings/:id/cancel', requireAdmin, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b) return bad(res, 'Not found', 404);
  res.json({ booking: publicBooking(updateBooking(b.id, { status: 'cancelled' }), { full: true }) });
});
app.post('/api/admin/settings', requireAdmin, upload.fields([{ name: 'gcash_qr', maxCount: 1 }, { name: 'instapay_qr', maxCount: 1 }]), (req, res) => {
  const fields = { ...req.body };
  if (req.files?.gcash_qr?.[0]) fields.gcash_qr = req.files.gcash_qr[0].filename;
  if (req.files?.instapay_qr?.[0]) fields.instapay_qr = req.files.instapay_qr[0].filename;
  saveSettings(fields);
  res.json({ settings: allSettings() });
});
app.get('/api/admin/outbox', requireAdmin, (req, res) => res.json({ outbox: listOutbox() }));
app.get('/api/admin/outbox/:id', requireAdmin, (req, res) => {
  const m = getOutboxItem(req.params.id);
  if (!m) return res.status(404).end();
  res.type('html').send(m.html);
});
app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  const to = req.body?.to || process.env.OWNER_EMAIL || process.env.SMTP_USER;
  res.json({ mail: await sendMail({ to, subject: 'MSpace test email', html: '<p>Your MSpace booking site can send email. 🎉</p>' }) });
});

// Printable entrance poster with the QR code customers scan on arrival (step 2).
app.get('/admin/poster', async (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin');
  const svg = await QRCode.toString(PUBLIC_URL, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  const plans = Object.values(PLANS).map((p) => `<div class="plan"><b>${p.name}</b><span>${peso(p.price)}</span><small>${p.access}</small></div>`).join('');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>MSpace – Scan to book</title>
  <style>
    @page{size:A4;margin:12mm} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#000;color:#fff}
    .sheet{max-width:720px;margin:0 auto;padding:40px 32px;text-align:center;min-height:100vh;box-sizing:border-box}
    .logo{font-size:64px;font-weight:800;letter-spacing:1px}.logo b{color:#c9a24a}
    .sub{letter-spacing:6px;font-size:14px;color:#c9a24a;text-transform:uppercase;margin-top:-6px}
    h1{font-size:36px;margin:28px 0 6px}.lead{color:#bbb;font-size:18px;margin:0 0 24px}
    .qr{background:#fff;padding:20px;border-radius:24px;display:inline-block;width:320px}.qr svg{width:100%;height:auto;display:block}
    .url{margin:14px 0 26px;color:#c9a24a;font-size:18px;word-break:break-all}
    .plans{display:flex;gap:14px;justify-content:center}.plan{flex:1;border:1px solid #c9a24a;border-radius:16px;padding:14px 8px}
    .plan b{display:block;font-size:15px}.plan span{display:block;font-size:30px;font-weight:800;color:#c9a24a;margin:4px 0}.plan small{color:#bbb}
    .steps{margin:28px auto 0;text-align:left;max-width:520px;color:#ddd;line-height:1.7;font-size:15px}
    .foot{margin-top:26px;color:#888;font-size:13px;letter-spacing:2px;text-transform:uppercase}
    .print{position:fixed;top:12px;right:12px;background:#c9a24a;color:#000;border:0;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer}
    @media print{.print{display:none}.sheet{min-height:auto}}
  </style></head><body>
  <button class="print" onclick="print()">Print</button>
  <div class="sheet">
    <img src="/img/logo.png" alt="MSpace" style="width:220px;height:220px;display:block;margin:0 auto -20px"><div class="sub">24/7 Coworking · Mlang</div>
    <h1>Scan to book your pass</h1>
    <p class="lead">No walk-in. Pre-registered only. Sign up with your Gmail, pay via GCash or InstaPay, get your keybox code by email.</p>
    <div class="qr">${svg}</div>
    <div class="url">${PUBLIC_URL}</div>
    <div class="plans">${plans}</div>
    <div class="steps">1. Scan the QR code<br>2. Sign up with your Gmail<br>3. Choose a pass and agree to the house rules<br>4. Pay via GCash / InstaPay QR<br>5. Check your email for the keybox code</div>
    <div class="foot">Start Local · Work Global</div>
  </div></body></html>`);
});

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return bad(res, 'Image is too large (max 8 MB).');
  console.error(err);
  bad(res, 'Something went wrong. Please try again.', 500);
});

app.listen(PORT, () => {
  console.log(`MSpace booking site running at ${PUBLIC_URL} (port ${PORT})`);
  console.log(`  email: ${mailEnabled() ? 'SMTP enabled' : 'DRY-RUN (set SMTP_* in .env)'} · google sign-in: ${googleEnabled() ? 'enabled' : 'fallback form (set GOOGLE_CLIENT_ID)'}`);
  startScheduler();
});
