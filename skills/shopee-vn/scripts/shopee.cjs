#!/usr/bin/env node
/** Shopee VN CLI: search / item / cart. See SKILL.md for the anti-bot rules. */
const { withPage, captureJson, parseItem, vnd } = require(`${__dirname}/lib.cjs`);
const { runJS, runFile, json, jsonFile, go, sleep } = require(`${__dirname}/bridge.cjs`);

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const out = (o) => {
  const text = JSON.stringify(o, null, 2);
  const file = val('json');
  if (file) require('fs').writeFileSync(file, text);
  console.log(text);
};

const SORTS = { relevancy: 'sortBy=relevancy', sales: 'sortBy=sales', latest: 'sortBy=ctime', price_asc: 'sortBy=price&order=asc', price_desc: 'sortBy=price&order=desc' };
const BY = { relevancy: 'by=relevancy', sales: 'by=sales', latest: 'by=ctime', price_asc: 'by=price', price_desc: 'by=price' };

async function search() {
  const keyword = argv[1];
  if (!keyword) throw new Error('search needs a keyword');
  const sort = val('sort', 'relevancy'); const min = val('min'); const max = val('max');
  const limit = Number(val('limit', 20)); const page0 = Number(val('page', 0));
  let url = `https://shopee.vn/search?keyword=${encodeURIComponent(keyword)}&${SORTS[sort] || SORTS.relevancy}&page=${page0}`;
  if (min) url += `&minPrice=${min}`;
  if (max) url += `&maxPrice=${max}`;
  // the page fires an unfiltered search first — only accept the XHR carrying our params
  const must = [BY[sort] || BY.relevancy, ...(min ? [`price_min=${min}`] : []), ...(max ? [`price_max=${max}`] : [])];

  return withPage(async (page) => {
    const cap = captureJson(page,
      (r) => r.url().includes('/api/v4/search/search_items') && must.every((m) => decodeURIComponent(r.url()).includes(m)),
      (j) => (Array.isArray(j.items) && j.items.length ? j : null));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const p = await cap.wait();
    if (!p) throw new Error('no search_items payload — session expired or anti-bot');
    const items = p.items.slice(0, limit).map(parseItem).filter((i) => i.name);
    return out({ keyword, sort, page: page0, total_count: p.total_count, returned: items.length, items });
  }, { headed: flag('headed') });
}

async function item() {
  const url = argv[1];
  if (!url) throw new Error('item needs a product url');
  return withPage(async (page) => {
    const cap = captureJson(page, (r) => /\/api\/v4\/(pdp\/get_pc|item\/get)/.test(r.url()), (j) => j?.data?.item || null);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const d = await cap.wait();
    if (!d) throw new Error('no pdp payload');
    // some pdp responses omit the title; the tab title carries it
    const name = d.name || d.title || (await page.title()).replace(/\s*\|.*$/, '');
    // What a set actually contains lives ONLY here — the title lies (see SKILL.md).
    const desc = (d.description || d.detail || '').replace(/<[^>]*>/g, '').trim();
    return out({
      name, price_min_vnd: vnd(d.price_min || d.price), price_max_vnd: vnd(d.price_max || d.price),
      rating: d.item_rating?.rating_star ?? null,
      variations: (d.tier_variations || []).map((t) => ({ name: t.name, options: t.options })),
      models: (d.models || []).map((m) => ({ name: m.name, modelid: m.modelid, price_vnd: vnd(m.price), stock: m.stock })),
      ...(flag('desc') ? { description: desc || null } : {}),
    });
  }, { headed: flag('headed') });
}

/* ---- live-browser commands: Shopee blocks cart writes from any automated browser ---- */

async function liveRows() { return jsonFile('rows'); }

async function ensureCart() {
  if (!/shopee\.vn\/cart/.test(await runJS('String(location.href)'))) await go('https://shopee.vn/cart');
}

async function cartCmd() {
  await ensureCart();
  const rows = await liveRows();
  out({ items: rows.length, rows });
}

/** add <product-url> --variant "Trắng" [--variant …] [--qty N] */
async function add() {
  const url = argv[1];
  if (!url) throw new Error('add needs a product url');
  const want = argv.reduce((a, v, i) => (v === '--variant' && argv[i + 1] ? [...a, argv[i + 1]] : a), []);
  const qty = Number(val('qty', 1));
  await go(url);
  // one option per call: a single-option tier auto-selects after the first pick, and a
  // second click in the same tick would silently clear it
  const picked = [];
  for (const label of want) {
    picked.push(`${label}:${await runFile('pick_one', { LABEL: JSON.stringify(label) })}`);
    await sleep(2000);
  }
  let selected = await jsonFile('selected');
  for (const label of want) {
    if (selected.includes(label)) continue;
    picked.push(`${label}:retry-${await runFile('pick_one', { LABEL: JSON.stringify(label) })}`);
    await sleep(2000);
    selected = await jsonFile('selected');
  }
  if (!want.every((l) => selected.includes(l))) throw new Error(`variants not selected: ${JSON.stringify(selected)}`);
  for (let i = 1; i < qty; i++) { await runJS("(function(){const b=document.querySelector('button[aria-label=\"Increase\"]');b&&b.click();return 'inc'})()"); await sleep(900); }
  const res = await runFile('add_to_cart');
  await sleep(6000);
  const badge = await runJS("String((document.body.innerText.match(/items in cart (\\d+)/i)||[])[1]||'?')");
  out({ action: 'add', url, variants: picked, selected, qty, result: res, cart_badge: badge });
}

/** qty <row> <count> */
async function qty() {
  const idx = Number(argv[1]); const target = Number(argv[2]);
  if (Number.isNaN(idx) || Number.isNaN(target)) throw new Error('usage: qty <row> <count>');
  await ensureCart();
  const rows = await liveRows();
  const cur = Number((rows[idx] || {}).qty || 0);
  if (!cur) throw new Error(`row ${idx} not found`);
  const DIR = target > cur ? 'Increase' : 'Decrease';
  for (let i = 0; i < Math.abs(target - cur); i++) { await runFile('step_qty', { IDX: idx, DIR }); await sleep(1600); }
  await sleep(2000);
  out({ action: 'qty', row: idx, from: cur, to: target, rows: await liveRows() });
}

/** rm <row> */
async function rm() {
  const idx = Number(argv[1]);
  if (Number.isNaN(idx)) throw new Error('usage: rm <row>');
  await ensureCart();
  const clicked = await runFile('remove', { IDX: idx });
  await sleep(2500);
  const confirmed = await runFile('confirm');
  await sleep(3000);
  out({ action: 'rm', row: idx, clicked, confirmed, rows: await liveRows() });
}

/** reviews <product-url> [--pages N] — captures the page's own /api/v4/item/get_ratings XHRs.
 *  A scripted fetch to that endpoint is refused (business: "Rating"), same as search.
 *  NB: the live endpoint is /api/v2/item/get_ratings — v4 is gone. */
async function reviews() {
  const url = argv[1];
  if (!url) throw new Error('reviews needs a product url');
  const pages = Number(val('pages', 3));

  if (flag('live')) {
    // live Chrome: lets us switch star filters and read low-star reviews, which the
    // headless capture cannot reach (its pager never renders)
    await go(url, 12000);
    for (let i = 0; i < 6; i++) { await runJS("(function(){window.scrollBy(0,1500);return 'ok'})()"); await sleep(1200); }
    await sleep(2500);
    const stars = val('stars');
    if (stars) { await runFile('reviews_tab', { STARS: JSON.stringify(String(stars)) }); await sleep(4000); }
    const res = await jsonFile('reviews_read');
    if (!res.found) throw new Error('ratings section not rendered');
    return out({ url, stars_filter: stars || 'all', source: 'live-dom', text: res.text });
  }

  return withPage(async (page) => {
    const seen = [];
    page.on('response', async (res) => {
      if (!/\/api\/v[0-9]+\/item\/get_ratings/.test(res.url())) return;
      if (process.env.SHOPEE_DEBUG) console.error(' rating-xhr:', res.status(), res.url().slice(0, 60));
      try {
        const j = JSON.parse(await res.text());
        for (const x of j?.data?.ratings || []) {
          seen.push({
            stars: x.rating_star,
            text: (x.comment || '').replace(/\s+/g, ' ').trim().slice(0, 400),
            variant: x.product_items?.[0]?.model_name || null,
            liked: x.like_count,
          });
        }
      } catch (e) { if (process.env.SHOPEE_DEBUG) console.error(' rating-parse-fail:', e.message); }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(900); }
    const stars = val('stars');
    if (stars) {
      // star tabs are plain buttons: "1 Star (12)" / "1 Sao (12)"
      const tab = page.locator(`button:has-text("${stars} Star"), button:has-text("${stars} Sao")`).first();
      if (await tab.count()) { await tab.click({ force: true }).catch(() => {}); await page.waitForTimeout(3500); }
    }
    for (let p = 1; p < pages; p++) {
      const next = page.locator('button.shopee-icon-button--right').first();
      if (!(await next.count())) break;
      await next.click({ force: true }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    const withText = seen.filter((r) => r.text);
    out({
      url,
      stars_filter: val('stars') || 'all',
      collected: seen.length,
      with_text: withText.length,
      stars_histogram: seen.reduce((a, r) => ({ ...a, [r.stars]: (a[r.stars] || 0) + 1 }), {}),
      reviews: withText,
    });
  }, { headed: flag('headed') });
}

/** orders — reads My Purchases from the live Chrome and structures it. */
async function orders() {
  await go('https://shopee.vn/user/purchase/', 13000);
  const res = await jsonFile('orders_read');
  const text = typeof res === 'string' ? res : res.text;
  const blocks = text.split('Order Shop Section |').slice(1);
  const list = blocks.map((b) => {
    const shop = (b.split('|')[0] || '').trim();   // block starts right after the marker
    const status = (b.match(/\b(TO PAY|TO SHIP|TO RECEIVE|COMPLETED|CANCELLED|RETURN)\b/) || [])[1] || null;
    const total = (b.match(/Order Total:\s*\|\s*([\d.,]+₫)/) || [])[1] || null;
    const delivery = (b.match(/between ([\d-]+) and ([\d-]+)/) || []).slice(1, 3);
    // every line item repeats the product name before "Variation:", so match on that
    const items = [...b.matchAll(/([^|]{5,140})\| Variation: ([^|]+)\| x(\d+) \| ([^|]+)/g)]
      .map((m) => ({ name: m[1].trim().slice(0, 70), variant: m[2].trim(), qty: Number(m[3]), price: m[4].trim() }));
    return { shop, status, total, delivery: delivery.length ? delivery.join(' … ') : null, items };
  }).filter((o) => o.shop && o.items.length);
  out({ orders: list.length, list });
}

async function cartHeadless() {
  return withPage(async (page) => {
    const cap = captureJson(page, (r) => /\/api\/v4\/cart\/(get|list)/.test(r.url()), (j) => (j?.error === 0 ? (j.data || j) : null));
    await page.goto('https://shopee.vn/cart', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const c = await cap.wait();
    if (!c) throw new Error('no cart payload');
    const rows = (c.shop_orders || []).flatMap((s) => (s.items || []).map((i) => ({
      shop: s.shop?.name || null, name: i.name, variant: i.model_name || null,
      qty: i.amount, price_vnd: vnd(i.price), total_vnd: vnd((i.price || 0) * (i.amount || 1)),
    })));
    return out({ items: rows.length, total_vnd: rows.reduce((a, r) => a + (r.total_vnd || 0), 0), rows });
  }, { headed: flag('headed') });
}

const CMDS = { search, item, reviews, orders, cart: cartCmd, 'cart-headless': cartHeadless, add, qty, rm };
(CMDS[cmd] || (async () => { console.error('usage: shopee.cjs search|item|cart …'); process.exit(2); }))()
  .catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
