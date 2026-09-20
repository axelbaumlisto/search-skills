/** Читалка корзины Лазады: DOM → JSON.
 *
 *  Разметка корзины — Next-UI: каждая позиция это .cart-item, внутри
 *  .title (ссылка на товар), .sub-title (вариант), p.current-price,
 *  .quantity с парой стрелок, и span.automation-btn-delete.
 *
 *  Две грабли, найденные на живой корзине:
 *  1) Магазин — это заголовок группы .checkout-shop-outer, а не первый
 *     .shop-title на странице: иначе все позиции получают один магазин.
 *  2) Количество в input не лежит — первый input в строке это галка
 *     выбора со значением "on". Число берём из .next-number-picker.
 */
(function () {
  function txt(el) { return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null; }

  var items = [];
  document.querySelectorAll('.cart-item').forEach(function (row, idx) {
    var title = row.querySelector('a[class*=link-from-title]');
    if (!title) return;
    var group = row.closest('.checkout-shop-outer, [class*=shop-outer]');
    var shop = group ? txt(group.querySelector('[class*=shop-title]')) : null;
    var picker = row.querySelector('.next-number-picker input, [class*=number-picker] input');
    var href = title.getAttribute('href') || '';
    items.push({
      index: idx + 1,
      shop: shop,
      title: txt(title),
      variant: txt(row.querySelector('a[class*=link-from-sub-title]')),
      priceText: txt(row.querySelector('p[class*=current-price]')),
      qty: picker ? Number(picker.value) || 1 : Number(txt(row.querySelector('[class*=number-picker]'))) || 1,
      checked: !!row.querySelector('input[type=checkbox]:checked'),
      url: href ? href.replace(/^\/\//, 'https://').replace(/([^:])\/\//g, '$1/') : null,
    });
  });

  var body = document.body.innerText;
  var total = (body.match(/Total\s*฿\s*([\d.,]+)/i) || [])[1] || null;
  var count = (body.match(/\((\d+)\s*ITEM/i) || [])[1] || String(items.length);

  return JSON.stringify({ items: items, total: total, count: Number(count) });
})();
