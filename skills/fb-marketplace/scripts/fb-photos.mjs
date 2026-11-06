#!/usr/bin/env node
/* Facebook: выгрузить ФОТО работ со страницы или из группы.
 *
 * Зачем: у мастерских всё портфолио живёт в «Ảnh» страницы или в альбомах
 * группы, а не в описании. Текстом их не достать — только из DOM после
 * прокрутки.
 *
 *   node fb-photos.mjs xưởng_sản_xuất...            # список URL (страница)
 *   node fb-photos.mjs <slug|url> --limit 40
 *   node fb-photos.mjs <slug|url> --download --out /tmp/fb --limit 20
 *   node fb-photos.mjs groups/123456789 --limit 30   # группа: media/photos
 *
 * Печатает URL и (с --download) локальные пути. Ничего не пишет без --download.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const NM = process.env.FB_NODE_MODULES || `${homedir()}/work/search-skills/node_modules`;
const { chromium } = require(`${NM}/playwright`);

function host() {
  if (process.env.BROWSER_SSH_HOST) return process.env.BROWSER_SSH_HOST;
  const cfg = (process.env.SKILLS_CONFIG || '').replace(/^~/, homedir());
  if (cfg) {
    try {
      const j = JSON.parse(readFileSync(cfg, 'utf8'));
      return j.remoteBrowser?.sshHost || 'spex';
    } catch { /* ниже */ }
  }
  return 'spex';
}

const args = process.argv.slice(2);
const target = args[0];
if (!target) {
  console.error('usage: fb-photos.mjs <slug|url|groups/ID> [--limit N] [--download --out DIR]');
  process.exit(2);
}
const getFlag = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const LIMIT = Number(getFlag('--limit', 30));
const DOWNLOAD = args.includes('--download');
const OUT = getFlag('--out', join(homedir(), 'Downloads', 'fb-photos'));

// groups/<id> → media/photos; иначе страница → /photos
let url;
if (/^https?:/.test(target)) {
  // ссылку пользователя НЕ переписываем: /groups/<slug>/media и /media/photos
  // ведут на разные вкладки, и вторая у части групп пустая
  url = target;
} else if (/^groups\/[^/]+/.test(target)) {
  // группы: и числовой id, и username-slug (напр. groups/samuhire/media)
  const rest = target.split('/').slice(1).join('/');
  url = rest.includes('/')
    ? `https://www.facebook.com/groups/${rest}`
    : `https://www.facebook.com/groups/${rest}/media`;
} else {
  url = `https://www.facebook.com/${target.replace(/^\//, '')}/photos`;
}

const LOCAL = Number(process.env.FB_CDP_LOCAL || 9231);
const REMOTE = Number(process.env.FB_CDP_REMOTE || 9222);
execSync(`bash ${homedir()}/.pi/agent/skills/browser-scout/scripts/cdp-tunnel.sh ${LOCAL} ${REMOTE} ${host()}`,
  { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] });

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${LOCAL}`);
const page = await browser.contexts()[0].newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(11000);

// прокрутка: сетка фото ленивая. Скроллим до тех пор, пока прирост не
// остановится три раунда подряд — у групп и больших страниц сетка длинная.
const seen = new Map();
let stall = 0;
for (let i = 0; i < 40 && seen.size < LIMIT * 3 && stall < 6; i++) {
  const batch = await page.evaluate(() => {
    const out = [];
    const push = (src, w, h) => {
      if (!src || !/scontent/.test(src)) return;              // static.xx.fbcdn.net и rsrc.php — это иконки
      if (/static\.xx\.fbcdn\.net|rsrc\.php/.test(src)) return;
      if (w && h && (w < 150 || h < 150)) return;
      out.push({ src, w: w || 0, h: h || 0 });
    };
    for (const img of document.querySelectorAll('img')) push(img.src, img.naturalWidth, img.naturalHeight);
    // сетка групп/страниц часто рисует фото как background-image на div'ах,
    // а <img> внутри — только плейсхолдер, поэтому собственный фильтр по <img>
    // давал «фото: 1». Снимаем и css-фоны.
    for (const el of document.querySelectorAll('[style*="background"]')) {
      const bg = el.style.backgroundImage || '';
      const m = bg.match(/url\("?([^")]+)"?\)/);
      if (m) push(m[1], el.clientWidth, el.clientHeight);
    }
    return out;
  }).catch(() => []);
  const before = seen.size;
  if (process.env.FB_DEBUG) {
    const dbg = await page.evaluate(() => ({ imgs: document.querySelectorAll('img').length, title: document.title.slice(0, 50), h: document.body.scrollHeight })).catch(() => ({}));
    console.error(`  round ${i}: batch=${batch.length} total=${before} imgs=${dbg.imgs} h=${dbg.h} "${dbg.title}"`);
  }
  // ключ — путь без query: одно фото приходит в 2-3 размерах (s320/s512), и
  // полный src давал дубли, а обрезка по '?' раньше склеивала всю сетку в 1-3
  // записи. Держим самый крупный вариант каждого фото.
  for (const b of batch) {
    const key = b.src.split('?')[0];
    const prev = seen.get(key);
    if (!prev || (b.w * b.h) > (prev.w * prev.h)) seen.set(key, b);
  }
  stall = seen.size === before ? stall + 1 : 0;
  // медиа-вкладка иногда ждёт «Xem thêm / See more», а не только скролла
  if (stall >= 2) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('div[role="button"],span')]
        .find(e => /^(Xem thêm|See more)$/i.test((e.innerText || '').trim()));
      if (btn) btn.click();
    }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  // mouse.wheel без позиции курсора не прокручивает ленту FB — крутим окно из JS
  await page.evaluate(() => {
    window.scrollBy(0, 1600);
    const sc = [...document.querySelectorAll('div')]
      .filter(d => d.scrollHeight > d.clientHeight + 200 && d.clientHeight > 300);
    for (const d of sc.slice(0, 3)) d.scrollTop += 1600;
  }).catch(() => {});
  await page.waitForTimeout(1500);
}

let photos = [...seen.values()];

// Сетка отдаёт не всё: у части групп/страниц картинки в медиа-вкладке — это
// обложки альбомов, а сами снимки доступны только по постоянным ссылкам
// /photo/?fbid=… Поэтому добираем по ним, открывая в той же вкладке.
if (photos.length < LIMIT) {
  const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="fbid="]')]
    .map(a => a.href))].slice(0, 40)).catch(() => []);
  for (const link of links) {
    if (photos.length >= LIMIT) break;
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const best = await page.evaluate(() => {
        let top = null;
        for (const img of document.querySelectorAll('img')) {
          if (!/scontent/.test(img.src)) continue;
          const area = img.naturalWidth * img.naturalHeight;
          if (!top || area > top.area) top = { src: img.src, w: img.naturalWidth, h: img.naturalHeight, area };
        }
        return top;
      }).catch(() => null);
      if (best && best.w >= 300) {
        const key = best.src.split('?')[0];
        if (!seen.has(key)) { seen.set(key, { src: best.src, w: best.w, h: best.h }); photos.push({ ...best }); }
      }
    } catch { /* пропускаем битую ссылку */ }
  }
  photos = [...seen.values()];
}

photos = photos.slice(0, LIMIT);
console.log(`# ${url} — фото: ${photos.length}`);
if (photos.length < 3) {
  const why = await page.evaluate(() => {
    const t = (document.body.innerText || '');
    if (/log in|Đăng nhập|Join group|Tham gia nhóm/i.test(t)) return 'нужен вход/вступление в группу';
    if (/This content isn|nội dung này không/i.test(t)) return 'контент скрыт настройками группы';
    return 'сетка не догрузилась';
  }).catch(() => '');
  console.error(`# мало фото: ${why}`);
}
if (DOWNLOAD && photos.length) {
  mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const p of photos) {
    n += 1;
    try {
      const r = await page.request.get(p.src);
      const buf = await r.body();
      const ext = (p.src.match(/\.(jpg|jpeg|png|webp)/i) || [, 'jpg'])[1];
      const f = join(OUT, `${(target.replace(/[^A-Za-z0-9._-]+/g, '_')).slice(0, 40)}_${String(n).padStart(2, '0')}_${p.w}x${p.h}.${ext}`);
      writeFileSync(f, buf);
      console.log(f);
    } catch (e) {
      console.error('skip', p.src.slice(0, 60), e.message.split('\n')[0]);
    }
  }
} else {
  photos.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${p.w}x${p.h}  ${p.src}`));
}
await page.close();
await browser.close();
