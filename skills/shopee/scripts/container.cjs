/* Драйвер браузера в контейнере clicker — тот же интерфейс, что у bridge.cjs.

   Зачем: локальный мост поднимает окно в Chrome владельца, отбирает фокус и
   ничего не умеет, когда экран мака заблокирован (вкладка получает
   visibilityState="hidden", SPA не гидрируется, запись в корзину молча
   не срабатывает). Здесь — свой Chromium внутри уже существующего контейнера,
   профиль на volume, CDP наружу через host-сеть.

   Скилл остаётся неизменным: меняется только подложка.

     SHOPEE_BROWSER=container     — этот драйвер

   Переменные:
     SHOPEE_CONTAINER             имя контейнера (default clicker-test)
     SHOPEE_CDP_PORT              порт CDP на хосте (default 9350)
     SHOPEE_CONTAINER_PROFILE     каталог профиля внутри контейнера
                                  (default /config/market-profile)
     SHOPEE_CONTAINER_IDLE_MIN    сколько минут простоя терпеть до
                                  выключения браузера (default 10)

   Браузер поднимается по требованию и гасится сам по простою: headless
   Chromium в контейнере занимает ~300-400 МБ, и держать его между задачами
   незачем. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAME = process.env.SHOPEE_CONTAINER || 'market-browser';
const PORT = Number(process.env.SHOPEE_CDP_PORT || 9360);
const CDP = `http://127.0.0.1:${PORT}`;
const PROFILE = process.env.SHOPEE_CONTAINER_PROFILE || '/config/.config/chromium';
const IDLE_MIN = Number(process.env.SHOPEE_CONTAINER_IDLE_MIN || 10);
const CHROME = '/usr/bin/chromium';
const STATE_DIR = path.join(os.homedir(), '.cache', 'search-skills');
const STATE = path.join(STATE_DIR, 'container-browser.json');

const docker = (args, opts = {}) => execFileSync('docker', args, { stdio: 'pipe', timeout: 60000, ...opts }).toString().trim();

let _browser = null;
let _page = null;

async function cdpAlive(ms = 2000) {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Отметка «браузером только что пользовались» — по ней сторож решает, пора ли гасить. */
function markUse() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ last: Date.now(), port: PORT, name: NAME }));
  } catch { /* отметка не критична */ }
}

/** Сколько миллисекунд браузер простаивает. */
function idleMs() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    return Date.now() - Number(s.last || 0);
  } catch { return 0; }
}

/** Запустить Chromium в контейнере и дождаться CDP. Повторный вызов безопасен. */
async function start() {
  if (await cdpAlive()) { markUse(); return 'already up'; }
  // --no-sandbox обязателен: в контейнере мы root, иначе Chromium просто
  // отказывается стартовать («Running as root without --no-sandbox»).
  // --headless=new: окна нет, значит нет ни фокуса, ни зависимости от
  // того, разблокирован ли экран мака.
  // Флаги запуска живут в entrypoint.sh образа: одна точка правды, иначе
  // скилл и контейнер разъедутся в аргументах.
  try {
    docker(['exec', '-d', NAME, '/usr/local/bin/entrypoint.sh', 'browser']);
  } catch (e) {
    throw new Error(`контейнер ${NAME} недоступен: ${String(e.message || e).slice(0, 120)}`);
  }
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await cdpAlive(1200)) { markUse(); return 'started'; }
  }
  throw new Error(`Chromium в ${NAME} не отдал CDP на порту ${PORT} — смотри /tmp/market-chromium.log в контейнере`);
}

/** Погасить браузер. Профиль остаётся на volume, поэтому вход не теряется. */
async function stop() {
  if (_page && !_page.isClosed()) await _page.close().catch(() => {});
  if (_browser) await _browser.close().catch(() => {});
  _browser = null; _page = null;
  try { docker(['exec', NAME, '/usr/local/bin/entrypoint.sh', 'stop']); } catch { /* уже нет */ }
  for (let i = 0; i < 10; i++) {
    if (!(await cdpAlive(800))) return 'stopped';
    await sleep(300);
  }
  return 'stopped';
}

/** Сторож простоя: один detached процесс на всех, сам выходит, когда гасить нечего. */
function ensureIdleGuard() {
  const guard = path.join(__dirname, 'container-browser.sh');
  if (!fs.existsSync(guard)) return;
  try { execFileSync('bash', [guard, 'watch'], { stdio: 'ignore', timeout: 5000 }); } catch { /* уже сторожит */ }
}

async function page() {
  if (_page && !_page.isClosed()) return _page;
  await start();
  ensureIdleGuard();
  const { chromium } = require('playwright');
  _browser = await chromium.connectOverCDP(CDP);
  const ctx = _browser.contexts()[0] || (await _browser.newContext());
  for (const p of ctx.pages()) {
    try {
      if ((await p.evaluate(() => window.__marketContainerTab)) === 'shopee-container-1') { _page = p; return _page; }
    } catch { /* чужая или закрывающаяся */ }
  }
  const blank = ctx.pages().find((p) => p.url() === 'about:blank');
  _page = blank || (await ctx.newPage());
  await _page.addInitScript(() => { window.__marketContainerTab = 'shopee-container-1'; });
  return _page;
}

async function runJS(js) {
  const p = await page();
  markUse();
  const v = await p.evaluate(js);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

async function runFile(name, vars = {}) {
  let js = fs.readFileSync(path.join(__dirname, 'js', `${name}.js`), 'utf8');
  for (const [k, v] of Object.entries(vars)) js = js.split(`__${k}__`).join(v);
  if (js.includes('__CART_ROWS__')) js = js.split('__CART_ROWS__').join(fs.readFileSync(path.join(__dirname, 'js', '_cart_rows.js'), 'utf8'));
  return runJS(js);
}

const json = async (js) => { const s = await runJS(js); try { return JSON.parse(s); } catch { return s; } };
const jsonFile = async (n, v) => { const s = await runFile(n, v); try { return JSON.parse(s); } catch { return s; } };

async function go(url, settleMs = 13000) {
  const p = await page();
  markUse();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForLoadState('networkidle', { timeout: Math.min(settleMs, 20000) }).catch(() => {});
}

/** Прокрутка колесом: ждём прирост высоты, а не фиксированную паузу. */
async function autoScroll({ steps = 10, everyMs = 700, px = 1400 } = {}) {
  const p = await page();
  markUse();
  let prev = await p.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < steps; i++) {
    await p.mouse.wheel(0, px);
    await p.waitForFunction((h) => document.body.scrollHeight > h, prev, { timeout: everyMs + 2000 }).catch(() => {});
    prev = await p.evaluate(() => document.body.scrollHeight);
  }
  await p.evaluate(() => window.scrollTo(0, 0));
}

const serverAlive = () => cdpAlive();
// В headless-браузере единственная вкладка всегда «видима», переключать нечего.
const showTab = () => false;
const hideTab = () => {};
// Признак для browser.cjs: отрисованный DOM здесь достоверен (вкладка одна и видима).
const domIsVisible = () => true;

module.exports = {
  runJS, runFile, json, jsonFile, go, autoScroll,
  stopServer: stop, start, stop, serverAlive, sleep, showTab, hideTab,
  idleMs, markUse, cdpAlive, domIsVisible,
};
