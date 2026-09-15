/* MSpace booking flow: 1 sign up (Gmail) → 2 choose pass → 3 agree to rules → 4 pay via QR → 5 done */
const API = (window.MSPACE_API || '').replace(/\/$/, '');
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH');
const fmtDT = (ms) => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const api = async (url, opts = {}) => {
  const r = await fetch(API + url, { headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, credentials: 'include', ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const state = {
  config: null, me: null, step: 1,
  plan: sessionStorage.getItem('ms_plan') || 'monthly',
  startDate: null, phone: '', booking: null, method: 'gcash', error: '',
};
try { state.booking = JSON.parse(sessionStorage.getItem('ms_booking') || 'null'); } catch {}

function setStep(n) {
  state.step = n; state.error = '';
  document.querySelectorAll('#steps div').forEach((d) => {
    const s = +d.dataset.step; d.className = s < n ? 'done' : s === n ? 'active' : '';
  });
  $('#hero').classList.toggle('hidden', n > 1);
  render();
  window.scrollTo({ top: n > 1 ? $('#steps').offsetTop - 8 : 0, behavior: 'smooth' });
}
function renderWho() {
  const me = state.me;
  $('#who').innerHTML = me
    ? `${me.picture ? `<img src="${esc(me.picture)}" alt="">` : ''}<span>${esc(me.name)}</span> <button class="btn small" id="signout">Sign out</button>`
    : '';
  $('#signout')?.addEventListener('click', async () => { if (!state.offline) await api('/api/auth/logout', { method: 'POST' }); sessionStorage.removeItem('ms_booking'); sessionStorage.removeItem('ms_offline_me'); location.reload(); });
}
const errorHtml = () => (state.error ? `<div class="alert error">${esc(state.error)}</div>` : '');

/* ---------- step 1: sign up with Gmail ---------- */
function renderSignup() {
  const cfg = state.config;
  $('#main').innerHTML = `
  <div class="card">
    <h2>Sign up to book a pass</h2>
    <p class="lead">We use your Gmail to send your keybox code, checkout reminders and expiry notices. VAs, freelancers, AI builders — you belong here.</p>
    ${errorHtml()}
    ${cfg.googleClientId ? `<div id="gsi-btn" style="display:flex;justify-content:center;margin:10px 0 6px"></div>
      <p class="center small muted">Signed in securely by Google. We only receive your name and email.</p>` : `
    <form id="emailForm">
      <label class="field"><span>Full name</span><input name="name" required placeholder="Juan dela Cruz" autocomplete="name"></label>
      <label class="field"><span>Gmail address</span><input name="email" type="email" required placeholder="you@gmail.com" autocomplete="email" inputmode="email"></label>
      <label class="field"><span>Mobile number (GCash)</span><input name="phone" placeholder="09XX XXX XXXX" autocomplete="tel" inputmode="tel"></label>
      <button class="btn primary block" type="submit">Continue</button>
    </form>`}
  </div>
  <div class="card">
    <h3>How it works</h3>
    <ol class="rules"><li>Sign up with your Gmail.</li><li>Choose a Daily, Weekly or Monthly pass.</li><li>Agree to the policies &amp; house rules.</li><li>Pay via GCash or InstaPay QR and upload a screenshot of your receipt.</li><li>We verify and email your <b>keybox code</b>. Your pass page shows a live time counter and checkout list.</li></ol>
  </div>`;
  if (cfg.googleClientId) mountGoogle();
  $('#emailForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (state.offline) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email || '')) { state.error = 'Please enter a valid email address.'; return render(); }
      state.me = { name: f.name.trim(), email: f.email.trim().toLowerCase(), phone: (f.phone || '').trim() };
      sessionStorage.setItem('ms_offline_me', JSON.stringify(state.me)); renderWho(); return afterSignIn();
    }
    try {
      const { customer } = await api('/api/auth/email', { method: 'POST', body: JSON.stringify(f) });
      state.me = customer; renderWho(); await afterSignIn();
    } catch (err) { state.error = err.message; render(); }
  });
}
function mountGoogle() {
  const init = () => {
    google.accounts.id.initialize({
      client_id: state.config.googleClientId, ux_mode: 'popup',
      callback: async ({ credential }) => {
        try {
          const { customer } = await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) });
          state.me = customer; renderWho(); await afterSignIn();
        } catch (err) { state.error = err.message; render(); }
      },
    });
    google.accounts.id.renderButton($('#gsi-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signup_with', width: 300 });
  };
  if (window.google?.accounts) return init();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init; document.head.appendChild(s);
}
async function afterSignIn() {
  if (state.offline) return setStep(2);
  // Resume an unfinished booking, otherwise show existing passes + start a new one.
  const { bookings } = await api('/api/my-bookings');
  state.myBookings = bookings;
  const unfinished = bookings.find((b) => b.status === 'new');
  if (unfinished) { state.booking = unfinished; sessionStorage.setItem('ms_booking', JSON.stringify(unfinished)); return setStep(4); }
  setStep(2);
}

/* ---------- step 2: choose pass ---------- */
function previewWindow(planId, dateStr) {
  const plan = state.config.plans.find((p) => p.id === planId);
  const [y, m, d] = dateStr.split('-').map(Number); const day = new Date(y, m - 1, d);
  const at = (dt, h) => { const x = new Date(dt); x.setHours(h, 0, 0, 0); return x; };
  if (planId === 'daily') return { start: at(day, state.config.hours.dailyStart), end: at(day, state.config.hours.dailyEnd) };
  const end = new Date(day); end.setDate(end.getDate() + plan.days - 1);
  return { start: at(day, 0), end: at(end, state.config.hours.dailyEnd) };
}
function renderPlans() {
  const cfg = state.config;
  state.startDate ||= cfg.today;
  const mine = (state.myBookings || []).filter((b) => ['pending', 'confirmed'].includes(b.status));
  $('#main').innerHTML = `
  ${mine.length ? `<div class="card"><h3>Your passes</h3>${mine.map((b) => `<div class="kv"><span>${esc(b.planName)} · ${esc(b.id)} <span class="pill ${b.status}">${b.status}</span></span><b><a href="pass.html?t=${b.token}">Open pass →</a></b></div>`).join('')}</div>` : ''}
  <div class="card">
    <h2>Choose your pass</h2>
    <p class="lead">Hi ${esc(state.me.name.split(' ')[0])}! Pick the pass that fits your grind.</p>
    ${errorHtml()}
    <div class="plans">${cfg.plans.map((p) => `
      <button type="button" class="plan ${state.plan === p.id ? 'selected' : ''}" data-plan="${p.id}">
        ${p.popular ? '<span class="badge">Best value</span>' : ''}
        <b>${esc(p.name)}</b><div class="price">${peso(p.price)}</div><div class="access">${esc(p.access)}</div>
        <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      </button>`).join('')}</div>
    <div class="row">
      <label class="field"><span>Start date</span><input type="date" id="startDate" min="${cfg.today}" value="${state.startDate}"></label>
      <label class="field"><span>Mobile number (GCash)</span><input id="phone" placeholder="09XX XXX XXXX" inputmode="tel" value="${esc(state.phone || state.me.phone || '')}"></label>
    </div>
    <div class="window" id="window"></div>
    <div class="actions"><button class="btn primary" id="toRules">Continue to house rules →</button></div>
  </div>`;
  const updateWindow = () => {
    const w = previewWindow(state.plan, state.startDate);
    $('#window').innerHTML = `Access from <b>${fmtDT(w.start)}</b> until <b>${fmtDT(w.end)}</b>. Checkout hours ${cfg.hours.checkoutStart}:00 AM – ${cfg.hours.checkoutEnd - 12}:00 PM.`;
  };
  updateWindow();
  document.querySelectorAll('.plan').forEach((el) => el.addEventListener('click', () => {
    state.plan = el.dataset.plan; sessionStorage.setItem('ms_plan', state.plan);
    document.querySelectorAll('.plan').forEach((p) => p.classList.toggle('selected', p === el)); updateWindow();
  }));
  $('#startDate').addEventListener('change', (e) => { state.startDate = e.target.value || cfg.today; updateWindow(); });
  $('#phone').addEventListener('input', (e) => { state.phone = e.target.value; });
  $('#toRules').addEventListener('click', () => {
    state.phone = $('#phone').value.trim();
    if (state.phone.replace(/\D/g, '').length < 10) { state.error = 'Please enter your mobile number so we can reach you about your booking.'; return render(); }
    setStep(3);
  });
}

/* ---------- step 3: policies & house rules ---------- */
function renderRules() {
  const cfg = state.config;
  $('#main').innerHTML = `
  <div class="card">
    <h2>Policies &amp; house rules</h2>
    <p class="lead">Please read and agree before paying. Good ideas work anytime — so does good behaviour. ♡</p>
    ${errorHtml()}
    <div class="scrollbox">
      <h3>Policies</h3><ol class="rules">${cfg.policies.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <h3>House rules</h3><ol class="rules">${cfg.houseRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <h3>Checkout list (every time you leave)</h3><ol class="rules">${cfg.checklist.map((c) => `<li>${c.icon} ${esc(c.text)}</li>`).join('')}</ol>
    </div>
    <label class="check"><input type="checkbox" id="agreePolicies"><span>I have read and agree to the <b>MSpace policies</b>.</span></label>
    <label class="check"><input type="checkbox" id="agreeRules"><span>I agree to follow the <b>house rules</b> and the <b>checkout list</b> (aircon off, table clean, doors locked, keys in the keybox).</span></label>
    <label class="check"><input type="checkbox" id="agreeKeybox"><span>I understand my <b>keybox code is personal</b> and I will not share it.</span></label>
    <div class="actions"><button class="btn" id="back">← Back</button><button class="btn primary" id="agree" disabled>I agree — continue to payment</button></div>
  </div>`;
  const boxes = ['#agreePolicies', '#agreeRules', '#agreeKeybox'].map((s) => $(s));
  const sync = () => { $('#agree').disabled = !boxes.every((b) => b.checked); boxes.forEach((b) => b.closest('.check').classList.toggle('done', b.checked)); };
  boxes.forEach((b) => b.addEventListener('change', sync));
  $('#back').addEventListener('click', () => setStep(2));
  $('#agree').addEventListener('click', async () => {
    $('#agree').disabled = true; $('#agree').textContent = 'Creating booking…';
    if (state.offline) {
      const plan = state.config.plans.find((p) => p.id === state.plan); const w = previewWindow(state.plan, state.startDate);
      if (w.end <= Date.now()) { state.error = 'Today\'s daily window (6:00 AM – 6:00 PM) has already ended. Please choose tomorrow or later.'; return render(); }
      state.booking = { id: 'MS-' + Math.random().toString(16).slice(2, 8).toUpperCase(), plan: plan.id, planName: plan.name, amount: plan.price,
        start_at: w.start.getTime(), end_at: w.end.getTime(), name: state.me.name, email: state.me.email, phone: state.phone, startDate: state.startDate };
      sessionStorage.setItem('ms_booking', JSON.stringify(state.booking)); return setStep(4);
    }
    try {
      const { booking } = await api('/api/bookings', { method: 'POST', body: JSON.stringify({ plan: state.plan, startDate: state.startDate, phone: state.phone, agreed: true }) });
      state.booking = booking; sessionStorage.setItem('ms_booking', JSON.stringify(booking)); setStep(4);
    } catch (err) { state.error = err.message; render(); }
  });
}

/* ---------- step 4: pay via GCash / InstaPay QR ---------- */
function renderPay() {
  const cfg = state.config; const b = state.booking; const pay = cfg.payment[state.method];
  const acct = state.method === 'gcash'
    ? `<div class="acct">GCash · <b>${esc(pay.number)}</b><button class="copy" data-copy="${esc(pay.number)}">copy</button><br><span class="muted small">Account name: ${esc(pay.name)}</span></div>`
    : `<div class="acct">${esc(pay.bank)} · <b>${esc(pay.number)}</b><button class="copy" data-copy="${esc(pay.number)}">copy</button><br><span class="muted small">Account name: ${esc(pay.name)}</span></div>`;
  $('#main').innerHTML = `
  <div class="card">
    <h2>Pay ${esc(b.planName)}</h2>
    <p class="lead">Booking <b>${esc(b.id)}</b> · ${fmtDT(b.start_at)} → ${fmtDT(b.end_at)}</p>
    <div class="amount">${peso(b.amount)}</div>
    <div class="methods"><button type="button" data-m="gcash" class="${state.method === 'gcash' ? 'on' : ''}">GCash</button><button type="button" data-m="instapay" class="${state.method === 'instapay' ? 'on' : ''}">InstaPay</button></div>
    <div class="qrbox"><img src="${API}${pay.qr}?v=${Date.now()}" alt="${esc(state.method)} QR code"></div>
    ${acct}
    <ol class="rules small"><li>Open your ${state.method === 'gcash' ? 'GCash app → Scan QR' : 'bank app → InstaPay / QR Ph'} and scan the code above.</li><li>Send exactly <b>${peso(b.amount)}</b>.</li><li>Take a <b>screenshot of the receipt</b> and upload it below.</li></ol>
    ${errorHtml()}
    <form id="payForm" style="margin-top:14px">
      <label class="field"><span>Payment screenshot (required)</span><input name="proof" type="file" accept="image/*" required></label>
      <div class="actions"><button class="btn" type="button" id="cancel">Cancel</button><button class="btn primary" type="submit">I have paid — submit</button></div>
    </form>
  </div>`;
  document.querySelectorAll('.methods button').forEach((el) => el.addEventListener('click', () => { state.method = el.dataset.m; render(); }));
  document.querySelectorAll('.copy').forEach((el) => el.addEventListener('click', () => { navigator.clipboard?.writeText(el.dataset.copy); el.textContent = 'copied!'; }));
  $('#cancel').addEventListener('click', () => { sessionStorage.removeItem('ms_booking'); state.booking = null; setStep(2); });
  $('#payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#payForm button[type=submit]'); btn.disabled = true; btn.textContent = 'Submitting…';
    const fd = new FormData(e.target); fd.set('method', state.method);
    if (state.offline) {
      const subject = `MSpace ${b.planName} — ${b.name} — ${b.id}`;
      const body = `Booking ID: ${b.id}\nName: ${b.name}\nMobile: ${b.phone}\nEmail: ${b.email}\nPass: ${b.planName} (₱${b.amount})\nAccess: ${fmtDT(b.start_at)} → ${fmtDT(b.end_at)}\nPaid via: ${state.method === 'gcash' ? 'GCash' : 'InstaPay'}\n\n>>> Please ATTACH your payment screenshot to this email before sending. <<<\n\nI agree to the MSpace policies, house rules and checkout list.`;
      location.href = `mailto:mspacemind@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      b.payment_method = state.method; b.offline = true; sessionStorage.removeItem('ms_booking'); return setTimeout(() => setStep(5), 400);
    }
    try {
      const { booking } = await api(`/api/bookings/${b.id}/payment`, { method: 'POST', body: fd });
      state.booking = booking; sessionStorage.removeItem('ms_booking'); setStep(5);
    } catch (err) { state.error = err.message; render(); }
  });
}

/* ---------- step 5: done ---------- */
function renderDone() {
  const b = state.booking; const cfg = state.config;
  if (b.offline) {
    $('#main').innerHTML = `
  <div class="card">
    <div class="alert success">✅ Almost done! Your email app opened with your reservation.</div>
    <h2>What happens next</h2>
    <ol class="rules">
      <li><b>Attach your payment screenshot</b> to that email and press send. <a href="#" id="reopen">Open the email again</a> if it closed.</li>
      <li>We verify the payment and email your <b>keybox code</b> to <b>${esc(b.email)}</b>. Check spam if it does not arrive.</li>
      <li>Open the keybox, take the key, unlock, and <b>put the key back inside the keybox</b>.</li>
      <li>Before leaving: aircon off, table clean, doors locked, keys in the keybox.</li>
    </ol>
    <div class="kv"><span>Booking ID</span><b>${esc(b.id)}</b></div>
    <div class="kv"><span>Pass</span><b>${esc(b.planName)} · ₱${Number(b.amount).toLocaleString('en-PH')}</b></div>
    <div class="kv"><span>Access</span><b>${fmtDT(b.start_at)} → ${fmtDT(b.end_at)}</b></div>
    <div class="kv"><span>Checkout hours</span><b>${cfg.hours.checkoutStart}:00 AM – ${cfg.hours.checkoutEnd - 12}:00 PM</b></div>
    <div class="actions"><a class="btn primary" href="index.html">Book another pass</a></div>
  </div>`;
    $('#reopen').addEventListener('click', (e) => { e.preventDefault(); state.step = 4; state.booking = b; renderPay(); $('#payForm').requestSubmit(); });
    return;
  }
  $('#main').innerHTML = `
  <div class="card">
    <div class="alert success">✅ Payment submitted! We are verifying your ${esc(b.planName)}.</div>
    <h2>What happens next</h2>
    <ol class="rules">
      <li>We check your ${esc(b.payment_method === 'gcash' ? 'GCash' : 'InstaPay')} payment screenshot.</li>
      <li>Your <b>keybox code</b> is emailed to <b>${esc(b.email)}</b>. Check spam if it does not arrive.</li>
      <li>Open the keybox, take the key, unlock, and <b>put the key back inside the keybox</b>.</li>
      <li>Your pass page has a live time counter, Wi-Fi details and the checkout list.</li>
    </ol>
    <div class="kv"><span>Booking ID</span><b>${esc(b.id)}</b></div>
    <div class="kv"><span>Access</span><b>${fmtDT(b.start_at)} → ${fmtDT(b.end_at)}</b></div>
    <div class="kv"><span>Checkout hours</span><b>${cfg.hours.checkoutStart}:00 AM – ${cfg.hours.checkoutEnd - 12}:00 PM</b></div>
    <div class="actions"><a class="btn primary" href="pass.html?t=${b.token}">Open my pass page →</a></div>
    <p class="small muted center" style="margin-top:12px">Bookmark your pass page — the link is also in your email.</p>
  </div>`;
}

function render() {
  ({ 1: renderSignup, 2: renderPlans, 3: renderRules, 4: renderPay, 5: renderDone })[state.step]();
}

(async function init() {
  try {
    const [cfg, me] = await Promise.all([api('/api/config'), api('/api/me')]);
    state.config = cfg; state.me = me.customer; renderWho();
    if (state.me) await afterSignIn(); else setStep(1);
  } catch (err) {
    await startOffline(err);
  }
})();

/* Offline mode (GitHub Pages without the booking server): the same 5 steps run in the browser;
   the reservation + screenshot are emailed to MSpace at the pay step. */
async function startOffline(err) {
  console.warn('Booking server unreachable, running offline:', err?.message);
  const m = await import('./content.js');
  state.offline = true;
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  state.config = {
    business: m.BUSINESS, hours: m.HOURS, plans: Object.values(m.PLANS), policies: m.POLICIES, houseRules: m.HOUSE_RULES,
    checklist: m.CHECKOUT_CHECKLIST, paymentMethods: Object.values(m.PAYMENT_METHODS), payment: m.PAYMENT_DEFAULTS,
    today: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, googleClientId: null,
  };
  try { state.me = JSON.parse(sessionStorage.getItem('ms_offline_me') || 'null'); } catch { state.me = null; }
  renderWho();
  if (state.me && state.booking) return setStep(4);
  if (state.me) return setStep(2);
  setStep(1);
}
