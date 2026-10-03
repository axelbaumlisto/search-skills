// Click "Add To Cart" and report what the page actually did.
// The old version clicked and returned 'added' unconditionally, so an out-of-stock
// item or a blocking modal was reported as success. Now the badge is read before the
// click and handed back, so the caller can verify the cart really grew.
(function () {
  const badge = () => {
    const m = (document.body.innerText || '').match(/items? in cart\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  };
  const b = [...document.querySelectorAll('button')]
    .find((x) => /add to cart|thêm vào giỏ/i.test(x.innerText || ''));
  if (!b) return JSON.stringify({ ok: false, reason: 'no-button' });
  if (b.disabled || b.getAttribute('aria-disabled') === 'true') {
    return JSON.stringify({ ok: false, reason: 'button-disabled', before: badge() });
  }
  const before = badge();
  b.click();
  return JSON.stringify({ ok: true, clicked: true, before });
})()
