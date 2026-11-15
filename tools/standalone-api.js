// Runs INSIDE the single HTML file. Replaces the server: same /api/* endpoints,
// data lives in this browser (localStorage). Expects a global SEED object.
(function () {
  const LS = 'flowers_standalone_v1';
  const SESSION = 'flowers_admin_user';
  const DEMO_ADMIN = { username: 'admin', password: 'demo123' };

  let db = null;
  try { db = JSON.parse(localStorage.getItem(LS)); } catch (e) {}
  if (!db || !Array.isArray(db.products)) {
    db = { products: SEED.products, flowers: SEED.flowers, categories: SEED.categories, sales: [], admins: [DEMO_ADMIN] };
    persist();
  }
  function persist() { try { localStorage.setItem(LS, JSON.stringify(db)); return true; } catch (e) { return false; } }
  function commit() { if (!persist()) throw E(507, 'storage_full'); }
  function E(status, error, extra) { return Object.assign(new Error(error), { status, error }, extra || {}); }

  window.__resetDemo = () => { localStorage.removeItem(LS); sessionStorage.removeItem(SESSION); };

  const config = SEED.config;
  const tierOf = p => (p < 1000000 ? 'b1' : p < 2000000 ? 'b2' : 'b3');
  const recipeOf = p => p.recipe || Object.fromEntries((p.flowers || []).map(f => [f, 1]));

  // Photos are stored inside localStorage (about 5 MB total), so shrink big ones
  function shrink(dataUrl) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl || '') || dataUrl.length > 8e6) return Promise.resolve(null);
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 900 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => res(null);
      img.src = dataUrl;
    });
  }

  function clean(body) {
    const name = String(body.name || '').trim().slice(0, 80);
    const price = Math.round(Number(body.price));
    if (!name || !(price > 0)) return null;
    const arr = v => (Array.isArray(v) ? v.map(s => String(s).slice(0, 30)).slice(0, 40) : []);
    const flowers = arr(body.flowers);
    const raw = body.recipe && typeof body.recipe === 'object' ? body.recipe : {};
    const recipe = {};
    flowers.forEach(id => { const q = Math.round(Number(raw[id])); recipe[id] = q > 0 && q <= 999 ? q : 1; });
    const stock = Math.max(0, Math.min(99999, Math.round(Number(body.stock)) || 0));
    return { name, price, tier: tierOf(price), tags: arr(body.tags), flowers, recipe, stock };
  }

  function stats(days) {
    const since = days ? Date.now() - days * 86400000 : 0;
    const list = db.sales.filter(s => new Date(s.at).getTime() >= since);
    const low = config.lowStock || { flowers: 2, bouquets: 2 };
    const fl = db.flowers;
    const flName = id => (fl.find(f => f.id === id) || {}).uz || id;
    const byFlower = {}, byProduct = {};
    list.forEach(s => {
      Object.entries(s.recipe || {}).forEach(([id, q]) => { byFlower[id] = (byFlower[id] || 0) + q * s.qty; });
      const b = byProduct[s.productId] || (byProduct[s.productId] = { id: s.productId, name: s.name, qty: 0, total: 0 });
      b.qty += s.qty; b.total += s.total;
    });
    const pad = n => String(n).padStart(2, '0');
    const daily = days > 0 && days <= 31;
    const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}${daily ? '-' + pad(d.getDate()) : ''}`;
    const now = new Date();
    let start;
    if (daily) start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    else {
      const months = days > 0 ? Math.ceil(days / 30) : 6;
      start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
      if (!days && list.length) { const first = new Date(Math.min(...list.map(s => new Date(s.at).getTime()))); if (first < start) start = new Date(first.getFullYear(), first.getMonth(), 1); }
    }
    const series = [];
    for (let d = new Date(start); d <= now; daily ? d.setDate(d.getDate() + 1) : d.setMonth(d.getMonth() + 1)) series.push({ key: keyOf(d), qty: 0, revenue: 0 });
    list.forEach(s => { const b = series.find(x => x.key === keyOf(new Date(s.at))); if (b) { b.qty += s.qty; b.revenue += s.total; } });
    return {
      days, series, daily,
      revenue: list.reduce((a, s) => a + s.total, 0),
      bouquetsSold: list.reduce((a, s) => a + s.qty, 0),
      salesCount: list.length,
      topFlowers: Object.entries(byFlower).map(([id, sold]) => ({ id, name: flName(id), sold, stock: (fl.find(f => f.id === id) || {}).stock ?? null })).sort((a, b) => b.sold - a.sold).slice(0, 10),
      topProducts: Object.values(byProduct).sort((a, b) => b.qty - a.qty).slice(0, 10),
      lowFlowers: fl.filter(f => typeof f.stock === 'number' && f.stock <= low.flowers).map(f => ({ id: f.id, name: f.uz, stock: f.stock })).sort((a, b) => a.stock - b.stock),
      untrackedFlowers: fl.filter(f => typeof f.stock !== 'number').length,
      bouquets: db.products.filter(p => typeof p.stock === 'number').map(p => ({ id: p.id, name: p.name, stock: p.stock, low: p.stock <= low.bouquets })).sort((a, b) => a.stock - b.stock),
      thresholds: low
    };
  }

  async function route(method, url, body) {
    const u = new URL(url, 'http://x');
    const p = u.pathname, q = u.searchParams;
    body = body || {};
    const admin = sessionStorage.getItem(SESSION);
    const need = () => { if (!admin) throw E(401, 'unauthorized'); };
    let m;

    // ----- public -----
    if (method === 'GET' && p === '/api/config') return config;
    if (method === 'GET' && p === '/api/stats') {
      const out = {};
      ['b1', 'b2', 'b3'].forEach(k => { const pr = db.products.filter(x => x.tier === k).map(x => x.price); out[k] = { count: pr.length, from: pr.length ? Math.min(...pr) : null }; });
      return { total: db.products.length, tiers: out };
    }
    if (method === 'GET' && p === '/api/products') {
      let l = db.products;
      if (q.get('tier')) l = l.filter(x => x.tier === q.get('tier'));
      if (q.get('tag')) l = l.filter(x => x.tags.includes(q.get('tag')));
      if (q.get('flower')) l = l.filter(x => x.flowers.includes(q.get('flower')));
      if (q.get('q')) l = l.filter(x => x.name.toLowerCase().includes(q.get('q').toLowerCase()));
      return l.map(({ recipe, ...x }) => x);
    }
    if (method === 'GET' && p === '/api/flowers') return db.flowers.map(({ stock, ...x }) => x);
    if (method === 'GET' && p === '/api/categories') return db.categories;

    // ----- admin session -----
    if (method === 'POST' && p === '/api/admin/login') {
      const a = db.admins.find(x => x.username === String(body.username || '') && x.password === String(body.password || ''));
      if (!a) throw E(401, 'bad_credentials');
      sessionStorage.setItem(SESSION, a.username); return { ok: true };
    }
    if (method === 'POST' && p === '/api/admin/logout') { sessionStorage.removeItem(SESSION); return { ok: true }; }
    if (method === 'GET' && p === '/api/admin/me') return { authed: !!admin, user: admin || null };

    // everything below needs a logged in admin
    if (p.startsWith('/api/admin/')) need();

    if (method === 'GET' && p === '/api/admin/orders') return [];
    if (method === 'GET' && p === '/api/admin/products') return db.products;
    if (method === 'GET' && p === '/api/admin/flowers') return db.flowers;
    if (method === 'GET' && p === '/api/admin/stats') return stats(Number(q.get('days')) || 0);
    if (method === 'GET' && p === '/api/admin/sales') return db.sales.slice().reverse().slice(0, 100);

    // products
    if (method === 'POST' && p === '/api/admin/products') {
      const base = clean(body); if (!base) throw E(400, 'name_and_price_required');
      const item = { id: db.products.reduce((mx, x) => Math.max(mx, x.id), 0) + 1, ...base };
      if (body.image) { const img = await shrink(body.image); if (!img) throw E(400, 'bad_image'); item.image = img; }
      db.products.push(item); commit(); return item;
    }
    if ((m = /^\/api\/admin\/products\/(\d+)$/.exec(p))) {
      const i = db.products.findIndex(x => x.id === Number(m[1]));
      if (i < 0) throw E(404, 'not_found');
      if (method === 'PUT') {
        const base = clean(body); if (!base) throw E(400, 'name_and_price_required');
        const item = { ...db.products[i], ...base };
        if (body.image) { const img = await shrink(body.image); if (!img) throw E(400, 'bad_image'); item.image = img; }
        else if (body.removeImage) delete item.image;
        db.products[i] = item; commit(); return item;
      }
      if (method === 'DELETE') { db.products.splice(i, 1); commit(); return { ok: true }; }
    }

    // flowers + categories (editable lists)
    if ((m = /^\/api\/admin\/(flowers|categories)(?:\/([^/]+))?$/.exec(p))) {
      const kind = m[1], id = m[2] && decodeURIComponent(m[2]);
      const list = db[kind], field = kind === 'flowers' ? 'flowers' : 'tags';
      if (method === 'POST' && !id) {
        const t = k => String(body[k] || '').trim().slice(0, 60);
        const item = { ru: t('ru'), uz: t('uz'), en: t('en') };
        if (!item.ru && !item.uz && !item.en) throw E(400, 'name_required');
        const any = item.en || item.ru || item.uz;
        item.ru = item.ru || any; item.uz = item.uz || any; item.en = item.en || any;
        let base = item.en.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item', nid = base, n = 2;
        while (list.some(x => x.id === nid)) nid = `${base}_${n++}`;
        const st = body.stock === undefined || body.stock === null || body.stock === '' ? NaN : Math.round(Number(body.stock));
        const rec = { id: nid, ...item, ...(st >= 0 ? { stock: st } : {}) };
        list.push(rec); commit(); return rec;
      }
      if (method === 'PUT' && id) {
        const it = list.find(x => x.id === id); if (!it) throw E(404, 'not_found');
        const v = body.stock;
        if (v === null || v === '') delete it.stock;
        else { const nn = Math.round(Number(v)); if (!(nn >= 0 && nn <= 9999999)) throw E(400, 'bad_stock'); it.stock = nn; }
        commit(); return it;
      }
      if (method === 'DELETE' && id) {
        if (!list.some(x => x.id === id)) throw E(404, 'not_found');
        db[kind] = list.filter(x => x.id !== id);
        db.products = db.products.map(x => {
          const y = { ...x, [field]: x[field].filter(v => v !== id) };
          if (field === 'flowers' && y.recipe) { y.recipe = { ...y.recipe }; delete y.recipe[id]; }
          return y;
        });
        commit(); return { ok: true };
      }
    }

    // sales
    if (method === 'POST' && p === '/api/admin/sales') {
      const qty = Math.round(Number(body.qty) || 1);
      if (!(qty >= 1 && qty <= 9999)) throw E(400, 'bad_qty');
      const pr = db.products.find(x => x.id === Number(body.productId)); if (!pr) throw E(404, 'product_not_found');
      if (typeof pr.stock === 'number' && qty > pr.stock) throw E(400, 'not_enough_stock', { have: pr.stock });
      const recipe = recipeOf(pr);
      if (typeof pr.stock === 'number') pr.stock -= qty;
      db.flowers.forEach(f => { if (recipe[f.id] && typeof f.stock === 'number') f.stock = Math.max(0, f.stock - recipe[f.id] * qty); });
      const sale = { id: Date.now(), productId: pr.id, name: pr.name, qty, price: pr.price, total: pr.price * qty, recipe, by: admin, at: new Date().toISOString() };
      db.sales.push(sale); commit(); return { sale, stock: pr.stock };
    }
    if (method === 'DELETE' && (m = /^\/api\/admin\/sales\/(\d+)$/.exec(p))) {
      const s = db.sales.find(x => x.id === Number(m[1])); if (!s) throw E(404, 'not_found');
      const pr = db.products.find(x => x.id === s.productId);
      if (pr && typeof pr.stock === 'number') pr.stock += s.qty;
      db.flowers.forEach(f => { if (s.recipe[f.id] && typeof f.stock === 'number') f.stock += s.recipe[f.id] * s.qty; });
      db.sales = db.sales.filter(x => x.id !== s.id); commit(); return { ok: true };
    }

    // admins
    if (method === 'GET' && p === '/api/admin/admins') return db.admins.map(a => a.username);
    if (method === 'POST' && p === '/api/admin/admins') {
      const username = String(body.username || '').trim(), password = String(body.password || '');
      if (!/^[A-Za-z0-9_.-]{2,30}$/.test(username)) throw E(400, 'bad_username');
      if (password.length < 4) throw E(400, 'password_too_short');
      if (db.admins.some(a => a.username === username)) throw E(409, 'exists');
      db.admins.push({ username, password }); commit(); return { ok: true, username };
    }
    if (method === 'DELETE' && (m = /^\/api\/admin\/admins\/(.+)$/.exec(p))) {
      const name = decodeURIComponent(m[1]);
      if (name === admin) throw E(400, 'cannot_delete_self');
      if (!db.admins.some(a => a.username === name)) throw E(404, 'not_found');
      db.admins = db.admins.filter(a => a.username !== name); commit(); return { ok: true };
    }

    throw E(404, 'not_found');
  }

  // fetch() replacement used by both the site and the admin panel
  window.fetch = async function (url, opts) {
    opts = opts || {};
    let body; try { body = opts.body ? JSON.parse(opts.body) : undefined; } catch (e) {}
    try {
      const data = await route((opts.method || 'GET').toUpperCase(), String(url), body);
      return { ok: true, status: 200, json: async () => data };
    } catch (e) {
      if (!e.status) { console.error(e); return { ok: false, status: 500, json: async () => ({ error: 'server_error' }) }; }
      return { ok: false, status: e.status, json: async () => ({ error: e.error, ...(e.have !== undefined ? { have: e.have } : {}) }) };
    }
  };
})();
