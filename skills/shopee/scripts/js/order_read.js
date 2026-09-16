/** Order Detail page as plain text. The layout is section-labelled
 *  ("Order Detail Section", "Payment Method Section"), so the CLI slices on those
 *  markers instead of guessing at the DOM. */
(function () {
  const t = document.body.innerText.replace(/\n{2,}/g, '\n');
  const i = t.indexOf('Order Detail Page');
  const j = t.indexOf('CUSTOMER SERVICE');
  return JSON.stringify({ text: t.slice(i > 0 ? i : 0, j > 0 ? j : t.length) });
})()
