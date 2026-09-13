// Read the rendered ratings section as plain text (the JSON endpoint is anti-bot gated
// even inside the real browser, so the DOM is the only source).
(function () {
  const t = document.body.innerText;
  const i = t.search(/Product Ratings|Đánh Giá Sản Phẩm/i);
  if (i < 0) return JSON.stringify({ found: false });
  return JSON.stringify({ found: true, text: t.slice(i, i + 9000) });
})()
