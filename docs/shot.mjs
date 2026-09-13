#!/usr/bin/env node
/** Render a terminal transcript into a PNG for the README.
 *
 *   node docs/shot.mjs <transcript.txt> <out.png> ["window title"]
 *
 * The transcript is plain text; lines starting with "$ " are drawn as commands,
 * "# " as dim comments, everything else as output. No ANSI parsing on purpose —
 * screenshots stay reproducible and diffable.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Resolve playwright from the repo install, or from $SHOPEE_NODE_MODULES / $NODE_PATH
// when it is shared with another checkout (the Shopee skill does the same).
const require = createRequire(import.meta.url);
const extra = process.env.SHOPEE_NODE_MODULES || process.env.NODE_PATH;
const { chromium } = extra ? require(`${extra}/playwright`) : require('playwright');

const [, , src, out, title = 'search-skills'] = process.argv;
if (!src || !out) { console.error('usage: shot.mjs <transcript.txt> <out.png> [title]'); process.exit(2); }

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const body = readFileSync(src, 'utf8').replace(/\s+$/, '').split('\n').map((l) => {
  if (l.startsWith('$ ')) return `<div class="cmd"><span class="p">$</span> ${esc(l.slice(2))}</div>`;
  if (l.startsWith('# ')) return `<div class="cmt">${esc(l)}</div>`;
  return `<div class="out">${esc(l) || '&nbsp;'}</div>`;
}).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  :root{--bg:#101010;--card:#16181a;--line:#2a2d30;--fg:#eeeeee;--dim:#8a8380;--accent:#ee6018;--ok:#a0ca92}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);padding:28px;font-family:"JetBrains Mono",
    ui-monospace,SFMono-Regular,Menlo,monospace}
  .win{width:1120px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}
  .dot{width:11px;height:11px;border-radius:50%} .r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}
  .title{margin-left:10px;color:var(--dim);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
  .body{padding:18px 20px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
  .cmd{color:var(--fg);margin:10px 0 6px} .cmd .p{color:var(--accent)}
  .cmt{color:var(--dim)} .out{color:#c9c6c3}
  .out:first-child{margin-top:0}
</style><div class="win"><div class="bar">
  <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
  <span class="title">${esc(title)}</span></div>
  <div class="body">${body}</div></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.locator('.win').screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
