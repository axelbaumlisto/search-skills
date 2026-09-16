// Click the "__STARS__ Star" filter tab in the ratings section.
(function () {
  const want = new RegExp('^' + __STARS__ + '\\s*(Star|Sao)', 'i');
  const el = [...document.querySelectorAll('div,button,span')]
    .filter((x) => want.test((x.innerText || '').trim()) && (x.innerText || '').length < 24)
    .pop();
  if (!el) return 'no-tab';
  el.click(); return 'tab-clicked';
})()
