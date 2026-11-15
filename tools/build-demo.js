// Builds ONE self-contained HTML file of the site (no server needed) to show a client.
// Usage:  node tools/build-demo.js [output.html] [--real-only]
//   default: your real products + clearly marked sample bouquets and a "demo" bar
//   --real-only: only your real products (no samples)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(root, 'flowers-demo.html');
const realOnly = process.argv.includes('--real-only');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const json = f => JSON.parse(read(f));
const readOr = (f, d) => { try { return json(f); } catch (e) { return d; } };

const config = json('config.json');
const flowers = (readOr('data/flowers.json', []) || require(path.join(root, 'seed.js')).FLOWERS).map(({ stock, ...x }) => x);
const categories = readOr('data/categories.json', require(path.join(root, 'seed.js')).CATEGORIES);
const tierOf = p => (p < 1000000 ? 'b1' : p < 2000000 ? 'b2' : 'b3');

// same placeholder picture the server draws for bouquets without a photo
const placeholder = id => {
  const hues = [345, 330, 20, 300, 140, 200], h = hues[id % hues.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,88%)"/><stop offset="1" stop-color="hsl(${h + 20},45%,72%)"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><g fill="hsl(${h},55%,58%)" opacity=".85"><circle cx="200" cy="190" r="70"/><circle cx="140" cy="240" r="50"/><circle cx="262" cy="240" r="50"/><circle cx="200" cy="270" r="46" fill="hsl(${h},60%,48%)"/></g><path d="M200 300 L200 440" stroke="hsl(130,30%,35%)" stroke-width="8"/><path d="M200 380 C150 350 130 360 120 330 C160 330 190 350 200 380Z M200 400 C250 370 270 380 280 350 C240 350 210 370 200 400Z" fill="hsl(130,30%,40%)"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};
const photo = url => {
  const f = path.join(root, 'public', path.basename(url));
  const file = path.join(root, 'public', 'photos', path.basename(url));
  const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
  return 'data:image/' + ext + ';base64,' + fs.readFileSync(file).toString('base64');
};

// real products
let products = readOr('data/products.json', []).map(({ recipe, ...p }) => {
  let image = p.image;
  try { image = p.image ? photo(p.image) : placeholder(p.id); } catch (e) { image = placeholder(p.id); }
  return { ...p, image };
});

// clearly-labelled samples so the client can see a full catalog
if (!realOnly) products = products.concat(require('./samples')(placeholder, tierOf));

const stats = (() => {
  const t = {};
  ['b1', 'b2', 'b3'].forEach(k => { const pr = products.filter(p => p.tier === k).map(p => p.price); t[k] = { count: pr.length, from: pr.length ? Math.min(...pr) : null }; });
  return { total: products.length, tiers: t };
})();

const DATA = { config, products, stats, flowers, categories };
const embed = o => JSON.stringify(o).replace(/</g, '\\u003c');

// ---- the app code, adapted for a single file opened from disk ----
let app = read('public/app.js');
const must = (cond, what) => { if (!cond) throw new Error('build-demo: could not adapt app.js (' + what + ') - app.js changed?'); };
const rep = (a, b, what) => { must(app.includes(a), what); app = app.split(a).join(b); };
rep("const seg = location.pathname.split('/')[1];", "const seg = __route.path.split('/')[1];", 'seg');
rep('/catalog/.test(location.pathname)', '/catalog/.test(__route.path)', 'isCatalog');
rep('new URLSearchParams(location.search)', 'new URLSearchParams(__route.query)', 'query');
// no photo URL in the Telegram text (photos are embedded in this file)
const photoPart = "${p.image ? '\\n' + (cfg.siteUrl || location.origin).replace(/\\/+$/, '') + encodeURI(p.image) : ''}";
rep(photoPart, '', 'photo link');

const shim = `
// ---- demo shim: routing by #hash and data instead of the server ----
const DATA = ${embed(DATA)};
const __h = location.hash.replace(/^#/, '') || '/';
const __route = { path: __h.split('?')[0] || '/', query: __h.split('?')[1] || '' };
window.fetch = async function (url) {
  const u = new URL(url, 'http://x');
  let body;
  if (u.pathname === '/api/config') body = DATA.config;
  else if (u.pathname === '/api/stats') body = DATA.stats;
  else if (u.pathname === '/api/flowers') body = DATA.flowers;
  else if (u.pathname === '/api/categories') body = DATA.categories;
  else if (u.pathname === '/api/products') {
    const q = u.searchParams; let l = DATA.products;
    if (q.get('tier')) l = l.filter(p => p.tier === q.get('tier'));
    if (q.get('tag')) l = l.filter(p => p.tags.includes(q.get('tag')));
    if (q.get('flower')) l = l.filter(p => p.flowers.includes(q.get('flower')));
    if (q.get('q')) l = l.filter(p => p.name.toLowerCase().includes(q.get('q').toLowerCase()));
    body = l;
  } else body = {};
  return { ok: true, json: async () => body };
};
// internal links ("/uz/catalog" etc.) become #/uz/catalog
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="/"]');
  if (!a) return;
  e.preventDefault();
  const to = '#' + a.getAttribute('href');
  if (location.hash === to) return;
  location.hash = to;
}, true);
window.addEventListener('hashchange', () => location.reload());
${realOnly ? '' : `
window.addEventListener('DOMContentLoaded', () => {
  const t = { ru: 'Демо-версия: каталог — примеры', uz: "Demo ko'rinish: katalogdagi buketlar namuna uchun", en: 'Demo preview: sample bouquets for illustration' };
  const l = ['uz', 'en'].includes(__route.path.split('/')[1]) ? __route.path.split('/')[1] : 'ru';
  const b = document.createElement('div');
  b.textContent = t[l];
  b.style.cssText = 'background:#1f241f;color:#fff;text-align:center;font:13px Inter,Arial,sans-serif;padding:7px 12px;position:relative;z-index:60';
  document.body.insertBefore(b, document.body.firstChild);
});`}
`;

const css = read('public/style.css') + '\n.admin-link{display:none!important}\n';
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.brand}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${shim}</script>
<script>${read('public/i18n.js')}</script>
<script>${app}</script>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log('written', out, (html.length / 1024).toFixed(0) + ' KB,', products.length, 'bouquets', realOnly ? '(real only)' : '(with samples)');
