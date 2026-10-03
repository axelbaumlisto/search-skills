
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
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').trim() === label);
  if (!b) return 'missing';
  if (!/unselected/.test(b.className)) return 'already';
  const res = realClick(b); return res;
})()
