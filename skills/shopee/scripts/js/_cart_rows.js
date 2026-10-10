// Общий поиск строк корзины — вставляется в rows/remove/step_qty вместо __CART_ROWS__.
// Якорь — кнопка «Increase»; поднимаемся до блока с ценой. Строку «Variations:» не
// требуем: у товаров без вариантов её нет, и такие строки пропадали (rm → no-row).
function cartRows() {
  const money = /[฿₫]/;
  const ups = (el) => {
    let n = el;
    for (let i = 0; i < 12 && n; i++) {
      const t = n.innerText || '';
      if (money.test(t) && t.length > 40) return n;
      n = n.parentElement;
    }
    return null;
  };
  const seen = new Set();
  const rows = [];
  for (const b of document.querySelectorAll('button[aria-label="Increase"]')) {
    const r = ups(b);
    if (!r || seen.has(r)) continue;
    seen.add(r);
    rows.push(r);
  }
  return rows;
}
