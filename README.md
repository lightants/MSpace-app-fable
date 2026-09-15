# MSpace 24/7 Booking Site

Pre-booking website for MSpace coworking (Mlang). Customers scan the entrance QR, sign up with
Gmail, pick a pass, agree to the house rules, pay via GCash / InstaPay QR, and receive their
keybox code by email. The site then reminds them about checkout and pass expiry.

## The customer flow

| Step | What happens | Where |
|---|---|---|
| 1 | Customer arrives and scans the QR poster | Admin → **Entrance QR poster** (print it) |
| 2 | Signs up with Gmail (name + email captured, phone asked next) | `/` step 1 |
| 3 | Chooses Daily ₱150 (6 AM–6 PM) · Weekly ₱600 · Monthly ₱2,000 and a start date | `/` step 2 |
| 4 | Reads and agrees to policies, house rules and the checkout list | `/` step 3 |
| 5 | Pays via the MSpace GCash / QR Ph code and uploads a screenshot of the receipt | `/` step 4 |
| 6 | Staff verifies in Admin → **Confirm & send code** → keybox code emailed | `/admin` |
| 7 | Pass page shows a live time counter, keybox code (all passes, Daily included), Wi-Fi and checkout list | `/pass/<token>` (link in email) |
| 8 | Reminder emails: 3 days / 1 day before expiry (weekly & monthly), 9 AM on the last day, 1 hour before the end, and when the pass ends | automatic |

Checkout list (in every email and on the pass page): aircon off if nobody else is inside, table
cleaned to prevent insects, doors locked if nobody else is inside, keys back in the keybox. The customer then enters the keybox code to confirm checkout.

## Run it locally

```bash
cd booking-site
cp .env.example .env      # then edit .env
npm install
npm start                 # http://localhost:4600  ·  admin at /admin
```

Requires Node 22.13 or newer (uses the built-in SQLite). Data lives in `data/mspace.sqlite`;
uploaded QR images and payment screenshots go in `data/uploads/`.

## One-time setup (in order)

1. **`.env`** – set `ADMIN_PASSWORD`, `SESSION_SECRET` (any long random string) and `PUBLIC_URL`
   (the address customers will open, e.g. `https://book.mspace.ph`).
2. **Email** – in your Google account create an *App Password*
   (Google Account → Security → 2-Step Verification → App passwords) and put it in `SMTP_PASS`
   with `SMTP_USER=mspacemind@gmail.com`. Until you do, emails are recorded in Admin → **Emails**
   as "dry-run" so you can preview them.
3. **Sign in with Google** – in Google Cloud Console create *APIs & Services → Credentials →
   OAuth client ID → Web application*, add your `PUBLIC_URL` (and `http://localhost:4600` for
   testing) under *Authorized JavaScript origins*, and put the client ID in `GOOGLE_CLIENT_ID`.
   Until you do, customers sign up with a simple name + Gmail form instead.
4. **Admin → Settings** – enter the keybox code, GCash / InstaPay account details, upload your
   GCash and QR Ph images, and the Wi-Fi details.
5. **Admin → Entrance QR poster** – print and post it at the door.

## Daily operation

* New payments appear under Admin → Bookings → *pending* (you also get an email at `OWNER_EMAIL`).
  Check the reference in your GCash / bank app, then **Confirm & send code**.
  Use **Reject** if the payment cannot be found; the customer gets an email.
* **Resend code** after you change the physical keybox combination (update Settings first).
* Admin → **Customers** lists every sign-up with passes bought and total spent; **Export CSV**
  downloads the list.
* Abandoned bookings (no payment submitted within 24 h) are cancelled automatically.

## Changing prices, rules or hours

Everything customers read is in `src/content.js`: plans and prices, policies, house rules,
the checkout checklist and the daily / checkout hours. Restart the server after editing.

## Going live

Any host that runs Node works (Render, Railway, Fly.io, a small VPS with `pm2`). Set the
`.env` values as environment variables there, keep the `data/` folder on persistent storage,
and put the site behind HTTPS (required for Google sign-in and for the admin cookie).
The process runs in Manila time regardless of the server's location.
