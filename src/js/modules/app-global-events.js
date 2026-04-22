/**
 * App-level global event wiring.
 */
export function registerAppGlobalEvents(deps = {}) {
  const {
    doc = typeof document !== 'undefined' ? document : null,
    hideAllContextMenus,
  } = deps;

  if (!doc || typeof hideAllContextMenus !== 'function') {
    return;
  }

  doc.addEventListener('click', hideAllContextMenus);

  doc.addEventListener('contextmenu', hideAllContextMenus);

  doc.addEventListener('contextmenu', (event) => {
    const listButton = event.target?.closest?.('[data-list-name]');
    if (listButton) {
      event.preventDefault();
    }
  });
}
