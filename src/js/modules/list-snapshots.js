/** Snapshot creation and browser persistence for conflict-aware list writes. */
export function createListSnapshot(albums) {
  if (!albums || !Array.isArray(albums)) return [];
  const snapshot = albums.map((a) => a.album_id || null).filter(Boolean);
  Object.defineProperty(snapshot, 'records', {
    value: Object.fromEntries(
      albums
        .filter((a) => a.album_id)
        .map((album) => {
          const fields = Object.fromEntries(
            Object.entries(album)
              .filter(([key]) => !['points', 'rank', 'position'].includes(key))
              .sort(([left], [right]) => left.localeCompare(right))
          );
          return [album.album_id, JSON.stringify(fields)];
        })
    ),
  });
  return snapshot;
}

export function saveSnapshotToStorage(listId, snapshot) {
  if (!listId || !snapshot) return;
  try {
    localStorage.setItem(
      `list-snapshot-${listId}`,
      JSON.stringify(
        snapshot.records
          ? { ids: [...snapshot], records: snapshot.records }
          : [...snapshot]
      )
    );
  } catch (error) {
    console.warn('Failed to save snapshot to localStorage:', error.message);
  }
}

export function loadSnapshotFromStorage(listId) {
  if (!listId) return null;
  try {
    const stored = localStorage.getItem(`list-snapshot-${listId}`);
    if (stored) {
      const snapshot = JSON.parse(stored);
      if (Array.isArray(snapshot)) return snapshot;
      if (
        Array.isArray(snapshot?.ids) &&
        snapshot.records &&
        typeof snapshot.records === 'object'
      ) {
        Object.defineProperty(snapshot.ids, 'records', {
          value: snapshot.records,
        });
        return snapshot.ids;
      }
    }
  } catch (error) {
    console.warn('Failed to load snapshot from localStorage:', error.message);
  }
  return null;
}

export function clearSnapshotFromStorage(listId) {
  if (!listId) return;
  try {
    localStorage.removeItem(`list-snapshot-${listId}`);
  } catch (_error) {
    // Storage may be unavailable or disabled.
  }
}
