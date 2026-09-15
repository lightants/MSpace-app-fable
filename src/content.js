// Everything a customer reads: plans, policies, house rules, checkout checklist.
// Edit the text here; the site, emails and pass page all read from this file.

export const BUSINESS = {
  name: 'MSpace',
  tagline: 'Work · Create · Learn · Build — from Mlang to the world',
  email: 'mspacemind@gmail.com',
  location: 'Mlang, Cotabato',
  timezone: 'Asia/Manila',
};

// Daily pass window and checkout window (24-hour clock, Manila time)
export const HOURS = {
  dailyStart: 6,     // 6:00 AM
  dailyEnd: 18,      // 6:00 PM
  checkoutStart: 9,  // 9:00 AM
  checkoutEnd: 18,   // 6:00 PM
};

export const PLANS = {
  daily: {
    id: 'daily',
    name: 'Daily Pass',
    price: 150,
    days: 1,
    access: '6:00 AM – 6:00 PM',
    blurb: 'One full working day. Perfect for a focused sprint.',
    features: ['Access 6:00 AM – 6:00 PM', 'Keybox code for self check-in', 'Fast Wi-Fi & cool aircon', 'Free coffee & tea', 'Power outlets at every seat'],
  },
  weekly: {
    id: 'weekly',
    name: 'Weekly Pass',
    price: 600,
    days: 7,
    access: '24/7 for 7 days',
    blurb: 'Seven days of round-the-clock access. Great for night-shift VAs.',
    features: ['24/7 access for 7 days', 'Keybox code for after-hours entry', 'Fast Wi-Fi, aircon, coffee & tea', 'Expiry reminders by email'],
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly Pass',
    price: 2000,
    days: 30,
    access: '24/7 for 30 days',
    blurb: 'Your desk away from home. Best value for full-time remote workers.',
    features: ['24/7 access for 30 days', 'Keybox code for after-hours entry', 'Fast Wi-Fi, aircon, coffee & tea', 'Expiry reminders by email', 'A community that builds'],
    popular: true,
  },
};

export const POLICIES = [
  'Pre-registration only. There are no walk-ins. Every pass (Daily, Weekly, Monthly) is self check-in: access is granted only after your payment screenshot is verified and a keybox code is emailed to you.',
  'Passes are personal and non-transferable. Never share your keybox code with anyone.',
  'Daily Pass: access from 6:00 AM to 6:00 PM on the date you choose. Weekly and Monthly Passes: 24/7 access, ending at 6:00 PM on your last day.',
  'Checkout hours are 9:00 AM to 6:00 PM. Complete the checkout checklist before you leave on your last day.',
  'Payments are non-refundable. Unused days are not carried over or extended.',
  'MSpace is not liable for lost, stolen or damaged belongings. Keep your valuables with you.',
  'Keys must never leave the premises. Return the keys to the keybox every time you leave.',
  'Report damage, incidents or safety concerns to mspacemind@gmail.com right away.',
  'By booking you consent to MSpace storing your name, email and phone number to manage your pass and send reminders.',
];

export const HOUSE_RULES = [
  'Keep the volume down. Use headphones and take calls at a considerate level; keep it quiet after 10:00 PM.',
  'Keep your table clean. Do not leave food or wrappers on tables to prevent insects. Use the bins.',
  'Turn off the aircon and lights when you are the last person leaving.',
  'Lock the doors when you are the last person leaving and put the keys back inside the keybox.',
  'No smoking, vaping, alcohol or illegal substances anywhere on the premises.',
  'No guests. Every person inside must have a valid MSpace pass.',
  'Handle shared equipment with care and report any issue immediately.',
  'Be kind. This is a community that builds each other up.',
];

export const CHECKOUT_CHECKLIST = [
  { id: 'ac',    icon: '❄️', text: 'Turn off the aircon if no other customer is inside.' },
  { id: 'table', icon: '🧹', text: 'Clean up your table. Throw away food and wrappers to prevent insects.' },
  { id: 'doors', icon: '🔒', text: 'Lock the doors if no other customer is inside.' },
  { id: 'keys',  icon: '🔑', text: 'Put the keys inside the keybox, close it and scramble the dial.' },
];

export const PAYMENT_METHODS = {
  gcash:    { id: 'gcash',    name: 'GCash' },
  instapay: { id: 'instapay', name: 'InstaPay (bank app)' },
};
