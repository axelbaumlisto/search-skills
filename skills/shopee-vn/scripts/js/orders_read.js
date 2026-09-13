// Purchase history as plain text. Headless gets an empty list (same risk gate as the cart),
// so this runs in the live Chrome and the parsing happens in Node.
(function () {
  const t = document.body.innerText.replace(/\n+/g, ' | ');
  const i = t.indexOf('Tab Content');
  return JSON.stringify({ text: i > -1 ? t.slice(i, i + 20000) : t.slice(0, 20000) });
})()
