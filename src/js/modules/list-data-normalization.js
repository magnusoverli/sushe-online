export function normalizeAlbumRecord(album) {
  if (!album || typeof album !== 'object') {
    return { album, changed: false };
  }

  return { album, changed: false };
}

export function normalizeAlbumRecords(albums = []) {
  if (!Array.isArray(albums)) {
    return [];
  }

  return albums;
}

export function createDefaultListEntry(listId, albums = []) {
  const data = normalizeAlbumRecords(albums);

  return {
    _id: listId,
    name: 'Unknown',
    year: null,
    isMain: false,
    count: data.length,
    _data: data,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

export function normalizeListsMap(newLists = {}) {
  const normalized = {};

  Object.keys(newLists).forEach((listId) => {
    const entry = newLists[listId];

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return;
    }

    if (Array.isArray(entry._data)) {
      const normalizedData = normalizeAlbumRecords(entry._data);
      normalized[listId] =
        normalizedData === entry._data
          ? entry
          : {
              ...entry,
              _data: normalizedData,
            };
      return;
    }

    normalized[listId] = entry;
  });

  return normalized;
}
