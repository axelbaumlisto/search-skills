#!/usr/bin/env node
/* Чтение Zalo Web из консоли.
 *
 * Сессия Zalo живёт не в обычном Chrome, а в cloak-браузере на удалённом хосте
 * (CDP 9444). Локально поднимается ssh-туннель на 9445 и playwright цепляется
 * к уже открытой вкладке chat.zalo.me — логиниться заново не нужно и нельзя:
 * повторный вход требует QR с телефона.
 *
 *   node zalo.mjs list [n]            последние диалоги
 *   node zalo.mjs read "Имя" [n]      открыть диалог и выгрузить сообщения
 *   node zalo.mjs search "текст"      поиск по сообщениям во всех чатах и группах
 *   node zalo.mjs find "текст"        то же, но только по превью списка диалогов
 *   node zalo.mjs tabs                что открыто в cloak-браузере
 *
 * Поиск ищет только по истории, которую держит веб-клиент (обычно последние две недели);
 * более старое Zalo отдаёт только в десктопном приложении Zalo PC.
 *
 * Отправка сообщений намеренно не реализована: писать людям от чужого имени
 * без подтверждения — не то, что должен уметь скрипт, запускаемый мимоходом.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  const guesses = [
    process.env.ZALO_NODE_MODULES,
    `${homedir()}/work/search-skills/node_modules`,
  ].filter(Boolean);
  for (const g of guesses) {
    try { return require(`${g}/playwright`); } catch { /* дальше */ }
  }
  try { return require('playwright'); } catch { /* ниже */ }
  console.error('playwright не найден. Поставить: cd ~/work/search-skills && npm i');
  process.exit(2);
}

function config() {
  const p = (process.env.SKILLS_CONFIG || '').replace(/^~/, homedir());
  // хост берётся из SKILLS_CONFIG (remoteBrowser.sshHost) или ZALO_SSH_HOST
  const HOST = process.env.ZALO_SSH_HOST || 'remote-browser';
  // --acc 2 (или ZALO_ACC=2) — второй аккаунт в отдельном профиле cloak-браузера
  const accArg = process.argv.indexOf('--acc');
  const acc = accArg > -1 ? Number(process.argv[accArg + 1]) : Number(process.env.ZALO_ACC || 1);
  const def = acc === 2
    ? { sshHost: HOST, remotePort: 9446, localPort: 9447 }
    : { sshHost: HOST, remotePort: 9444, localPort: 9445 };
  if (!p) return def;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return {
      sshHost: j.remoteBrowser?.sshHost || def.sshHost,
      remotePort: acc === 2 ? def.remotePort : (j.cloakBrowser?.cdpRemotePort || def.remotePort),
      localPort:  acc === 2 ? def.localPort  : (j.cloakBrowser?.cdpLocalPort  || def.localPort),
    };
  } catch { return def; }
}

const CFG = config();
const CDP = `http://127.0.0.1:${CFG.localPort}`;

/** Туннель до CDP cloak-браузера — общий скрипт скилла browser-scout. */
function ensureTunnel() {
  const sh = `${homedir()}/.pi/agent/skills/browser-scout/scripts/cdp-tunnel.sh`;
  return execSync(`bash ${sh} ${CFG.localPort} ${CFG.remotePort} ${CFG.sshHost}`,
                  { encoding: 'utf8' }).trim();
}

async function zaloPage(pw) {
  const b = await pw.chromium.connectOverCDP(CDP);
  const ctx = b.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('chat.zalo.me'));
  if (!page) {
    await b.close();
    console.error('вкладки chat.zalo.me нет. Открыть её в cloak-браузере и, если просит QR,\n' +
                  'войти руками через VNC — сессия Zalo Web живёт недолго.');
    process.exit(3);
  }
  return { b, page };
}

/** Закрыть панель поиска: она перекрывает список диалогов и перехватывает клики. */
async function closeSearch(page) {
  // кнопка «Đóng» рядом со строкой поиска; Escape панель не закрывает
  const close = page.locator('text="Đóng"').first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForTimeout(1000);
  }
}

/** Список диалогов: имя, время, превью — по одному на строку. */
async function list(page, n) {
  await closeSearch(page);
  const raw = await page.$eval('#conversationList', el => el.innerText);
  const blocks = raw.split('\n').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < blocks.length; i += 3) {
    const [name, when, preview] = [blocks[i], blocks[i + 1], blocks[i + 2]];
    if (!name) continue;
    out.push({ name, when: when || '', preview: preview || '' });
  }
  return out.slice(0, n);
}

/** Поиск по сообщениям через штатную строку Zalo. */
async function search(page, query, n) {
  await page.fill('#contact-search-input', query);
  await page.waitForTimeout(4000);
  const rows = await page.evaluate(() => {
    const seen = [];
    const root = document.querySelector('#searchResultList');   // только выдача, не открытый чат
    if (!root) return seen;
    root.querySelectorAll('div').forEach(d => {
      if (d.children.length > 3) return;
      const t = (d.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length < 25 || t.length > 300) return;
      if (/Zalo PC|G\u1eedi nhanh|Th\u1ea3 File/.test(t)) return;   // подсказки интерфейса
      if (/^T\u1ea5t c\u1ea3 Ch\u01b0a \u0111\u1ecdc|^T\u1ea5t c\u1ea3 Li\u00ean h\u1ec7/.test(t)) return;  // чипы фильтров
      if (/^[\/:;=><()\-\w\s]{0,40}$/.test(t) && /\/-\w|:>|:-\(/.test(t)) return;   // панель стикеров
      if (seen.includes(t)) return;                       // один и тот же узел в двух уровнях
      seen.push(t);
    });
    // убираем строки, целиком входящие в другие: DOM даёт родителя и ребёнка
    return seen.filter(t => !seen.some(o => o !== t && o.includes(t)))
               .filter(t => !/^Không tìm thấy kết quả|^Vui lòng thử lại/.test(t));
  });
  await closeSearch(page);
  return rows.slice(0, n);
}

/** Открыть диалог по видимому тексту и выгрузить его содержимое. */
/** Открыть диалог по куску имени. Кликаем по СТРОКЕ списка, а не по текстовому
 *  узлу: `text=` цепляется к span внутри, и клик по нему уходит в таймаут. */
async function openChat(page, name) {
  await closeSearch(page);
  const row = page.locator('#conversationList .conv-item').filter({ hasText: name }).first();
  if (await row.count()) {
    await row.click({ timeout: 15000 });
    await page.waitForTimeout(2500);
    return;
  }
  // нет в списке диалогов — ищем через строку поиска (работает и по номеру телефона)
  const box = page.locator('#contact-search-input');
  await box.click({ timeout: 10000 });
  await box.fill(name);
  await page.waitForTimeout(3000);
  const hit = page.locator('[class*="search"] [class*="item"], #contact-search-result li, .conv-item')
    .filter({ hasText: /./ }).first();
  if (!(await hit.count()))
    throw new Error(`диалог «${name}» не найден: нет в списке и поиск пуст`);
  try { await hit.click({ timeout: 8000 }); }
  catch { throw new Error(`диалог «${name}» не открылся: результат поиска не кликается`); }
  await page.waitForTimeout(3000);
  if (!(await page.locator('#richInput').count()))
    throw new Error(`диалог «${name}» не открылся: нет в списке и поиск не дал результата`);
}

async function read(page, name, n) {
  await openChat(page, name);
  await page.waitForTimeout(1000);
  const txt = await page.$eval('#chatViewContainer', el => el.innerText);
  // панель стикеров внизу попадает в innerText — выкидываем её коды
  const JUNK = /^(\/-\w+|:[>ор)(\-][\w)(]*|:-?[\w)(><]+|;[\w)(]+|=[\w)(]+)$/;
  const lines = txt.split('\n').map(s => s.trim())
    .filter(s => s && !JUNK.test(s));
  return lines.slice(-n);
}

/** Отправка сообщения в открытый диалог. Многострочный текст — Shift+Enter. */
async function send(page, name, text) {
  await openChat(page, name);
  // Поле ввода — сам #richInput. Кликать по нему НЕЛЬЗЯ: центр перекрыт
  // дочерним input_line_0, и playwright ждёт освобождения цели до таймаута.
  // Фокусируем через DOM — клавиатура после этого печатает прямо в поле.
  // Один focus() через DOM не включает редактор: поле остаётся contenteditable=false
  // и набранное теряется (так было во 2-м аккаунте 08.10.2026). Клик с force включает.
  await page.locator('#richInput').click({ force: true, timeout: 5000 }).catch(() => {});
  const ok = await page.evaluate(() => {
    const e = document.querySelector('#richInput');
    if (!e) return false;
    e.focus();
    return document.activeElement === e;
  });
  if (!ok) throw new Error('поле ввода не найдено — Zalo поменял вёрстку');
  // в поле мог остаться черновик — вычищаем, иначе он прилипнет к сообщению
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press('Shift+Enter');
    // insertText, а не type: посимвольный type на вьетнамских буквах с диакритикой
    // зависает намертво (08.10.2026); insertText вставляет строку целиком, как IME.
    await page.keyboard.insertText(lines[i]);
  }
  await page.waitForTimeout(400);
  const typed = await page.evaluate(() => (document.querySelector('#richInput')?.innerText || '').trim().length);
  if (!typed) throw new Error('текст не попал в поле ввода — ничего не отправлено');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const txt = await page.$eval('#chatViewContainer', el => el.innerText);
  return txt.split('\n').map(x => x.trim()).filter(Boolean).slice(-4);
}

/** Отзыв последнего своего сообщения: правый клик → «Thu hồi».
 *  В «My Documents» пункта нет — там только «Xóa» (удалить у себя). */
async function unsend(page, name) {
  await openChat(page, name);
  const bubble = page.locator('[id^="text-mCntr_"]').last();
  await bubble.scrollIntoViewIfNeeded();
  await bubble.click({ button: 'right' });
  await page.waitForTimeout(900);
  const item = page.locator('div,li,span').filter({ hasText: /^Thu hồi$/ }).first();
  if (!(await item.count())) {
    await page.keyboard.press('Escape');
    throw new Error('пункт «Thu hồi» не предложен: прошло больше суток, это не твоё сообщение или это My Documents');
  }
  await item.click();
  await page.waitForTimeout(800);
  const ok = page.locator('button,div').filter({ hasText: /^(Thu hồi|Xác nhận|Đồng ý)$/ }).last();
  if (await ok.count()) { await ok.click().catch(() => {}); }
  await page.waitForTimeout(2000);
  const txt = await page.$eval('#chatViewContainer', el => el.innerText);
  return txt.split('\n').map(x => x.trim()).filter(Boolean).slice(-3);
}

/** Следилка: помнит последнее виденное превью по каждому чату и показывает
 *  только новое. Состояние — JSON рядом со скриптом, по аккаунту отдельно. */
function watchFile(acc) {
  return join(homedir(), '.cache', `zalo-watch-${acc}.json`);
}
async function watch(page, filter, acc) {
  const f = watchFile(acc);
  let seen = {};
  try { seen = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  // Zalo ставит в именах и превью НЕРАЗРЫВНЫЕ пробелы — без нормализации
  // фильтр по обычному пробелу не совпадает никогда
  const nb = x => (x || '').replace(/\u00a0/g, ' ').trim();
  const rows = (await list(page, 40)).map(r => ({ ...r, name: nb(r.name), preview: nb(r.preview) }));
  const pats = filter ? filter.split(',').map(x => nb(x).toLowerCase()).filter(Boolean) : null;
  const fresh = [];
  for (const r of rows) {
    if (pats && !pats.some(p => r.name.toLowerCase().includes(p))) continue;
    const key = r.name;
    const val = `${r.when}|${r.preview}`;
    if (seen[key] !== val) {
      // своё же сообщение не считаем ответом
      if (!/^Bạn:/.test(r.preview)) fresh.push(r);
      seen[key] = val;
    }
  }
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(seen, null, 1));
  return fresh;
}

/** Превью в списке обрезано многоточием — цена или размер из ответа поставщика
 *  туда не влезут. Поэтому по каждому новому чату заходим и берём живой текст. */
async function watchFull(page, fresh, n = 6) {
  const out = [];
  for (const r of fresh) {
    let lines = [];
    try { lines = await read(page, r.name, n); }
    catch (e) { lines = ['(не удалось открыть: ' + (e.message || '').slice(0, 60) + ')']; }
    out.push({ ...r, lines });
  }
  return out;
}

const [cmd = 'list', arg = '', arg2 = ''] = process.argv.slice(2);
const pw = loadPlaywright();
console.error(`# ${ensureTunnel()}`);

if (cmd === 'tabs') {
  const b = await pw.chromium.connectOverCDP(CDP);
  for (const p of b.contexts()[0].pages()) console.log(p.url().slice(0, 100));
  await b.close();
} else {
  const { b, page } = await zaloPage(pw);
  const bail = async (msg) => { console.error(msg); await b.close().catch(() => {}); process.exit(1); };
  try {
  if (cmd === 'list') {
    const rows = await list(page, Number(arg) || 15);
    rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.name} · ${r.when}\n    ${r.preview}`));
  } else if (cmd === 'send') {
    const body = arg2 === '-' ? readFileSync(0, 'utf8') : arg2;
    if (!arg || !body) { console.error('usage: send "<чат>" "<текст>"  |  ... send "<чат>" - < file'); process.exit(2); }
    const tail = await send(page, arg, body);
    console.log('отправлено. хвост диалога:');
    tail.forEach(t => console.log('  ' + t));
  } else if (cmd === 'unsend') {
    if (!arg) { console.error('usage: unsend "<чат>"  — отзывает ПОСЛЕДНЕЕ своё сообщение'); process.exit(2); }
    const tail = await unsend(page, arg);
    console.log('отозвано. хвост диалога:');
    tail.forEach(t => console.log('  ' + t));
  } else if (cmd === 'watch') {
    const accNum = process.argv.includes('--acc') ? process.argv[process.argv.indexOf('--acc') + 1] : '1';
    const fresh = await watch(page, arg, accNum);
    if (!fresh.length) { console.log('нового нет'); }
    else if (process.argv.includes('--full')) {
      const full = await watchFull(page, fresh);
      for (const r of full) {
        console.log(`НОВОЕ · ${r.name} · ${r.when}`);
        r.lines.forEach(l => console.log('    ' + l));
        console.log('');
      }
    } else {
      fresh.forEach(r => console.log(`НОВОЕ · ${r.name} · ${r.when}\n    ${r.preview}`));
    }
  } else if (cmd === 'find') {
    const rows = await list(page, 60);
    const q = arg.toLowerCase();
    const hit = rows.filter(r => (r.name + ' ' + r.preview).toLowerCase().includes(q));
    if (!hit.length) console.log('в превью диалогов совпадений нет — открывай нужный через read');
    hit.forEach(r => console.log(`• ${r.name} · ${r.when}\n  ${r.preview}`));
  } else if (cmd === 'search') {
    if (!arg) { console.error('нужен запрос: node zalo.mjs search "текст"'); process.exit(1); }
    const rows = await search(page, arg, Number(arg2) || 20);
    if (!rows.length) console.log('ничего не найдено (веб-клиент ищет только по свежей истории)');
    rows.forEach(r => console.log('•', r));
  } else if (cmd === 'read') {
    if (!arg) { console.error('нужно имя диалога: node zalo.mjs read "Имя"'); process.exit(1); }
    const lines = await read(page, arg, Number(arg2) || 40);
    lines.forEach(l => console.log(l));
  } else {
    console.error('команды: list | read "Имя" | find "текст" | tabs');
    process.exit(1);
  }
  await b.close();
  } catch (e) {
    await bail('# ' + (e?.message || String(e)).split('\n')[0]);
  }
}
