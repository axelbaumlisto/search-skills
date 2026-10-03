// Нажать Increase на строке корзины: реальный клик, не синтетический.
(function () {
  const b = document.querySelector('button[aria-label="Increase"]');
  if (!b) return 'no-button';
  b.click();
  const r = b.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true,
                 clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
                 pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
  b.dispatchEvent(new PointerEvent('pointerdown', opts));
  b.dispatchEvent(new MouseEvent('mousedown', opts));
  b.dispatchEvent(new PointerEvent('pointerup', opts));
  b.dispatchEvent(new MouseEvent('mouseup', opts));
  b.dispatchEvent(new MouseEvent('click', opts));
  return 'inc';
})()
