export function getAlbumId(album) {
  return (
    album._id || `${album.artist}::${album.album}::${album.release_date || ''}`
  );
}

export function getAlbumIdFromFingerprint(fp) {
  const pipeIdx = fp.indexOf('|');
  const id = pipeIdx >= 0 ? fp.substring(0, pipeIdx) : fp;
  if (id) return id;

  const parts = fp.split('|');
  return `${parts[1] || ''}::${parts[2] || ''}::${parts[3] || ''}`;
}

export function findSingleAddition(oldFingerprints, newAlbums) {
  if (newAlbums.length !== oldFingerprints.length + 1) return null;

  const oldIds = new Set(oldFingerprints.map(getAlbumIdFromFingerprint));

  for (let i = 0; i < newAlbums.length; i++) {
    const newId = getAlbumId(newAlbums[i]);
    if (!oldIds.has(newId)) {
      const beforeMatch = newAlbums
        .slice(0, i)
        .every(
          (a, idx) =>
            getAlbumId(a) === getAlbumIdFromFingerprint(oldFingerprints[idx])
        );
      const afterMatch = newAlbums
        .slice(i + 1)
        .every(
          (a, idx) =>
            getAlbumId(a) ===
            getAlbumIdFromFingerprint(oldFingerprints[i + idx])
        );

      if (beforeMatch && afterMatch) {
        return { album: newAlbums[i], index: i };
      }
    }
  }

  return null;
}

export function findSingleRemoval(oldFingerprints, newAlbums) {
  if (newAlbums.length !== oldFingerprints.length - 1) return -1;

  const newIds = new Set(newAlbums.map(getAlbumId));

  for (let i = 0; i < oldFingerprints.length; i++) {
    const oldId = getAlbumIdFromFingerprint(oldFingerprints[i]);
    if (!newIds.has(oldId)) {
      const beforeMatch = newAlbums
        .slice(0, i)
        .every(
          (a, idx) =>
            getAlbumId(a) === getAlbumIdFromFingerprint(oldFingerprints[idx])
        );
      const afterMatch = newAlbums
        .slice(i)
        .every(
          (a, idx) =>
            getAlbumId(a) ===
            getAlbumIdFromFingerprint(oldFingerprints[i + 1 + idx])
        );

      if (beforeMatch && afterMatch) {
        return i;
      }
    }
  }

  return -1;
}

export function detectUpdateType(
  oldFingerprints,
  newAlbums,
  { incrementalEnabled = true } = {}
) {
  if (!incrementalEnabled || !oldFingerprints) {
    return 'FULL_REBUILD';
  }

  if (newAlbums.length === oldFingerprints.length + 1) {
    const addition = findSingleAddition(oldFingerprints, newAlbums);
    if (addition) {
      return {
        type: 'SINGLE_ADD',
        album: addition.album,
        index: addition.index,
      };
    }
  }

  if (newAlbums.length === oldFingerprints.length - 1) {
    const removalIndex = findSingleRemoval(oldFingerprints, newAlbums);
    if (removalIndex !== -1) {
      return { type: 'SINGLE_REMOVE', index: removalIndex };
    }
  }

  if (oldFingerprints.length !== newAlbums.length) {
    return 'FULL_REBUILD';
  }

  let positionChanges = 0;
  let fieldChanges = 0;

  for (let i = 0; i < newAlbums.length; i++) {
    const oldId = getAlbumIdFromFingerprint(oldFingerprints[i]);
    const newId = getAlbumId(newAlbums[i]);

    if (oldId !== newId) {
      positionChanges++;
    } else {
      const newAlbum = newAlbums[i];
      const newFp = `${newAlbum._id || ''}|${newAlbum.artist || ''}|${newAlbum.album || ''}|${newAlbum.release_date || ''}|${newAlbum.country || ''}|${newAlbum.genre_1 || ''}|${newAlbum.genre_2 || ''}|${newAlbum.comments || ''}|${newAlbum.comments_2 || ''}|${newAlbum.primary_track || ''}`;
      if (oldFingerprints[i] !== newFp) {
        fieldChanges++;
      }
    }
  }

  if (positionChanges === 0 && fieldChanges > 0 && fieldChanges <= 10) {
    return 'FIELD_UPDATE';
  }
  if (fieldChanges === 0 && positionChanges > 0) {
    return 'POSITION_UPDATE';
  }
  if (positionChanges + fieldChanges <= 15) {
    return 'HYBRID_UPDATE';
  }

  return 'FULL_REBUILD';
}
