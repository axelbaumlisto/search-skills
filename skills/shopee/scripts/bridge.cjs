/** Bridge to the user's live, logged-in Chrome.
 *
 *  Shopee's risk engine (MPBuyerOrder) refuses cart writes from any automated browser,
 *  so mutations run as JavaScript inside the real Chrome via a trusted AppleScript applet.
 *  ChromeBridge.app must keep its exact bundle path, otherwise macOS re-prompts for
 *  Automation permission. Chrome needs browser.allow_javascript_apple_events = true
 *  (View > Developer > Allow JavaScript from Apple Events).
 */
const fs = require('fs'); const path = require('path'); const os = require('os');
const { execFileSync } = require('child_process');

const APP = ['/Applications/ChromeBridge.app', path.join(os.homedir(), 'Applications/ChromeBridge.app')]
  .find((p) => fs.existsSync(p)) || '/Applications/ChromeBridge.app';
const SERVER = path.join(__dirname, 'bridge_server.applescript');
const AS = '/tmp/shopee_as.applescript';
const JOB = '/tmp/shopee_job.js'; const GO = '/tmp/shopee_job.go';
const OUT = '/tmp/shopee_job.out'; const HB = '/tmp/shopee_job.hb';
const QUIT = '/tmp/shopee_job.quit';

// Windows, tabs, profiles and failure diagnosis live in their own module; this file only
// ships jobs to the resident applet and reads the answers back.
const chrome = require(`${__dirname}/chrome_tab.cjs`);
const { showTab, hideTab } = chrome;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rm = (p) => { try { fs.unlinkSync(p); } catch { /* already gone */ } };

/** Is the resident applet still ticking? It rewrites the heartbeat ~4x/sec. */
function serverAlive() {
  try { return Date.now() - fs.statSync(HB).mtimeMs < 3000; } catch { return false; }
}

/** Start the job server once. Relaunching the applet per JS call is what used to steal
 *  the user's focus ten times per search. */
async function ensureServer() {
  if (serverAlive()) return;
  // Create the tab from here, where System Events is permitted; the applet cannot ask
  // which profile a window belongs to and would launch a focus-stealing window instead.
  await chrome.ensureTab();
  fs.copyFileSync(SERVER, AS);
  rm(QUIT); rm(GO); rm(OUT);
  // -g: do not bring the applet forward. -j: start hidden. It stays the responsible
  // process either way, so the Automation grant still binds.
  execFileSync('open', ['-g', '-j', '-a', APP]);
  for (let i = 0; i < 40; i++) { await sleep(500); if (serverAlive()) return; }
  throw new Error('bridge: server did not start (is ChromeBridge.app allowed in Automation?)');
}

/** Run JS in the dedicated tab; returns the string the JS returned (must be sync, no Promise).
 *  ERR 12 means Chrome refused JS from Apple Events. A resident applet started while the
 *  setting was off keeps reporting it even after the user ticks the box, so the applet is
 *  killed and the job retried once instead of telling the user to enable what is enabled. */
async function runJS(js, { timeoutMs = 50000, _retried = false } = {}) {
  await ensureServer();
  rm(OUT);
  fs.writeFileSync(JOB, js);
  fs.writeFileSync(GO, '1');
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    await sleep(250);
    if (fs.existsSync(OUT) && !fs.existsSync(GO)) {
      const out = fs.readFileSync(OUT, 'utf8').trim();
      if (/^ERR 12\b/.test(out) && !_retried) {
        try { execFileSync('pkill', ['-f', 'ChromeBridge.app']); } catch {}
        await sleep(1500);
        return runJS(js, { timeoutMs, _retried: true });
      }
      // 9001: the owner closed the bridge window. Reopen it once, on demand — checking the
      // tab before every job would cost an osascript round trip per call.
      if (/^ERR 9001\b/.test(out) && !_retried) {
        await chrome.ensureTab();
        return runJS(js, { timeoutMs, _retried: true });
      }
      if (out.startsWith('ERR')) throw new Error(`bridge: ${out}`);
      return out.replace(/^OK\s?/, '');
    }
    if (!serverAlive()) await ensureServer();
  }
  throw new Error(`bridge: job timeout — ${chrome.diagnose()}`);
}

/** Ask the resident applet to quit (it also self-quits after ~2 min idle). */
const stopServer = () => { if (serverAlive()) fs.writeFileSync(QUIT, '1'); };

/** Run a JS snippet from scripts/js/<name>.js, substituting __TOKEN__ placeholders. */
async function runFile(name, vars = {}, opts) {
  let js = fs.readFileSync(path.join(__dirname, 'js', `${name}.js`), 'utf8');
  for (const [k, v] of Object.entries(vars)) js = js.split(`__${k}__`).join(v);
  return runJS(js, opts);
}
const jsonFile = async (name, vars, opts) => { const s = await runFile(name, vars, opts); try { return JSON.parse(s); } catch { return s; } };

const json = async (js, opts) => { const s = await runJS(js, opts); try { return JSON.parse(s); } catch { return s; } };

/** Navigate the bridge tab and wait for the SPA to settle. */
async function go(url, settleMs = 13000) {
  await runJS(`location.href=${JSON.stringify(url)}; 'nav'`);
  await sleep(settleMs);
}

/** Lazy grids only load on real scroll events, which need the event loop — and page JS
 *  handed to AppleScript must return synchronously. So fire one detached setInterval and
 *  let Node wait, instead of paying an app launch per scroll step. */
async function autoScroll({ steps = 10, everyMs = 700, px = 1400 } = {}) {
  await runJS(`(function(){let n=0;const id=setInterval(function(){window.scrollBy(0,${px});`
    + ` if(++n>=${steps}){clearInterval(id);window.scrollTo(0,0);}},${everyMs});return 'scrolling'})()`);
  await sleep(steps * everyMs + 2500);
}

module.exports = { runJS, runFile, json, jsonFile, go, autoScroll, stopServer, serverAlive, sleep, showTab, hideTab };
