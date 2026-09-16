// Type into the My Purchases search box. The ?keyword= URL param is ignored — the field is
// a controlled React input, so plain `inp.value = q` is reverted on the next render.
// The native value setter + a bubbling `input` event is what React's onChange listens to.
(function () {
  const q = __Q__;
  const inp = document.querySelector(
    'input[placeholder*="Seller Name"], input[placeholder*="Order ID"], input[placeholder*="ค้นหา"]',
  );
  if (!inp) return 'no-input';
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  inp.focus();
  set.call(inp, q);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  ['keydown', 'keypress', 'keyup'].forEach((t) => inp.dispatchEvent(
    new KeyboardEvent(t, { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }),
  ));
  return 'typed:' + inp.value;
})()
