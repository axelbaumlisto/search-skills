
/** Реальный клик по элементу для React-интерфейсов Shopee/Lazada.
 *  `el.click()` даёт isTrusted=false, и React игнорирует его: вариант не выбирается,
 *  корзина не растёт. Обход — полный набор событий pointerdown → mousedown →
 *  pointerup → mouseup → click с координатами элемента.
 *  Проверено 03.10.2026: cart checkboxes и CONFIRM CART на cart.lazada.vn.
 */
function realClick(el) {
  if (!el) return 'no-element';
  el.click();
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true,
                 clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
                 pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  return 'clicked-real';
}

// Select one variant option by aria-label, idempotently. React re-renders between clicks,
// so each option must be picked in its own call and verified afterwards.
(function () {
  // TH option labels carry a trailing space in aria-label, so compare trimmed
  const label = String(__LABEL__).trim();
  const all = [...document.querySelectorAll('button, div[role="button"], div[class*="selection-box"], div[class*="variation"] div')];
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // 1) точное совпадение aria-label, 2) aria-label содержит метку, 3) текст кнопки = метка
  let b = all.find((x) => norm(x.getAttribute('aria-label')) === label);
  if (!b) b = all.find((x) => norm(x.getAttribute('aria-label')).endsWith(label));
  if (!b) b = all.find((x) => norm(x.innerText) === label || norm(x.textContent) === label);
  if (!b) b = all.find((x) => norm(x.innerText).startsWith(label) || norm(x.textContent).startsWith(label));
  if (!b) {
    const sample = all.map((x) => norm(x.getAttribute('aria-label')) || norm(x.textContent)).filter(Boolean).slice(0, 25);
    return 'missing:' + JSON.stringify(sample);
  }
  if (/unselected/.test(b.className)) { return realClick(b); }
  return 'already';
})()
