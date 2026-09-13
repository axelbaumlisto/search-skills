/** Shared Shopee session plumbing: cookies, browser, money, item parsing. */
const fs = require('fs'); const os = require('os'); const path = require('path');
const PW = process.env.NODE_PATH ? require(path.join(process.env.NODE_PATH, 'playwright')) : require('playwright');

const CONF_DIR = process.env.SHOPEE_HOME || process.env.SEARCH_SKILLS_HOME
  || path.join(os.homedir(), '.config/search-skills');
const COOKIE_FILE = process.env.SHOPEE_COOKIES || path.join(CONF_DIR, 'shopee.cookies.txt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const vnd = (v) => (v ? Math.round(v / 100000) : null);

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
      userAgent: UA, locale: 'vi-VN', timezoneId: 'Asia/Saigon', viewport: { width: 1440, height: 900 },
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

/** Search result row (new BFF shape: item_data + item_card_displayed_asset). */
const parseItem = (raw) => {
  const d = raw.item_data || {}; const a = raw.item_card_displayed_asset || {};
  const p = d.item_card_display_price || {}; const s = d.item_card_display_sold_count || {};
  return {
    name: a.name || null,
    price_vnd: vnd(p.price), original_price_vnd: vnd(p.strikethrough_price || p.original_price),
    discount_pct: p.discount || null,
    sold: s.historical_sold_count ?? null, sold_month: s.monthly_sold_count ?? null,
    rating: d.item_rating?.rating_star ?? null, liked: d.liked_count ?? null,
    shop: d.shop_data?.shop_name || null, location: a.shop_location || null,
    sold_out: !!d.is_sold_out,
    image: a.image ? `https://down-vn.img.susercontent.com/file/${a.image}` : null,
    url: `https://shopee.vn/product/${raw.shopid || d.shopid}/${raw.itemid || d.itemid}`,
  };
};

module.exports = { COOKIE_FILE, UA, vnd, cookies, withPage, captureJson, parseItem };
