#!/usr/bin/env node
/* Facebook: поиск ПУБЛИЧНЫХ ГРУПП и СТРАНИЦ по запросу.
 *
 * Зачем: Marketplace-поиск (fb-search.sh) ищет объявления, а мастерские/цеха
 * живут в группах и на страницах — именно там выкладывают фото работ.
 * Локальный HTTP-путь таких выдачи не отдаёт, поэтому идём через живой Chrome.
 *
 *   node fb-discover.mjs groups "xưởng bàn ghế inox"
 *   node fb-discover.mjs pages  "xưởng sản xuất ghế inox" --limit 15
 *   node fb-discover.mjs groups "nội thất đà nẵng" --json
 *
 * Хост и CDP-порт берутся из окружения: BROWSER_SSH_HOST / SKILLS_CONFIG,
 * иначе remoteBrowser.sshHost/sshHost и CDP 9222.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
      return j.remoteBrowser?.sshHost || j.remoteBrowser?.sshHost || 'spex';
    } catch { /* ниже */ }
  }
  return 'spex';
}

const args = process.argv.slice(2);
const kind = args[0];
const query = args[1];
if (!['groups', 'pages'].includes(kind) || !query) {
  console.error('usage: fb-discover.mjs groups|pages "<query>" [--limit N] [--json]');
  process.exit(2);
}
const getFlag = (n, d) => {
  const i = args.indexOf(n);
  return i > -1 ? args[i + 1] : d;
};
const LIMIT = Number(getFlag('--limit', 20));
const JSONOUT = args.includes('--json');

const LOCAL = Number(process.env.FB_CDP_LOCAL || 9231);
const REMOTE = Number(process.env.FB_CDP_REMOTE || 9222);
execSync(`bash ${homedir()}/.pi/agent/skills/browser-scout/scripts/cdp-tunnel.sh ${LOCAL} ${REMOTE} ${host()}`,
  { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] });

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${LOCAL}`);
const page = await browser.contexts()[0].newPage();
const url = `https://www.facebook.com/search/${kind}/?q=${encodeURIComponent(query)}`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1500);
}

const rows = await page.evaluate((kind) => {
  const out = [];
  const skip = new Set(['search', 'watch', 'marketplace', 'groups', 'pages', 'home.php', 'profile.php',
    'photo', 'reel', 'story.php', 'permalink.php', 'people', 'public', 'help', 'policies', 'login',
    'recover', 'notifications', 'friends', 'bookmarks', 'm', 'l', 'settings', 'ads']);
  const seen = new Set();
  const re = kind === 'groups'
    ? /^https:\/\/www\.facebook\.com\/groups\/(\d+)/
    : /^https:\/\/www\.facebook\.com\/([A-Za-z0-9._-]+)\/?$/;
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.href.split('?')[0];
    const m = raw.match(re);
    if (!m) continue;
    const id = m[1];
    if (skip.has(id) || seen.has(id)) continue;
    // карточка выдачи — ближайший контейнер с текстом
    let box = a;
    for (let i = 0; i < 6 && box.parentElement; i++) {
      box = box.parentElement;
      if ((box.innerText || '').split('\n').length >= 2) break;
    }
    const lines = (box.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) continue;
    const name = lines[0];
    const meta = lines.slice(1).join(' · ');
    if (kind === 'pages' && !/followers?|người theo dõi|thích/i.test(meta)) continue;
    if (kind === 'groups' && !/members?|thành viên|Public|Công khai/i.test(meta)) continue;
    seen.add(id);
    out.push({ id, name, meta, url: raw });
  }
  return out.slice(0, 60);
}, kind);

const list = rows.slice(0, LIMIT);
if (JSONOUT) {
  console.log(JSON.stringify(list, null, 1));
} else if (!list.length) {
  console.log('ничего не найдено — вероятно, выдача не догрузилась или нужен логин (--health у fb-search.sh)');
} else {
  console.log(`# ${kind}: "${query}" — ${list.length}`);
  list.forEach((r, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${r.name}`);
    console.log(`    ${r.meta}`);
    console.log(`    ${r.url}`);
  });
}
await page.close();
await browser.close();
