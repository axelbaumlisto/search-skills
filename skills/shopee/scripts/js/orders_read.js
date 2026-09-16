// Purchase history as plain text + the order-detail links. Headless gets an empty list
// (same risk gate as the cart), so this runs in the live Chrome and Node does the parsing.
(function () {
  const t = document.body.innerText.replace(/\n+/g, ' | ');
  const i = t.indexOf('Tab Content');
  const links = [...document.querySelectorAll('a[href*="/user/purchase/order/"]')]
    .map((a) => (a.getAttribute('href').match(/order\/(\d+)/) || [])[1])
    .filter(Boolean);
  return JSON.stringify({
    text: i > -1 ? t.slice(i, i + 20000) : t.slice(0, 20000),
    order_ids: [...new Set(links)],
  });
})()
