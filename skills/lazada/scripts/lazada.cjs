/** Lazada Thailand — история заказов через внутренний Ultron-эндпоинт.
 *
 *  Почему не разбор DOM: у списка заказов 77 страниц и пагинация Next-UI, то есть
 *  77 кликов и разбор вёрстки. Вместо этого страница сама ходит POST-ом на
 *  /customer/api/sync/order-list с телом {ultronVersion:"2.0"}, и тот же запрос
 *  принимает page и pageSize. При pageSize=100 вся история снимается за ~8 запросов.
 *
 *  Как нашлись имена параметров: linkage.common.queryParams в ответе — это
 *  gzip+base64 с префиксом "^^$$<md5>{$_$}". Внутри лежит
 *  QueryBuyerOrderListRequest с полями tab/page/pageSize/chosenTimeLimit.
 *  Угадывать их не надо: pageNum, currentPage и pageIndex молча игнорируются,
 *  запрос отвечает success:true и всегда отдаёт первую страницу.
 *
 *  Браузер нужен живой и залогиненный: эндпоинт авторизуется кукой, а fetch
 *  идёт из самой страницы Лазады, поэтому кука подставляется сама.
 */
const path = require('path');

// Мост к живому Chrome общий с шопи-скиллом. Своей копии не держим: правка
// в одном месте — работает у обоих.
const BRIDGE = path.join(process.env.HOME, '.pi/agent/skills/shopee-search/scripts/bridge.cjs');
const bridge = require(BRIDGE);

// Страна — одной переменной LAZADA_REGION (th по умолчанию, vn — Вьетнам).
// Копировать скилл под вторую страну нельзя: отличаются только хост,
// валюта и слова в интерфейсе, всё остальное у Лазады общее.
const REGIONS = {
  th: {
    host: 'my.lazada.co.th', shop: 'www.lazada.co.th', cart: 'cart.lazada.co.th',
    cur: '฿',
    // «1,234.50»: запятая — тысячи, точка — копейки
    num: (s) => Number(String(s).replace(/[^\d.]/g, '')),
    sold: /([\d.,]+)\s*(?:sold|ขายแล้ว)/i,
    addBtn: ['add to cart', 'หยิบใส่ตะกร้า'],
    added: /added to cart|หยิบใส่ตะกร้าเรียบร้อย/i,
    confirm: ['remove', 'ลบ', 'ok', 'confirm'],
  },
  vn: {
    host: 'my.lazada.vn', shop: 'www.lazada.vn', cart: 'cart.lazada.vn',
    cur: '₫',
    // «184.536»: точка — тысячи, дробной части у донга нет
    num: (s) => Number(String(s).replace(/[^\d]/g, '')),
    sold: /([\d.,]+)\s*(?:sold|đã bán)/i,
    addBtn: ['add to cart', 'thêm vào giỏ hàng', 'mua ngay'],
    added: /added to cart|đã thêm vào giỏ hàng|thêm vào giỏ hàng thành công/i,
    confirm: ['remove', 'xóa', 'xoá', 'đồng ý', 'ok', 'confirm'],
  },
};
const REGION = (process.env.LAZADA_REGION || 'th').toLowerCase();
const R = REGIONS[REGION];
if (!R) throw new Error(`неизвестный LAZADA_REGION=${REGION}, доступны: ${Object.keys(REGIONS).join(', ')}`);

const HOST = R.host;
const SHOP_HOST = R.shop;
const CART_HOST = R.cart;
const ORDERS_URL = `https://${HOST}/customer/order/index/`;
const CART_URL = `https://${CART_HOST}/cart`;
const API = '/customer/api/sync/order-list';
const CUR = R.cur;

const TABS = ['ALL', 'TO_PAY', 'TO_SHIP', 'TO_RECEIVE', 'TO_REVIEW'];

/** Открыть страницу заказов, если браузер не на ней: fetch должен идти с её домена. */
async function ensurePage() {
  const here = String(await bridge.runJS('location.host')) || '';
  if (!here.includes('lazada')) {
    await bridge.go(ORDERS_URL, 14000);
    return;
  }
  const p = String(await bridge.runJS('location.pathname')) || '';
  if (!p.includes('/customer/order')) await bridge.go(ORDERS_URL, 12000);
}

/** Один запрос страницы заказов. runJS отдаёт результат синхронно, поэтому
 *  промис разрешаем внутри страницы и забираем из window по метке. */
async function fetchPage(page, pageSize, tab) {
  const slot = `__lzd_${Date.now()}_${page}`;
  await bridge.runJS(`(() => { window.${slot} = null;
    fetch(${JSON.stringify(API)}, {method:"POST", credentials:"include",
      headers:{"content-type":"application/json","accept":"application/json"},
      body: JSON.stringify({ultronVersion:"2.0", tab:${JSON.stringify(tab)},
        page:${page}, pageSize:${pageSize}})})
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j || !j.success || !j.module) { window.${slot} = {err: "ответ без данных"}; return; }
        var d = j.module.data, shops = {}, out = [];
        Object.keys(d).forEach(function(k){
          if (k.indexOf("orderShop_") === 0) {
            var f = d[k].fields;
            // Человеческий статус (Delivered/Cancelled) живёт в магазине, а не в
            // позиции: у позиции есть только delivery.status = "success", это
            // технический признак доставки и он одинаков у отменённых тоже.
            var st = null;
            if (f.status && typeof f.status === "string") st = f.status;
            else if (f.status && f.status.text) st = f.status.text;
            else if (f.orderInfo && f.orderInfo.status) st = f.orderInfo.status;
            shops[String(f.shopGroupKey)] = {
              shop: f.name || null, shopLink: f.link || null, status: st,
              createdAt: (f.orderInfo && f.orderInfo.createdAt) || null
            };
          }
        });
        Object.keys(d).forEach(function(k){
          if (k.indexOf("orderItem_") !== 0) return;
          var f = d[k].fields, s = shops[String(f.groupId)] || {};
          out.push({
            orderId: String(f.tradeOrderId || ""),
            title: f.title || "",
            variation: (f.sku && f.sku.skuText) || null,
            price: typeof f.price === "string" ? f.price : (f.price && f.price.text) || null,
            qty: typeof f.quantity === "number" ? f.quantity
                 : (f.quantity && (f.quantity.text || f.quantity.value)) || null,
            status: s.status || null,
            delivery: (f.delivery && f.delivery.method) || null,
            date: s.createdAt || null,
            shop: s.shop, shopLink: s.shopLink,
            url: f.orderDetailUrl || f.itemUrl || null
          });
        });
        window.${slot} = {items: out};
      })
      .catch(function(e){ window.${slot} = {err: String(e).slice(0,140)}; });
    return 1; })()`);

  for (let i = 0; i < 40; i++) {
    await bridge.sleep(600);
    const raw = String(await bridge.runJS(`JSON.stringify(window.${slot})`) || 'null');
    if (raw && raw !== 'null' && raw !== 'undefined') {
      await bridge.runJS(`delete window.${slot}; 1`);
      const d = JSON.parse(raw);
      if (d.err) throw new Error(d.err);
      return d.items;
    }
  }
  throw new Error(`страница ${page}: ответа нет за 24 с`);
}

/** Вся история или её часть.
 *
 *  Конец списка определяется по «новых позиций не пришло», а не по размеру
 *  страницы: pageSize считает заказы, а ответ содержит позиции, их больше
 *  (100 заказов ≈ 126 позиций). Разовый сбой страницы не должен ронять всю
 *  выгрузку: пробуем второй раз, потом останавливаемся и отдаём собранное.
 */
async function orders({ pages = 20, pageSize = 100, tab = 'ALL', onPage = null } = {}) {
  if (!TABS.includes(tab)) throw new Error(`вкладка «${tab}»; есть: ${TABS.join(', ')}`);
  await ensurePage();
  const seen = new Set();
  const all = [];
  const notes = [];
  for (let p = 1; p <= pages; p++) {
    let items = null;
    for (let attempt = 1; attempt <= 2 && items === null; attempt++) {
      try {
        items = await fetchPage(p, pageSize, tab);
      } catch (e) {
        if (attempt === 2) notes.push(`страница ${p}: ${String(e.message || e).slice(0, 80)}`);
        else await bridge.sleep(2500);
      }
    }
    if (items === null) break;
    let added = 0;
    for (const it of items) {
      const key = it.orderId + '|' + it.title;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(it);
      added++;
    }
    if (onPage) onPage(p, added, all.length);
    if (added === 0) break;
  }
  all.notes = notes;
  return all;
}

/** Фильтр по названию, магазину и варианту. Регистр и язык не важны.
 *  Слова разделяются пробелом или вертикальной чертой и ищутся по или: саму черту
 *  экранировать нельзя, иначе «touch|screen» ищется как одна строка целиком. */
function filter(items, query) {
  if (!query) return items;
  const words = query.split(/[\s|]+/).filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()[\]\\]/g, '\\$&'));
  const re = new RegExp(words.join('|'), 'i');
  return items.filter((it) => re.test([it.title, it.shop, it.variation].filter(Boolean).join(' ')));
}

/** Поиск по каталогу.
 *
 *  Читается отрисованная выдача: 40 карточек приходят сразу, виртуализации нет,
 *  и рендер не зависит от того, видима ли вкладка. У тайского Шопи наоборот —
 *  в скрытой вкладке сетка не строится вовсе, а его search API отдаёт 403 даже
 *  из настоящего браузера. Поэтому для Таиланда рабочий поиск — здесь.
 */
async function search(query, { sort = null, limit = 20 } = {}) {
  const fs = require('fs');
  const url = `https://${SHOP_HOST}/catalog/?q=${encodeURIComponent(query)}`
    + (sort ? `&sort=${sort}` : '');
  await bridge.go(url, 16000);
  await bridge.sleep(3500);
  const reader = fs.readFileSync(path.join(__dirname, 'js/search_read.js'), 'utf8');
  const cards = JSON.parse(String(await bridge.runJS(reader)) || '[]');
  return cards.map(parseCard).filter((x) => x.name).slice(0, limit);
}

/** Текст карточки → поля.
 *
 *  Формат устойчив: название ~ цена ~ скидка ~ ваучер ~ «N sold» ~ «(N)» ~ город.
 *  Звёздного рейтинга в тексте НЕТ — он нарисован иконками, а «(89)» это число
 *  оценок. Первый попавшийся «5.6» в тексте — это диагональ 15.6", а не звёзды:
 *  наивная регулярка выдавала рейтинги 5.6★ и 8.5★.
 */
function parseCard(c) {
  const parts = c.text.split(' ~ ').map((x) => x.trim()).filter(Boolean);
  // Знак валюты стоит по-разному: в Таиланде слева (฿168.00),
  // во Вьетнаме справа (168.000 ₫). Ищем с любой стороны.
  const priceRaw = parts.find((x) => /^[฿₫]\s*[\d.,]+$/.test(x) || /^[\d.,]+\s*[฿₫]$/.test(x)) || null;
  const price = priceRaw ? R.num(priceRaw) : null;
  const sold = Number(((c.text.match(R.sold) || [])[1] || '').replace(/[.,]/g, '')) || 0;
  const reviews = Number((c.text.match(/\((\d+)\)/) || [])[1]) || 0;
  const name = parts[0] || '';
  const nit = Number((c.text.match(/(\d{3,4})\s*(?:nit|nits|นิต)/i) || [])[1]) || null;
  const inch = (name.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:-?\s*inch|นิ้ว|["\u2019])/i) || [])[1] || null;
  const res = (name.match(/\b(4K|2\.?5K|2K|1440P|1080P|FHD|QHD)\b/i) || [])[1] || null;
  const touch = /touch|สัมผัส|ทัช/i.test(name);
  return {
    name, price, priceText: priceRaw, sold, reviews, nit, touch,
    res: res ? res.toUpperCase() : null,
    inch: inch ? inch.replace(',', '.') : null,
    city: parts[parts.length - 1] || null, url: c.url,
  };
}

/** Ссылка на товар из чего угодно: полный URL, короткий pdp-id, голый id. */
function productUrl(target) {
  const t = String(target || '').trim();
  if (/^https?:\/\//.test(t)) return t;
  const id = (t.match(/i(\d{6,})/) || [])[1];
  if (!id) throw new Error(`не похоже на товар: ${t}`);
  return `https://${SHOP_HOST}/products/pdp-i${id}.html`;
}

/** Содержимое корзины. */
async function cart() {
  const fs = require('fs');
  const here = String(await bridge.runJS('location.href')) || '';
  if (!here.includes('cart.lazada')) {
    await bridge.go(CART_URL, 16000);
    await bridge.sleep(6000);
  }
  const reader = fs.readFileSync(path.join(__dirname, 'js/cart_read.js'), 'utf8');
  return JSON.parse(String(await bridge.runJS(reader)) || '{"items":[]}');
}

/** Положить товар в корзину.
 *
 *  Кнопка ищется по тексту, а не по классу: класс у неё
 *  add-to-cart-buy-now-btn, но рядом живёт add-to-cart у «Buy Now», и выбор по
 *  префиксу класса приводит к мгновенному оформлению заказа вместо корзины.
 *  Подтверждение — всплывающее «Added to cart successfully», сетевого ответа
 *  перехватить нельзя: запрос уходит мимо fetch и XHR.
 */
async function addToCart(target, { qty = 1 } = {}) {
  const url = productUrl(target);
  await bridge.go(url, 16000);
  await bridge.sleep(6000);

  if (qty > 1) {
    await bridge.runJS(`(function(){
      var up = document.querySelector('[class*=next-number-picker-handler-up]');
      if (!up) return 'нет счётчика';
      for (var i = 1; i < ${Number(qty)}; i++) up.click();
      return 'ok';
    })()`);
    await bridge.sleep(1200);
  }

  // «Buy Now» рядом и тоже содержит слово «mua»: берём точное совпадение
  // по надписи корзины и никогда — по префиксу класса.
  const labels = JSON.stringify(R.addBtn.filter((t) => t !== 'mua ngay'));
  const clicked = String(await bridge.runJS(`(function(){
    var want = ${labels};
    var hit = null;
    document.querySelectorAll('button').forEach(function(el){
      var t = (el.innerText || '').trim().toLowerCase();
      if (want.indexOf(t) > -1) hit = el;
    });
    if (!hit) return 'кнопки «Add to Cart» нет — возможно, нужен выбор варианта';
    hit.click();
    return 'ok';
  })()`));
  if (clicked !== 'ok') throw new Error(clicked);

  await bridge.sleep(5000);
  const ok = String(await bridge.runJS(`(function(){
    var t = document.body.innerText;
    return ${R.added.toString()}.test(t) ? 'ok' : 'нет подтверждения';
  })()`));
  return { url, qty, confirmed: ok === 'ok' };
}

/** Убрать позицию: номер из cart() или кусок названия. */
async function removeFromCart(pick) {
  const before = await cart();
  const byIndex = /^\d+$/.test(String(pick));
  const target = byIndex
    ? before.items.find((i) => i.index === Number(pick))
    : before.items.find((i) => new RegExp(String(pick).replace(/[.*+?^${}()[\]\\]/g, '\\$&'), 'i')
      .test([i.title, i.variant].filter(Boolean).join(' ')));
  if (!target) throw new Error(`в корзине нет позиции «${pick}»`);

  await bridge.runJS(`(function(){
    var rows = document.querySelectorAll('.cart-item');
    var row = rows[${target.index - 1}];
    if (!row) return 'нет строки';
    var del = row.querySelector('[class*=automation-btn-delete], [class*=icon-Delete]');
    if (!del) return 'нет кнопки удаления';
    del.click();
    return 'ok';
  })()`);
  await bridge.sleep(2500);
  // Удаление всегда спрашивает подтверждение модалкой «Remove from cart»
  // с кнопками REMOVE и CANCEL. Без этого шага позиция остаётся на месте.
  await bridge.runJS(`(function(){
    var want = ${JSON.stringify(R.confirm)};
    var b = Array.prototype.slice.call(document.querySelectorAll('button, a, span[role=button]'))
      .find(function(e){ return want.indexOf((e.innerText||'').trim().toLowerCase()) > -1; });
    if (!b) return 'нет кнопки подтверждения';
    b.click();
    return 'ok';
  })()`);
  await bridge.sleep(4000);
  const after = await cart();
  return { removed: target, left: after.items.length };
}

module.exports = { orders, filter, fetchPage, ensurePage, search, parseCard,
  cart, addToCart, removeFromCart, productUrl, HOST, CUR, TABS, REGION };
