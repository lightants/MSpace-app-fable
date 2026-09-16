/* Admin: verify payments (sends keybox code), customers, settings, email log, poster. */
const API = (window.MSPACE_API || '').replace(/\/$/, '');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH');
const fmtDT = (ms) => (ms ? new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const api = async (url, opts = {}) => {
  const r = await fetch(API + url, { headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, credentials: 'include', ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); };
const state = { session: null, tab: 'bookings', filter: 'pending', data: null };

function renderLogin(err = '') {
  $('#main').innerHTML = `<div class="card" style="max-width:420px;margin:40px auto"><h2>Staff login</h2><p class="lead">Enter the admin password from your .env file.</p>
    ${err ? `<div class="alert error">${esc(err)}</div>` : ''}
    <form id="login"><label class="field"><span>Password</span><input type="password" name="password" required autofocus></label><button class="btn primary block">Log in</button></form></div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) }); init(); }
    catch (er) { renderLogin(er.message); }
  });
}

const mailNote = (m) => (m?.dryRun ? ' (email DRY-RUN — configure SMTP in .env to really send)' : m?.ok === false ? ` (EMAIL FAILED: ${m.error})` : ' — email sent');

async function refresh() {
  state.data = await api(`/api/admin/overview?status=${state.filter}`);
  render();
}
function shell(inner) {
  const s = state.data.stats;
  $('#who').innerHTML = `<span class="small">${state.session.mailEnabled ? '📧 SMTP on' : '📧 dry-run'} · ${state.session.googleEnabled ? 'G sign-in on' : 'email sign-up'}</span> <button class="btn small" id="logout">Log out</button>`;
  $('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); };
  $('#main').innerHTML = `
  <div class="stats">
    <div class="stat"><div class="n">${s.pending}</div><div class="l">To verify</div></div>
    <div class="stat"><div class="n">${s.active}</div><div class="l">Active now</div></div>
    <div class="stat"><div class="n">${s.upcoming}</div><div class="l">Upcoming</div></div>
    <div class="stat"><div class="n">${s.customers}</div><div class="l">Customers</div></div>
    <div class="stat"><div class="n">${peso(s.revenue30)}</div><div class="l">Revenue · 30d</div></div>
  </div>
  <div class="tabs">${['bookings', 'customers', 'settings', 'emails'].map((t) => `<button data-t="${t}" class="${state.tab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    <a class="btn small" href="${API}/admin/poster" target="_blank">🖨 Entrance QR poster</a><a class="btn small" href="index.html" target="_blank">Customer site ↗</a></div>
  <div id="tab">${inner}</div>`;
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { state.tab = b.dataset.t; render(); });
}

/* ---------- bookings ---------- */
function renderBookings() {
  const rows = state.data.bookings;
  const filters = ['pending', 'confirmed', 'new', 'checked_out', 'expired', 'rejected', 'cancelled', 'all'];
  shell(`
  <div class="filters">${filters.map((f) => `<button data-f="${f}" class="${state.filter === f ? 'on' : ''}">${f.replace('_', ' ')}</button>`).join('')}</div>
  <div class="card tablewrap">${rows.length ? `<table class="data"><thead><tr><th>Booking</th><th>Customer</th><th>Pass</th><th>Access window</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead><tbody>
    ${rows.map((b) => `<tr>
      <td><b>${esc(b.id)}</b><div class="sub">${fmtDT(b.created_at)}</div></td>
      <td>${esc(b.name)}<div class="sub">${esc(b.email)}<br>${esc(b.phone || '')}</div></td>
      <td>${esc(b.planName)}<div class="sub">${peso(b.amount)}</div></td>
      <td class="sub">${fmtDT(b.start_at)}<br>→ ${fmtDT(b.end_at)}</td>
      <td>${b.payment_method ? `${esc(b.payment_method)}` : '<span class="sub">none yet</span>'}${b.proof_path ? `<div><a class="btn small" href="${API}/api/admin/proof/${b.id}" target="_blank">📷 View screenshot</a></div>` : ''}</td>
      <td><span class="pill ${b.status}">${b.status.replace('_', ' ')}</span>${b.keybox_code ? `<div class="sub">code ${esc(b.keybox_code)}</div>` : ''}${b.notifications?.length ? `<div class="sub">${b.notifications.map((n) => n.kind).join(', ')}</div>` : ''}</td>
      <td style="white-space:nowrap">
        ${b.status === 'pending' ? `<button class="btn small success" data-a="confirm" data-id="${b.id}">✓ Confirm & send code</button> <button class="btn small danger" data-a="reject" data-id="${b.id}">Reject</button>` : ''}
        ${b.status === 'confirmed' ? `<button class="btn small" data-a="resend" data-id="${b.id}">Resend code</button> <button class="btn small" data-a="checkout" data-id="${b.id}">Check out</button>` : ''}
        ${['new', 'pending'].includes(b.status) ? `<button class="btn small" data-a="cancel" data-id="${b.id}">Cancel</button>` : ''}
        <a class="btn small" href="pass.html?t=${b.token}" target="_blank">Pass ↗</a>
      </td></tr>`).join('')}</tbody></table>` : '<p class="muted center">No bookings here.</p>'}</div>`);
  document.querySelectorAll('.filters button').forEach((b) => b.onclick = () => { state.filter = b.dataset.f; refresh(); });
  document.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => action(b.dataset.a, b.dataset.id));
}
async function action(a, id) {
  try {
    if (a === 'confirm') return confirmModal(id);
    if (a === 'reject') { const reason = prompt('Reason (sent to the customer):', 'No matching payment found for this reference.'); if (reason === null) return; const { mail } = await api(`/api/admin/bookings/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); toast('Rejected' + mailNote(mail)); }
    if (a === 'resend') { const { mail } = await api(`/api/admin/bookings/${id}/resend`, { method: 'POST' }); toast('Keybox code resent' + mailNote(mail)); }
    if (a === 'checkout') { if (!confirm('Mark this pass as checked out?')) return; await api(`/api/admin/bookings/${id}/checkout`, { method: 'POST' }); toast('Checked out'); }
    if (a === 'cancel') { if (!confirm('Cancel this booking?')) return; await api(`/api/admin/bookings/${id}/cancel`, { method: 'POST' }); toast('Cancelled'); }
    refresh();
  } catch (e) { toast('Error: ' + e.message); }
}
function confirmModal(id) {
  const b = state.data.bookings.find((x) => x.id === id); const cur = state.data.settings.keybox_code;
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><h2>Confirm ${esc(b.id)}</h2><p class="lead">${esc(b.name)} · ${esc(b.planName)} · ${peso(b.amount)} via ${esc(b.payment_method)} · <a href="${API}/api/admin/proof/${b.id}" target="_blank">📷 view screenshot</a></p>
    <label class="field"><span>Keybox code to email</span><input id="kb" value="${esc(cur)}" placeholder="e.g. 2468"></label>
    <p class="small muted">Defaults to the current keybox code from Settings. Change it here only if this customer gets a different code.</p>
    <div class="actions"><button class="btn" id="mclose">Cancel</button><button class="btn primary" id="mgo">Confirm & email code</button></div></div>`;
  document.body.appendChild(m);
  $('#mclose').onclick = () => m.remove();
  $('#mgo').onclick = async () => {
    $('#mgo').disabled = true;
    try { const { mail } = await api(`/api/admin/bookings/${id}/confirm`, { method: 'POST', body: JSON.stringify({ keyboxCode: $('#kb').value }) }); toast('Confirmed' + mailNote(mail)); m.remove(); refresh(); }
    catch (e) { toast('Error: ' + e.message); $('#mgo').disabled = false; }
  };
}

/* ---------- customers ---------- */
async function renderCustomers() {
  const { customers } = await api('/api/admin/customers');
  shell(`<div class="card tablewrap"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap"><h2>Customers (${customers.length})</h2><a class="btn small" href="${API}/api/admin/customers.csv">⬇ Export CSV</a></div>
    ${customers.length ? `<table class="data"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Valid ID</th><th>Sign-up</th><th>Last seen</th><th>Passes</th><th>Spent</th></tr></thead><tbody>
    ${customers.map((c) => `<tr><td>${c.picture ? `<img src="${esc(c.picture)}" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px">` : ''}${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone || '—')}</td><td>${c.id_path ? `${esc(c.id_type)}<div><a class="btn small" href="${API}/api/admin/customers/${c.id}/id-photo" target="_blank">🪪 View ID</a></div>` : '<span class="sub">not uploaded</span>'}</td><td class="sub">${esc(c.provider)} · ${fmtDT(c.created_at)}</td><td class="sub">${fmtDT(c.last_login_at)} · ${c.visits} visits</td><td>${c.passes}</td><td>${peso(c.spent)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted center">No customers yet. They appear here as soon as they sign up with Gmail.</p>'}</div>`);
}

/* ---------- settings ---------- */
function renderSettings() {
  const s = state.data.settings;
  const f = (k, label, ph = '', type = 'text') => `<label class="field"><span>${label}</span><input name="${k}" type="${type}" value="${esc(s[k])}" placeholder="${esc(ph)}"></label>`;
  shell(`<form id="settings" class="card">
    <h2>Settings</h2>
    <h3>Keybox</h3>${f('keybox_code', 'Current keybox code (emailed to confirmed customers)', 'e.g. 2468')}
    <p class="small muted">When you change the physical combination, update it here and use "Resend code" for active customers.</p>
    ${f('checkout_code', 'Checkout code (customers must enter this to complete checkout)', 'leave blank to use the keybox code above')}
    <p class="small muted">Confirms the customer returned the keys. Leave blank and the keybox code above is used.</p>
    <h3>GCash</h3><div class="row">${f('gcash_name', 'Account name')}${f('gcash_number', 'GCash number', '09XX XXX XXXX')}</div>
    <label class="field"><span>GCash QR image ${s.gcash_qr ? '(custom upload ✓)' : '(using the bundled MSpace QR Ph code)'}</span><input type="file" name="gcash_qr" accept="image/*"></label>
    <h3>InstaPay</h3><div class="row">${f('instapay_name', 'Account name')}${f('instapay_bank', 'Bank')}${f('instapay_number', 'Account number')}</div>
    <label class="field"><span>InstaPay / QR Ph image ${s.instapay_qr ? '(custom upload ✓)' : '(using the bundled MSpace QR Ph code)'}</span><input type="file" name="instapay_qr" accept="image/*"></label>
    <h3>Wi-Fi (shown on the pass page and in the code email)</h3><div class="row">${f('wifi_name', 'Network name')}${f('wifi_password', 'Password')}</div>
    <h3>Location</h3><div class="row">${f('address', 'Address')}${f('maps_url', 'Google Maps link', 'https://maps.app.goo.gl/…')}</div>
    <div class="actions"><button class="btn primary">Save settings</button><button class="btn" type="button" id="testmail">Send test email</button></div>
  </form>`);
  $('#settings').onsubmit = async (e) => { e.preventDefault(); try { const { settings } = await api('/api/admin/settings', { method: 'POST', body: new FormData(e.target) }); state.data.settings = settings; toast('Settings saved'); render(); } catch (er) { toast('Error: ' + er.message); } };
  $('#testmail').onclick = async () => { const to = prompt('Send a test email to:', 'mspacemind@gmail.com'); if (!to) return; const { mail } = await api('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to }) }); toast('Test' + mailNote(mail)); };
}

/* ---------- email log ---------- */
async function renderEmails() {
  const { outbox } = await api('/api/admin/outbox');
  shell(`<div class="card tablewrap"><h2>Email log</h2><p class="lead">${state.session.mailEnabled ? 'Emails are sent through SMTP.' : 'SMTP is not configured: emails are recorded here as dry-run so you can preview them. Set SMTP_* in .env to send for real.'}</p>
    ${outbox.length ? `<table class="data"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>
    ${outbox.map((m) => `<tr><td class="sub">${fmtDT(m.created_at)}</td><td>${esc(m.to_addr)}</td><td>${esc(m.subject)}</td><td><span class="pill ${m.status === 'sent' ? 'confirmed' : m.status === 'failed' ? 'rejected' : 'pending'}">${m.status}</span>${m.error ? `<div class="sub">${esc(m.error)}</div>` : ''}</td><td><a class="btn small" href="${API}/api/admin/outbox/${m.id}" target="_blank">Preview</a></td></tr>`).join('')}
    </tbody></table>` : '<p class="muted center">No emails yet.</p>'}</div>`);
}

function render() {
  const fn = { bookings: renderBookings, customers: renderCustomers, settings: renderSettings, emails: renderEmails }[state.tab];
  Promise.resolve().then(fn).catch((e) => toast('Error: ' + e.message));
}
async function init() {
  state.session = await api('/api/admin/session');
  if (!state.session.admin) return renderLogin();
  await refresh();
  setInterval(() => { if (state.tab === 'bookings') refresh(); }, 30000);
}
init();
