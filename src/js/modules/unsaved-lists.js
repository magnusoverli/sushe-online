const unsavedLists = new Set();
const protectedWindows = new WeakSet();

export function markListUnsaved(listId, unsaved) {
  if (unsaved) unsavedLists.add(listId);
  else unsavedLists.delete(listId);
}

export function hasUnsavedLists() {
  return unsavedLists.size > 0;
}

export function protectUnsavedLists(win) {
  if (!win?.addEventListener || protectedWindows.has(win)) return;
  protectedWindows.add(win);
  win.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedLists()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
