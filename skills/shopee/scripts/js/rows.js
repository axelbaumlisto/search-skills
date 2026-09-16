// One row per cart item: climb from each Increase button to the container with the variant + price.
(function () {
  const ups = (el) => { let n = el; for (let i = 0; i < 12 && n; i++) { if (/Variations:/.test(n.innerText || '') && /[฿₫]/.test(n.innerText || '')) return n; n = n.parentElement; } return null; };
  const seen = new Set(); const rows = [];
  for (const b of document.querySelectorAll('button[aria-label="Increase"]')) {
    const r = ups(b); if (!r || seen.has(r)) continue; seen.add(r);
    const t = r.innerText.split('\n').map((x) => x.trim()).filter(Boolean);
    const qtyInput = r.querySelector('input[class*="quantity"], .shopee-input-quantity input');
    rows.push({
      i: rows.length,
      name: (t.find((x) => x.length > 25) || '').slice(0, 70),
      variant: t[t.indexOf('Variations:') + 1] || null,
      price: t.filter((x) => /[฿₫]/.test(x))[0] || null,
      total: t.filter((x) => /[฿₫]/.test(x)).pop() || null,
      qty: qtyInput ? qtyInput.value : null,
    });
  }
  return JSON.stringify(rows);
})()
