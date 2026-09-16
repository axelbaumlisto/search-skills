/** Shopee regional profiles. Everything country-specific lives here and nowhere else.
 *
 *  Pick with SHOPEE_REGION=vn|th (default vn, so the original VN behaviour is untouched).
 *  Prices come out of the API as amount × 100000 in every region; only the number of
 *  decimals differs (VND has none, THB has satang).
 */
const os = require('os');
const path = require('path');

const COOKIE_DIR = path.join(os.homedir(), 'work/tg_agent/naked/.secrets/cookies');

const REGIONS = {
  vn: {
    code: 'vn',
    host: 'shopee.vn',
    locale: 'vi-VN',
    timezone: 'Asia/Saigon',
    lang: 'vi',
    currency: 'VND',
    symbol: '₫',
    decimals: 0,
    imgCdn: 'down-vn',
    cookieFile: path.join(COOKIE_DIR, 'shopee.cookies.txt'),
    // star-filter tab captions seen in the ratings section, per UI language
    starWords: ['Star', 'Sao'],
    searchLive: false,
  },
  th: {
    code: 'th',
    host: 'shopee.co.th',
    locale: 'th-TH',
    timezone: 'Asia/Bangkok',
    lang: 'th',
    currency: 'THB',
    symbol: '฿',
    decimals: 2,
    imgCdn: 'down-th',
    cookieFile: path.join(COOKIE_DIR, 'shopee_th.cookies.txt'),
    starWords: ['Star', 'ดาว'],
    // shopee.co.th answers the headless search XHR with error 90309999
    // ({"business":"Search"}) even with valid cookies — read the rendered grid instead.
    searchLive: true,
  },
};

const name = (process.env.SHOPEE_REGION || 'vn').toLowerCase();
const R = REGIONS[name];
if (!R) throw new Error(`unknown SHOPEE_REGION=${name} (have: ${Object.keys(REGIONS).join(', ')})`);

R.base = `https://${R.host}`;
/** Output key for a price field: price_vnd / price_thb — keeps the VN contract intact. */
R.priceKey = (prefix) => `${prefix}_${R.currency.toLowerCase()}`;

module.exports = { R, REGIONS };
