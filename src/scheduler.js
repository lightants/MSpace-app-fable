// Runs every minute: expires passes, sends expiry / checkout reminders (each at most once per booking),
// and cancels abandoned bookings that never reached the payment step.
import { activeBookings, claimNotification, stalePending, updateBooking } from './db.js';
import { sendTemplate } from './mailer.js';
import { DAY, HOUR, MIN, atHour, sameDay } from './time.js';
import { HOURS } from '../public/js/content.js';

async function notify(b, kind, template, ...args) {
  if (!claimNotification(b.id, kind)) return;
  await sendTemplate(template, b, ...args);
}

export async function tick(now = Date.now()) {
  const today = new Date(now);
  for (const b of activeBookings()) {
    try {
      if (b.end_at <= now) {
        updateBooking(b.id, { status: 'expired' });
        await notify(b, 'expired', 'expired');
        continue;
      }
      if (now < b.start_at) continue;            // pass has not started yet
      const left = b.end_at - now;
      const lastDay = sameDay(b.end_at, today);

      if (b.plan !== 'daily') {
        if (left <= 3 * DAY && left > 1 * DAY) await notify(b, 'expiry_3d', 'expiryReminder', 3);
        if (left <= 1 * DAY && !lastDay)        await notify(b, 'expiry_1d', 'expiryReminder', 1);
      }
      // Morning of the last day (from 9:00 AM), unless the pass was only confirmed after that time today.
      const checkoutOpens = atHour(today, HOURS.checkoutStart).getTime();
      if (lastDay && now >= checkoutOpens && (b.confirmed_at || 0) < checkoutOpens) {
        await notify(b, 'checkout_morning', 'checkoutMorning');
      }
      if (left <= 1 * HOUR) await notify(b, 'checkout_1h', 'checkoutSoon');
    } catch (err) {
      console.error('[scheduler]', b.id, err.message);
    }
  }
  // Abandoned bookings (never submitted payment) are cancelled after 24 hours.
  for (const b of stalePending(24 * HOUR)) updateBooking(b.id, { status: 'cancelled' });
}

export function startScheduler() {
  tick().catch((e) => console.error('[scheduler]', e));
  setInterval(() => tick().catch((e) => console.error('[scheduler]', e)), MIN);
}
