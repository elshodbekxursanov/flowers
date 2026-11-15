(async function () {
  const seg = location.pathname.split('/')[1];
  const lang = ['uz', 'en'].includes(seg) ? seg : 'ru';
  const prefix = lang === 'ru' ? '' : '/' + lang;
  const isCatalog = /catalog/.test(location.pathname);
  const T = I18N[lang];

  // Add your real customer reviews here: { n:'Name', src:'Google', d:'date', t:'text' }
  const reviews = [];

  const [cfg, products, stats, flowerList, catList] = await Promise.all([
    fetch('/api/config').then(r => r.json()),
    fetch('/api/products').then(r => r.json()),
    fetch('/api/stats').then(r => r.json()),
    fetch('/api/flowers').then(r => r.json()),
    fetch('/api/categories').then(r => r.json())
  ]);

  const fmt = n => n.toLocaleString('en-US').replace(/,/g, ' ');
  const tr = (s, o = {}) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');
  // Russian needs 3 word forms (1 букет, 2 букета, 5 букетов); English 2
  const ruForm = (n, a, b, c) => { const m = n % 100, d = n % 10; return m >= 11 && m <= 14 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
  const bouquetWord = n => lang === 'ru' ? ruForm(n, 'букет', 'букета', 'букетов') : n === 1 ? 'bouquet' : 'bouquets';
  const itemWord = n => lang === 'ru' ? ruForm(n, 'ПОЗИЦИЯ', 'ПОЗИЦИИ', 'ПОЗИЦИЙ') : lang === 'en' ? (n === 1 ? 'ITEM' : 'ITEMS') : T.positions;
  const flowerName = id => { const f = flowerList.find(x => x.id === id); return f ? f[lang] : ''; };
  const flowersText = p => p.flowers.map(flowerName).filter(Boolean).join(', ');
  const tg = `https://t.me/${cfg.telegram}`;
  const prodLink = p => `${tg}?text=${encodeURIComponent(`${lang === 'ru' ? 'Здравствуйте. Хочу заказать букет' : lang === 'uz' ? 'Assalomu alaykum. Buket buyurtma bermoqchiman' : 'Hello. I want to order a bouquet'}:\n${p.name} — ${fmt(p.price)} ${T.sum}${p.image ? '\n' + (cfg.siteUrl || location.origin).replace(/\/+$/, '') + encodeURI(p.image) : ''}`)}`;

  document.documentElement.lang = lang;
  document.title = isCatalog ? T.catalog_title : T.title;
  document.querySelector('meta[name=description]')?.setAttribute('content', T.seo_desc);

  const logo = `<a class="logo" href="${prefix || '/'}">${cfg.brand}</a>`;
  // Per-client theme from config.json
  const th = cfg.theme || {};
  if (th.primary) document.documentElement.style.setProperty('--green', th.primary);
  if (th.bg) { document.documentElement.style.setProperty('--bg', th.bg); document.body.style.background = th.bg; }
  if (th.ink) document.documentElement.style.setProperty('--ink', th.ink);
  document.title = document.title.replace(/Flowers$/, cfg.brand);
  const langLink = l => `<a class="${l === lang ? 'on' : ''}" href="${(l === 'ru' ? '' : '/' + l) + (isCatalog ? '/catalog' : '/')}">${l.toUpperCase()}</a>`;

  const card = p => `<article class="card">
    <div class="ph">${p.tags.includes('bestseller') ? '<span class="tag">BESTSELLER</span>' : p.tags.includes('vip') ? '<span class="tag">VIP</span>' : ''}<img loading="lazy" src="${p.image || '/img/' + p.id + '.svg'}" alt="${p.name}"></div>
    <div class="in"><h3>${p.name}</h3><div class="fl">${flowersText(p)}</div><div class="pr">${fmt(p.price)} ${T.sum}</div>
    ${typeof p.stock === 'number' ? `<div class="stock ${p.stock === 0 ? 'out' : p.stock <= 2 ? 'low' : ''}">${p.stock === 0 ? T.sold_out : tr(T.in_stock, { n: p.stock })}</div>` : ''}
    ${p.stock === 0 ? `<span class="btn dark disabled">${T.sold_out}</span>` : `<a class="btn dark" href="${prodLink(p)}" target="_blank" rel="noopener">${T.order}</a>`}</div></article>`;

  const topbar = `<div class="topbar"><div class="wrap"><div class="langs">${['ru', 'uz', 'en'].map(langLink).join('')}</div>
    <div class="soc"><a href="${tg}">Telegram</a><a href="https://wa.me/${cfg.whatsapp}">WhatsApp</a><a href="https://instagram.com/${cfg.instagram}">Instagram</a></div></div></div>
    <header><div class="wrap">${logo}<nav><a class="hide-m" href="${prefix}/catalog">${T.nav_catalog}</a>
    <a class="btn light hide-m" href="tel:${cfg.phoneRaw}">${T.call}</a><a class="btn dark" href="${tg}">${T.order}</a></nav></div></header>`;

  const footer = `<footer><div class="wrap"><div class="cols">
    <div>${logo}<p>${T.footer_tag}</p></div>
    <div><h4>${T.nav_catalog.toUpperCase()}</h4><a href="${prefix}/catalog">${T.f_cat}</a><a href="${prefix}/catalog">${T.f_wed}</a><a href="${prefix}/catalog">${T.f_corp}</a></div>
    <div><h4>${T.contact}</h4><a href="${tg}">Telegram</a><a href="https://t.me/${cfg.telegramVitrine}">${T.vitrine.replace(' →', '')}</a><a href="https://instagram.com/${cfg.instagram}">Instagram</a><a href="tel:${cfg.phoneRaw}">${cfg.phone}</a></div>
    <div><h4>${T.address_h}</h4><p>${cfg.address[lang]}</p><p>${T.always}</p><p>${T.no_off}</p></div></div>
    <div class="legal"><span>© ${new Date().getFullYear()} ${cfg.brand}. ${T.rights}</span><a href="#">${T.privacy}</a><a href="#">${T.offer}</a><a href="#">${T.pay}</a><a href="#">${T.refund}</a><span>${T.made}</span><a class="admin-link" href="/admin" rel="nofollow">🔒 ${{ ru: 'Только для админа', uz: 'Faqat admin uchun', en: 'Admin only' }[lang]}</a></div></div></footer>
    <div class="sticky"><span>${T.manager}</span><a class="btn dark" href="${tg}">${T.order}</a></div>
    `;

  let body = '';
  if (!isCatalog) {
    const best = products.filter(p => p.tags.includes('bestseller')).slice(0, 8);
    const has = products.length > 0;
    const heroImg = (products.find(p => p.image) || {}).image;
    const tierImg = k => { const p = products.find(x => x.tier === k); return p ? (p.image || '/img/' + p.id + '.svg') : ''; };
    const tier = k => stats.tiers[k].count ? `<a class="tier" href="${prefix}/catalog?tier=${k}"><img src="${tierImg(k)}" alt=""><div><small>${T[k + '_k']}</small><h3>${T[k + '_n']}</h3><p>${T.from} ${fmt(stats.tiers[k].from)} · ${stats.tiers[k].count} ${itemWord(stats.tiers[k].count)}</p></div></a>` : '';
    const P = k => stats.tiers[k].from === null ? '—' : fmt(stats.tiers[k].from);
    const faq = T.faq.map(([q, a]) => `<details><summary>${q}</summary><p>${tr(a, { p1: P('b1'), p2: P('b2'), p3: P('b3'), tg: cfg.telegram, phone: cfg.phone })}</p></details>`).join('');
    const revs = reviews.length ? `<div class="revs">${reviews.map(r => `<div class="rv"><div class="st">★★★★★</div><div class="nm">${r.n}</div><small>${r.src} · ${r.d}</small><p>${r.t}</p></div>`).join('')}</div>` : `<div class="rev">${T.rev_p}</div>`;
    body = `<section class="hero"><div class="wrap"><div>
      <span class="pill">${T.badge}</span>
      <h1 class="serif">${T.h1a}<br><em>${T.h1b}</em></h1><p class="lead">${T.lead}</p>
      <div class="cta"><a class="btn dark" href="${tg}">${T.order}</a><a class="btn light" href="tel:${cfg.phoneRaw}">${T.call}</a></div>
      <p class="small">${T.manager}</p>${has ? `<div style="margin-top:14px"><a class="btn light" href="${prefix}/catalog">${tr(T.catalog_btn, { n: stats.total, w: bouquetWord(stats.total) })}</a></div>` : ''}</div>
      ${heroImg ? `<div class="hero-img"><img src="${heroImg}" alt=""></div>` : ''}</div>
      <div class="wrap trust"><div>${T.t1}</div><div>${T.t2}</div><div>${T.t3}</div><div>${T.t4}</div></div></section>
    ${has ? `<section><div class="wrap"><div class="eyebrow">${T.start}</div><h2 class="serif">${T.start_h}<br><em>${T.start_h2}</em></h2>
      <div class="tiers">${['b3', 'b2', 'b1'].map(tier).join('')}</div></div></section>` : ''}
    ${has ? `<section><div class="wrap"><div class="eyebrow">${tr(T.cat_k, { n: stats.total })}</div><h2 class="serif">${T.cat_h}<br><em>${T.cat_h2}</em></h2>
      <div class="grid">${best.map(card).join('')}</div>
      <div class="center"><a class="btn dark" href="${prefix}/catalog">${tr(T.open_all, { n: stats.total })}</a> <a class="btn light" href="https://t.me/${cfg.telegramVitrine}">${T.vitrine}</a></div></div></section>` : ''}
    <section><div class="wrap"><div class="help"><h2 class="serif">${T.help_h}</h2><p>${T.help_p}</p><a class="btn" href="${tg}">${T.help_btn}</a><p class="small" style="margin-top:14px;color:#cfd8cf">${T.help_note}</p></div></div></section>
    <section><div class="wrap"><div class="eyebrow">${T.rev_k}</div><h2 class="serif">${T.rev_h}</h2>${revs}</div></section>
    <section id="location"><div class="wrap loc"><div><div class="eyebrow">${T.loc_k}</div><h2 class="serif">${T.loc_h}<br><em>${T.loc_h2}</em></h2><p class="lead">${T.loc_p}</p>
      <dl><div><dt>${T.addr}</dt><dd>${cfg.address[lang]}</dd></div><div><dt>${T.hours}</dt><dd>${T.hours_v}</dd></div><div><dt>${T.parking}</dt><dd>${T.parking_v}</dd></div></dl>
      <a class="btn dark" target="_blank" href="https://www.google.com/maps/search/${encodeURIComponent(cfg.address.en)}">${T.route}</a></div>
      <div class="map"><iframe loading="lazy" src="https://www.google.com/maps?q=${encodeURIComponent(cfg.address.en)}&output=embed"></iframe></div></div></section>
    <section><div class="wrap" style="max-width:820px"><h2 class="serif">${T.faq_h}</h2>${faq}</div></section>`;
  } else {
    const catChips = [`<button class="chip" data-tag="all">${T.f_all}</button>`, ...catList.map(c => `<button class="chip" data-tag="${c.id}">${c[lang]}</button>`)].join('');
    const used = new Set(products.flatMap(p => p.flowers));
    const flowerChips = flowerList.filter(f => used.has(f.id)).map(f => `<button class="chip" data-flower="${f.id}">${f[lang]}</button>`).join('');
    const budgets = [['', 'b_all'], ['b1', 'b_b1'], ['b2', 'b_b2'], ['b3', 'b_b3']];
    body = `<section><div class="wrap"><div class="eyebrow">${T.cat_page_k}</div><h2 class="serif">${T.cat_page_h}</h2><p class="lead">${T.cat_page_p}</p>
      <div class="filters" id="tags">${catChips}</div>
      ${flowerChips ? `<div class="filters" id="flowers"><span class="small" style="align-self:center">${T.flowers_label}</span>${flowerChips}</div>` : ''}
      <div class="filters" id="tiers"><span class="small" style="align-self:center">${T.budget}</span>${budgets.map(([k, l]) => `<button class="chip" data-tier="${k}">${T[l]}</button>`).join('')}
      <input class="search" id="q" placeholder="${T.search}"></div><div class="grid" id="list"></div></div></section>`;
  }

  document.getElementById('app').innerHTML = topbar + '<main>' + body + '</main>' + footer;

  // ----- catalog filtering (uses backend API) -----
  if (isCatalog) {
    const st = { tag: 'all', flower: '', tier: new URLSearchParams(location.search).get('tier') || '', q: '' };
    const mark = () => {
      document.querySelectorAll('[data-tag]').forEach(b => b.classList.toggle('on', b.dataset.tag === st.tag));
      document.querySelectorAll('[data-flower]').forEach(b => b.classList.toggle('on', b.dataset.flower === st.flower));
      document.querySelectorAll('[data-tier]').forEach(b => b.classList.toggle('on', b.dataset.tier === st.tier));
    };
    const load = async () => {
      const u = new URLSearchParams();
      if (st.tag !== 'all') u.set('tag', st.tag);
      if (st.tier) u.set('tier', st.tier);
      if (st.flower) u.set('flower', st.flower);
      if (st.q) u.set('q', st.q);
      const list = await fetch('/api/products?' + u).then(r => r.json());
      document.getElementById('list').innerHTML = list.length ? list.map(card).join('') : `<p>${T.nothing}</p>`;
      mark();
    };
    document.getElementById('tags').onclick = e => { if (e.target.dataset.tag) { st.tag = e.target.dataset.tag; load(); } };
    const fl = document.getElementById('flowers');
    if (fl) fl.onclick = e => { if (e.target.dataset.flower) { st.flower = st.flower === e.target.dataset.flower ? '' : e.target.dataset.flower; load(); } };
    document.getElementById('tiers').onclick = e => { if (e.target.dataset.tier !== undefined && e.target.tagName === 'BUTTON') { st.tier = e.target.dataset.tier; load(); } };
    document.getElementById('q').oninput = e => { st.q = e.target.value; load(); };
    load();
  }

})();
