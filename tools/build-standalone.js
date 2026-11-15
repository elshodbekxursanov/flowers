// Builds ONE html file with the whole site AND the admin panel. No server needed:
// double-click it. Data (bouquets, flowers, sales, admins) is kept in the browser (localStorage).
// Usage: node tools/build-standalone.js [output.html] [--real-only]
//   default demo login:  admin / demo123
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(root, 'flowers-standalone.html');
const realOnly = process.argv.includes('--real-only');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const json = f => JSON.parse(read(f));
const readOr = (f, d) => { try { return json(f); } catch (e) { return d; } };
const seedLists = require(path.join(root, 'seed.js'));

const config = json('config.json');
const flowers = readOr('data/flowers.json', seedLists.FLOWERS).map(({ stock, ...x }) => x);
const categories = readOr('data/categories.json', seedLists.CATEGORIES);
const tierOf = p => (p < 1000000 ? 'b1' : p < 2000000 ? 'b2' : 'b3');

const placeholder = id => {
  const hues = [345, 330, 20, 300, 140, 200], h = hues[id % hues.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},60%,88%)"/><stop offset="1" stop-color="hsl(${h + 20},45%,72%)"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><g fill="hsl(${h},55%,58%)" opacity=".85"><circle cx="200" cy="190" r="70"/><circle cx="140" cy="240" r="50"/><circle cx="262" cy="240" r="50"/><circle cx="200" cy="270" r="46" fill="hsl(${h},60%,48%)"/></g><path d="M200 300 L200 440" stroke="hsl(130,30%,35%)" stroke-width="8"/><path d="M200 380 C150 350 130 360 120 330 C160 330 190 350 200 380Z M200 400 C250 370 270 380 280 350 C240 350 210 370 200 400Z" fill="hsl(130,30%,40%)"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};
const photo = url => {
  const file = path.join(root, 'public', 'photos', path.basename(url));
  const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
  return 'data:image/' + ext + ';base64,' + fs.readFileSync(file).toString('base64');
};

let products = readOr('data/products.json', []).map(p => {
  let image;
  try { image = p.image ? photo(p.image) : placeholder(p.id); } catch (e) { image = placeholder(p.id); }
  return { ...p, image };
});
if (!realOnly) products = products.concat(require('./samples')(placeholder, tierOf));
// the file must never carry the real admin contact; keep the config but no secrets exist in it
const SEED = { config, products, flowers, categories };
const embed = o => JSON.stringify(o).replace(/</g, '\\u003c');
const safeScript = s => s.replace(/<\/script/gi, '<\\/script');

const must = (cond, what) => { if (!cond) throw new Error('build-standalone: could not adapt (' + what + ') - source changed?'); };
const rep = (s, a, b, what) => { must(s.includes(a), what); return s.split(a).join(b); };

// ---- site code ----
let site = read('public/app.js');
site = rep(site, "const seg = location.pathname.split('/')[1];", "const seg = __route.path.split('/')[1];", 'seg');
site = rep(site, '/catalog/.test(location.pathname)', '/catalog/.test(__route.path)', 'isCatalog');
site = rep(site, 'new URLSearchParams(location.search)', 'new URLSearchParams(__route.query)', 'query');
site = rep(site, "${p.image ? '\\n' + (cfg.siteUrl || location.origin).replace(/\\/+$/, '') + encodeURI(p.image) : ''}", '', 'photo link');

// ---- admin code ----
const adminHtml = read('public/admin.html');
const adminCss = (/<style>([\s\S]*?)<\/style>/.exec(adminHtml) || [])[1];
const scripts = [...adminHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
let admin = scripts.length ? scripts[scripts.length - 1][1] : '';
must(adminCss && admin, 'admin parts');
admin = rep(admin, 'location.hash.slice(1)', "location.hash.replace(/^#\\/admin\\/?/, '')", 'admin hash read');
admin = rep(admin, "history.replaceState(null,'','#'+tab)", "history.replaceState(null,'','#/admin/'+tab)", 'admin hash write');
admin = rep(admin,
  '<button class="btn dark" style="width:100%;justify-content:center">Kirish</button>',
  '<button class="btn dark" style="width:100%;justify-content:center">Kirish</button>' +
  '<p class="small" style="margin-top:14px;line-height:1.6">Demo kirish: login <b>admin</b>, parol <b>demo123</b><br>Ma\'lumotlar faqat shu brauzerda saqlanadi.<br>' +
  '<a href="#" onclick="if(confirm(\'Hamma o\\\'zgarishlar o\\\'chib, boshlang\\\'ich holatga qaytadi. Davom etasizmi?\')){__resetDemo();location.href=\'#/admin\';location.reload();}return false" style="text-decoration:underline">Boshlang\'ich holatga qaytarish</a></p>',
  'login hint');

const shim = `
const SEED = ${embed(SEED)};
const __h = location.hash.replace(/^#/, '') || '/';
const __route = { path: __h.split('?')[0] || '/', query: __h.split('?')[1] || '' };
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="/"]');
  if (!a) return;
  e.preventDefault();
  const to = '#' + a.getAttribute('href');
  if (location.hash !== to) location.hash = to;
}, true);
window.addEventListener('hashchange', () => location.reload());
${fs.readFileSync(path.join(__dirname, 'standalone-api.js'), 'utf8')}
`;

const loader = `
(function () {
  const isAdmin = __route.path.split('/')[1] === 'admin';
  if (isAdmin) {
    document.title = 'Admin · ' + SEED.config.brand;
    const st = document.createElement('style'); st.textContent = document.getElementById('admin-css').textContent; document.head.appendChild(st);
    const app = document.getElementById('app'); app.className = 'wrap'; app.id = 'root'; // admin script renders into #root
  } else if (${realOnly ? 'false' : 'true'}) {
    window.addEventListener('DOMContentLoaded', () => {
      const t = { ru: 'Демо-версия: каталог — примеры. Данные хранятся в этом браузере', uz: "Demo ko'rinish: buketlar namuna uchun. Ma'lumotlar shu brauzerda saqlanadi", en: 'Demo preview: sample bouquets. Data is stored in this browser' };
      const l = ['uz', 'en'].includes(__route.path.split('/')[1]) ? __route.path.split('/')[1] : 'ru';
      const b = document.createElement('div'); b.textContent = t[l];
      b.style.cssText = 'background:#1f241f;color:#fff;text-align:center;font:12.5px Inter,Arial,sans-serif;padding:7px 12px;position:relative;z-index:60';
      document.body.insertBefore(b, document.body.firstChild);
    });
  }
  const s = document.createElement('script');
  s.textContent = document.getElementById(isAdmin ? 'admin-js' : 'site-js').textContent;
  document.body.appendChild(s);
})();
`;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light only">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.brand}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${read('public/style.css')}</style>
<script type="text/plain" id="admin-css">${adminCss}</script>
</head>
<body>
<div id="app"></div>
<script type="text/plain" id="site-js">${safeScript(site)}</script>
<script type="text/plain" id="admin-js">${safeScript(admin)}</script>
<script>${safeScript(shim)}</script>
<script>${safeScript(read('public/i18n.js'))}</script>
<script>${safeScript(loader)}</script>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log('written', out, (html.length / 1024).toFixed(0) + ' KB,', products.length, 'bouquets', realOnly ? '(real only)' : '(with samples)');
