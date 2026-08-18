function compareVersions(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeVersion(version) {
  const normalized = String(version ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : null;
}

export function createRealtimeAlbumPatches(options = {}) {
  const maxAlbums = options.maxAlbums || 200;
  const rememberedAlbums = new Map();
  let generation = 0;

  function remember(albumId, patch, eventVersion = null) {
    const normalizedVersion = normalizeVersion(eventVersion);
    const remembered = rememberedAlbums.get(albumId) || {};
    const accepted = {};

    for (const [field, value] of Object.entries(patch)) {
      const previousVersion = remembered[field]?.eventVersion;
      if (
        normalizedVersion &&
        previousVersion &&
        compareVersions(normalizedVersion, previousVersion) <= 0
      ) {
        continue;
      }
      accepted[field] = value;
    }
    if (Object.keys(accepted).length === 0) return accepted;

    generation += 1;
    for (const [field, value] of Object.entries(accepted)) {
      remembered[field] = {
        value,
        generation,
        eventVersion:
          normalizedVersion || remembered[field]?.eventVersion || null,
      };
    }
    rememberedAlbums.delete(albumId);
    rememberedAlbums.set(albumId, remembered);
    if (rememberedAlbums.size > maxAlbums) {
      rememberedAlbums.delete(rememberedAlbums.keys().next().value);
    }
    return accepted;
  }

  function applyAfter(albums, refreshGeneration) {
    if (!Array.isArray(albums)) return;
    for (const album of albums) {
      const remembered = rememberedAlbums.get(album?.album_id);
      if (!remembered) continue;
      for (const [field, entry] of Object.entries(remembered)) {
        if (entry.generation > refreshGeneration) album[field] = entry.value;
      }
    }
  }

  return {
    remember,
    applyAfter,
    get generation() {
      return generation;
    },
  };
}
