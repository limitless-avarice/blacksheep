// Blacksheep store back end: Express API with JSON file storage.
// Run: npm install && npm start   (default http://localhost:3000)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);

/* ---------- Settings ---------- */
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data'); // use a persistent disk in production
const PUBLIC_DIR = path.join(__dirname, 'public');
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Blacksheep <onboarding@resend.dev>';
const DROP_DATE = process.env.DROP_DATE || '';
const HOLD_MINUTES = 30; // unpaid online orders release their stock after this long

// EDIT: promo codes. type "percent" or "fixed" (GHS).
const PROMOS = { NOTONEOFTHEM10: { type: 'percent', value: 10 }, WELCOME20: { type: 'fixed', value: 20 } };

let ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (ADMIN_TOKEN.length < 12 || ADMIN_TOKEN === 'change-me') {
  if (PROD) { console.error('Set ADMIN_TOKEN to a long random string (12+ characters) before starting in production.'); process.exit(1); }
  ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');
  console.log('Dev admin token (set ADMIN_TOKEN to choose your own): ' + ADMIN_TOKEN);
}

const PRODUCTS_FILE = path.join(PUBLIC_DIR, 'data', 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscribers.json');
const STOCK_FILE = path.join(DATA_DIR, 'stock.json');
const NOTIFY_FILE = path.join(DATA_DIR, 'notify.json');
const LOCATIONS_FILE = path.join(PUBLIC_DIR, 'data', 'locations.json'); // towns, delivery fees, delivery days and time slots

/* ---------- Helpers ---------- */
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ghs = n => 'GH\u20B5' + Number(n).toFixed(2);
const digits = s => String(s || '').replace(/\D/g, '');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ORDER_RE = /^BS-[A-F0-9]{6}$/;
const phoneOk = v => {
  const s = String(v).trim();
  if (!/^[+0-9 ()-]+$/.test(s)) return false;
  const d = digits(s);
  if (s.startsWith('+')) return d.length >= 8 && d.length <= 15;
  return (d.length === 10 && d[0] === '0') || (d.length === 12 && d.startsWith('233'));
};

const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const k = name + ':' + req.ip, now = Date.now();
  const h = (hits.get(k) || []).filter(t => now - t < windowMs);
  if (h.length >= max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  h.push(now); hits.set(k, h); next();
};
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 600000)) hits.delete(k); }, 600000).unref();

/* ---------- Catalogue and stock (stock lives in DATA_DIR so redeploys never reset it) ---------- */
const baseCatalog = () => read(PRODUCTS_FILE, { collections: [], products: [] });
function loadStock() {
  const base = baseCatalog();
  const s = read(STOCK_FILE, {});
  let changed = false;
  for (const p of base.products) {
    if (!s[p.id]) { s[p.id] = { ...p.stock }; changed = true; continue; }
    for (const sz of Object.keys(p.stock)) if (s[p.id][sz] === undefined) { s[p.id][sz] = p.stock[sz]; changed = true; }
  }
  if (changed) write(STOCK_FILE, s);
  return s;
}
function catalog() {
  const c = baseCatalog(), s = loadStock();
  c.products = c.products.map(p => ({ ...p, stock: s[p.id] || p.stock }));
  return c;
}
function reserve(o) {
  const s = loadStock();
  if (o.items.some(l => (s[l.id] && s[l.id][l.size] !== undefined ? s[l.id][l.size] : 0) < l.qty)) return false;
  for (const l of o.items) s[l.id][l.size] -= l.qty;
  write(STOCK_FILE, s); return true;
}
function restock(o) {
  if (o.restocked) return;
  const s = loadStock();
  for (const l of o.items) if (s[l.id] && s[l.id][l.size] !== undefined) s[l.id][l.size] += l.qty;
  write(STOCK_FILE, s); o.restocked = true;
}

/* ---------- Pricing ---------- */
const findPromo = code => { const k = String(code || '').trim().toUpperCase(); return PROMOS[k] ? { code: k, ...PROMOS[k] } : null; };
const calcDiscount = (p, sub) => p.type === 'percent' ? Math.round(sub * p.value) / 100 : Math.min(p.value, sub);

/* ---------- Delivery places, fees and schedule (edit public/data/locations.json) ---------- */
const locations = () => read(LOCATIONS_FILE, { freeDeliveryOver: 0, regions: [], otherRegion: { name: 'Outside Greater Accra', fee: 100 }, schedule: { earliestDaysAhead: 1, daysToShow: 7, closedWeekdays: [], timeSlots: [] } });
// Ghana is on GMT all year, so the server clock (UTC) is Ghana time.
function deliveryDates() {
  const S = locations().schedule, now = new Date(), out = [];
  for (let i = S.earliestDaysAhead; out.length < S.daysToShow && i < S.earliestDaysAhead + 40; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    if (!(S.closedWeekdays || []).includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
function deliveryFor(region, town, sub) {
  const L = locations();
  if (L.freeDeliveryOver && sub >= L.freeDeliveryOver) return 0;
  if (region === L.otherRegion.name) return L.otherRegion.fee;
  const r = L.regions.find(x => x.name === region), t = r && r.towns.find(x => x.name === town);
  return t ? t.fee : L.otherRegion.fee;
}

/* ---------- Orders ---------- */
function updateOrder(id, fn) {
  const orders = read(ORDERS_FILE, []);
  const o = orders.find(x => x.id === id);
  if (!o) return null;
  fn(o); write(ORDERS_FILE, orders); return o;
}
function cancel(o, note) { if (o.status === 'cancelled') return; o.status = 'cancelled'; o.note = note; restock(o); }
const publicOrder = o => ({
  id: o.id, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, createdAt: o.createdAt,
  schedule: o.schedule || null, place: [o.customer.city, o.customer.region].filter(Boolean).join(', '),
  items: o.items, subtotal: o.subtotal, discount: o.discount, delivery: o.delivery, total: o.total,
  paymentUrl: (o.paymentMethod === 'online' && o.paymentStatus !== 'paid' && o.status === 'pending') ? o.paymentUrl || null : null
});

async function sendMail(to, subject, html) {
  if (!RESEND_API_KEY || !to) return;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }) });
    if (!r.ok) console.error('Email failed:', r.status, await r.text());
  } catch (e) { console.error('Email failed:', e.message); }
}
async function notifyOrder(o) {
  const rows = o.items.map(l => `<tr><td>${esc(l.name)} (${esc(l.size)})</td><td>x${l.qty}</td><td>${ghs(l.price * l.qty)}</td></tr>`).join('');
  const html = `<h2>Order ${o.id}</h2><table cellpadding="4">${rows}</table><p>Subtotal ${ghs(o.subtotal)}${o.discount ? ', discount -' + ghs(o.discount) : ''}, delivery ${ghs(o.delivery)}.<br><b>Total ${ghs(o.total)}</b></p><p>${o.paymentMethod === 'online' ? 'Paid online.' : 'Pay on delivery.'}</p>${o.schedule ? `<p>Delivery: ${esc(o.schedule.date)}, ${esc(o.schedule.slot)}, ${esc(o.customer.city)}</p>` : ''}`;
  if (o.customer.email) await sendMail(o.customer.email, `Your Blacksheep order ${o.id}`, `<p>Hi ${esc(o.customer.name)}, thank you for your order. We will contact you on ${esc(o.customer.phone)} about delivery.</p>${html}<p>You can track it on our website with your order number and phone number.</p>`);
  if (OWNER_EMAIL) await sendMail(OWNER_EMAIL, `New order ${o.id} (${ghs(o.total)})`, `${html}<p>${esc(o.customer.name)}, ${esc(o.customer.phone)}<br>${esc(o.customer.address)}, ${esc(o.customer.city)}</p>`);
}
function notifyOnce(id) {
  let copy = null;
  updateOrder(id, x => { if (!x.notified) { x.notified = true; copy = { ...x }; } });
  if (copy) notifyOrder(copy).catch(e => console.error('Notify failed:', e.message));
}
function markPaid(id) {
  let flagged = false;
  const o = updateOrder(id, x => {
    if (x.paymentStatus === 'paid') return;
    x.paymentStatus = 'paid'; x.paidAt = new Date().toISOString();
    if (x.status === 'cancelled') {
      if (x.expired && x.restocked && reserve(x)) { x.restocked = false; x.expired = false; x.status = 'paid'; x.note = ''; }
      else { x.note = 'Customer paid after this order was cancelled or expired. Refund them or fulfil it manually.'; flagged = true; }
    } else if (x.status === 'pending') x.status = 'paid';
  });
  if (!o) return;
  if (flagged) sendMail(OWNER_EMAIL, `ACTION NEEDED: order ${id} was paid after it expired`, `<p>Open the admin page and refund or fulfil order ${esc(id)}.</p>`);
  else notifyOnce(id);
}
async function paystackVerify(ref) {
  const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref), { headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET } });
  const d = await r.json();
  return r.ok && d.status ? d.data : null;
}
const paidOk = (o, d) => d && d.status === 'success' && d.currency === 'GHS' && d.amount === Math.round(o.total * 100);

function sweep() {
  const orders = read(ORDERS_FILE, []);
  let changed = false;
  for (const o of orders) {
    if (o.paymentMethod === 'online' && o.paymentStatus === 'unpaid' && o.status === 'pending' && Date.now() - Date.parse(o.createdAt) > HOLD_MINUTES * 60000) {
      o.expired = true; cancel(o, 'Payment not completed in time'); changed = true;
    }
  }
  if (changed) write(ORDERS_FILE, orders);
}
setInterval(sweep, 5 * 60 * 1000).unref();
sweep();

/* ---------- Middleware ---------- */
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/admin')) res.set('X-Robots-Tag', 'noindex');
  next();
});
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- Public API ---------- */
app.get('/api/config', (req, res) => res.json({
  currency: 'GHS', locations: locations(), deliveryDates: deliveryDates(), dropDate: DROP_DATE,
  whatsapp: WHATSAPP_NUMBER, payOnline: !!PAYSTACK_SECRET, instagram: process.env.INSTAGRAM_URL || '', tiktok: process.env.TIKTOK_URL || ''
}));

app.get('/api/products', (req, res) => {
  let { products, collections } = catalog();
  const { collection, q, sort } = req.query;
  if (collection && collection !== 'All') products = products.filter(p => p.collection === collection);
  if (q) products = products.filter(p => p.name.toLowerCase().includes(String(q).toLowerCase()));
  if (sort === 'price-asc') products = [...products].sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') products = [...products].sort((a, b) => b.price - a.price);
  res.json({ collections, count: products.length, products });
});
app.get('/api/products/:id', (req, res) => {
  const p = catalog().products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

app.post('/api/promo', limit('promo', 20, 10 * 60 * 1000), (req, res) => {
  const p = findPromo((req.body || {}).code);
  if (!p) return res.status(404).json({ error: 'That promo code is not valid.' });
  res.json({ code: p.code, type: p.type, value: p.value });
});

// Orders: prices, stock, delivery and discounts are all worked out on the server, never trusted from the browser.
app.post('/api/orders', limit('order', 10, 10 * 60 * 1000), wrap(async (req, res) => {
  const { customer = {}, items = [], payment = 'delivery', promo } = req.body || {};
  const c = {
    name: String(customer.name || '').trim().slice(0, 100), phone: String(customer.phone || '').trim().slice(0, 20),
    email: String(customer.email || '').trim().slice(0, 120), region: String(customer.region || '').trim().slice(0, 60), city: String(customer.city || '').trim().slice(0, 60), address: String(customer.address || '').trim().slice(0, 300)
  };
  const deliveryDate = String(customer.deliveryDate || '').trim(), deliverySlot = String(customer.deliverySlot || '').trim();
  if (!['online', 'delivery'].includes(payment)) return res.status(400).json({ error: 'Choose how you want to pay.' });
  const online = payment === 'online';
  const fields = {};
  if (c.name.length < 2) fields.name = 'Enter your full name.';
  if (!c.phone) fields.phone = 'Enter your phone number so our rider can reach you.';
  else if (!phoneOk(c.phone)) fields.phone = 'Enter a valid phone number, like 024 123 4567.';
  if (c.email && !EMAIL_RE.test(c.email)) fields.email = 'That email does not look right. Check for typos, for example name@gmail.com.';
  else if (!c.email && online) fields.email = 'Enter your email so we can send your payment receipt.';
  const L = locations(), reg = L.regions.find(r => r.name === c.region);
  if (c.region !== L.otherRegion.name && !reg) fields.region = 'Choose your region.';
  else if (c.region === L.otherRegion.name) { if (c.city.length < 2) fields.city = 'Enter your town or city.'; }
  else if (!reg.towns.some(t => t.name === c.city)) fields.city = 'Choose your town.';
  if (!deliveryDate) fields.deliveryDate = 'Choose a delivery day.';
  else if (!deliveryDates().includes(deliveryDate)) fields.deliveryDate = 'That day is no longer available. Pick another day.';
  if (!(L.schedule.timeSlots || []).includes(deliverySlot)) fields.deliverySlot = 'Choose a delivery time.';
  if (c.address.length < 5) fields.address = 'Enter your delivery address, including area and a landmark.';
  if (Object.keys(fields).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields, code: deliveryDate && fields.deliveryDate ? 'SCHEDULE' : undefined });
  if (online && !PAYSTACK_SECRET) return res.status(400).json({ error: 'Online payment is not available right now. Please choose pay on delivery.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty.' });
  if (items.length > 30) return res.status(400).json({ error: 'Your cart has too many lines. Please order in two batches.' });

  const merged = new Map();
  for (const raw of items) {
    const it = raw || {}, qty = parseInt(it.qty, 10);
    if (typeof it.id !== 'string' || typeof it.size !== 'string' || !(qty > 0) || qty > 10) return res.status(400).json({ error: 'One of the items in your cart is not valid. We have refreshed your cart.', code: 'INVALID_ITEM' });
    const k = it.id + '|' + it.size;
    merged.set(k, { id: it.id, size: it.size, qty: Math.min(10, (merged.get(k) ? merged.get(k).qty : 0) + qty) });
  }
  const cat = catalog(), lines = [], issues = [];
  let subtotal = 0;
  for (const it of merged.values()) {
    const p = cat.products.find(x => x.id === it.id);
    if (!p || p.stock[it.size] === undefined) return res.status(400).json({ error: 'One of the items in your cart is no longer available. We have refreshed your cart.', code: 'INVALID_ITEM' });
    const have = p.stock[it.size] || 0;
    if (have < it.qty) issues.push({ id: p.id, name: p.name, size: it.size, available: have });
    lines.push({ id: p.id, name: p.name, size: it.size, qty: it.qty, price: p.price });
    subtotal += p.price * it.qty;
  }
  if (issues.length) return res.status(409).json({ code: 'STOCK', stockIssues: issues, error: issues.map(i => i.available === 0 ? `${i.name} (${i.size}) just sold out.` : `${i.name} (${i.size}): only ${i.available} left.`).join(' ') + ' We have updated your cart.' });

  let discount = 0;
  if (promo) {
    const pr = findPromo(promo);
    if (!pr) return res.status(400).json({ error: 'That promo code is not valid.', fields: { promo: 'That promo code is not valid.' } });
    discount = calcDiscount(pr, subtotal);
  }
  const delivery = deliveryFor(c.region, c.city, subtotal);
  const total = Math.round((subtotal - discount + delivery) * 100) / 100;

  // Reserve stock straight away (no await between the check and this line, so two buyers cannot take the last piece).
  const stock = loadStock();
  for (const l of lines) stock[l.id][l.size] -= l.qty;
  write(STOCK_FILE, stock);

  const orders = read(ORDERS_FILE, []);
  let id; do { id = 'BS-' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (orders.some(o => o.id === id));
  const order = {
    id, createdAt: new Date().toISOString(), status: 'pending', paymentMethod: payment, paymentStatus: 'unpaid',
    customer: c, schedule: { date: deliveryDate, slot: deliverySlot }, items: lines, subtotal, discount, delivery, total, currency: 'GHS', promo: promo ? String(promo).trim().toUpperCase() : null, restocked: false
  };
  orders.push(order); write(ORDERS_FILE, orders);

  let paymentUrl = null;
  if (online) {
    try {
      const base = SITE_URL || `${req.protocol}://${req.get('host')}`;
      const r = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST', headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, amount: Math.round(total * 100), currency: 'GHS', reference: id, callback_url: `${base}/?pay=${id}`, metadata: { order_id: id } })
      });
      const d = await r.json();
      if (!r.ok || !d.status) throw new Error(d.message || 'Paystack error');
      paymentUrl = d.data.authorization_url;
      updateOrder(id, o => { o.paymentUrl = paymentUrl; });
    } catch (e) {
      console.error('Paystack initialize failed:', e.message);
      updateOrder(id, o => cancel(o, 'Could not start payment'));
      return res.status(502).json({ error: 'We could not start the payment. You were not charged and your order was not placed. Please try again, or choose pay on delivery.' });
    }
  } else notifyOnce(id);
  res.status(201).json({ id, subtotal, discount, delivery, total, paymentUrl });
}));

// Called when the customer returns from Paystack. Also lets the page confirm an order's state.
app.get('/api/orders/verify', limit('verify', 30, 10 * 60 * 1000), wrap(async (req, res) => {
  const ref = String(req.query.reference || '').toUpperCase();
  if (!ORDER_RE.test(ref)) return res.status(400).json({ error: 'That order number is not valid.' });
  let o = read(ORDERS_FILE, []).find(x => x.id === ref);
  if (!o) return res.status(404).json({ error: 'We could not find that order.' });
  if (o.paymentMethod === 'online' && o.paymentStatus !== 'paid' && PAYSTACK_SECRET) {
    try {
      const d = await paystackVerify(ref);
      if (paidOk(o, d)) { markPaid(ref); o = read(ORDERS_FILE, []).find(x => x.id === ref); }
    } catch (e) { console.error('Paystack verify failed:', e.message); }
  }
  res.json(publicOrder(o));
}));

app.post('/api/orders/track', limit('track', 20, 10 * 60 * 1000), (req, res) => {
  const id = String((req.body || {}).id || '').trim().toUpperCase(), phone = digits((req.body || {}).phone);
  const o = read(ORDERS_FILE, []).find(x => x.id === id);
  if (!o || phone.length < 7 || digits(o.customer.phone).slice(-9) !== phone.slice(-9)) return res.status(404).json({ error: 'We could not find an order with those details. Check the order number and the phone number you used at checkout.' });
  res.json(publicOrder(o));
});

// Paystack calls this when a payment succeeds, even if the customer closes the browser. Add it in the Paystack dashboard.
app.post('/api/paystack/webhook', wrap(async (req, res) => {
  if (!PAYSTACK_SECRET) return res.sendStatus(404);
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.rawBody || '').digest('hex');
  if (!safeEq(req.get('x-paystack-signature') || '', hash)) return res.sendStatus(401);
  const ev = req.body || {};
  if (ev.event === 'charge.success' && ev.data) {
    const ref = String(ev.data.reference || '');
    const o = read(ORDERS_FILE, []).find(x => x.id === ref);
    if (o && paidOk(o, ev.data)) markPaid(ref);
  }
  res.sendStatus(200);
}));

app.post('/api/subscribe', limit('sub', 10, 10 * 60 * 1000), (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address, for example name@gmail.com.' });
  const subs = read(SUBS_FILE, []);
  if (!subs.includes(email)) { subs.push(email); write(SUBS_FILE, subs); }
  res.json({ ok: true });
});

app.post('/api/notify', limit('notify', 10, 10 * 60 * 1000), (req, res) => {
  const { id, size } = req.body || {};
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address, for example name@gmail.com.' });
  const p = catalog().products.find(x => x.id === id);
  if (!p || p.stock[size] === undefined) return res.status(400).json({ error: 'Choose a size to be notified about.' });
  if (p.stock[size] > 0) return res.status(400).json({ error: 'That size is in stock right now. You can add it to your cart.' });
  const list = read(NOTIFY_FILE, []);
  if (!list.some(e => e.email === email && e.id === id && e.size === size)) { list.push({ email, id, size, createdAt: new Date().toISOString() }); write(NOTIFY_FILE, list); }
  res.json({ ok: true });
});

/* ---------- Admin API (header x-admin-token) ---------- */
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const admin = (req, res, next) => limit('admin', 120, 60000)(req, res, () => safeEq(req.get('x-admin-token') || '', ADMIN_TOKEN) ? next() : res.status(401).json({ error: 'Unauthorised' }));

app.get('/api/admin/orders', admin, (req, res) => res.json(read(ORDERS_FILE, []).slice().reverse()));
app.patch('/api/admin/orders/:id', admin, (req, res) => {
  const status = (req.body || {}).status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  let err = null;
  const o = updateOrder(req.params.id, x => {
    if (x.status === 'cancelled' && status !== 'cancelled') { err = 'Cancelled orders cannot be reopened. Ask the customer to place a new order.'; return; }
    if (status === 'cancelled') cancel(x, 'Cancelled by admin. Refund the customer if they already paid.');
    else { x.status = status; if (status === 'paid' || status === 'delivered') x.paymentStatus = 'paid'; }
  });
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (err) return res.status(400).json({ error: err });
  res.json(o);
});
app.get('/api/admin/stock', admin, (req, res) => res.json(catalog().products.map(p => ({ id: p.id, name: p.name, stock: p.stock }))));
app.put('/api/admin/stock/:id', admin, wrap(async (req, res) => {
  const p = baseCatalog().products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const incoming = (req.body || {}).stock || {}, stock = loadStock(), before = { ...stock[p.id] };
  for (const sz of Object.keys(p.stock)) {
    if (incoming[sz] === undefined) continue;
    const n = Number(incoming[sz]);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return res.status(400).json({ error: `Stock for size ${sz} must be a whole number, 0 or more.` });
    stock[p.id][sz] = n;
  }
  write(STOCK_FILE, stock);
  const back = Object.keys(stock[p.id]).filter(sz => (before[sz] || 0) < 1 && stock[p.id][sz] > 0);
  if (back.length) {
    const list = read(NOTIFY_FILE, []), keep = [];
    for (const e of list) {
      if (e.id === p.id && back.includes(e.size)) await sendMail(e.email, `${p.name} is back in stock`, `<p>Good news: ${esc(p.name)} (size ${esc(e.size)}) is back in stock.</p>${SITE_URL ? `<p><a href="${SITE_URL}">Shop now</a></p>` : ''}`);
      else keep.push(e);
    }
    write(NOTIFY_FILE, keep);
  }
  res.json({ id: p.id, stock: stock[p.id] });
}));
app.get('/api/admin/subscribers', admin, (req, res) => res.json(read(SUBS_FILE, [])));

/* ---------- Errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'That request was not valid. Please refresh the page and try again.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again in a moment.' });
});

app.listen(PORT, () => console.log(`Blacksheep running on http://localhost:${PORT}`));
