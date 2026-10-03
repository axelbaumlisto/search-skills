// Why did the add fail? Read the badge again plus any modal/toast Shopee threw up.
// Shopee reports stock limits, variant requirements and login walls in a transient
// layer, so it must be scraped right after the click, not minutes later.
(function () {
  const badge = () => {
    const m = (document.body.innerText || '').match(/items? in cart\s*(\d+)/i);
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
  return JSON.stringify({ after: badge(), messages: texts.slice(0, 4), stock, soldOut });
})()
