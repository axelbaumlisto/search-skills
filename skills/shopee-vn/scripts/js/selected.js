(function () {
  return JSON.stringify([...document.querySelectorAll('button')]
    .filter((b) => /selection-box/.test(b.className) && !/unselected/.test(b.className))
    .map((b) => b.getAttribute('aria-label')));
})()
