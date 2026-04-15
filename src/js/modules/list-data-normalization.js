export function normalizeAlbumRecord(album) {
  if (!album || typeof album !== 'object') {
    return { album, changed: false };
  }

  let changed = false;
  const normalized = { ...album };

  if (!normalized.album_id && normalized.albumId) {
    normalized.album_id = normalized.albumId;
    changed = true;
  }

  if (normalized.comments == null && normalized.comment != null) {
    normalized.comments = normalized.comment;
    changed = true;
  }

  if (!normalized.genre_1 && normalized.genre) {
    normalized.genre_1 = normalized.genre;
    changed = true;
  }

  const legacyPrimary =
    normalized.track_picks?.primary || normalized.track_pick || null;
  if (!normalized.primary_track && legacyPrimary) {
    normalized.primary_track = legacyPrimary;
    changed = true;
  }

  const legacySecondary = normalized.track_picks?.secondary || null;
  if (!normalized.secondary_track && legacySecondary) {
    normalized.secondary_track = legacySecondary;
    changed = true;
  }

  return { album: changed ? normalized : album, changed };
}

export function normalizeAlbumRecords(albums = []) {
  if (!Array.isArray(albums)) {
    return [];
  }

  let changed = false;
  const normalized = albums.map((album) => {
    const result = normalizeAlbumRecord(album);
    changed = changed || result.changed;
    return result.album;
  });

  return changed ? normalized : albums;
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
