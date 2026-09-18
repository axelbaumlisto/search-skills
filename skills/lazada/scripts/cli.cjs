/** CLI поверх lazada.cjs. Разбор аргументов и печать — здесь; логика запросов там. */
const { orders, filter, search, CUR, TABS } = require('./lazada.cjs');

function args(argv) {
  const o = { cmd: argv[0] || 'orders', query: null, pages: 10, pageSize: 100, tab: 'ALL', json: false, sort: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--query' || a === '-q') o.query = argv[++i];
    else if (a === '--pages') o.pages = Number(argv[++i]);
    else if (a === '--page-size') o.pageSize = Number(argv[++i]);
    else if (a === '--tab') o.tab = String(argv[++i]).toUpperCase();
    else if (a === '--json') o.json = true;
    else if (a === '--sort') o.sort = argv[++i];   // priceasc | pricedesc | pop
    else if (!o.query) o.query = a;
  }
  return o;
}

function table(items) {
  const w = (s, n) => {
    const t = String(s ?? '—');
    return t.length > n ? t.slice(0, n - 1) + '…' : t.padEnd(n);
  };
  for (const it of items) {
    console.log(`${w(it.shop, 20)} ${w(it.status, 10)} ${String(it.price ?? '—').padStart(10)} x${String(it.qty ?? 1).padEnd(2)} ${w(it.title, 56)}`);
    if (it.variation) console.log(`${' '.repeat(20)} └ ${it.variation}`);
  }
}

(async () => {
  const o = args(process.argv.slice(2));
  const quiet = o.json;
  if (o.cmd === 'search') {
    const items = await search(o.query, { limit: o.pageSize > 40 ? 40 : o.pageSize, sort: o.sort });
    if (o.json) { console.log(JSON.stringify({ query: o.query, returned: items.length, items }, null, 2)); return; }
    console.log(`поиск «${o.query}»: ${items.length} позиций\n`);
    for (const i of items) {
      const nit = i.nit ? `${i.nit}нит` : '—';
      console.log(`  ${(i.priceText || '—').padStart(9)} ${String(i.sold).padStart(5)}прод ${String(i.reviews).padStart(4)}отз`
        + ` ${String(i.inch ?? '—').padStart(5)}" ${String(i.res ?? '—').padStart(5)} ${nit.padStart(7)}`
        + ` ${i.touch ? 'сенсор' : '  —   '}  ${i.name.slice(0, 44)}`);
      console.log(`${' '.repeat(12)}${i.url}`);
    }
    return;
  }
  if (o.cmd !== 'orders') {
    console.error(`команда «${o.cmd}» не поддержана; есть: orders, search`);
    process.exit(2);
  }
  const all = await orders({ pages: o.pages, pageSize: o.pageSize, tab: o.tab,
    onPage: quiet ? null : (p, added, total) =>
      process.stderr.write(`  страница ${p}: +${added}, всего ${total}\r`) });
  if (!quiet) process.stderr.write(' '.repeat(50) + '\r');
  const hits = filter(all, o.query);

  if (o.json) {
    console.log(JSON.stringify({ tab: o.tab, query: o.query, total: all.length,
      matched: hits.length, notes: all.notes || [], items: hits }, null, 2));
    return;
  }
  console.log(`вкладка ${o.tab}: позиций ${all.length}` + (o.query ? `, подходящих ${hits.length} по «${o.query}»` : '') + `, цены в ${CUR}\n`);
  table(hits);
  if (!hits.length) console.log('  ничего не нашлось');
  for (const n of all.notes || []) console.log(`\nзамечание: ${n}`);
})().catch((e) => {
  console.error('ошибка:', String(e.message || e).slice(0, 200));
  process.exit(1);
});
