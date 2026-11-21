/* Выбор подложки браузера. Скилл всегда требует browser.cjs и не знает,
   что под ним: живой Chrome владельца, браузер на сервере или Chromium
   в контейнере кликера.

     SHOPEE_BROWSER=container               — Chromium в контейнере (рекомендуется)
     SHOPEE_BROWSER=bridge   (по умолчанию) — ChromeBridge, локальный Chrome
     SHOPEE_BROWSER=remote                  — CDP на удалённом сервере

   container поднимает свой headless-Chromium с профилем на volume, не берёт
   фокус и не зависит от того, разблокирован ли экран мака; гасится сам после
   простоя (см. container-browser.sh). bridge оставлен по умолчанию только
   ради совместимости: он отбирает фокус, а при заблокированном экране записи
   в корзину молча не срабатывают.

   Это единственное место, где делается выбор: добавится четвёртый драйвер —
   правка будет здесь, а не в командах скилла. */
const which = (process.env.SHOPEE_BROWSER || 'bridge').toLowerCase();
const remote = which === 'remote' || which === 'remote-browser';   // remote-browser — старое имя
const container = which === 'container' || which === 'docker';
const mod = require(container ? './container.cjs' : remote ? './remote.cjs' : './bridge.cjs');
module.exports = mod;
module.exports.driverName = container ? 'container' : remote ? 'remote' : 'bridge';
// Свой браузер (сервер или контейнер) не боится фоновой сетки: он либо единственная
// страница контекста, либо headless, где скрытых вкладок нет. Поэтому сетку можно
// читать из отрисованного DOM без отдельного живого режима — он нужен только мосту
// в Chrome владельца. Без этого container-драйвер упирался в searchLive и падал на
// «no cards rendered».
module.exports.domSafe = !!mod.domIsVisible;
