/** Read a product page from the rendered DOM (live Chrome).
 *  Needed where the pdp XHR is refused to automated browsers (Shopee TH). */
(function () {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const T = document.body.innerText;
  const title = document.title.replace(/\s*\|\s*Shopee.*$/i, '').trim();

  // variant tiers: a <section> holding buttons whose class carries "selection-box";
  // its first text line is the tier name (Thai/Vietnamese/English alike)
  const tiers = [];
  const seenTier = new Set();
  document.querySelectorAll('section').forEach((sec) => {
    // outer sections wrap the inner one and would report the same options twice
    if (sec.querySelector('section')) return;
    const opts = [...sec.querySelectorAll('button')].filter((b) => /selection-box/.test(b.className));
    if (!opts.length) return;
    const options = opts.map((b) => ({
      name: clean(b.getAttribute('aria-label') || b.innerText),
      sold_out: b.getAttribute('aria-disabled') === 'true' || /disabled/.test(b.className),
    }));
    const key = options.map((o) => o.name).join('|');
    if (seenTier.has(key)) return;
    seenTier.add(key);
    tiers.push({ name: clean((sec.innerText || '').split('\n')[0]), options });
  });

  // the header block between the rating line and Shipping carries price + vouchers
  const head = (T.split(/\bRatings\b/)[1] || T).split(/\bShipping\b/)[0] || '';
  const pick = (re, s) => { const m = (s || T).match(re); return m ? m[1] : null; };

  return JSON.stringify({
    title,
    price_text: pick(/([฿₫]\s?[\d.,]+(?:\s*-\s*[฿₫]?\s?[\d.,]+)?)/, head),
    price_block: clean(head).slice(0, 300),
    rating: pick(/\n(\d\.\d)\n[\d.,]+k?\+?\nRatings/),
    sold: pick(/([\d.,]+k?\+?)\s*Sold\b/i),
    stock: pick(/([\d,]+)\s*pieces? available/i),
    tiers,
    description: clean((document.querySelector('[class*="product-detail"], section:last-of-type') || {}).innerText || '').slice(0, 4000),
  });
})()
