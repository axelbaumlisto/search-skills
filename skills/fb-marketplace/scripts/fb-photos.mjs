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
if (/^groups\/\d+/.test(target)) {
  const id = target.split('/')[1];
  url = `https://www.facebook.com/groups/${id}/media/photos`;
} else if (/^https?:/.test(target)) {
  url = target.replace(/\/$/, '') + (/photos|media/.test(target) ? '' : '/photos');
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
await page.waitForTimeout(9000);

// прокрутка: сетка фото ленивая, без скролла в DOM живут только первые 8-12
const seen = new Map();
for (let i = 0; i < 14 && seen.size < LIMIT * 3; i++) {
  const batch = await page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll('img')) {
      const src = img.src || '';
      if (!/scontent|fbcdn/.test(src)) continue;
      if (img.naturalWidth < 150 || img.naturalHeight < 150) continue;
      out.push({ src, w: img.naturalWidth, h: img.naturalHeight });
    }
    return out;
  }).catch(() => []);
  for (const b of batch) if (!seen.has(b.src.split('?')[0])) seen.set(b.src.split('?')[0], b);
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(1400);
}

const photos = [...seen.values()].slice(0, LIMIT);
console.log(`# ${url} — фото: ${photos.length}`);
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
