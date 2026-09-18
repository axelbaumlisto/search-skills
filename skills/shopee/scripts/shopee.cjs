#!/usr/bin/env node
/** Shopee CLI: search / item / cart. Region via SHOPEE_REGION=vn|th (regions.cjs).
 *  See SKILL.md for the anti-bot rules. */
const { R, withPage, captureJson, parseItem, money } = require(`${__dirname}/lib.cjs`);
const { runJS, runFile, json, jsonFile, go, autoScroll, sleep } = require(`${__dirname}/browser.cjs`);

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

const searchUrl = (keyword, sort, min, max, page0) => {
  let u = `${R.base}/search?keyword=${encodeURIComponent(keyword)}&${SORTS[sort] || SORTS.relevancy}&page=${page0}`;
  if (min) u += `&minPrice=${min}`;
  if (max) u += `&maxPrice=${max}`;
  return u;
};

/** Parse one rendered search card. Text shape (fields joined with " ~ "):
 *  [-45%] name ~ ฿ ~ 4,969 [~ ฿ ~ 8,998 ~ -45%] [~ badges] [~ 4.9] [~ 47 sold] [~ 2-5 Days] [~ Location] */
function parseCard(c) {
  const f = c.t.split(' ~ ').map((s) => s.trim()).filter(Boolean);
  const num = (s) => Number(String(s).replace(/[^\d.]/g, '')) || null;
  const prices = [];
  f.forEach((tok, i) => {
    if (/^[฿₫]$/.test(tok)) { const v = num(f[i + 1]); if (v) prices.push(v); }
    else { const m = tok.match(/^[฿₫]\s*([\d.,]+)$/); if (m) prices.push(num(m[1])); }
  });
  const soldTok = f.find((t) => /\bsold\b/i.test(t)) || '';
  const soldM = soldTok.match(/([\d.,]+)\s*(k|m)?\+?\s*sold/i);
  const soldN = soldM ? Math.round(num(soldM[1]) * ({ k: 1e3, m: 1e6 }[(soldM[2] || '').toLowerCase()] || 1)) : null;
  // the grid shows either lifetime "2k+ sold" or "982 Sold/Month" — never both
  const monthly = /sold\s*\/\s*month/i.test(soldTok);
  const discTok = f.filter((t) => /^-\d+%$/.test(t)).pop();
  const rating = Number(f.find((t) => /^[0-5](\.\d+)?$/.test(t)) || 0) || null;
  const name = f.find((t) => t.length > 8 && !/^-\d+%$/.test(t) && !/^[฿₫]/.test(t)) || null;
  const last = f[f.length - 1] || '';
  const location = /sold|Days|%|^[฿₫]|^\d/.test(last) ? null : last;
  return {
    name,
    [R.priceKey('price')]: prices[0] ?? null,
    [R.priceKey('original_price')]: prices[1] ?? null,
    discount_pct: discTok ? Math.abs(Number(discTok.replace(/[^\d]/g, ''))) : null,
    sold: monthly ? null : soldN,
    sold_month: monthly ? soldN : null,
    rating,
    location,
    promoted: !c.organic,
    image: c.img || null,
    url: `${R.base}/product/${c.shopid}/${c.itemid}`,
    raw: c.t,
  };
}

/** Search by reading the rendered grid in the user's live Chrome.
 *  Needed for regions where the search XHR is refused to any automated browser. */
async function liveSearch(keyword, sort, min, max, limit, page0) {
  await go(searchUrl(keyword, sort, min, max, page0), 15000);
  /* Сетка виртуализована: контейнеры [data-sqe=item] существуют сразу (60 шт.),
     но содержимое появляется только у видимых, а у ушедших из вида снова пустеет.
     Одно чтение после прокрутки видело только три рекламные карточки вверху, и тайский
     поиск отдавал пустоту. Поэтому читаем на каждом шаге и накапливаем. */
  const byId = new Map();
  for (let step = 0; step < 12; step++) {
    const batch = await jsonFile('search_read');
    if (Array.isArray(batch)) for (const c of batch) byId.set(`${c.shopid}.${c.itemid}`, c);
    if (byId.size >= limit * 3) break;
    await runJS(`scrollBy(0, 1500); 1`);
    await sleep(800);
  }
  const cards = [...byId.values()];
  if (!cards.length) throw new Error('no cards rendered (captcha in the live tab?)');
  // the first rows are a paid promo strip whose products often ignore the query
  const rows = flag('ads') ? cards : cards.filter((c) => c.organic);
  /* Реклама есть, а органики нет — значит сетка ждёт данных, которые ей не дали.
     Тихой пустоты вместо ошибки быть не должно: спрашиваем у самой страницы, чем ответил
     её же запрос поиска, и передаём код наружу. 403/90309999 — анти-бот Шопи,
     вылезает после очереди запросов подряд и проходит сам через несколько минут. */
  if (!rows.length && cards.length) {
    const why = await searchApiStatus();
    throw new Error(
      `выдана только реклама (${cards.length} карт.), органики нет.\n`
      + `Запрос поиска самой страницы: ${why}.\n`
      + 'Причина не в блокировке, а в окне Chrome: когда оно перекрыто другими\n'
      + 'окнами, macOS считает его occluded, и Сетка результатов не строится вовсе.\n'
      + 'Покажи окно Chrome на экране и повтори запрос.');
  }
  const items = rows.map(parseCard).filter((i) => i.name).slice(0, limit);
  return out({ region: R.code, currency: R.currency, source: 'live-dom', keyword, sort, page: page0, returned: items.length, items });
}

async function search() {
  const keyword = argv[1];
  if (!keyword) throw new Error('search needs a keyword');
  const sort = val('sort', 'relevancy'); const min = val('min'); const max = val('max');
  const limit = Number(val('limit', 20)); const page0 = Number(val('page', 0));
  if ((R.searchLive && !flag('headless')) || flag('live')) return liveSearch(keyword, sort, min, max, limit, page0);
  const url = searchUrl(keyword, sort, min, max, page0);
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
    return out({ region: R.code, currency: R.currency, keyword, sort, page: page0, total_count: p.total_count, returned: items.length, items });
  }, { headed: flag('headed') });
}

/** Product page read from the live Chrome — same reason as liveSearch. */
async function liveItem(url) {
  await go(url, 15000);
  await autoScroll({ steps: 2, everyMs: 700, px: 900 });
  const d = await jsonFile('pdp_read');
  if (!d || !d.title) throw new Error('pdp not rendered (captcha in the live tab?)');
  return out({
    region: R.code, currency: R.currency, source: 'live-dom', url,
    name: d.title, price: d.price_text, price_block: d.price_block,
    rating: d.rating, sold: d.sold, stock: d.stock,
    variations: d.tiers,
    ...(flag('desc') ? { description: d.description || null } : {}),
  });
}

async function item() {
  const url = argv[1];
  if (!url) throw new Error('item needs a product url');
  if ((R.searchLive && !flag('headless')) || flag('live')) return liveItem(url);
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
      region: R.code, currency: R.currency, name,
      [R.priceKey('price_min')]: money(d.price_min || d.price),
      [R.priceKey('price_max')]: money(d.price_max || d.price),
      rating: d.item_rating?.rating_star ?? null,
      variations: (d.tier_variations || []).map((t) => ({ name: t.name, options: t.options })),
      models: (d.models || []).map((m) => ({ name: m.name, modelid: m.modelid, [R.priceKey('price')]: money(m.price), stock: m.stock })),
      ...(flag('desc') ? { description: desc || null } : {}),
    });
  }, { headed: flag('headed') });
}

/* ---- live-browser commands: Shopee blocks cart writes from any automated browser ---- */

async function liveRows() { return jsonFile('rows'); }

async function ensureCart() {
  const here = await runJS('String(location.href)');
  if (!here.includes(`${R.host}/cart`)) await go(`${R.base}/cart`);
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

  if (flag('live') || (R.searchLive && !flag('headless'))) {
    // live Chrome: lets us switch star filters and read low-star reviews, which the
    // headless capture cannot reach (its pager never renders)
    await go(url, 12000);
    await autoScroll({ steps: 7, everyMs: 1000, px: 1500 });
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
      // star tabs are plain buttons: "1 Star (12)" / "1 Sao (12)" / "1 ดาว (12)"
      const tab = page.locator(R.starWords.map((w) => `button:has-text("${stars} ${w}")`).join(', ')).first();
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

/** orders [--query WORD] [--pages N] [--type all|completed|cancelled]
 *  Reads My Purchases from the live Chrome, walks the pager and filters locally.
 *  Shopee's own purchase search box is React-driven; the ?page= URL is the reliable way. */
async function orders() {
  const type = val('type', 'all');
  const q = (val('query') || '').toLowerCase();
  // With a query, use Shopee's own search box: it covers the whole history server-side,
  // which paging cannot (30 orders over 6 pages still missed a 2024 one).
  if (q) {
    await go(`${R.base}/user/purchase/?type=${type}`, 13000);
    const typed = await runFile('orders_search', { Q: JSON.stringify(val('query')) });
    if (typed === 'no-input') throw new Error('purchase search box not found');
    await sleep(6000);
    await waitOrders();
    const hit = dedupe(parseOrders(await jsonFile('orders_read')));
    return out({ region: R.code, query: val('query'), source: 'purchase-search', orders: hit.length, list: hit });
  }
  /* Постраничности у списка покупок НЕТ: ?page=N Шопи игнорирует — и VN, и TH
     на любой странице отдают один и тот же первый экран из 5 заказов. Прежний
     цикл по --pages множил повторы: 20 страниц давали «100 заказов», которые
     были теми же пятью. Список подгружается бесконечной п��окруткой, поэтому
     листаем вниз и накапливаем, пока приходят новые.

     Прокрутка работает только в видимом окне: в перекрытом macOS помечает
     вкладку occluded, догрузка не срабатывает, и виден лишь первый экран.
     Поэтому в ответе есть visible и note, а за полной историей — --query:
     он идёт через серверный поиск Шопи и видит все заказы. */
  await go(`${R.base}/user/purchase/?type=${type}`, 13000);
  const painted = await waitOrders();
  if (!painted) throw new Error('страница заказов не отрисовалась за 20 с — проверь логин');

  const visible = String(await runJS('document.visibilityState')) === 'visible';
  const list = [];
  const seen = new Set();
  let idle = 0;
  for (let step = 0; step < 40 && idle < 3; step++) {
    const fresh = parseOrders(await jsonFile('orders_read')).filter((o) => {
      const k = o.order_id || `${o.shop}|${o.total}|${(o.items[0] || {}).name}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    list.push(...fresh);
    idle = fresh.length ? 0 : idle + 1;
    await runJS('scrollTo(0, document.body.scrollHeight); 1');
    await sleep(1500);
  }

  const note = visible
    ? null
    : 'окно Chrome перекрыто: показан только первый экран истории. Покажи окно '
      + 'или используй --query — он ищет по всей истории на сервере.';
  out({ region: R.code, source: 'purchase-scroll', visible, orders: list.length, note, list });
}

function parseOrders(res) {
  const text = (typeof res === 'string' ? res : res.text) || '';
  const ids = (typeof res === 'object' && res.order_ids) || [];
  const blocks = text.split('Order Shop Section |').slice(1);
  return blocks.map((b, n) => {
    const shop = (b.split('|')[0] || '').trim();   // block starts right after the marker
    /* Статус берём по месту, а не по словарю: между «View Shop |» и началом
       списка товаров. Словарь ловил только знакомые слова и отдавал null на
       REFUND IN PROGRESS — заказ выглядел «без статуса». Рядом бывает заметка
       перевозчика («Giao hàng thành công»), её сохраняем отдельно. */
    const head = (b.split('Order Item List Section')[0] || '').split('View Shop |')[1] || '';
    const segs = head.split('|').map((x) => x.trim()).filter(Boolean);
    const status = [...segs].reverse().find((x) => /^[A-Z][A-Z \-]{2,}$/.test(x)) || null;
    const note = segs.filter((x) => x !== status).join(' · ') || null;
    // currency symbol placement differs per region (1.000₫ vs ฿1,000) — take the whole field
    const total = ((b.match(/Order Total:\s*\|\s*([^|]+)/) || [])[1] || '').trim() || null;
    const delivery = (b.match(/between ([\d-]+) and ([\d-]+)/) || []).slice(1, 3);
    /* Позиция: имя, необязательный вариант, количество, цена. Вариант есть не
       у всех товаров — у односортных (CeraVe) его нет, и обязательный
       «Variation:» выбрасывал такой заказ целиком как пустой. */
    const items = [...b.matchAll(/([^|]{5,140})\|(?:\s*Variation:\s*([^|]+)\|)?\s*x(\d+)\s*\|\s*([^|]+)/g)]
      .map((m) => ({
        name: m[1].trim().slice(0, 70),
        variant: (m[2] || '').trim() || null,
        qty: Number(m[3]),
        price: m[4].trim(),
      }))
      .filter((i) => i.name && !/^(Go to PDP|Order Item List Section)$/.test(i.name));
    return {
      shop, status, note, total, delivery: delivery.length ? delivery.join(' … ') : null,
      order_id: ids[n] || null, items,
    };
  }).filter((o) => o.shop && o.items.length);
}

/** Чем ответил поисковый запрос самой страницы. Повторяем его URL дословно:
 *  свою сборку Шопи отвергает всегда — там есть подпись в параметрах сессии. */
async function searchApiStatus() {
  const url = String(await runJS(`(function(){
    var e = performance.getEntriesByType('resource').filter(function(x){ return /search_items/.test(x.name); });
    return e.length ? e[e.length - 1].name : '';
  })()`) || '');
  if (!url) return 'запроса поиска вообще не было';
  await runJS(`(function(){ window.__sst = null;
    fetch(${JSON.stringify(url)}, {credentials:'include'}).then(function(r){ return r.text().then(function(t){
      var j = null; try { j = JSON.parse(t); } catch (e) {}
      window.__sst = {status: r.status, error: j && j.error, items: j && j.items ? j.items.length : null};
    });}).catch(function(e){ window.__sst = {status: 0, error: String(e).slice(0, 60)}; });
    return 1; })()`);
  for (let i = 0; i < 12; i++) {
    await sleep(700);
    const raw = String(await runJS('JSON.stringify(window.__sst)') || 'null');
    if (raw && raw !== 'null') {
      const d = JSON.parse(raw);
      return d.items ? `${d.status}, товаров ${d.items}` : `${d.status}, ошибка ${d.error}`;
    }
  }
  return 'ответа нет';
}

/** Дождаться карточек заказов в DOM. Фиксированной паузы не хватало: разбор
 *  шёл по пустому дереву и скилл отдавал «заказов 0» при полной истории — проверено
 *  на тайском кабинете. Возвращает true, если карточки появились. */
async function waitOrders(tries = 20, everyMs = 1000) {
  for (let i = 0; i < tries; i++) {
    const n = Number(await runJS(
      `document.body.innerText.split('Order Shop Section').length - 1`)) || 0;
    if (n > 0) return true;
    await sleep(everyMs);
  }
  return false;
}

/** The grid repeats a block per rendered row; key on order id, else shop+item+total. */
function dedupe(list) {
  const seen = new Set();
  return list.filter((o) => {
    const k = o.order_id || `${o.shop}|${o.total}|${(o.items[0] || {}).name}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/** order <order-id|url> — one Order Detail page: money, timeline, carrier, address. */
async function order() {
  const a = argv[1];
  if (!a) throw new Error('usage: order <order-id|url>');
  const url = /^https?:/.test(a) ? a : `${R.base}/user/purchase/order/${a}?type=9999`;
  await go(url, 15000);
  const res = await jsonFile('order_read');
  const t = (typeof res === 'string' ? res : res.text) || '';
  if (!t) throw new Error('order page not rendered');
  const one = (re, d = null) => { const m = t.match(re); return m ? m[1].trim() : d; };
  const CUR = '[฿₫]';
  // "Order Placed\n11-06-2024 13:23", "Order Paid (฿10,900)\n11-06-2024 13:23", …
  const timeline = [...t.matchAll(/\n(Order [A-Z][a-z][^\n(]*?)(?:\s*\(([^)]*)\))?\n(\d{2}-\d{2}-\d{4} \d{2}:\d{2})/g)]
    .map((m) => ({ step: m[1].trim(), amount: m[2] || null, at: m[3] }));
  const items = [...t.matchAll(/\nGo to PDP\n([^\n]+)\nVariation: ([^\n]+)\nx(\d+)\n([^\n]+)/g)]
    .map((m) => {
      const p = m[4].match(new RegExp(`${CUR}[\\d.,]+`, 'g')) || [];
      return { name: m[1].trim(), variant: m[2].trim(), qty: Number(m[3]), was: p[0] || null, paid: p[1] || p[0] || null };
    });
  return out({
    region: R.code, url,
    order_id: one(/ORDER ID\.?\s*([A-Z0-9]+)/),
    status: one(/\n(ORDER [A-Z ]{3,})\n/),
    shop: one(/\n([^\n]+)\nChat\nView Shop\nGo to PDP/),
    items,
    subtotal: one(new RegExp(`Merchandise Subtotal\\n(${CUR}[\\d.,]+)`)),
    shipping_fee: one(new RegExp(`Shipping Fee\\n(${CUR}[\\d.,]+)`)),
    total: one(new RegExp(`Order Total\\n(${CUR}[\\d.,]+)`)),
    payment: one(/Payment Method\n([^\n]+)/),
    carrier: one(/Delivery Address\n([^\n]+)/),
    tracking: one(/\n([A-Z]{2}[A-Z0-9]{8,})\n/),
    address: one(/\(\+\d+\)[^\n]*\n([^\n]+)/),
    timeline,
    ...(flag('raw') ? { raw: t } : {}),
  });
}

async function cartHeadless() {
  return withPage(async (page) => {
    const cap = captureJson(page, (r) => /\/api\/v4\/cart\/(get|list)/.test(r.url()), (j) => (j?.error === 0 ? (j.data || j) : null));
    await page.goto(`${R.base}/cart`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const c = await cap.wait();
    if (!c) throw new Error('no cart payload');
    const rows = (c.shop_orders || []).flatMap((s) => (s.items || []).map((i) => ({
      shop: s.shop?.name || null, name: i.name, variant: i.model_name || null,
      qty: i.amount,
      [R.priceKey('price')]: money(i.price),
      [R.priceKey('total')]: money((i.price || 0) * (i.amount || 1)),
    })));
    const tk = R.priceKey('total');
    return out({ items: rows.length, [tk]: rows.reduce((a, r) => a + (r[tk] || 0), 0), rows });
  }, { headed: flag('headed') });
}

const CMDS = { search, item, reviews, orders, order, cart: cartCmd, 'cart-headless': cartHeadless, add, qty, rm };
(CMDS[cmd] || (async () => { console.error('usage: shopee.cjs search|item|cart …'); process.exit(2); }))()
  .catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
