#!/usr/bin/env node
/* Открыть URL в живом Chrome по CDP и забрать текст/HTML — без Playwright.
 *
 * Playwright (1.58 на spex, 1.63 локально) с Chrome 148+ виснет на
 * connectOverCDP: HTTP /json отвечает, браузерный WebSocket отвечает, а
 * хендшейк самого Playwright не проходит. Та же болезнь описана в
 * cafe/research/staffing/cdp_capture.js. Поэтому здесь свой минимальный
 * клиент на ws: Target.createTarget -> Runtime.evaluate -> Target.closeTarget.
 *
 *   node cdp_open.js <url> [--html] [--chars N] [--settle MS] [--keep]
 *
 * Порт берётся из CDP_URL (по умолчанию http://127.0.0.1:9224 — туннель на spex).
 */
const WebSocket = require('ws');

const args = process.argv.slice(2);
const url = args[0];
if (!url) { console.error('нужен url'); process.exit(2); }
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = process.env.CDP_URL || 'http://127.0.0.1:9224';
const CHARS = parseInt(val('--chars', '6000'), 10);
const SETTLE = parseInt(val('--settle', '6000'), 10);

const http = async (p) => (await fetch(BASE + p)).json();

function rpc(ws) {
  let id = 0;
  const waiting = new Map();
  ws.on('message', (m) => {
    const msg = JSON.parse(String(m));
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  return (method, params = {}, sessionId) => new Promise((res, rej) => {
    const myId = ++id;
    waiting.set(myId, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params, sessionId }));
    setTimeout(() => waiting.has(myId) && (waiting.delete(myId), rej(new Error(`таймаут ${method}`))), 60000);
  });
}

(async () => {
  const ver = await http('/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl, { handshakeTimeout: 15000 });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const send = rpc(ws);

  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await new Promise((r) => setTimeout(r, SETTLE));

  // Лента Facebook догружается только при прокрутке: без этого в дампе
  // одна шапка профиля и ни одного поста.
  const SCROLL = parseInt(val('--scroll', '0'), 10);
  for (let i = 0; i < SCROLL; i++) {
    await send('Runtime.evaluate', { expression: 'window.scrollBy(0, window.innerHeight * 3)' }, sessionId);
    await new Promise((r) => setTimeout(r, 2500));
  }

  const expr = flag('--html')
    ? 'document.documentElement.outerHTML'
    : `(() => { const d = document.cloneNode(true);
         d.querySelectorAll('script,style,noscript,svg').forEach(e => e.remove());
         return (d.body ? d.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n'); })()`;
  const out = await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  const loc = await send('Runtime.evaluate',
    { expression: 'location.href', returnByValue: true }, sessionId);

  // Facebook рвёт текст постов служебными символами (защита от парсинга),
  // поэтому иногда единственный честный способ прочитать пост — картинка.
  const SHOT = val('--shot', '');
  if (SHOT) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: 1400, height: 2600, deviceScaleFactor: 1, mobile: false }, sessionId);
    await new Promise((r) => setTimeout(r, 1500));
    const img = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    require('fs').writeFileSync(SHOT, Buffer.from(img.data, 'base64'));
    console.error('# shot=' + SHOT);
  }

  console.error('# url=' + (loc.result.value || url));
  console.log(String(out.result.value || '').slice(0, CHARS));

  if (!flag('--keep')) await send('Target.closeTarget', { targetId });
  ws.close();
})().catch((e) => { console.error('ОШИБКА:', e.message); process.exit(1); });
