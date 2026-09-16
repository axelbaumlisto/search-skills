/** Read the rendered search-results grid. Used where the risk engine refuses the
 *  search XHR to a headless browser (Shopee TH) — the live Chrome renders it fine.
 *  Returns raw card text; the CLI does the parsing so the regexes stay testable. */
(function () {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('a[href*="-i."]').forEach((a) => {
    const m = (a.getAttribute('href') || '').match(/-i\.(\d+)\.(\d+)/);
    if (!m || seen.has(m[0])) return;
    const t = (a.innerText || '').replace(/\s*\n\s*/g, ' ~ ').trim();
    if (t.length < 8) return;
    seen.add(m[0]);
    const img = a.querySelector('img');
    // organic results sit in a data-sqe="item" container; the promo strip above them does not
    const box = a.closest('[data-sqe]');
    out.push({ shopid: m[1], itemid: m[2], t, img: img ? img.src : null, organic: !!box && box.getAttribute('data-sqe') === 'item' });
  });
  return JSON.stringify(out);
})()
