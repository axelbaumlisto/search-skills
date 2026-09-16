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
  fs.copyFileSync(SERVER, AS);
  rm(QUIT); rm(GO); rm(OUT);
  // -g: do not bring the applet forward. -j: start hidden. It stays the responsible
  // process either way, so the Automation grant still binds.
  execFileSync('open', ['-g', '-j', '-a', APP]);
  for (let i = 0; i < 40; i++) { await sleep(500); if (serverAlive()) return; }
  throw new Error('bridge: server did not start (is ChromeBridge.app allowed in Automation?)');
}

/** Run JS in the dedicated tab; returns the string the JS returned (must be sync, no Promise). */
async function runJS(js, { timeoutMs = 50000 } = {}) {
  await ensureServer();
  rm(OUT);
  fs.writeFileSync(JOB, js);
  fs.writeFileSync(GO, '1');
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    await sleep(250);
    if (fs.existsSync(OUT) && !fs.existsSync(GO)) {
      const out = fs.readFileSync(OUT, 'utf8').trim();
      if (out.startsWith('ERR')) throw new Error(`bridge: ${out}`);
      return out.replace(/^OK\s?/, '');
    }
    if (!serverAlive()) await ensureServer();
  }
  throw new Error('bridge: job timeout');
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

module.exports = { runJS, runFile, json, jsonFile, go, autoScroll, stopServer, serverAlive, sleep };
