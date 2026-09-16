/* Pass page: status, live countdown, keybox code, Wi-Fi, checkout checklist. */
const API = (window.MSPACE_API || '').replace(/\/$/, '');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDT = (ms) => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const token = new URLSearchParams(location.search).get('t') || location.pathname.split('/').pop();
let data, offset = 0, timer;

const STATUS_TEXT = {
  new: 'Payment not yet submitted', pending: 'Verifying your payment', confirmed: 'Active pass', checked_out: 'Checked out — thank you!',
  expired: 'Pass ended', rejected: 'Payment could not be verified', cancelled: 'Booking cancelled',
};

function pad(n) { return String(n).padStart(2, '0'); }
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function tickCountdown() {
  const b = data.booking; const now = Date.now() + offset; const el = $('#cd');
  if (!el) return;
  if (now < b.start_at) {
    el.innerHTML = `<div class="lbl">Your pass starts in</div><div class="time">${fmtLeft(b.start_at - now)}</div><div class="sub">${fmtDT(b.start_at)}</div>`;
  } else if (now < b.end_at) {
    const left = b.end_at - now;
    el.innerHTML = `<div class="lbl">Time remaining</div><div class="time ${left < 3600e3 ? 'warn' : ''}">${fmtLeft(left)}</div><div class="sub">Ends ${fmtDT(b.end_at)} · checkout by ${data.hours.checkoutEnd - 12}:00 PM</div>`;
  } else {
    el.innerHTML = `<div class="lbl">Pass ended</div><div class="time warn">00:00:00</div><div class="sub">Ended ${fmtDT(b.end_at)}. Please complete checkout below.</div>`;
    if (b.status === 'confirmed') { clearInterval(timer); setTimeout(load, 5000); }
  }
}

function render() {
  const b = data.booking; const active = b.status === 'confirmed';
  const showChecklist = ['confirmed', 'expired'].includes(b.status);
  $('#main').innerHTML = `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h2>${esc(b.planName)} · ${esc(b.id)}</h2><span class="pill ${b.status}">${esc(STATUS_TEXT[b.status] || b.status)}</span>
    </div>
    <p class="lead">${esc(b.name)}</p>
    ${b.status === 'pending' ? `<div class="alert info">⏳ We are verifying your ${esc(b.payment_method)} payment screenshot. Your keybox code will be emailed to <b>${esc(b.email)}</b>. This page updates automatically.</div>` : ''}
    ${b.status === 'rejected' ? `<div class="alert error">We could not verify this payment. Please reply to our email with your receipt, or <a href="index.html">book again</a>.</div>` : ''}
    ${b.status === 'new' ? `<div class="alert info">This booking has no payment yet. <a href="index.html">Continue to payment →</a></div>` : ''}
    ${active || b.status === 'expired' ? `<div class="countdown" id="cd"></div>` : ''}
    ${active ? `<div class="codebox" id="codebox" title="Tap to reveal"><div class="lbl">Keybox code · tap to reveal</div><div class="code blur" id="code">${esc(b.keybox_code || '····')}</div></div>
      <p class="small muted center">Open the keybox, take the key, unlock the door, then <b>put the key back inside the keybox</b>. Never share this code.</p>` : ''}
    <div class="kv"><span>Access</span><b>${fmtDT(b.start_at)} → ${fmtDT(b.end_at)}</b></div>
    <div class="kv"><span>Checkout hours</span><b>${data.hours.checkoutStart}:00 AM – ${data.hours.checkoutEnd - 12}:00 PM</b></div>
    ${data.wifi?.name ? `<div class="kv"><span>Wi-Fi</span><b>${esc(data.wifi.name)} · ${esc(data.wifi.password)}</b></div>` : ''}
    ${b.checked_out_at ? `<div class="kv"><span>Checked out</span><b>${fmtDT(b.checked_out_at)}</b></div>` : ''}
  </div>
  ${showChecklist ? `
  <div class="card checklist">
    <h2>Checkout list</h2>
    <p class="lead">Run through this every time you leave. On your last day, tap the button to complete checkout.</p>
    ${data.checklist.map((c) => `<label class="check"><input type="checkbox" data-id="${c.id}"><span>${c.icon} ${esc(c.text)}</span></label>`).join('')}
    <label class="field" style="margin-top:14px"><span>Keybox code (from your email) — confirms you returned the keys</span><input id="kbcode" inputmode="numeric" autocomplete="off" placeholder="e.g. 2468"></label>
    <div id="err"></div>
    <div class="actions"><button class="btn primary block" id="checkout" disabled>Complete checkout</button></div>
    <p class="small muted center" style="margin-top:10px">Leaving for a bit and coming back? Just do the list — no need to press the button until your last day.</p>
  </div>` : ''}
  ${b.status === 'checked_out' ? `<div class="card center"><h2>Thank you for building with us! 🙌</h2><p class="muted">Same people, bigger possibilities. See you next time.</p><div class="actions"><a class="btn primary" href="index.html">Book your next pass</a></div></div>` : ''}`;

  $('#codebox')?.addEventListener('click', () => $('#code').classList.toggle('blur'));
  const boxes = [...document.querySelectorAll('.checklist input')];
  const sync = () => { const ok = boxes.every((x) => x.checked) && $('#kbcode').value.trim().length > 0; $('#checkout').disabled = !ok; boxes.forEach((x) => x.closest('.check').classList.toggle('done', x.checked)); };
  boxes.forEach((x) => x.addEventListener('change', sync));
  $('#kbcode')?.addEventListener('input', sync);
  $('#checkout')?.addEventListener('click', async () => {
    const checklist = Object.fromEntries(boxes.map((x) => [x.dataset.id, x.checked]));
    if (!confirm('Complete checkout? This ends your pass on our side.')) return;
    const r = await fetch(`${API}/api/pass/${token}/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklist, keyboxCode: $('#kbcode').value }) });
    const j = await r.json();
    if (!r.ok) { $('#err').innerHTML = `<div class="alert error">${esc(j.error)}</div>`; return; }
    data.booking = j.booking; clearInterval(timer); render();
  });
  if ($('#cd')) { clearInterval(timer); tickCountdown(); timer = setInterval(tickCountdown, 1000); }
}

async function load() {
  const r = await fetch(`${API}/api/pass/${token}`);
  const j = await r.json();
  if (!r.ok) { $('#main').innerHTML = `<div class="card"><div class="alert error">${esc(j.error)}</div><a class="btn primary" href="index.html">Book a pass</a></div>`; return; }
  data = j; offset = j.now - Date.now(); render();
  if (['pending', 'new'].includes(j.booking.status)) setTimeout(load, 20000);   // auto-refresh while waiting for verification
}
load();
