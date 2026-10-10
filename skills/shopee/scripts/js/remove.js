// Click Delete on row __IDX__ (confirmation is handled by a follow-up call).
(function () {
  __CART_ROWS__
  const row = cartRows()[__IDX__]; if (!row) return 'no-row';
  const del = [...row.querySelectorAll('button')].find((x) => /^(delete|xóa)$/i.test((x.innerText || '').trim()));
  if (!del) return 'no-delete'; del.click(); return 'delete-clicked';
})()
