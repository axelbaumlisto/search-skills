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

// Keep the applet in a *visible* folder: macOS permission pickers cannot browse into ~/.pi
const APP = process.env.SHOPEE_BRIDGE_APP || path.join(os.homedir(), 'Applications/ChromeBridge.app');
const RUNNER = path.join(__dirname, 'bridge_run.applescript');
const TMP = process.env.SHOPEE_BRIDGE_DIR || '/tmp/search-skills-bridge';
fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
const JS_IN = path.join(TMP, 'shopee_js.js');
const JS_OUT = path.join(TMP, 'shopee_js.out');
const AS = path.join(TMP, 'shopee_as.applescript');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run JS in the active tab; returns the string the JS returned (must be sync, no Promise). */
async function runJS(js, { timeoutMs = 50000 } = {}) {
  fs.writeFileSync(JS_IN, js);
  fs.writeFileSync(AS, fs.readFileSync(RUNNER, 'utf8').split('__JS_IN__').join(JS_IN));
  if (fs.existsSync(JS_OUT)) fs.unlinkSync(JS_OUT);
  execFileSync('open', ['-a', APP]);
  for (let waited = 0; waited < timeoutMs; waited += 500) {
    await sleep(500);
    if (fs.existsSync(JS_OUT)) {
      const out = fs.readFileSync(JS_OUT, 'utf8').trim();
      if (out.startsWith('ERR')) throw new Error(`bridge: ${out}`);
      return out.replace(/^OK\s?/, '');
    }
  }
  throw new Error('bridge: timeout (is ChromeBridge.app allowed in Automation?)');
}

/** Run a JS snippet from scripts/js/<name>.js, substituting __TOKEN__ placeholders. */
async function runFile(name, vars = {}, opts) {
  let js = fs.readFileSync(path.join(__dirname, 'js', `${name}.js`), 'utf8');
  for (const [k, v] of Object.entries(vars)) js = js.split(`__${k}__`).join(v);
  return runJS(js, opts);
}
const jsonFile = async (name, vars, opts) => { const s = await runFile(name, vars, opts); try { return JSON.parse(s); } catch { return s; } };

const json = async (js, opts) => { const s = await runJS(js, opts); try { return JSON.parse(s); } catch { return s; } };

/** Navigate the active tab and wait for the SPA to settle. */
async function go(url, settleMs = 13000) {
  await runJS(`location.href=${JSON.stringify(url)}; 'nav'`);
  await sleep(settleMs);
}

module.exports = { runJS, runFile, json, jsonFile, go, sleep };
