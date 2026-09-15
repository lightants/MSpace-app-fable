import nodemailer from 'nodemailer';
import { logEmail, setting } from './db.js';
import { BUSINESS, PLANS, CHECKOUT_CHECKLIST, HOURS } from '../public/js/content.js';
import { fmtDateTime, fmtDate, fmtTime, peso } from './time.js';

const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:4600').replace(/\/$/, '');
const FROM = process.env.MAIL_FROM || `MSpace <${BUSINESS.email}>`;

let transport = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
export const mailEnabled = () => !!transport;

/** Send an email; always recorded in the outbox (status sent | dry-run | failed). */
export async function sendMail({ to, subject, html, bookingId }) {
  if (!transport) {
    logEmail({ bookingId, to, subject, html, status: 'dry-run' });
    console.log(`[mail dry-run] to=${to} subject="${subject}"`);
    return { ok: true, dryRun: true };
  }
  try {
    await transport.sendMail({ from: FROM, to, subject, html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    logEmail({ bookingId, to, subject, html, status: 'sent' });
    return { ok: true };
  } catch (err) {
    logEmail({ bookingId, to, subject, html, status: 'failed', error: String(err.message || err) });
    console.error('[mail failed]', to, subject, err.message);
    return { ok: false, error: err.message };
  }
}

// ---------- layout ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#0b0b0b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#f3ede1">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px">
    <div style="text-align:center;margin-bottom:22px">
      <div style="font-size:34px;font-weight:800;letter-spacing:1px;color:#fff"><span style="color:#c9a24a">M</span>Space</div>
      <div style="font-size:11px;letter-spacing:3px;color:#9a9080;text-transform:uppercase">24/7 Coworking · Mlang</div>
    </div>
    <div style="background:#161410;border:1px solid #3a3326;border-radius:16px;padding:24px">
      <h1 style="font-size:20px;margin:0 0 14px;color:#fff">${esc(title)}</h1>
      ${body}
    </div>
    <p style="color:#6f6656;font-size:12px;text-align:center;margin-top:18px">
      ${esc(BUSINESS.name)} · ${esc(BUSINESS.location)} · <a href="mailto:${BUSINESS.email}" style="color:#c9a24a">${BUSINESS.email}</a><br>
      Start Local. Work Global.
    </p>
  </div></body></html>`;
}
const p = (s) => `<p style="line-height:1.55;margin:0 0 12px;color:#e9e2d3">${s}</p>`;
const box = (label, value) => `<div style="background:#0b0b0b;border:1px dashed #c9a24a;border-radius:12px;padding:14px;text-align:center;margin:16px 0">
  <div style="font-size:11px;letter-spacing:2px;color:#9a9080;text-transform:uppercase">${esc(label)}</div>
  <div style="font-size:30px;font-weight:800;letter-spacing:6px;color:#e7c87a;margin-top:4px">${esc(value)}</div></div>`;
const button = (href, label) => `<p style="text-align:center;margin:20px 0"><a href="${href}" style="background:#c9a24a;color:#1a1610;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:10px;display:inline-block">${esc(label)}</a></p>`;
const rows = (pairs) => `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:10px 0 16px">${pairs
  .map(([k, v]) => `<tr><td style="padding:6px 0;color:#9a9080;border-bottom:1px dashed #3a3326">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600;border-bottom:1px dashed #3a3326">${esc(v)}</td></tr>`)
  .join('')}</table>`;

export function checklistHtml() {
  return `<ol style="padding-left:18px;margin:8px 0 14px">${CHECKOUT_CHECKLIST.map((c) => `<li style="margin:6px 0;line-height:1.5">${c.icon} ${esc(c.text)}</li>`).join('')}</ol>`;
}
const passLink = (b) => `${PUBLIC_URL}/pass.html?t=${b.token}`;
const planName = (b) => PLANS[b.plan]?.name ?? b.plan;
const summary = (b) => rows([
  ['Booking ID', b.id],
  ['Pass', planName(b)],
  ['Starts', fmtDateTime(b.start_at)],
  ['Ends', fmtDateTime(b.end_at)],
  ['Amount', peso(b.amount)],
]);

// ---------- templates ----------
export const templates = {
  paymentReceived(b) {
    return {
      subject: `We received your payment details — ${b.id}`,
      html: layout('Thanks! We\'re verifying your payment.', [
        p(`Hi ${esc(b.name)}, we got your ${esc(b.payment_method === 'gcash' ? 'GCash' : 'InstaPay')} payment screenshot for a ${esc(planName(b))}.`),
        summary(b),
        p('As soon as we verify the payment you will receive another email with your <b>keybox code</b>. This usually takes a few minutes during the day.'),
        button(passLink(b), 'View my pass'),
      ].join('')),
    };
  },
  confirmed(b) {
    const code = b.keybox_code || setting('keybox_code') || '(ask staff)';
    const wifi = setting('wifi_name') ? p(`Wi-Fi: <b>${esc(setting('wifi_name'))}</b> · Password: <b>${esc(setting('wifi_password'))}</b>`) : '';
    return {
      subject: `Your MSpace keybox code — ${planName(b)} ${b.id}`,
      html: layout('You\'re in! Here is your keybox code.', [
        p(`Hi ${esc(b.name)}, your payment is confirmed. Welcome to MSpace.`),
        box('Keybox code', code),
        p('Open the keybox at the entrance, take the key, unlock the door, and <b>put the key back inside the keybox</b> right away. Never share this code.'),
        summary(b),
        wifi,
        p(`<b>Checkout hours: ${HOURS.checkoutStart}:00 AM – ${HOURS.checkoutEnd - 12}:00 PM.</b> Before you leave, please:`),
        checklistHtml(),
        p('Your pass page has a live countdown of your remaining time and the checkout checklist.'),
        button(passLink(b), 'Open my pass & timer'),
      ].join('')),
    };
  },
  rejected(b, reason) {
    return {
      subject: `We couldn't verify your payment — ${b.id}`,
      html: layout('Payment not verified', [
        p(`Hi ${esc(b.name)}, we could not match your payment screenshot to a received payment.`),
        reason ? p(`Note from MSpace: ${esc(reason)}`) : '',
        p(`Please reply to this email with a screenshot of your payment, or book again at <a href="${PUBLIC_URL}" style="color:#c9a24a">${PUBLIC_URL}</a>.`),
      ].join('')),
    };
  },
  expiryReminder(b, daysLeft) {
    return {
      subject: `Your ${planName(b)} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${b.id}`,
      html: layout(`${daysLeft} day${daysLeft === 1 ? '' : 's'} left on your pass`, [
        p(`Hi ${esc(b.name)}, your ${esc(planName(b))} ends on <b>${esc(fmtDateTime(b.end_at))}</b>.`),
        p(`To keep your desk without interruption, book your next pass at <a href="${PUBLIC_URL}" style="color:#c9a24a">${PUBLIC_URL}</a>. Same people, bigger possibilities.`),
        button(passLink(b), 'See remaining time'),
      ].join('')),
    };
  },
  checkoutMorning(b) {
    return {
      subject: `Today is your last day — checkout by ${fmtTime(b.end_at)} · ${b.id}`,
      html: layout('Checkout today', [
        p(`Hi ${esc(b.name)}, your ${esc(planName(b))} ends today at <b>${esc(fmtTime(b.end_at))}</b>. Checkout hours are ${HOURS.checkoutStart}:00 AM – ${HOURS.checkoutEnd - 12}:00 PM.`),
        p('Before you leave:'),
        checklistHtml(),
        p('On your pass page, tick the list and <b>enter your keybox code</b> to confirm you returned the keys.'),
        button(passLink(b), 'Complete checkout'),
      ].join('')),
    };
  },
  checkoutSoon(b) {
    return {
      subject: `1 hour left — please check out by ${fmtTime(b.end_at)} · ${b.id}`,
      html: layout('One hour left', [
        p(`Hi ${esc(b.name)}, your pass ends at <b>${esc(fmtTime(b.end_at))}</b>. Please finish up and run through the checkout list:`),
        checklistHtml(),
        button(passLink(b), 'Complete checkout'),
      ].join('')),
    };
  },
  expired(b) {
    return {
      subject: `Your pass has ended — thank you! · ${b.id}`,
      html: layout('Your pass has ended', [
        p(`Hi ${esc(b.name)}, your ${esc(planName(b))} ended on ${esc(fmtDate(b.end_at))}. Thank you for building with us.`),
        p(`If you are still inside, please complete the checkout list and return the keys to the keybox. Your keybox code no longer grants access.`),
        checklistHtml(),
        button(PUBLIC_URL, 'Book your next pass'),
      ].join('')),
    };
  },
  ownerNewPayment(b) {
    return {
      subject: `[MSpace] Payment to verify: ${b.name} · ${planName(b)} · ${peso(b.amount)}`,
      html: layout('New payment submitted', [
        summary(b),
        rows([['Customer', b.name], ['Email', b.email], ['Phone', b.phone || '—'], ['Method', b.payment_method], ['Proof', 'Screenshot attached in dashboard']]),
        button(`${PUBLIC_URL}/admin`, 'Open admin dashboard'),
      ].join('')),
    };
  },
};

export async function sendTemplate(name, b, ...args) {
  const t = templates[name](b, ...args);
  return sendMail({ to: b.email, subject: t.subject, html: t.html, bookingId: b.id });
}
