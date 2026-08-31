const { canonicalKey } = require('./historical-list-import-validation');

const CANONICAL_METADATA_FIELDS = [
  'release_date',
  'country',
  'genre_1',
  'genre_2',
];

function applyCanonicalMetadataPolicy(item, canonical, warnings) {
  const enriched = [];
  const ignored = [];
  const protectedFields = [];
  for (const field of CANONICAL_METADATA_FIELDS) {
    if (!item[field]) {
      delete item[field];
    } else if (
      (field === 'genre_1' || field === 'genre_2') &&
      (canonical.album_taxonomy?.rym ||
        canonical.album_taxonomy?.manual_overrides?.[field])
    ) {
      protectedFields.push(field);
      delete item[field];
    } else if (!canonical[field]) {
      enriched.push(field);
    } else {
      ignored.push(field);
      delete item[field];
    }
  }
  const identity = `${canonical.artist} - ${canonical.album}`;
  if (enriched.length > 0) {
    warnings.push(
      `Canonical metadata will be enriched for ${identity}: ${enriched.join(', ')}`
    );
  }
  if (ignored.length > 0) {
    warnings.push(
      `Existing canonical metadata preserved for ${identity}: ${ignored.join(', ')}`
    );
  }
  if (protectedFields.length > 0) {
    warnings.push(
      `Structured canonical taxonomy preserved for ${identity}: ${protectedFields.join(', ')}`
    );
  }
}

function reconcileNewCanonicalAlbums(imports) {
  const pending = new Map();
  for (const entry of imports) {
    for (const item of entry.albums) {
      if (item.album_id) continue;
      const key = canonicalKey(item.artist, item.album);
      const canonical = pending.get(key);
      if (!canonical) {
        pending.set(key, { ...item });
        continue;
      }
      entry.newCanonicalCount--;
      entry.existingCanonicalCount++;
      applyCanonicalMetadataPolicy(item, canonical, entry.warnings);
      for (const field of CANONICAL_METADATA_FIELDS) {
        if (!canonical[field] && item[field]) canonical[field] = item[field];
      }
    }
  }
}

function createHistoricalImportCanonicalResolver(db) {
  async function resolveCanonicalAlbums(albums) {
    if (albums.length === 0) return new Map();
    const artistKeys = [...new Set(albums.map((item) => item.artistKey))];
    const albumKeys = [...new Set(albums.map((item) => item.albumKey))];
    const result = await db.raw(
      `SELECT album_id, artist, album, release_date, country, genre_1, genre_2,
              album_taxonomy
       FROM albums
       WHERE LOWER(TRIM(COALESCE(artist, ''))) = ANY($1::text[])
         AND LOWER(TRIM(COALESCE(album, ''))) = ANY($2::text[])`,
      [artistKeys, albumKeys],
      { name: 'historical-import-resolve-albums', retryable: true }
    );

    const matches = new Map();
    for (const row of result.rows) {
      const key = canonicalKey(row.artist, row.album);
      const rows = matches.get(key) || [];
      rows.push(row);
      matches.set(key, rows);
    }
    return matches;
  }

  async function applyCanonicalMatches(entry) {
    const matchesByKey = await resolveCanonicalAlbums(entry.albums);
    const resolvedIds = new Map();
    let existingCanonicalCount = 0;
    let newCanonicalCount = 0;

    for (const item of entry.albums) {
      const matches =
        matchesByKey.get(canonicalKey(item.artist, item.album)) || [];
      if (matches.length > 1) {
        entry.errors.push(
          `Canonical album identity is ambiguous: ${item.artist} - ${item.album}`
        );
        continue;
      }
      if (matches.length === 0) {
        newCanonicalCount++;
        continue;
      }

      existingCanonicalCount++;
      applyCanonicalMetadataPolicy(item, matches[0], entry.warnings);
      item.album_id = matches[0].album_id;
      item.artist = matches[0].artist;
      item.album = matches[0].album;
      const previousPosition = resolvedIds.get(item.album_id);
      if (previousPosition) {
        entry.errors.push(
          `Position ${item.position} resolves to the same canonical album as position ${previousPosition}`
        );
      } else {
        resolvedIds.set(item.album_id, item.position);
      }
    }
    entry.existingCanonicalCount = existingCanonicalCount;
    entry.newCanonicalCount = newCanonicalCount;
  }

  return { applyCanonicalMatches };
}

module.exports = {
  createHistoricalImportCanonicalResolver,
  reconcileNewCanonicalAlbums,
};
