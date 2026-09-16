// Confirm the delete modal ONLY. Never match row-level "Delete" buttons: a loose
// text match here once wiped a second cart row.
(function () {
  const modal = [...document.querySelectorAll('[role="dialog"], .shopee-popup__container, .shopee-modal__container, .shopee-popup')]
    .filter((m) => m.offsetParent !== null && /delete|xóa|remove/i.test(m.innerText || '')).pop();
  if (!modal) return 'no-modal';
  const b = [...modal.querySelectorAll('button')].find((x) => /^(yes|confirm|delete|xóa|đồng ý|ok)$/i.test((x.innerText || '').trim()));
  if (!b) return 'no-confirm-button';
  b.click(); return 'confirmed';
})()
