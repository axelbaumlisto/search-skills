// Click Increase/Decrease once on row __IDX__ (__DIR__ = Increase | Decrease).
// NB: a bare el.click() does nothing on the cart quantity widget — it listens for the
// press sequence, so dispatch pointerdown/mousedown/mouseup/click explicitly.
(function () {
  const row = cartRows()[__IDX__]; if (!row) return 'no-row';
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
