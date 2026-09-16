/* Настройки берутся снаружи: скилл публичный и не должен знать ни имени
 * хоста, ни доменов с чужими сессиями.
 *
 *   SKILLS_CONFIG=/path/skills.json   — личный файл (см. репозиторий владельца)
 *   без него                          — generic-значения ниже
 */
const fs = require('fs');
const os = require('os');

const DEFAULTS = {
  remoteBrowser: {
    sshHost: process.env.BROWSER_SSH_HOST || 'remote-browser',
    cdpRemotePort: 9222,
    cdpLocalPort: 9224,
    vncRemotePort: 6081,
    vncLocalPort: 6080,
    tmuxCdpSession: 'cdp-tunnel',
    tmuxVncSession: 'vnc-tunnel',
  },
  protectedDomains: [],
};

function load() {
  const p = (process.env.SKILLS_CONFIG || '').replace(/^~/, os.homedir());
  if (!p) return DEFAULTS;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      remoteBrowser: { ...DEFAULTS.remoteBrowser, ...(j.remoteBrowser || {}) },
      protectedDomains: j.protectedDomains || DEFAULTS.protectedDomains,
      cookies: j.cookies || {},
    };
  } catch {
    return DEFAULTS;                   // битый или отсутствующий файл не должен ронять скилл
  }
}

module.exports = load();
