const unsavedLists = new Map();
const protectedWindows = new WeakSet();

export function markListUnsaved(listId, unsaved, owner = 'save') {
  if (!listId) return;
  if (unsaved) {
    if (!unsavedLists.has(listId)) unsavedLists.set(listId, new Set());
    unsavedLists.get(listId).add(owner);
  } else {
    unsavedLists.get(listId)?.delete(owner);
    if (!unsavedLists.get(listId)?.size) unsavedLists.delete(listId);
  }
}

export function hasUnsavedLists() {
  return unsavedLists.size > 0;
}

export function isListUnsaved(listId, includeDrafts = false) {
  return [...(unsavedLists.get(listId) || [])].some(
    (owner) => includeDrafts || !owner?.draft
  );
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
