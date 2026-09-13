// Click Delete on row __IDX__ (confirmation is handled by a follow-up call).
(function () {
  const ups = (el) => { let n = el; for (let i = 0; i < 12 && n; i++) { if (/Variations:/.test(n.innerText || '') && /₫/.test(n.innerText || '')) return n; n = n.parentElement; } return null; };
  const seen = new Set(); const rows = [];
  for (const b of document.querySelectorAll('button[aria-label="Increase"]')) { const r = ups(b); if (!r || seen.has(r)) continue; seen.add(r); rows.push(r); }
  const row = rows[__IDX__]; if (!row) return 'no-row';
  const del = [...row.querySelectorAll('button')].find((x) => /^(delete|xóa)$/i.test((x.innerText || '').trim()));
  if (!del) return 'no-delete'; del.click(); return 'delete-clicked';
})()
