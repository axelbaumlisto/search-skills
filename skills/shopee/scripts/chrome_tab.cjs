/** Everything that knows about Chrome's windows, tabs and profiles.
 *
 *  Split out of bridge.cjs, which should only ship jobs to the resident applet and read
 *  results back. Three separate incidents lived in here, so the knowledge is kept together:
 *
 *   1. The bridge window must belong to the Chrome profile that holds the shop session.
 *      AppleScript's `make new window` opens in whichever profile Chrome used last, so a
 *      bridge born while the owner worked in a second profile is logged out.
 *   2. "Allow JavaScript from Apple Events" is a per-profile switch. A bridge in the wrong
 *      profile therefore cannot run a single line of JS.
 *   3. Chrome throttles background tabs: a click reaches `document` but the shop's app never
 *      updates its state, so writes silently do nothing while reads look fine.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TABID = '/tmp/shopee_tab.id';
const MARKER = 'https://shopee.vn/#pi-bridge';
// The applet can only read /tmp, but /tmp is wiped on reboot and by cleaners — and an id
// lost there used to orphan the bridge window, because a navigated bridge tab is
// indistinguishable from one of the owner's shop tabs. So Node keeps its own copy.
const STATE = path.join(__dirname, '.bridge-tab.id');
const PROFILE_CONFIG = path.join(__dirname, 'profile.dir');

/** One-liner AppleScript, trimmed. Tab bookkeeping only, never page JS. */
const osa = (src) => execFileSync('osascript', ['-e', src]).toString().trim();

/** Profile directory the bridge must live in, as configured by the owner. */
function wantedProfile() {
  try { return fs.readFileSync(PROFILE_CONFIG, 'utf8').trim() || 'Default'; } catch { return 'Default'; }
}

/** Where the bridge tab sits: window index, tab index, and the tab the owner was looking
 *  at. Null when the tab is gone — or when it is no longer ALONE in its window.
 *
 *  That second rule is a safety belt, not pedantry. A tab id outlives the marker URL (the
 *  hash is gone after the first navigation), so a stale id pointing into one of the owner's
 *  windows would make every `go()` hijack a tab he is reading. A window holding only the
 *  bridge cannot be a window he is working in. */
function tabPos() {
  const id = rememberedId();
  if (!id) return null;
  if (!fs.existsSync(TABID)) fs.writeFileSync(TABID, id);   // /tmp was wiped; the applet needs it
  const out = osa(`tell application "Google Chrome"
    repeat with wi from 1 to count of windows
      repeat with ti from 1 to count of tabs of window wi
        if ((id of tab ti of window wi) as text) is "${id}" then
          return (wi as text) & "," & (ti as text) & "," & (active tab index of window wi as text) & "," & ((count of tabs of window wi) as text)
        end if
      end repeat
    end repeat
    return ""
  end tell`);
  const [w, t, prev, tabs] = String(out).split(',').map(Number);
  if (!w) return null;
  if (tabs !== 1) return null;        // the owner opened tabs next to it: hands off
  return { w, t, prev };
}

/** The bridge gets exactly one window of its own.
 *
 *  Two rules learned the hard way, both by annoying the owner:
 *   - never add tabs to a window he is working in: a bridge tab among his tabs is litter,
 *     and a recovery loop turns it into a tab storm;
 *   - never take focus: a cold start must not pull the screen away mid-typing.
 *
 *  So reuse the marker tab while it lives, otherwise sweep the strays, open ONE background
 *  window and hand the screen straight back. */
async function ensureTab() {
  if (tabPos()) return 'already there';
  // The previous bridge window loses its marker on first navigation, so it can only be
  // found by the id we stored. Without this, every recovery left another window behind.
  closePrevious();
  closeStrays();

  let front = '';
  try { front = osa('tell application "System Events" to get name of first application process whose frontmost is true'); } catch { /* unknown */ }

  try {
    execFileSync('open', ['-g', '-na', 'Google Chrome', '--args',
      `--profile-directory=${wantedProfile()}`, '--new-window', MARKER]);
  } catch { /* the poll below decides whether it worked */ }

  let id = '';
  for (let i = 0; i < 20 && !id; i++) {
    try { id = findMarkerTab(); } catch { /* Chrome still starting */ }
    if (!id) await sleep(500);
  }

  await giveFocusBack(front);

  if (!id) return 'could not open a bridge window';
  fs.writeFileSync(TABID, id);
  fs.writeFileSync(STATE, id);
  return 'opened a background window';
}

/** Chrome raises itself a beat after the new window appears, so one restore is not enough:
 *  the first attempt lands before Chrome steals the screen. Verify, retry, then give up
 *  quietly — a wrong focus is annoying, not fatal. */
async function giveFocusBack(front) {
  if (!front || front === 'Google Chrome') return;
  for (let i = 0; i < 4; i++) {
    await sleep(400);
    try {
      osa(`tell application "System Events" to set frontmost of application process "${front}" to true`);
      const now = osa('tell application "System Events" to get name of first application process whose frontmost is true');
      if (now === front) return;
    } catch { return; }
  }
}

function findMarkerTab() {
  return osa(`tell application "Google Chrome"
    repeat with w in windows
      repeat with t in tabs of w
        if (URL of t) contains "#pi-bridge" then return (id of t) as text
      end repeat
    end repeat
    return ""
  end tell`);
}

/** Close the window the last bridge tab lived in — but only while it still holds that one
 *  tab, so a window the owner has since adopted is left alone. */
function closePrevious() {
  const id = rememberedId();
  if (!id) return;
  try {
    osa(`tell application "Google Chrome"
      repeat with wi from 1 to count of windows
        if (count of tabs of window wi) is 1 then
          try
            if ((id of tab 1 of window wi) as text) is "${id}" then close window wi
          end try
        end if
      end repeat
    end tell`);
  } catch { /* already gone */ }
  for (const f of [TABID, STATE]) { try { fs.unlinkSync(f); } catch { /* fine */ } }
}

/** Last known bridge tab id, from the runtime file or Node's durable copy. */
function rememberedId() {
  for (const f of [TABID, STATE]) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      if (v) return v;
    } catch { /* try the next one */ }
  }
  return '';
}

/** Close leftover bridge tabs so recovery cannot accumulate windows. Only tabs that are
 *  still marked, i.e. never navigated, and therefore never one of the owner's. */
function closeStrays() {
  try {
    osa(`tell application "Google Chrome"
      repeat with wi from (count of windows) to 1 by -1
        repeat with ti from (count of tabs of window wi) to 1 by -1
          try
            if (URL of tab ti of window wi) contains "#pi-bridge" then close tab ti of window wi
          end try
        end repeat
      end repeat
    end tell`);
  } catch { /* nothing to clean */ }
}

let _restore = null;

/** Bring the bridge tab to the front of its window so writes register. Switches the active
 *  tab inside Chrome only — the app is never activated, so the owner's focus stays put.
 *  Returns false when there is nothing to do. */
function showTab() {
  const p = tabPos();
  if (!p || p.prev === p.t) { _restore = null; return false; }
  osa(`tell application "Google Chrome" to set active tab index of window ${p.w} to ${p.t}`);
  _restore = p;
  return true;
}

/** Put back whatever tab the owner was looking at. */
function hideTab() {
  if (!_restore) return;
  const { w, prev } = _restore;
  _restore = null;
  try { osa(`tell application "Google Chrome" to set active tab index of window ${w} to ${prev}`); } catch {}
}

/** Name the suspect behind a job timeout. A bare "job timeout" once sent an investigation
 *  chasing Shopee's anti-bot defences for half an hour while the real cause was a bridge
 *  window in the wrong Chrome profile.
 *  `deps` is injectable so each branch can be tested without breaking the owner's Chrome. */
function diagnose(deps = {}) {
  const run = deps.osa || osa;
  const pos = (deps.tabPos || tabPos)();
  const want = (deps.wantedProfile || wantedProfile)();

  if (!pos) return `bridge tab is gone (expected Chrome profile "${want}")`;

  let url = '';
  try { url = run(`tell application "Google Chrome" to get URL of tab ${pos.t} of window ${pos.w}`); } catch { /* keep empty */ }
  let title = '';
  try { title = run('tell application "System Events" to tell process "Google Chrome" to get name of window 1'); } catch { /* keep empty */ }

  try {
    run(`tell application "Google Chrome" to execute tab ${pos.t} of window ${pos.w} javascript "1"`);
  } catch (e) {
    const msg = String(e.message || e);
    if (/Apple Events|отключено|disabled/i.test(msg)) {
      return `Chrome blocks JavaScript from Apple Events for this window's profile — tick `
        + `View > Developer > Allow JavaScript from Apple Events *in that window* (the switch `
        + `is per profile; wanted profile "${want}", front window "${title}")`;
    }
    return `direct probe failed: ${msg.slice(0, 140)}`;
  }

  if (/^chrome:\/\//.test(url)) {
    return `bridge tab sits on ${url}; some chrome:// pages refuse scripting`;
  }
  return `the tab answers a direct probe but the resident applet does not — kill ChromeBridge.app and retry (url ${url.slice(0, 60)})`;
}

module.exports = {
  TABID, osa, wantedProfile, ensureTab, closeStrays, showTab, hideTab, diagnose,
};
