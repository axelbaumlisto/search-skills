/** Дамп узлов, похожих на варианты, — чтобы понять, как карточка рисует выбор.
 *  Возвращает tag/class/aria/text/selected для первых 40 кандидатов.
 */
(function () {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const nodes = [...document.querySelectorAll('button, div[role="button"], div[class*="selection-box"], div[class*="variation"] > div, div[class*="product-variation"] > div')];
  const rows = nodes.map((n) => ({
    tag: n.tagName,
    cls: clean(String(n.className)).slice(0, 32),
    aria: clean(n.getAttribute('aria-label')),
    txt: clean(n.innerText || n.textContent),
    unsel: /unselected/.test(String(n.className)),
  })).filter((r) => r.aria || r.txt);
  return JSON.stringify({ total: nodes.length, rows: rows.slice(0, 40) });
})()
