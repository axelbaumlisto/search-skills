// Prepended to every snippet by bridge.cjs. Anything shared between page scripts
// lives here — the cart row finder was copy-pasted into three files before.
function upToRow(el) {
  let n = el;
  for (let i = 0; i < 12 && n; i++) {
    const t = n.innerText || '';
    if (/Variations:/.test(t) && /₫/.test(t)) return n;
    n = n.parentElement;
  }
  return null;
}
/** Cart rows in DOM order; Shopee re-renders after every change, so never cache indices. */
function cartRows() {
  const seen = new Set(); const rows = [];
  for (const b of document.querySelectorAll('button[aria-label="Increase"]')) {
    const r = upToRow(b);
    if (!r || seen.has(r)) continue;
    seen.add(r); rows.push(r);
  }
  return rows;
}
