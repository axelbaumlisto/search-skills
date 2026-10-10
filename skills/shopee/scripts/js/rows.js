// One row per cart item. Anchor on the quantity stepper, then climb to the container
// that holds a price. The old version also demanded a "Variations:" line, so any item
// without options (a monitor, a single-SKU gadget) silently vanished from the listing
// and the cart looked emptier than it was.
(function () {
  __CART_ROWS__
  const money = /[฿₫]/;
  const rows = [];
  for (const r of cartRows()) {
    const t = r.innerText.split('\n').map((x) => x.trim()).filter(Boolean);
    const vi = t.indexOf('Variations:');
    const qtyInput = r.querySelector('input[class*="quantity"], .shopee-input-quantity input');
    const prices = t.filter((x) => money.test(x));
    rows.push({
      i: rows.length,
      name: (t.find((x) => x.length > 25 && !money.test(x)) || '').slice(0, 70),
      variant: vi >= 0 ? t[vi + 1] || null : null,
      price: prices[0] || null,
      total: prices[prices.length - 1] || null,
      qty: qtyInput ? qtyInput.value : null,
    });
  }
  return JSON.stringify(rows);
})()
