(function () {
  const b = [...document.querySelectorAll('button')].find((x) => /add to cart|thêm vào giỏ/i.test(x.innerText || ''));
  if (!b) return 'no-button'; b.click(); return 'added';
})()
