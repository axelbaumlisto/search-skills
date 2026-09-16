/** Shared Shopee session plumbing: cookies, browser, money, item parsing.
 *  Country-specific values come from regions.cjs (SHOPEE_REGION=vn|th). */
const fs = require('fs'); const path = require('path');
const PW = process.env.NODE_PATH ? require(path.join(process.env.NODE_PATH, 'playwright')) : require('playwright');
const { R } = require(`${__dirname}/regions.cjs`);

const COOKIE_FILE = R.cookieFile;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** API amounts are value × 100000 in every region; VND is whole, THB keeps satang. */
const money = (v) => (v ? Number((v / 100000).toFixed(R.decimals)) : null);
const vnd = money; // legacy alias

const cookies = () => fs.readFileSync(COOKIE_FILE, 'utf8').split('\n')
  .filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t')).filter((p) => p.length >= 7)
  .map(([domain, , cpath, secure, expires, name, value]) => ({
    name, value, domain, path: cpath, secure: secure === 'TRUE',
    expires: Number(expires) > 0 ? Number(expires) : -1, sameSite: 'Lax',
  }));

/** Open a page carrying the session and hand it to fn. Never patch navigator.webdriver here:
 *  Shopee's fingerprint detects the tampered getter and answers error 90309999. */
async function withPage(fn, { headed = false } = {}) {
  const browser = await PW.chromium.launch({ headless: !headed });
  try {
    const ctx = await browser.newContext({
      userAgent: UA, locale: R.locale, timezoneId: R.timezone, viewport: { width: 1440, height: 900 },
    });
    await ctx.addCookies(cookies());
    return await fn(await ctx.newPage());
  } finally { await browser.close(); }
}

/** Wait until `pick` returns a value from a matching JSON response. */
function captureJson(page, test, pick = (j) => j) {
  const box = { value: null };
  page.on('response', async (res) => {
    if (box.value || !test(res)) return;
    try { const v = pick(JSON.parse(await res.text()), res); if (v) box.value = v; } catch { /* not json */ }
  });
  box.wait = async (tries = 40, ms = 700) => {
    for (let i = 0; i < tries && !box.value; i++) await page.waitForTimeout(ms);
    return box.value;
  };
  return box;
}

/** Search result row (new BFF shape: item_data + item_card_displayed_asset).
 *
 *  ЛОВУШКА: часть карточек — виртуальные (item_identities содержит "vitem"). У них
 *  shopid/itemid ведут на фиктивный магазин-витрину, и ссылка открывает главную
 *  Shopee вместо товара. Настоящий товар лежит в real_items[0].{shop_id,item_id}.
 *  Проверено: vitem 1506174776/56217701339 -> главная, real 400502712/8057038868 -> товар. */
const parseItem = (raw) => {
  const d = raw.item_data || {}; const a = raw.item_card_displayed_asset || {};
  const real = Array.isArray(raw.real_items) && raw.real_items.length ? raw.real_items[0] : null;
  const vitem = (raw.item_identities || []).includes('vitem');
  const shopid = (vitem && real ? real.shop_id : null) ?? raw.shopid ?? d.shopid;
  const itemid = (vitem && real ? real.item_id : null) ?? raw.itemid ?? d.itemid;
  const p = d.item_card_display_price || {}; const s = d.item_card_display_sold_count || {};
  return {
    name: a.name || null,
    [R.priceKey('price')]: money(p.price),
    [R.priceKey('original_price')]: money(p.strikethrough_price || p.original_price),
    discount_pct: p.discount || null,
    sold: s.historical_sold_count ?? null, sold_month: s.monthly_sold_count ?? null,
    rating: d.item_rating?.rating_star ?? null, liked: d.liked_count ?? null,
    shop: d.shop_data?.shop_name || null, location: a.shop_location || null,
    sold_out: !!d.is_sold_out,
    image: a.image ? `https://${R.imgCdn}.img.susercontent.com/file/${a.image}` : null,
    url: `${R.base}/product/${shopid}/${itemid}`,
    ...(vitem ? { vitem: true } : {}),
  };
};

module.exports = { R, COOKIE_FILE, UA, money, vnd, cookies, withPage, captureJson, parseItem };
