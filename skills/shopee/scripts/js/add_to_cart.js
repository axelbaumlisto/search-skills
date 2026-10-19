
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

// Click "Add To Cart" and report what the page actually did.
// The old version clicked and returned 'added' unconditionally, so an out-of-stock
// item or a blocking modal was reported as success. Now the badge is read before the
// click and handed back, so the caller can verify the cart really grew.
(function () {
  /* Badge читается ТРЕМЯ способами, потому что Shopee отдаёт его по-разному в
     зависимости от локали страницы (EN «items in cart 7», VI «7 sản phẩm trong
     giỏ»). Раньше здесь был только английский шаблон с числом ПОСЛЕ слов: на
     вьетнамской локли он не срабатывал, before/after были null, add докладывал
     «not-added» — и повторные попытки тихо добавляли товар ещё раз (так кабель
     оказался в корзине в количестве 7). */
  const badge = () => {
    const el = document.querySelector('[class*="cart-count"], [class*="cartCount"], [class*="CartBadge"], [data-sqe="cart-count"]');
    const t = el && (el.innerText || '').trim();
    if (t && /^\d+$/.test(t)) return Number(t);
    const body = document.body.innerText || '';
    let m = body.match(/(\d+)\s*(?:items? in cart|sản phẩm trong giỏ|trong giỏ hàng|รายการในตะกร้า)/i);
    if (m) return Number(m[1]);
    m = body.match(/items? in cart\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  // CTA бывает в трёх локалях: VN «Thêm Vào Giỏ Hàng», EN «Add To Cart», TH «เพิ่มลงในตะกร้า».
  const b = [...document.querySelectorAll('button')]
    .find((x) => /^(add to cart|thêm vào giỏ hàng|เพิ่มลงในตะกร้า)$/i.test((x.innerText || '').replace(/\s+/g, ' ').trim()));
  if (!b) return JSON.stringify({ ok: false, reason: 'no-button' });
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') {
    return JSON.stringify({ ok: false, reason: 'button-disabled', before: badge() });
  }
  const before = badge();
  const how = realClick(b);
  return JSON.stringify({ ok: true, clicked: true, how, before });
})()
