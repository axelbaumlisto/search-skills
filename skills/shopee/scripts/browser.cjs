/* Выбор подложки браузера. Скилл всегда требует browser.cjs и не знает,
   что под ним: живой Chrome владельца или браузер на сервере.

     SHOPEE_BROWSER=bridge   (по умолчанию) — ChromeBridge, локальный Chrome
     SHOPEE_BROWSER=remote                   — CDP на удалённом сервере

   Это единственное место, где делается выбор: добавится третий драйвер —
   правка будет здесь, а не в командах скилла. */
const which = (process.env.SHOPEE_BROWSER || 'bridge').toLowerCase();
const remote = which === 'remote' || which === 'remote-browser';   // remote-browser — старое имя
module.exports = require(remote ? './remote.cjs' : './bridge.cjs');
module.exports.driverName = remote ? 'remote' : 'bridge';
