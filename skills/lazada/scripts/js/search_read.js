/** Чтение выдачи каталога Лазады. Карточки помечены data-qa-locator=product-item
 *  и отрисованы все сразу — виртуализации, как в тайском Шопи, тут нет.
 *  Разбор текста оставляем ноде: регулярки проще править и проверять там. */
(function () {
  const out = [];
  document.querySelectorAll('[data-qa-locator=product-item]').forEach((el) => {
    const a = el.querySelector('a[href*="/products/"]');
    const href = a ? a.getAttribute('href') : null;
    if (!href) return;
    const id = (href.match(/i(\d+)-s(\d+)/) || [])[0] || href.slice(-40);
    const img = el.querySelector('img');
    out.push({
      id,
      url: href.startsWith('//') ? 'https:' + href : href,
      text: (el.innerText || '').replace(/\s*\n\s*/g, ' ~ ').trim(),
      image: img ? img.getAttribute('src') : null,
    });
  });
  return JSON.stringify(out);
})()
