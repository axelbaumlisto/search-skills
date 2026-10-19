// Why did the add fail? Read the badge again plus any modal/toast Shopee threw up.
// Shopee reports stock limits, variant requirements and login walls in a transient
// layer, so it must be scraped right after the click, not minutes later.
(function () {
  /* Та же трёхъязычная читка бейджа, что и в add_to_cart.js: локаль страницы
     переключается (EN / VI / TH), и один шаблон с числом после слов ловит не всё. */
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
  const texts = [];
  const sel = [
    '[class*="shopee-popup"]', '[class*="toast"]', '[class*="modal"]',
    '[role="dialog"]', '[class*="error"]', '[class*="notice"]',
  ];
  for (const s of sel) {
    for (const el of document.querySelectorAll(s)) {
      const t = (el.innerText || '').trim();
      if (t && t.length < 300 && !texts.includes(t)) texts.push(t);
    }
  }
  const body = document.body.innerText || '';
  const stock = (body.match(/(\d+)\s*items? left/i) || [])[0] || null;
  const soldOut = /out of stock|hết hàng|sold out/i.test(body) || null;
  /* Успех распознаётся по собственному тосту Shopee. Это единственный сигнал,
     когда бейдж корзины не читается вовсе: без него вызывающий код считал
     добавление неудачным и повторял его. */
  const addedToast = /đã thêm vào giỏ hàng|added to cart|เพิ่มลงในตะกร้าแล้ว/i.test(
    [...texts, body.slice(0, 4000)].join(' '),
  );
  return JSON.stringify({ after: badge(), messages: texts.slice(0, 4), stock, soldOut, addedToast });
})()
