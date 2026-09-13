// Click Increase/Decrease once on row __IDX__ (__DIR__ = Increase | Decrease).
// NB: a bare el.click() does nothing on the cart quantity widget — it listens for the
// press sequence, so dispatch pointerdown/mousedown/mouseup/click explicitly.
(function () {
  const ups = (el) => { let n = el; for (let i = 0; i < 12 && n; i++) { if (/Variations:/.test(n.innerText || '') && /₫/.test(n.innerText || '')) return n; n = n.parentElement; } return null; };
  const seen = new Set(); const rows = [];
  for (const b of document.querySelectorAll('button[aria-label="Increase"]')) { const r = ups(b); if (!r || seen.has(r)) continue; seen.add(r); rows.push(r); }
  const row = rows[__IDX__]; if (!row) return 'no-row';
  const btn = row.querySelector('button[aria-label="__DIR__"]'); if (!btn) return 'no-button';
  const r = btn.getBoundingClientRect();
  const opt = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, buttons: 1 };
  btn.dispatchEvent(new PointerEvent('pointerover', opt));
  btn.dispatchEvent(new PointerEvent('pointerdown', opt));
  btn.dispatchEvent(new MouseEvent('mousedown', opt));
  btn.dispatchEvent(new PointerEvent('pointerup', opt));
  btn.dispatchEvent(new MouseEvent('mouseup', opt));
  btn.dispatchEvent(new MouseEvent('click', opt));
  return 'step';
})()
