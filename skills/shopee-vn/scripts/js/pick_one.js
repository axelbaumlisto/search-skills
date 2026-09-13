// Select one variant option by aria-label, idempotently. React re-renders between clicks,
// so each option must be picked in its own call and verified afterwards.
(function () {
  const label = __LABEL__;
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === label);
  if (!b) return 'missing';
  if (!/unselected/.test(b.className)) return 'already';
  b.click(); return 'clicked';
})()
