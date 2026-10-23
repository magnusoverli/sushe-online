const revisions = new Map();
const itemLists = new Map();
export function rememberListRevision(id, revision) {
  if (!id || revision === undefined || revision === null) return;
  const previous = revisions.get(id);
  // Revisions are PostgreSQL bigint strings. A delayed response must not move
  // the write precondition backwards.
  if (
    previous &&
    /^\d+$/.test(previous) &&
    /^\d+$/.test(String(revision)) &&
    BigInt(revision) < BigInt(previous)
  )
    return;
  revisions.set(id, String(revision));
}
export function getListRevision(id) {
  return revisions.get(id);
}

export function rememberListItems(listId, items) {
  for (const item of items || []) {
    if (item?._id) itemLists.set(item._id, listId);
  }
}

export function getItemListId(itemId) {
  return itemLists.get(itemId);
}
