#!/usr/bin/env node
/* Удалённый браузер из локальной консоли: список действий одним вызовом.
 *
 * Зачем: раньше каждый шаг стоил ssh-раунда плюс фиксированный sleep — клик
 * обходился в 5-10 секунд. Здесь один SSH-туннель до CDP, playwright локально
 * и пачка действий за один запуск. Ожидание по событиям, а не по таймеру.
 *
 * На сервере Chrome 148 — playwright с ним работает. Локальный Chrome 152 по CDP
 * не подключается (Browser.setDownloadBehavior), а на профиле по умолчанию
 * Chrome 136+ игнорирует --remote-debugging-port.
 *
 *   node rbrowser.js '[{"do":"goto","url":"https://..."},{"do":"text","as":"t"}]'
 *   node rbrowser.js --file steps.json
 *   node rbrowser.js --tabs            что открыто в браузере
 *   node rbrowser.js --cleanup [--close-url подстрока]   убрать мусор
 *
 * После работы своя вкладка парkуется на about:blank (`--no-park` отменяет):
 * иначе она остаётся висеть на чужой странице — например на капче Shopee,
 * а домены с живыми сессиями владельца уборка не трогает совсем.
 *
 * Вкладка переиспользуется: она помечается через addInitScript (метка живёт
 * между переходами), и следующий запуск находит её, а не открывает новую.
 * Раньше каждый запуск плодил страницу — скопилось 24 страницы, из них 17
 * брошенных логинов Facebook. `--fresh` заставляет открыть новую.
 *
 * Действия:
 *   goto   url [wait: sel|"net"]      переход
 *   wait   sel | ms | "net"           ждать элемент, паузу, тишину в сети
 *   click  sel | text                 клик по селектору или видимому тексту
 *   type   sel text [enter]           ввод (нативный сеттер + события)
 *   scroll times                      прокрутка с ожиданием прироста высоты
 *   eval   js [as]                    выполнить JS, вернуть результат
 *   text   [sel] [as]                 innerText страницы или элемента
 *   html   [sel] [as]                 innerHTML
 *   attr   sel name [as]              атрибут
 *   list   sel [fields] [as]          массив по селектору: text/href/label
 *   gql    match [as]                 включить сбор ответов /api/graphql
 *   shot   path                       скриншот
 *   cookies [as]                      куки контекста
 *
 * Результат: {"ok":true,"out":{имя:значение},"steps":[{do,ms,ok,err}]}
 */
const { spawn } = require('child_process');
const fs = require('fs');

const CFG = require('./config.cjs');
const PORT = CFG.remoteBrowser.cdpLocalPort;
const TAB = 'rbrowser-1';              // метка своей вкладки
const MAX_PAGES = 15;                     // выше — подчищаем свой мусор сами

/* Живые сессии владельца закрывать нельзя, даже если вкладка помечена моей:
   вход делался руками, повторный стоит капчи. Список — снаружи, в личном
   конфиге (SKILLS_CONFIG), чтобы скилл оставался публичным. */
const PROTECTED = CFG.protectedDomains;
const isProtected = (u) => PROTECTED.some((d) => u.includes(d));
const CDP = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Значение флага --имя из командной строки. */
function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

async function cdpVersion(timeout = 2500) {
  const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(timeout) });
  return r.ok ? (await r.json()).Browser : null;
}

/* Туннель живёт отдельно — в tmux-сессии (имя из конфига), поднимается tunnel.sh.
   Свои `ssh -fN` не плодим: они копились после каждого холодного старта и
   никто не поднимал их обратно после обрыва связи. */
async function ensureTunnel() {
  try { const v = await cdpVersion(); if (v) return v; } catch {}
  const sh = require('path').join(__dirname, 'tunnel.sh');
  try {
    require('child_process').execFileSync(sh, ['up'], { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    throw new Error('tunnel.sh не поднял туннель: ' + String(e.message).slice(0, 80));
  }
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    try { const v = await cdpVersion(1500); if (v) return v; } catch {}
  }
  throw new Error('туннель до CDP не отвечает');
}

/** Прокрутка: ждём прирост высоты документа, а не фиксированную паузу. */
async function scrollStep(page, times) {
  let prev = await page.evaluate(() => document.body.scrollHeight);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, 2400);
    await page.waitForFunction((h) => document.body.scrollHeight > h, prev, { timeout: 4000 })
      .catch(() => {});
    prev = await page.evaluate(() => document.body.scrollHeight);
  }
  return prev;
}

/** Клик по видимому тексту — для кнопок без стабильных селекторов. */
async function clickByText(page, text) {
  return page.evaluate((t) => {
    const all = [...document.querySelectorAll('a,button,[role="button"],[role="tab"],span')];
    const el = all.find((x) => (x.innerText || '').trim() === t)
            || all.find((x) => (x.innerText || '').trim().startsWith(t));
    if (!el) return false;
    el.click();
    return true;
  }, text);
}

/** Ввод в контролируемые React-поля: нативный сеттер + всплывающий input. */
async function typeNative(page, sel, text, enter) {
  const ok = await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (set) set.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { sel, text });
  if (ok && enter) await page.keyboard.press('Enter');
  return ok;
}

async function runStep(page, ctx, s, out, bag) {
  switch (s.do) {
    case 'goto':
      await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: s.timeout || 60000 });
      if (s.wait === 'net' || !s.wait) {
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      } else {
        await page.waitForSelector(s.wait, { timeout: 25000 }).catch(() => {});
      }
      return page.url();
    case 'wait':
      if (s.ms) { await sleep(s.ms); return s.ms; }
      if (s.sel) { await page.waitForSelector(s.sel, { timeout: s.timeout || 25000 }); return s.sel; }
      await page.waitForLoadState('networkidle', { timeout: s.timeout || 20000 }).catch(() => {});
      return 'net';
    case 'click':
      if (s.text) return clickByText(page, s.text);
      await page.click(s.sel, { timeout: s.timeout || 15000 });
      return true;
    case 'type':
      return typeNative(page, s.sel, s.text, s.enter);
    case 'scroll':
      return scrollStep(page, s.times || 5);
    case 'eval':
      return page.evaluate(s.js);
    case 'text':
      return s.sel ? page.$eval(s.sel, (e) => e.innerText).catch(() => null)
                   : page.evaluate(() => document.body.innerText);
    case 'html':
      return s.sel ? page.$eval(s.sel, (e) => e.innerHTML).catch(() => null)
                   : page.content();
    case 'attr':
      return page.$eval(s.sel, (e, n) => e.getAttribute(n), s.name).catch(() => null);
    case 'list':
      return page.$$eval(s.sel, (els, f) => els.slice(0, 500).map((e) => {
        const o = {};
        (f || ['text']).forEach((k) => {
          o[k] = k === 'text' ? (e.innerText || '').trim().slice(0, 400)
               : k === 'href' ? e.getAttribute('href')
               : e.getAttribute(k);
        });
        return o;
      }), s.fields);
    case 'gql':
      page.on('response', async (r) => {
        if (!r.url().includes('/api/graphql')) return;
        try { const t = await r.text(); if (!s.match || t.includes(s.match)) bag.push(t); } catch {}
      });
      return 'сбор включён';
    case 'gqlDump': {
      const p = s.path || '/tmp/gql.json';
      fs.writeFileSync(p, JSON.stringify(bag));
      return { responses: bag.length, path: p };
    }
    case 'shot':
      await page.screenshot({ path: s.path || '/tmp/shot.png', fullPage: !!s.full });
      return s.path || '/tmp/shot.png';
    case 'cookies':
      return (await ctx.cookies()).map((c) => c.name);
    default:
      throw new Error('неизвестное действие: ' + s.do);
  }
}

/** Своя вкладка: ищем по метке, иначе создаём и метим. */
async function ownPage(ctx, fresh) {
  if (!fresh) {
    for (const p of ctx.pages()) {
      try {
        if (await p.evaluate(() => window.__rbTab) === TAB) return p;
      } catch { /* закрытая или чужая страница с недоступным контекстом */ }
    }
  }
  const p = await ctx.newPage();
  await p.addInitScript(`window.__rbTab = ${JSON.stringify(TAB)}`);
  return p;
}

/** Состояние браузера: что открыто, что моё, что защищено, что мусор. */
async function tabs(ctx, close, keepOwn = false, closeUrl = null) {
  const rows = [];
  for (const p of ctx.pages()) {
    let mine = false;
    try { mine = (await p.evaluate(() => window.__rbTab)) === TAB; } catch {}
    const url = p.url();
    const prot = isProtected(url);
    // мусор: мои прошлые вкладки, брошенные логины FB, пустышки
    const junk = !prot && (mine || /facebook\.com\/login/.test(url) || url === 'about:blank'
                 || (closeUrl && url.includes(closeUrl)));
    const row = { url: url.slice(0, 70), mine, protected: prot, junk };
    rows.push(row);
    if (close && junk && !(keepOwn && mine)) {
      await p.close().catch(() => {});
      row.closed = true;
    }
  }
  return rows;
}

/** Краткая сводка по домену — чтобы видеть, не расплодилось ли. */
function summary(rows) {
  const byHost = {};
  rows.forEach((r) => {
    const h = (r.url.match(/^https?:\/\/([^/]+)/) || [])[1] || r.url;
    byHost[h] = (byHost[h] || 0) + 1;
  });
  return {
    страниц: rows.length,
    моих: rows.filter((r) => r.mine).length,
    защищённых: rows.filter((r) => r.protected).length,
    мусора: rows.filter((r) => r.junk).length,
    закрыто: rows.filter((r) => r.closed).length,
    домены: byHost,
  };
}

(async () => {
  const fileIdx = process.argv.indexOf('--file');
  const wantTabs = process.argv.includes('--tabs');
  const wantCleanup = process.argv.includes('--cleanup');
  // список действий — первый аргумент, НЕ начинающийся с --; иначе флаг
  // вроде --no-park уезжал в позицию JSON и падал разбором
  const positional = process.argv.slice(2).find((a) => !a.startsWith('--')
    && !(fileIdx > -1 && a === process.argv[fileIdx + 1]));
  const raw = fileIdx > -1 ? fs.readFileSync(process.argv[fileIdx + 1], 'utf8') : positional;
  if (!raw && !wantTabs && !wantCleanup) {
    console.error('нужен список действий (JSON), --file, --tabs или --cleanup');
    process.exit(2);
  }

  const version = await ensureTunnel();
  process.stderr.write(`# ${CFG.remoteBrowser.sshHost}: ${version}\n`);
  const { chromium } = require('playwright');
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] || (await browser.newContext());

  if (wantTabs || wantCleanup) {
    const rows = await tabs(ctx, wantCleanup, false, arg('close-url'));
    console.log(JSON.stringify(summary(rows), null, 1));
    await browser.close().catch(() => {});
    return;
  }

  // гигиена перед работой: если вкладок больше нормы — закрыть свой мусор,
  // свою рабочую вкладку и чужие сессии не трогая
  if (ctx.pages().length > MAX_PAGES) {
    const rows = await tabs(ctx, true, true);
    process.stderr.write(`# подчистил вкладок: ${rows.filter((r) => r.closed).length}\n`);
  }

  const steps = JSON.parse(raw);
  const page = await ownPage(ctx, process.argv.includes('--fresh'));
  const out = {};
  const log = [];
  const bag = [];
  let ok = true;

  for (const s of steps) {
    const t0 = Date.now();
    try {
      const v = await runStep(page, ctx, s, out, bag);
      if (s.as) out[s.as] = v;
      log.push({ do: s.do, ms: Date.now() - t0, ok: true });
    } catch (e) {
      ok = false;
      log.push({ do: s.do, ms: Date.now() - t0, ok: false, err: String(e.message).slice(0, 120) });
      if (!s.soft) break;
    }
  }
  // вкладку НЕ закрываем: следующий запуск её переиспользует.
  // Но паркуем на пустую страницу, чтобы не висеть на чужой сессии или капче.
  if (process.argv.includes('--close')) {
    await page.close().catch(() => {});
  } else if (!process.argv.includes('--no-park')) {
    await page.goto('about:blank').catch(() => {});
  }
  await browser.close().catch(() => {});
  console.log(JSON.stringify({ ok, out, steps: log }, null, 1));
})().catch((e) => { console.error('ОШИБКА', e.message); process.exit(1); });
