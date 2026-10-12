// Blacksheep store back end: Express API with JSON file storage.
// Run: npm install && npm start   (default http://localhost:3000)
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';
const PRODUCTS_FILE = path.join(__dirname, 'public', 'data', 'products.json');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscribers.json');

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const catalog = () => read(PRODUCTS_FILE, { collections: [], products: [] });

// Catalogue
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

// Orders: prices and stock are checked on the server, never trusted from the browser.
app.post('/api/orders', (req, res) => {
  const { customer = {}, items = [] } = req.body || {};
  const required = ['name', 'phone', 'address', 'city'];
  const missing = required.filter(k => !String(customer[k] || '').trim());
  if (missing.length) return res.status(400).json({ error: 'Missing fields: ' + missing.join(', ') });
  if (!/^[+0-9 ()-]{9,16}$/.test(customer.phone)) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Cart is empty' });

  const cat = catalog();
  let total = 0;
  const lines = [];
  for (const it of items) {
    const p = cat.products.find(x => x.id === it.id);
    const qty = parseInt(it.qty, 10);
    if (!p || p.stock[it.size] === undefined || !(qty > 0)) return res.status(400).json({ error: 'Invalid item in cart' });
    if ((p.stock[it.size] || 0) < qty) return res.status(409).json({ error: `${p.name} (${it.size}) is out of stock` });
    lines.push({ id: p.id, name: p.name, size: it.size, qty, price: p.price });
    total += p.price * qty;
  }
  for (const l of lines) cat.products.find(x => x.id === l.id).stock[l.size] -= l.qty;
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(cat, null, 2));

  const order = {
    id: 'BS-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    customer: { name: customer.name.trim(), phone: customer.phone.trim(), email: (customer.email || '').trim(), address: customer.address.trim(), city: customer.city.trim() },
    items: lines, total, currency: 'GHS'
  };
  const orders = read(ORDERS_FILE, []);
  orders.push(order);
  write(ORDERS_FILE, orders);
  res.status(201).json({ id: order.id, total });
});

// Admin: list orders and update status. Send header  x-admin-token: <ADMIN_TOKEN>
const admin = (req, res, next) => req.get('x-admin-token') === ADMIN_TOKEN ? next() : res.status(401).json({ error: 'Unauthorised' });
app.get('/api/admin/orders', admin, (req, res) => res.json(read(ORDERS_FILE, [])));
app.patch('/api/admin/orders/:id', admin, (req, res) => {
  const orders = read(ORDERS_FILE, []);
  const o = orders.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  if (['pending', 'paid', 'shipped', 'delivered', 'cancelled'].includes(req.body.status)) o.status = req.body.status;
  write(ORDERS_FILE, orders);
  res.json(o);
});

// Newsletter
app.post('/api/subscribe', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const subs = read(SUBS_FILE, []);
  if (!subs.includes(email)) { subs.push(email); write(SUBS_FILE, subs); }
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Blacksheep running on http://localhost:${PORT}`));
