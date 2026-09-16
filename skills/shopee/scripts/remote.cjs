/* Драйвер удалённого браузера — тот же интерфейс, что у bridge.cjs.
 *
 * Скилл остаётся неизменным, меняется только подложка:
 *   SHOPEE_BROWSER=bridge (по умолчанию) — живой Chrome владельца через
 *                                          ChromeBridge, нужен его вход;
 *   SHOPEE_BROWSER=remote                — браузер на сервере по CDP.
 *
 * Зачем второй драйвер: локальный путь отбирает машину владельца, а фоновая
 * вкладка Chrome не делает сетевых запросов вообще — ленивые сетки не
 * догружаются. На сервере браузер видимый и залогиненный, сеть перехватывается
 * штатно, и работа не мешает владельцу.
 *
 * Туннель до CDP держит отдельная tmux-сессия, скрипт общий для всех скиллов:
 *   ~/.pi/agent/skills/browser-scout/scripts/tunnel.sh
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CFG = require(path.join(os.homedir(),
  '.pi/agent/skills/browser-scout/scripts/config.cjs'));
const PORT = CFG.remoteBrowser.cdpLocalPort;
const CDP = `http://127.0.0.1:${PORT}`;
const TAB = 'shopee-remote-1';
const TUNNEL = path.join(os.homedir(),
  '.pi/agent/skills/browser-scout/scripts/tunnel.sh');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _browser = null;
let _page = null;

async function cdpAlive(ms = 2500) {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureTunnel() {
  if (await cdpAlive()) return;
  execFileSync(TUNNEL, ['up'], { stdio: 'pipe', timeout: 30000 });
  for (let i = 0; i < 12; i++) {
    await sleep(400);
    if (await cdpAlive(1500)) return;
  }
  throw new Error('туннель до CDP не поднялся');
}

/** Своя вкладка, помеченная addInitScript: метка живёт между переходами. */
async function page() {
  if (_page && !_page.isClosed()) return _page;
  await ensureTunnel();
  const { chromium } = require('playwright');
  _browser = await chromium.connectOverCDP(CDP);
  const ctx = _browser.contexts()[0] || (await _browser.newContext());
  for (const p of ctx.pages()) {
    try {
      if ((await p.evaluate(() => window.__shopeeRemoteTab)) === TAB) { _page = p; return _page; }
    } catch { /* чужая или закрывающаяся страница */ }
  }
  _page = await ctx.newPage();
  await _page.addInitScript(`window.__shopeeRemoteTab = ${JSON.stringify(TAB)}`);
  return _page;
}

/** Результат приводим к строке — скилл ждёт строку, как от AppleScript.
 *  Сниппеты скилла — это самодостаточные выражения вида (function(){...})(),
 *  playwright такие принимает как есть. Первая версия оборачивала их ещё
 *  раз и ломала выемку: корзина отдавала ноль позиций. */
async function runJS(js) {
  const p = await page();
  const v = await p.evaluate(js);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

async function runFile(name, vars = {}) {
  let js = fs.readFileSync(path.join(__dirname, 'js', `${name}.js`), 'utf8');
  for (const [k, v] of Object.entries(vars)) js = js.split(`__${k}__`).join(v);
  return runJS(js);
}

const json = async (js) => { const s = await runJS(js); try { return JSON.parse(s); } catch { return s; } };
const jsonFile = async (n, v) => { const s = await runFile(n, v); try { return JSON.parse(s); } catch { return s; } };

async function go(url, settleMs = 13000) {
  const p = await page();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForLoadState('networkidle', { timeout: Math.min(settleMs, 20000) }).catch(() => {});
}

/** Прокрутка колесом: ждём прирост высоты, а не фиксированную паузу. */
async function autoScroll({ steps = 10, everyMs = 700, px = 1400 } = {}) {
  const p = await page();
  let prev = await p.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < steps; i++) {
    await p.mouse.wheel(0, px);
    await p.waitForFunction((h) => document.body.scrollHeight > h, prev,
      { timeout: everyMs + 2000 }).catch(() => {});
    prev = await p.evaluate(() => document.body.scrollHeight);
  }
  await p.evaluate(() => window.scrollTo(0, 0));
}

/** Вкладку оставляем для переиспользования, только паркуем. */
async function stopServer() {
  if (_page && !_page.isClosed()) await _page.goto('about:blank').catch(() => {});
  if (_browser) await _browser.close().catch(() => {});
  _browser = null; _page = null;
}

const serverAlive = () => cdpAlive();

module.exports = { runJS, runFile, json, jsonFile, go, autoScroll, stopServer, serverAlive, sleep };
