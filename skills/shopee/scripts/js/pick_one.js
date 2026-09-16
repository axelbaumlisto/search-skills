// Select one variant option by aria-label, idempotently. React re-renders between clicks,
// so each option must be picked in its own call and verified afterwards.
(function () {
  // TH option labels carry a trailing space in aria-label, so compare trimmed
  const label = String(__LABEL__).trim();
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').trim() === label);
  if (!b) return 'missing';
  if (!/unselected/.test(b.className)) return 'already';
  b.click(); return 'clicked';
})()
