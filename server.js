const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const config = require('./config.json');
const PRODUCTS = path.join(__dirname, 'data', 'products.json');
const ORDERS = path.join(__dirname, 'data', 'orders.json');
const PHOTOS = path.join(__dirname, 'public', 'photos');

// Admin accounts live in data/admins.json (passwords hashed).
// First start: the account from admin.json (or env ADMIN_USER / ADMIN_PASS) is created.
const ADMINS = path.join(__dirname, 'data', 'admins.json');

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx: real client IP and https detection
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path === '/admin' || req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '8mb' }));

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const products = () => readJson(PRODUCTS, []);
const tierOf = price => (price < 1000000 ? 'b1' : price < 2000000 ? 'b2' : 'b3');

// ---------- Auth ----------
const sessions = new Map(); // token -> {exp, user}
const attempts = new Map(); // ip -> {n, t}
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  ({ salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') });
const checkPw = (pw, a) => crypto.timingSafeEqual(Buffer.from(hashPw(pw, a.salt).hash, 'hex'), Buffer.from(a.hash, 'hex'));
const admins = () => readJson(ADMINS, []);
(function seedAdmin() {
  if (admins().length) return;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin.json'), 'utf8')); } catch (e) {}
  const username = process.env.ADMIN_USER || cfg.username || 'admin';
  let password = process.env.ADMIN_PASS || cfg.password;
  if (!password) {
    // never fall back to a guessable password: generate one and print it once
    password = crypto.randomBytes(9).toString('base64url');
    console.log(`\n=== FIRST START: admin login "${username}", password "${password}" (change it in /admin) ===\n`);
  }
  writeJson(ADMINS, [{ username, ...hashPw(password) }]);
  try { fs.unlinkSync(path.join(__dirname, 'admin.json')); } catch (e) {} // plain-text password no longer needed
})();
const getCookie = (req, name) => {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
};
const isAuthed = req => {
  const t = getCookie(req, 'admin_token');
  const s = sessions.get(t);
  if (!s || s.exp < Date.now()) { sessions.delete(t); return null; }
  return s.user;
};
const requireAdmin = (req, res, next) => {
  const u = isAuthed(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.admin = u; next();
};

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 10 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'too_many_attempts' });
  const { username, password } = req.body || {};
  const acc = admins().find(x => x.username === String(username || ''));
  // always hash once so response time doesn't reveal whether the user exists
  const ok = acc ? checkPw(password || '', acc) : (hashPw(password || ''), false);
  if (ok) {
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { exp: Date.now() + 12 * 3600 * 1000, user: acc.username });
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${req.secure ? '; Secure' : ''}`);
    return res.json({ ok: true });
  }
  a.n++; attempts.set(ip, a);
  res.status(401).json({ error: 'bad_credentials' });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(getCookie(req, 'admin_token'));
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => { const u = isAuthed(req); res.json({ authed: !!u, user: u || null }); });

// ---------- Admin: manage admin accounts ----------
app.get('/api/admin/admins', requireAdmin, (req, res) => res.json(admins().map(a => a.username)));
app.post('/api/admin/admins', requireAdmin, (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  const password = String((req.body || {}).password || '');
  if (!/^[A-Za-z0-9_.-]{2,30}$/.test(username)) return res.status(400).json({ error: 'bad_username' });
  if (password.length < 4) return res.status(400).json({ error: 'password_too_short' });
  const list = admins();
  if (list.some(a => a.username === username)) return res.status(409).json({ error: 'exists' });
  list.push({ username, ...hashPw(password) });
  writeJson(ADMINS, list);
  res.json({ ok: true, username });
});
app.delete('/api/admin/admins/:u', requireAdmin, (req, res) => {
  const list = admins();
  if (req.params.u === req.admin) return res.status(400).json({ error: 'cannot_delete_self' });
  if (!list.some(a => a.username === req.params.u)) return res.status(404).json({ error: 'not_found' });
  writeJson(ADMINS, list.filter(a => a.username !== req.params.u));
  for (const [t, s] of sessions) if (s.user === req.params.u) sessions.delete(t);
  res.json({ ok: true });
});

// ---------- Admin: products ----------
function saveImage(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return null;
  const name = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  fs.mkdirSync(PHOTOS, { recursive: true });
  fs.writeFileSync(path.join(PHOTOS, name), buf);
  return '/photos/' + name;
}
function removeImage(url) {
  if (!url || !url.startsWith('/photos/')) return;
  try { fs.unlinkSync(path.join(PHOTOS, path.basename(url))); } catch (e) {}
}
function clean(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const price = Math.round(Number(body.price));
  if (!name || !(price > 0)) return null;
  const arr = v => (Array.isArray(v) ? v.map(s => String(s).slice(0, 30)).slice(0, 40) : []);
  const flowers = arr(body.flowers);
  // recipe: how many stems of each flower go into one bouquet (default 1)
  const raw = body.recipe && typeof body.recipe === 'object' ? body.recipe : {};
  const recipe = {};
  flowers.forEach(id => { const q = Math.round(Number(raw[id])); recipe[id] = q > 0 && q <= 999 ? q : 1; });
  // stock: how many ready bouquets are available
  const stock = Math.max(0, Math.min(99999, Math.round(Number(body.stock)) || 0));
  return { name, price, tier: tierOf(price), tags: arr(body.tags), flowers, recipe, stock };
}

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const base = clean(req.body || {});
  if (!base) return res.status(400).json({ error: 'name_and_price_required' });
  const list = products();
  const p = { id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1, ...base };
  if (req.body.image) { const u = saveImage(req.body.image); if (!u) return res.status(400).json({ error: 'bad_image' }); p.image = u; }
  list.push(p); writeJson(PRODUCTS, list);
  res.json(p);
});
app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const list = products();
  const i = list.findIndex(x => x.id === Number(req.params.id));
  if (i < 0) return res.status(404).json({ error: 'not_found' });
  const base = clean(req.body || {});
  if (!base) return res.status(400).json({ error: 'name_and_price_required' });
  const p = { ...list[i], ...base };
  if (req.body.image) {
    const u = saveImage(req.body.image);
    if (!u) return res.status(400).json({ error: 'bad_image' });
    removeImage(p.image); p.image = u;
  } else if (req.body.removeImage) { removeImage(p.image); delete p.image; }
  list[i] = p; writeJson(PRODUCTS, list);
  res.json(p);
});
app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const list = products();
  const p = list.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not_found' });
  removeImage(p.image);
  writeJson(PRODUCTS, list.filter(x => x.id !== p.id));
  res.json({ ok: true });
});
app.get('/api/admin/orders', requireAdmin, (req, res) => res.json(readJson(ORDERS, []).reverse()));
app.get('/api/admin/products', requireAdmin, (req, res) => res.json(products())); // full data incl. recipe

// ---------- Flowers & categories (editable lists) ----------
const seed = require('./seed');
const FLOWERS = path.join(__dirname, 'data', 'flowers.json');
const CATEGORIES = path.join(__dirname, 'data', 'categories.json');
if (!fs.existsSync(FLOWERS)) writeJson(FLOWERS, seed.FLOWERS);
if (!fs.existsSync(CATEGORIES)) writeJson(CATEGORIES, seed.CATEGORIES);

function listApi(name, file, productField) {
  const read = () => readJson(file, []);
  // public list never exposes flower stock
  app.get(`/api/${name}`, (req, res) => res.json(read().map(({ stock, ...x }) => x)));
  app.get(`/api/admin/${name}`, requireAdmin, (req, res) => res.json(read()));
  // set (or clear with null/"") the stock of one item
  app.put(`/api/admin/${name}/:id`, requireAdmin, (req, res) => {
    const list = read();
    const it = list.find(x => x.id === req.params.id);
    if (!it) return res.status(404).json({ error: 'not_found' });
    const v = (req.body || {}).stock;
    if (v === null || v === '') delete it.stock;
    else { const n = Math.round(Number(v)); if (!(n >= 0 && n <= 9999999)) return res.status(400).json({ error: 'bad_stock' }); it.stock = n; }
    writeJson(file, list);
    res.json(it);
  });
  app.post(`/api/admin/${name}`, requireAdmin, (req, res) => {
    const b = req.body || {};
    const t = k => String(b[k] || '').trim().slice(0, 60);
    const item = { ru: t('ru'), uz: t('uz'), en: t('en') };
    if (!item.ru && !item.uz && !item.en) return res.status(400).json({ error: 'name_required' });
    // missing languages fall back to any filled one
    const any = item.en || item.ru || item.uz;
    item.ru = item.ru || any; item.uz = item.uz || any; item.en = item.en || any;
    const list = read();
    let base = item.en.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
    let id = base, n = 2;
    while (list.some(x => x.id === id)) id = `${base}_${n++}`;
    const st = b.stock === undefined || b.stock === null || b.stock === '' ? NaN : Math.round(Number(b.stock));
    list.push({ id, ...item, ...(st >= 0 ? { stock: st } : {}) });
    writeJson(file, list);
    res.json({ id, ...item });
  });
  app.delete(`/api/admin/${name}/:id`, requireAdmin, (req, res) => {
    const list = read();
    if (!list.some(x => x.id === req.params.id)) return res.status(404).json({ error: 'not_found' });
    writeJson(file, list.filter(x => x.id !== req.params.id));
    // remove from products too
    const ps = products().map(p => {
      const q = { ...p, [productField]: p[productField].filter(x => x !== req.params.id) };
      if (productField === 'flowers' && q.recipe) { q.recipe = { ...q.recipe }; delete q.recipe[req.params.id]; }
      return q;
    });
    writeJson(PRODUCTS, ps);
    res.json({ ok: true });
  });
}
listApi('flowers', FLOWERS, 'flowers');
listApi('categories', CATEGORIES, 'tags');

// ---------- Sales and statistics ----------
const SALES = path.join(__dirname, 'data', 'sales.json');
const sales = () => readJson(SALES, []);
const recipeOf = p => p.recipe || Object.fromEntries((p.flowers || []).map(f => [f, 1]));

// Record a sale: lowers bouquet stock and the stock of each tracked flower
app.post('/api/admin/sales', requireAdmin, (req, res) => {
  const qty = Math.round(Number((req.body || {}).qty) || 1);
  if (!(qty >= 1 && qty <= 9999)) return res.status(400).json({ error: 'bad_qty' });
  const ps = products();
  const p = ps.find(x => x.id === Number((req.body || {}).productId));
  if (!p) return res.status(404).json({ error: 'product_not_found' });
  if (typeof p.stock === 'number' && qty > p.stock) return res.status(400).json({ error: 'not_enough_stock', have: p.stock });
  const recipe = recipeOf(p);
  if (typeof p.stock === 'number') p.stock -= qty;
  const fl = readJson(FLOWERS, []);
  fl.forEach(f => { if (recipe[f.id] && typeof f.stock === 'number') f.stock = Math.max(0, f.stock - recipe[f.id] * qty); });
  const sale = { id: Date.now(), productId: p.id, name: p.name, qty, price: p.price, total: p.price * qty, recipe, by: req.admin, at: new Date().toISOString() };
  const all = sales(); all.push(sale);
  writeJson(PRODUCTS, ps); writeJson(FLOWERS, fl); writeJson(SALES, all);
  res.json({ sale, stock: p.stock });
});
// Undo a sale (mistake): gives the stock back
app.delete('/api/admin/sales/:id', requireAdmin, (req, res) => {
  const all = sales();
  const s = all.find(x => x.id === Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'not_found' });
  const ps = products(); const p = ps.find(x => x.id === s.productId);
  if (p && typeof p.stock === 'number') p.stock += s.qty;
  const fl = readJson(FLOWERS, []);
  fl.forEach(f => { if (s.recipe[f.id] && typeof f.stock === 'number') f.stock += s.recipe[f.id] * s.qty; });
  writeJson(PRODUCTS, ps); writeJson(FLOWERS, fl); writeJson(SALES, all.filter(x => x.id !== s.id));
  res.json({ ok: true });
});
app.get('/api/admin/sales', requireAdmin, (req, res) => res.json(sales().reverse().slice(0, 100)));

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const days = Number(req.query.days) || 0; // 0 = all time
  const since = days ? Date.now() - days * 86400000 : 0;
  const list = sales().filter(s => new Date(s.at).getTime() >= since);
  const low = config.lowStock || { flowers: 10, bouquets: 2 };
  const fl = readJson(FLOWERS, []);
  const flName = id => (fl.find(f => f.id === id) || {}).uz || id;

  const byFlower = {}, byProduct = {};
  list.forEach(s => {
    Object.entries(s.recipe || {}).forEach(([id, q]) => { byFlower[id] = (byFlower[id] || 0) + q * s.qty; });
    const b = byProduct[s.productId] || (byProduct[s.productId] = { id: s.productId, name: s.name, qty: 0, total: 0 });
    b.qty += s.qty; b.total += s.total;
  });
  const ps = products();
  res.json({
    days,
    revenue: list.reduce((a, s) => a + s.total, 0),
    bouquetsSold: list.reduce((a, s) => a + s.qty, 0),
    salesCount: list.length,
    topFlowers: Object.entries(byFlower).map(([id, sold]) => ({ id, name: flName(id), sold, stock: (fl.find(f => f.id === id) || {}).stock ?? null }))
      .sort((a, b) => b.sold - a.sold).slice(0, 10),
    topProducts: Object.values(byProduct).sort((a, b) => b.qty - a.qty).slice(0, 10),
    lowFlowers: fl.filter(f => typeof f.stock === 'number' && f.stock <= low.flowers)
      .map(f => ({ id: f.id, name: f.uz, stock: f.stock })).sort((a, b) => a.stock - b.stock),
    untrackedFlowers: fl.filter(f => typeof f.stock !== 'number').length,
    bouquets: ps.filter(p => typeof p.stock === 'number').map(p => ({ id: p.id, name: p.name, stock: p.stock, low: p.stock <= low.bouquets }))
      .sort((a, b) => a.stock - b.stock),
    thresholds: low
  });
});

// ---------- Public API ----------
app.get('/api/config', (req, res) => res.json(config));
app.get('/api/products', (req, res) => {
  const { tier, tag, flower, q } = req.query;
  let list = products();
  if (tier) list = list.filter(p => p.tier === tier);
  if (tag) list = list.filter(p => p.tags.includes(tag));
  if (flower) list = list.filter(p => p.flowers.includes(flower));
  if (q) list = list.filter(p => p.name.toLowerCase().includes(String(q).toLowerCase()));
  res.json(list.map(({ recipe, ...p }) => p)); // recipe stays private
});
app.get('/api/stats', (req, res) => {
  const all = products();
  const out = {};
  ['b1', 'b2', 'b3'].forEach(k => {
    const prices = all.filter(p => p.tier === k).map(p => p.price);
    out[k] = { count: prices.length, from: prices.length ? Math.min(...prices) : null };
  });
  res.json({ total: all.length, tiers: out });
});

app.post('/api/order', (req, res) => {
  const { productId, name, phone, address, lang } = req.body || {};
  const p = products().find(x => x.id === Number(productId));
  if (!p) return res.status(400).json({ error: 'product_not_found' });
  const order = {
    id: Date.now(), product: p.name, price: p.price,
    name: String(name || '').slice(0, 80), phone: String(phone || '').slice(0, 30),
    address: String(address || '').slice(0, 200), lang: lang || 'ru', createdAt: new Date().toISOString()
  };
  const all = readJson(ORDERS, []); all.push(order); writeJson(ORDERS, all);
  const text = `Order #${order.id}\n${p.name} — ${p.price.toLocaleString('en-US').replace(/,/g, ' ')} UZS\n${order.name} ${order.phone}\n${order.address}`;
  res.json({ ok: true, id: order.id, telegram: `https://t.me/${config.telegram}?text=${encodeURIComponent(text)}` });
});

// ---------- Pages ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get(['/uz', '/en'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(['/uz/catalog', '/en/catalog'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'catalog.html')));

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`Flowers running: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
