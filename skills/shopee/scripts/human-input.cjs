#!/usr/bin/env node
/* «Человеческий» ввод в браузер контейнера market-browser — настоящая
 * клавиатура и мышь через X11 (xdotool), а не CDP-события.
 *
 * Зачем: Shopee ловит CDP-навигацию и синтетические клики (проверено
 * 21.11.2026: серия newPage+goto дала капчу на весь домен). Ввод через
 * X11 — обычные события от активного окна, для страницы неотличимы от
 * человека. Чтение DOM по-прежнему через CDP (evaluate) — оно невидимо.
 *
 * Ключевая ловушка: CDP-скриншот снимает ТОЛЬКО viewport страницы, а
 * xdotool работает в координатах X11-окна, где над viewport ещё тулбар
 * Chrome. Смещение не константа — метод offset() определяет его сам:
 * кликает в известную точку страницы и сравнивает ожидание с фактом.
 *
 * Использование:
 *   const human = require('./human-input.cjs');
 *   await human.offset();                       // калибровка (1 клик по известной ссылке)
 *   await human.type('https://shopee.vn/...');  // в адресную строку + Enter
 *   await human.clickAt(cx, cy);                // клик по CDP-координатам
 *   await human.key('Escape');                  // закрыть попап
 *   await human.findAndClick(/aikomi/i);        // найти элемент по тексту и кликнуть
 *
 * Все координаты — CDP-viewport (как в boundingBox), функция сама
 * переводит их в X11. */
const { execSync } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

const CONTAINER = process.env.SHOPEE_CONTAINER || 'market-browser';
const CDP = `http://127.0.0.1:${process.env.SHOPEE_CDP_PORT || 9360}`;

let _browser = null, _page = null, _offsetY = null;

async function page() {
  if (_page) return _page;
  const { chromium } = require('playwright');
  _browser = await chromium.connectOverCDP(CDP);
  _page = _browser.contexts()[0].pages().find((x) => /shopee|lazada/.test(x.url()))
       || _browser.contexts()[0].pages()[0];
  return _page;
}

/** X11-команда от пользователя abc в контейнере. */
function x11(cmd) {
  execSync(`docker exec -u abc ${CONTAINER} env DISPLAY=:0 sh -c '${cmd}'`, { stdio: 'pipe' });
}

/** Окно Chrome могло потерять фокус (владелец трогал GUI, popap, рестарт).
 *  Активируем перед каждым действием — idempotent и дешёвый. */
function activate() {
  x11(`xdotool windowactivate $(xdotool search --class chromium | head -1) 2>/dev/null`);
}

const type_ = (text, delay = 80) => x11(`xdotool type --delay ${delay} '${text.replace(/'/g, "'\\''")}'`);
const key = (k) => x11(`xdotool key ${k}`);
const move = (x, y) => x11(`xdotool mousemove ${Math.round(x)} ${Math.round(y)}`);
const click = () => x11(`xdotool click 1`);

/** Смещение тулбара Chrome: кликаем по верхнему левому элементу страницы,
 *  перехватываем mousedown слушателем, сравниваем clientY с X11-координатой.
 *  Повторять после resize/перезапуска окна. */
async function offset() {
  const p = await page();
  await p.evaluate(() => {
    window.__probe = null;
    document.addEventListener('mousedown', (e) => {
      window.__probe = { x: e.clientX, y: e.clientY };
    }, { capture: true, once: true });
  });
  // точка пробы: 400,300 в viewport — почти всегда тело страницы, не ссылка
  x11(`xdotool mousemove 400 ${300 + (_offsetY || 100)}; sleep 0.2`);
  x11('xdotool click 1');
  await sleep(600);
  const probe = await p.evaluate(() => window.__probe);
  if (!probe) throw new Error('offset(): пробный клик не дошёл — окно неактивно?');
  // X11_y = viewport_y + offsetY => offsetY = X11_y - viewport_y
  _offsetY = (300 + (_offsetY || 100)) - probe.y;
  return _offsetY;
}

/** Клик по CDP-координатам с человеческой траекторией. */
async function clickAt(cx, cy) {
  if (_offsetY == null) await offset();
  activate();
  // путь с дрожью: 2-3 промежуточных точки
  const steps = 2 + Math.floor(Math.random() * 2);
  let lx = rnd(300, 900), ly = rnd(400, 700);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    move(lx + (cx - lx) * t + rnd(-8, 8), ly + (cy - ly) * t + rnd(-8, 8));
    await sleep(rnd(80, 220));
  }
  move(cx + rnd(-3, 3), cy + _offsetY + rnd(-3, 3));
  await sleep(rnd(150, 450));
  // нажать-подержать-отпустить: человек не кликает мгновенно
  x11('xdotool mousedown 1');
  await sleep(rnd(60, 130));
  x11('xdotool mouseup 1');
  await sleep(rnd(400, 900));
  return true;
}

/** Печать в адресную строку + Enter. Открывает URL как человек. */
async function navigate(url) {
  if (_offsetY == null) await offset().catch(() => {});
  activate();
  x11('xdotool key ctrl+l');
  await sleep(400);
  type_(url, 70);
  await sleep(300);
  key('Return');
  await sleep(7000);
}

/** Найти элемент по тексту/регэкспу и кликнуть. Возврат: true если найден. */
async function findAndClick(pattern, { scrollIntoView = true } = {}) {
  const p = await page();
  const box = await p.evaluate((re) => {
    const rx = new RegExp(re.source, re.flags);
    for (const el of document.querySelectorAll('a, button, [role=button]')) {
      if (rx.test(el.innerText || '')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.y > 80 && r.y < window.innerHeight - 60)
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: el.innerText.slice(0, 40) };
      }
    }
    return null;
  }, pattern instanceof RegExp ? { source: pattern.source, flags: pattern.flags } : pattern);
  if (!box) return false;
  await clickAt(box.x, box.y);
  await sleep(4000);
  return true;
}

module.exports = { page, offset, clickAt, navigate, key, type: type_, findAndClick, sleep };
