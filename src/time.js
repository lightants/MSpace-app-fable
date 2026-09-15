import { HOURS, PLANS } from './content.js';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// The whole process runs in Manila time (set in server.js), so plain Date math is local time.
export function atHour(date, h, m = 0) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
export function sameDay(a, b) {
  a = new Date(a); b = new Date(b);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}

/** Compute the access window for a plan starting on a given YYYY-MM-DD. Throws with a customer-friendly message. */
export function computeWindow(planId, startDateStr, now = new Date()) {
  const plan = PLANS[planId];
  if (!plan) throw new Error('Please choose a valid pass.');
  const day = parseDateStr(startDateStr);
  if (!day) throw new Error('Please choose a valid start date.');
  const today = atHour(now, 0);
  if (day < today) throw new Error('The start date cannot be in the past.');
  if (day > addDays(today, 60)) throw new Error('You can book up to 60 days in advance.');

  if (planId === 'daily') {
    const start = atHour(day, HOURS.dailyStart);
    const end = atHour(day, HOURS.dailyEnd);
    if (end <= now) throw new Error('Today\'s daily window (6:00 AM – 6:00 PM) has already ended. Please choose tomorrow or later.');
    return { start, end };
  }
  // Weekly / monthly: 24/7 from the start day, ending 6:00 PM on the last day (start day counts as day 1).
  const start = sameDay(day, now) ? new Date(now) : atHour(day, 0);
  const end = atHour(addDays(day, plan.days - 1), HOURS.dailyEnd);
  return { start, end };
}

const fmtOpts = { timeZone: 'Asia/Manila' };
export function fmtDateTime(ms) {
  return new Date(ms).toLocaleString('en-PH', { ...fmtOpts, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-PH', { ...fmtOpts, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-PH', { ...fmtOpts, hour: 'numeric', minute: '2-digit' });
}
export function peso(n) {
  return '₱' + Number(n).toLocaleString('en-PH');
}
