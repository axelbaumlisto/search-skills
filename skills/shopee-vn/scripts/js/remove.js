// Click Delete on row __IDX__ (the confirmation modal is a follow-up call).
// Indices shift after every delete — Shopee re-renders the list, so re-read rows each time.
(function () {
  const row = cartRows()[__IDX__]; if (!row) return 'no-row';
  const del = [...row.querySelectorAll('button')].find((x) => /^(delete|xóa)$/i.test((x.innerText || '').trim()));
  if (!del) return 'no-delete'; del.click(); return 'delete-clicked';
})()
