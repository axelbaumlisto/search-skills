// One row per cart item. Row discovery lives in _prelude.js (cartRows).
(function () {
  return JSON.stringify(cartRows().map((r, i) => {
    const t = r.innerText.split('\n').map((x) => x.trim()).filter(Boolean);
    const qtyInput = r.querySelector('input[class*="quantity"], .shopee-input-quantity input');
    const prices = t.filter((x) => /₫/.test(x));
    return {
      i,
      name: (t.find((x) => x.length > 25) || '').slice(0, 70),
      variant: t[t.indexOf('Variations:') + 1] || null,
      price: prices[0] || null,
      total: prices[prices.length - 1] || null,
      qty: qtyInput ? qtyInput.value : null,
    };
  }));
})()
