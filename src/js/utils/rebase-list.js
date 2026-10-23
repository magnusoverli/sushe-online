const equal = (left, right) =>
  JSON.stringify(left ?? '') === JSON.stringify(right ?? '');
const ignored = new Set(['_id', 'album_id', 'position', 'points', 'rank']);

function conflict() {
  return Object.assign(
    new Error(
      'This list changed elsewhere. Your edits are kept; review the conflicting item before retrying.'
    ),
    { code: 'LIST_CONFLICT' }
  );
}

function changedFields(base, item) {
  return Object.keys(item).filter(
    (key) => !ignored.has(key) && !equal(base[key], item[key])
  );
}

// Reapply only the user's changes, preserving unrelated acknowledged writes.
export function rebaseListChanges(snapshot, desired, remote) {
  if (!snapshot?.records) throw conflict();
  const base = new Map(
    snapshot.map((id) => [id, JSON.parse(snapshot.records[id])])
  );
  const local = new Map(desired.map((item) => [item.album_id, item]));
  const current = new Map(remote.map((item) => [item.album_id, item]));
  const merged = new Map(current);
  for (const [id, original] of base) {
    const item = local.get(id);
    const latest = current.get(id);
    if (!item) {
      if (latest && changedFields(original, latest).length) throw conflict();
      merged.delete(id);
      continue;
    }
    const fields = changedFields(original, item);
    if (!latest) {
      if (fields.length) throw conflict();
      continue;
    }
    const next = { ...latest };
    for (const field of fields) {
      if (
        !equal(latest[field], original[field]) &&
        !equal(latest[field], item[field])
      )
        throw conflict();
      next[field] = item[field];
    }
    merged.set(id, next);
  }
  for (const [id, item] of local) {
    if (!base.has(id) && !current.has(id)) merged.set(id, item);
  }
  const common = (items) =>
    items.filter((id) => base.has(id) && local.has(id) && current.has(id));
  const baseOrder = common([...base.keys()]);
  const localOrder = common([...local.keys()]);
  const remoteOrder = common([...current.keys()]);
  const reordered = !equal(localOrder, baseOrder);
  if (
    reordered &&
    !equal(remoteOrder, baseOrder) &&
    !equal(localOrder, remoteOrder)
  )
    throw conflict();
  const order = reordered
    ? [...local.keys(), ...current.keys()]
    : [...current.keys()];
  // Insert local additions relative to their next known item.
  for (let index = desired.length - 1; index >= 0; index--) {
    const id = desired[index].album_id;
    if (order.includes(id)) continue;
    const next = order.indexOf(desired[index + 1]?.album_id);
    order.splice(next < 0 ? order.length : next, 0, id);
  }
  return [...new Set(order)]
    .filter((id) => merged.has(id))
    .map((id) => merged.get(id));
}
