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
 *   node zalo.mjs files "Имя"         список файлов в диалоге
 *   node zalo.mjs get "Имя" [N]       скачать N-й файл (по умолчанию 1 — самый свежий)
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
  await resetUi(page);
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
/** Привести левую панель в исходное состояние: закрыть панель поиска, снять
 *  фильтр, очистить строку поиска, вернуть список диалогов к началу.
 *
 *  Панель поиска в Zalo Web заменяет список целиком, поэтому после любой
 *  команды с поиском `#conversationList .conv-item` пуст — и следующие вызовы
 *  решают, что диалога не существует. Раньше это и стоило нам «пропавшей»
 *  переписки с нужным чатом. */
async function resetUi(page) {
  const rows = () => page.locator('#conversationList .conv-item').count();
  for (let i = 0; i < 4; i++) {
    if (await rows()) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    const dong = page.locator('text=Đóng').first();          // кнопка панели поиска
    if (await dong.isVisible().catch(() => false)) { await dong.click().catch(() => {}); await page.waitForTimeout(700); }
    if (await rows()) break;
    const all = page.getByText('Tất cả', { exact: true }).first();   // снять фильтр
    if (await all.isVisible().catch(() => false)) { await all.click().catch(() => {}); await page.waitForTimeout(700); }
    if (await rows()) break;
    // последний шанс: вернуться на вкладку чатов в левой панели
    const chatTab = page.locator('#left-column [class*="tab"], #nav-bar [class*="chat"]').first();
    if (await chatTab.count()) { await chatTab.click().catch(() => {}); await page.waitForTimeout(700); }
  }
  const box = page.locator('#contact-search-input');
  if (await box.count()) {
    const val = await box.inputValue().catch(() => '');
    if (val) { await box.fill(''); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); }
  }
  const lb = await page.locator('#conversationList').boundingBox().catch(() => null);
  if (lb) {
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -1200); await page.waitForTimeout(120); }
  }
}

async function openChat(page, name) {
  await closeSearch(page);
  await resetUi(page);
  // список дорисовывается не мгновенно — ждём, иначе «диалог не найден»
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#conversationList .conv-item').count()) break;
    await page.waitForTimeout(200);
  }

  // Список Zalo виртуализирован: элементы переиспользуются, порядок меняется,
  // а клик по координатам попадает в соседнюю строку. Поэтому сначала читаем
  // названия, потом кликаем найденный элемент из JS (без координат) и сверяем
  // заголовок открытого чата.
  const norm = t => (t || '').replace(/[\u200b-\u200f\uFEFF\u00a0]/g, '').trim();
  // имя в заголовке может содержать невидимые символы — сверяем без пробелов и регистра
  const key = t => norm(t).replace(/\s+/g, '').toLowerCase();
  // Названия чатов лежат в .conv-item-title__name — и в обычном списке, и в
  // выдаче поиска, но их родители размечены по-разному, поэтому ищем по самому
  // элементу названия и кликаем по его координатам сразу после чтения.
  const grabRows = async () => {
    const nodes = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.conv-item-title__name')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        out.push({ t: (el.innerText || '').replace(/[\u200b-\u200f\uFEFF]/g, '').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 });
      }
      return out;
    });
    return nodes.filter(n => n.t && n.y > 60);
  };
  let rows = await grabRows();
  let hit = rows.find(r => r.t === name) || rows.find(r => r.t.startsWith(name));
  if (!hit) {
    // списка может не хватать — прокручиваем в начало и вниз, пока не найдём
    const lb = await page.locator('#conversationList').boundingBox().catch(() => null);
    if (lb) {
      await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
      for (let i = 0; i < 10 && !hit; i++) {
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(350);
        rows = await grabRows();
        hit = rows.find(r => r.t === name) || rows.find(r => r.t.startsWith(name));
      }
    }
  }
  if (hit) {
    await page.mouse.click(hit.x, hit.y);
    await page.waitForTimeout(2200);
    const hdr = norm(await page.locator('.header-title').first().innerText().catch(() => ''));
    if (key(hdr) && (key(hdr) === key(name) || key(hdr).startsWith(key(name)))) return;
    if (hdr) throw new Error(`открылся не тот чат: ожидался «${name}», открыт «${hdr}»`);
    return;
  }

  // в списке нет — идём в штатный поиск. Вкладка «Tin nhắn» ищет по тексту
  // сообщений, а нужен список диалогов: держим активной «Tất cả», тогда в выдаче
  // появляются conv-item'ы с названием чата.
  const clickText = async (t) => {
    const r = await page.evaluate(tt => {
      const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && (e.textContent || '').trim() === tt && e.offsetParent);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, t);
    if (!r) return false;
    await page.mouse.click(r.x, r.y);
    await page.waitForTimeout(1500);
    return true;
  };
  const box = page.locator('#contact-search-input');
  await box.click({ timeout: 10000 });
  await box.fill('');
  await clickText('Tất cả');
  await box.fill(name);
  await page.waitForTimeout(3000);
  for (let attempt = 0; attempt < 6; attempt++) {
    const found = await grabRows();
    const h2 = found.find(r => r.t === name) || found.find(r => r.t.startsWith(name));
    if (h2) {
      await page.mouse.click(h2.x, h2.y);
      await page.waitForTimeout(2500);
      const hdr = norm(await page.locator('.header-title').first().innerText().catch(() => ''));
      if (key(hdr) && (key(hdr) === key(name) || key(hdr).startsWith(key(name)))) return;
      if (hdr) throw new Error(`открылся не тот чат: ожидался «${name}», открыт «${hdr}»`);
    }
    // выдача тоже прокручивается
    const lb2 = await page.locator('#conversationList').boundingBox().catch(() => null);
    if (!lb2) break;
    await page.mouse.move(lb2.x + lb2.width / 2, lb2.y + lb2.height / 2);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(700);
  }
  throw new Error(`диалог «${name}» не найден: ни в списке, ни в выдаче поиска нет строки с таким названием`);
}

/** Проверка, что открылся именно нужный чат, а не группа с упоминанием имени. */
async function assertChat(page, name) {
  const hdr = await page.locator('.header-title').first().innerText().catch(() => '');
  const got = (hdr || '').trim();
  if (got && got.replace(/\s+/g,'').toLowerCase() !== name.replace(/\s+/g,'').toLowerCase() && !got.replace(/\s+/g,'').toLowerCase().startsWith(name.replace(/\s+/g,'').toLowerCase()))
    throw new Error(`открылся не тот чат: ожидался «${name}», открыт «${got}»`);
}

/** Прокрутить ленту вверх: Zalo виртуализирует историю и без скролла отдаёт
 *  только последний экран. Возвращает накопленный текст (старое → новое). */
async function loadHistory(page, scrolls = 0, dir = 'up') {
  const seen = new Map();
  const collect = async () => {
    const txt = await page.$eval('#chatViewContainer', el => el.innerText).catch(() => '');
    for (const l of txt.split('\n')) { const s = l.trim(); if (s) seen.set(s, true); }
  };
  await collect();
  if (!scrolls) return [...seen.keys()];
  const box = await page.locator('#chatViewContainer').boundingBox().catch(() => null);
  if (!box) return [...seen.keys()];
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, dir === 'up' ? -1200 : 1200);
    await page.waitForTimeout(650);
    await collect();
  }
  return [...seen.keys()];
}

async function read(page, name, n, scrolls = 0) {
  await openChat(page, name);
  await page.waitForTimeout(1000);
  if (scrolls) {
    const lines = await loadHistory(page, scrolls, 'up');
    if (lines.length) return lines.slice(-n);
  }
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


/** Файлы в открытом диалоге: имя + размер, сверху самые свежие. */
async function files(page, name) {
  await openChat(page, name);
  await page.waitForTimeout(900);
  const list = await page.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll('.file-message__content-title')) {
      const box = t.closest('.file-message__container') || t.parentElement?.parentElement;
      const size = box?.querySelector('.file-message__content-info-size')?.innerText?.trim() || '';
      out.push({ name: (t.getAttribute('title') || t.innerText || '').trim(), size });
    }
    return out.reverse();        // свежие первыми
  });
  return list;
}

/** Скачать файл из диалога.
 *
 *  Zalo расшифровывает вложение в браузере и отдаёт нативной загрузкой: href
 *  у кнопки нет, blob создаётся вне страничного контекста (перехват
 *  URL.createObjectURL ничего не ловит), а playwright-ское download-событие
 *  в connectOverCDP отменяется — контекст чужой и acceptDownloads не выставить.
 *  Поэтому загрузку разрешаем напрямую по CDP, файл падает на УДАЛЁННЫЙ хост,
 *  оттуда забираем по scp.
 */
async function download(page, name, idx, destDir, sshHost) {
  await openChat(page, name);
  await page.waitForTimeout(900);
  const btns = page.locator('.file-message__actions.download');
  const n = await btns.count();
  if (!n) throw new Error('в видимой части диалога нет файлов (пролистай выше или уточни чат)');
  // нумерация с конца: 1 — самый свежий
  const pick = n - Math.min(Math.max(idx, 1), n);
  const REMOTE = '/tmp/zalo_dl';
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: REMOTE, eventsEnabled: true });
  } catch {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: REMOTE });
  }
  let suggested = null;
  cdp.on('Browser.downloadWillBegin', e => { suggested = e.suggestedFilename; });
  const done = new Promise(res => {
    cdp.on('Browser.downloadProgress', e => { if (e.state === 'completed' || e.state === 'canceled') res(e.state); });
    setTimeout(() => res('timeout'), 40000);
  });
  const btn = btns.nth(pick);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ force: true, timeout: 10000 });
  const state = await done;
  if (state !== 'completed') throw new Error(`загрузка не завершилась: ${state}`);
  mkdirSync(destDir, { recursive: true });
  // имя с пробелами и диакритикой — отдаём scp одним аргументом в кавычках
  const safe = (suggested || 'zalo_file').replace(/"/g, '');
  execSync(`scp ${sshHost}:"${REMOTE}/${safe.replace(/([ '()])/g, '\\$1')}" "${destDir}/"`,
           { stdio: 'pipe' });
  execSync(`ssh ${sshHost} 'rm -f "${REMOTE}/${safe.replace(/'/g, "'\\''")}"'`, { stdio: 'pipe' }).toString?.();
  return join(destDir, safe);
}

/** Выгрузить картинки диалога файлами.
 *
 *  Ловушка, из-за которой терялись чеки: Zalo грузит фото ЛЕНИВО — картинка
 *  в самом низу ленты появляется в DOM только когда до неё доскроллили и
 *  подождали. Поэтому сначала прокручиваем в самый низ, потом вверх шагами,
 *  и на каждом шаге снимаем blob-URL (полноразмер живёт только в blob).
 */
async function exportImages(page, name, limit = 30, scrolls = 12) {
  await openChat(page, name);
  await page.waitForTimeout(1500);
  const box = await page.locator('#chatViewContainer').boundingBox();
  if (!box) throw new Error('лента чата не найдена');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // вниз — чтобы догрузился хвост
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(180); }
  await page.waitForTimeout(1500);
  // вкладка живёт между запусками — снимаем метки, иначе второй запуск «не найдёт» ничего
  await page.evaluate(() => document.querySelectorAll('#chatViewContainer img').forEach(i => { delete i.dataset.zgrabbed; }));
  const grab = () => page.evaluate(async () => {
    const out = [];
    for (const img of document.querySelectorAll('#chatViewContainer img')) {
      const s = img.src || '';
      if (!s.startsWith('blob:') || img.dataset.zgrabbed) continue;
      if (img.naturalWidth <= 60 || img.naturalHeight <= 60) { img.dataset.zgrabbed = '1'; continue; } // аватарки/иконки
      img.dataset.zgrabbed = '1';
      try {
        const r = await fetch(s);
        const ab = await r.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let bin = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        out.push({ w: img.naturalWidth, h: img.naturalHeight, b64: btoa(bin) });
      } catch (e) { /* пропускаем битые */ }
    }
    return out;
  });
  let all = await grab();
  for (let i = 0; i < scrolls && all.length < limit; i++) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(650);
    all = all.concat(await grab());
  }
  // DOM отдаёт старые → новые: берём хвост (самые свежие) и разворачиваем
  return all.slice(-limit).reverse();
}

/** Текст из скачанного вложения: pdf через pdftotext, docx/xlsx через unzip+xml. */
function extractText(path) {
  const lower = path.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      return execSync(`pdftotext -layout "${path}" -`, { encoding: 'utf8', maxBuffer: 40 << 20 });
    }
    if (lower.endsWith('.docx') || lower.endsWith('.xlsx') || lower.endsWith('.pptx')) {
      const inner = lower.endsWith('.docx') ? 'word/document.xml'
        : lower.endsWith('.xlsx') ? 'xl/sharedStrings.xml' : 'ppt/slides/slide1.xml';
      const xml = execSync(`unzip -p "${path}" "${inner}"`, { encoding: 'utf8', maxBuffer: 40 << 20 });
      return xml
        .replace(/<w:p[ >]/g, '\n<w:p ')          // абзацы Word — в переводы строк
        .replace(/<\/(w:p|si|a:p)>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n');
    }
    if (lower.endsWith('.txt') || lower.endsWith('.csv') || lower.endsWith('.md')) {
      return readFileSync(path, 'utf8');
    }
    return '';
  } catch (e) {
    return `# не удалось разобрать: ${e.message.split('\n')[0]}`;
  }
}

/**
 * Картинки в чате. Фото Zalo Web не отдаёт ни ссылкой, ни download-кнопкой:
 * в ленте это <div class="photo-message-v2"> с миниатюрой, а полноразмер
 * рождается только в просмотрщике как blob: после клика по пузырю.
 * Поэтому путь один — клик, чтение blob в base64, запись файла локально.
 */
async function photoBubbles(page, name) {
  await openChat(page, name);
  await page.waitForTimeout(1200);
  const bubbles = page.locator('#chatViewContainer .photo-message-v2');
  return { bubbles, n: await bubbles.count() };
}

/** Список фото в видимой части диалога, нумерация с конца: 1 — самое свежее. */
async function photos(page, name) {
  const { n } = await photoBubbles(page, name);
  if (!n) return [];
  const sizes = await page.$$eval('#chatViewContainer .photo-message-v2 img.zimg-el',
    els => els.map(e => ({ w: e.naturalWidth, h: e.naturalHeight })));
  return sizes.reverse();
}

/** Все полноразмерные blob-картинки открытого просмотрщика в base64. */
async function readViewerBlobs(page) {
  // просмотрщик Zalo показывает галерею: несколько blob-картинок сразу.
  // Берём ту, что ближе всего к центру экрана, — это и есть открытое фото.
  return page.evaluate(async () => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const cands = [];
    for (const im of [...document.querySelectorAll('img')]) {
      const cls = (im.className || '').toString();
      const r0 = im.getBoundingClientRect();
      const visible = r0.width > 100 && r0.height > 100 && r0.bottom > 0 && r0.right > 0;
      const big = im.naturalWidth >= 600 || /fit_contain/.test(cls);
      if (!im.src.startsWith('blob:') || !big || !visible) continue;
      const dist = Math.hypot(r0.left + r0.width / 2 - cx, r0.top + r0.height / 2 - cy);
      cands.push({ im, dist, area: r0.width * r0.height });
    }
    if (!cands.length) return [];
    cands.sort((a, b) => a.dist - b.dist || b.area - a.area);
    const pick = cands[0].im;
    const r = await fetch(pick.src);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return [{ b64: btoa(s), w: pick.naturalWidth, h: pick.naturalHeight }];
  });
}

async function downloadPhoto(page, name, idx, destDir) {
  const { bubbles, n } = await photoBubbles(page, name);
  if (!n) throw new Error('фотографий в видимой части диалога нет (пролистай выше или уточни чат)');
  const pick = n - Math.min(Math.max(idx, 1), n);   // 1 — самое свежее
  // размеры именно этого пузыря: просмотрщик открывает альбом и отдаёт blob
  // соседних фото, из-за чего раньше скачивалась чужая картинка
  const want = await bubbles.nth(pick).evaluate(el => {
    const im = el.querySelector('img.zimg-el') || el.querySelector('img');
    return im ? { w: im.naturalWidth, h: im.naturalHeight } : null;
  }).catch(() => null);
  await bubbles.nth(pick).click({ force: true });
  await page.waitForTimeout(2200);
  let blobs = await readViewerBlobs(page);
  if (want && want.w > 0 && blobs.length) {
    const match = blobs.filter(b => b.w > 0 && Math.abs(b.w / b.h - want.w / want.h) / (want.w / want.h) < 0.03);
    if (match.length) blobs = match;
  }
  await page.keyboard.press('Escape').catch(() => {});
  if (!blobs.length) throw new Error('просмотрщик не отдал картинку: blob не найден');
  mkdirSync(destDir, { recursive: true });
  const stamp = Date.now().toString().slice(-6);
  const base = name.replace(/[^\p{L}\p{N}]+/gu, '_');
  return blobs.map((s, i) => {
    const out = join(destDir, `${base}_${stamp}_${i + 1}.jpg`);
    writeFileSync(out, Buffer.from(s.b64, 'base64'));
    return out;
  });
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
  } else if (cmd === 'files') {
    const list = await files(page, arg);
    if (!list.length) console.log('файлов в видимой части диалога нет');
    list.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${f.name}  ${f.size ? '· ' + f.size : ''}`));
  } else if (cmd === 'get') {
    const dir = process.env.ZALO_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'zalo');
    const out = await download(page, arg, parseInt(arg2 || "1", 10), dir, CFG.sshHost);
    console.log(out);
  } else if (cmd === 'text') {
    if (!arg) { console.error('usage: text "<чат>" [n] [макс.символов]'); process.exit(1); }
    const dir = process.env.ZALO_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'zalo');
    const path = await download(page, arg, parseInt(arg2 || '1', 10), dir, CFG.sshHost);
    const body = extractText(path).trim();
    const max = parseInt(process.argv[5] || '8000', 10);
    console.log(`### ${path.split('/').pop()}`);
    console.log(body ? body.slice(0, max) : '(текста извлечь не удалось — это скан или картинка)');
  } else if (cmd === 'photos') {
    if (!arg) { console.error('usage: photos "<чат>"'); process.exit(1); }
    const rows = await photos(page, arg);
    if (!rows.length) console.log('фотографий в видимой части диалога нет');
    rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.w}×${r.h}`));
  } else if (cmd === 'getimg') {
    if (!arg) { console.error('usage: getimg "<чат>" [n]  — n считается с конца, 1 = самое свежее'); process.exit(1); }
    const dir = process.env.ZALO_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'zalo');
    const saved = await downloadPhoto(page, arg, parseInt(arg2 || '1', 10), dir);
    saved.forEach(x => console.log(x));
  } else if (cmd === 'imgs') {
    if (!arg) { console.error('usage: imgs "<чат>" [сколько] [--dir путь]'); process.exit(1); }
    const dirIdx = process.argv.indexOf('--dir');
    const dir = dirIdx > -1 ? process.argv[dirIdx + 1]
      : (process.env.ZALO_DOWNLOAD_DIR || join(homedir(), 'Downloads', 'zalo'));
    mkdirSync(dir, { recursive: true });
    const list = await exportImages(page, arg, Number(arg2) || 30);
    if (!list.length) { console.log('картинок не нашлось'); }
    const slug = arg.replace(/[^\p{L}\p{N}]+/gu, '_');
    list.forEach((im, i) => {
      const p = join(dir, `${slug}_${String(list.length - i).padStart(2, '0')}_${im.w}x${im.h}.png`);
      writeFileSync(p, Buffer.from(im.b64, 'base64'));
      console.log(p);
    });
  } else if (cmd === 'read') {
    if (!arg) { console.error('нужно имя диалога: node zalo.mjs read "Имя"'); process.exit(1); }
    const lines = await read(page, arg, Number(arg2) || 40, Number(process.argv[5] || 0));
    lines.forEach(l => console.log(l));
  } else {
    console.error('команды: list | read "Имя" [n] [scroll] | imgs "Имя" [n] | find | files | get | text | photos | getimg | tabs');
    process.exit(1);
  }
  // после любой команды оставляем Zalo в чистом состоянии, иначе следующий
  // вызов увидит пустой список и «не найдёт» диалог
  await resetUi(page).catch(() => {});
  await b.close();
  } catch (e) {
    await bail('# ' + (e?.message || String(e)).split('\n')[0]);
  }
}
