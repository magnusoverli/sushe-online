const {
  normalizeForLookup,
  sanitizeForStorage,
} = require('../utils/normalization');
const { validateListName, validateYear } = require('../utils/validators');
const {
  normalizeLocalFields,
  normalizeDisqualification,
  normalizeCanonicalMetadata,
} = require('./historical-list-import-fields');

const MAX_ALBUMS_PER_LIST = 1000;
const MAX_FILENAME_LENGTH = 255;
const ALLOWED_ENVELOPE_FIELDS = new Set(['version', 'list', 'albums']);
const ALLOWED_LIST_FIELDS = new Set(['name', 'year']);
const ALLOWED_ALBUM_FIELDS = new Set([
  'position',
  'artist',
  'album',
  'comments',
  'comments_2',
  'primary_track',
  'secondary_track',
  'is_disqualified',
  'disqualification_reason',
  'release_date',
  'country',
  'genre_1',
  'genre_2',
  // Legacy identifiers are accepted only so preview can explain that they are ignored.
  'album_id',
  '_id',
  'rank',
  'points',
]);
function canonicalKey(artist, album) {
  return `${normalizeForLookup(artist)}::${normalizeForLookup(album)}`;
}

function unknownFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function addUnknownFieldError(errors, value, allowed, prefix) {
  const fields = unknownFields(value, allowed);
  if (fields.length > 0) {
    errors.push(`${prefix}${fields.join(', ')}`);
  }
}

function normalizeAlbum(item, index, state) {
  const { errors, positions, identityKeys } = state;
  const label = `Album ${index + 1}`;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${label} must be an object`);
    return null;
  }

  addUnknownFieldError(
    errors,
    item,
    ALLOWED_ALBUM_FIELDS,
    `${label} has unsupported fields: `
  );

  if (!Number.isInteger(item.position) || item.position < 1) {
    errors.push(`${label} position must be a positive integer`);
  } else if (positions.has(item.position)) {
    errors.push(`Position ${item.position} occurs more than once`);
  } else {
    positions.add(item.position);
  }

  if (typeof item.artist !== 'string') {
    errors.push(`${label} artist must be a string`);
  }
  if (typeof item.album !== 'string') {
    errors.push(`${label} album must be a string`);
  }
  const artist =
    typeof item.artist === 'string' ? sanitizeForStorage(item.artist) : '';
  const album =
    typeof item.album === 'string' ? sanitizeForStorage(item.album) : '';
  if (!artist) errors.push(`${label} artist is required`);
  if (!album) errors.push(`${label} album is required`);
  if (artist.length > 500)
    errors.push(`${label} artist exceeds 500 characters`);
  if (album.length > 500) errors.push(`${label} album exceeds 500 characters`);

  const key = artist && album ? canonicalKey(artist, album) : null;
  if (key && identityKeys.has(key)) {
    errors.push(
      `${label} duplicates the canonical identity at position ${identityKeys.get(key)}`
    );
  } else if (key) {
    identityKeys.set(key, item.position);
  }

  if (!artist || !album) return null;
  return {
    position: item.position,
    artist,
    album,
    artistKey: normalizeForLookup(artist),
    albumKey: normalizeForLookup(album),
    ...normalizeLocalFields(item, label, errors),
    ...normalizeDisqualification(item, label, errors),
    ...normalizeCanonicalMetadata(item, label, errors),
    hasSourceId: Boolean(item.album_id || item._id),
  };
}

function normalizeAlbums(rawAlbums, errors, warnings, defaultReleaseYear) {
  if (!Array.isArray(rawAlbums)) {
    errors.push('albums must be an array');
    return [];
  }
  if (rawAlbums.length === 0) {
    errors.push('albums must contain at least one album');
  } else if (rawAlbums.length > MAX_ALBUMS_PER_LIST) {
    errors.push(`albums cannot contain more than ${MAX_ALBUMS_PER_LIST} items`);
  }

  const state = { errors, positions: new Set(), identityKeys: new Map() };
  const albums = rawAlbums
    .map((item, index) => normalizeAlbum(item, index, state))
    .filter(Boolean)
    .sort((a, b) => a.position - b.position);
  albums.forEach((item, index) => {
    if (item.position !== index + 1) {
      errors.push('Album positions must be consecutive and start at 1');
    }
  });

  if (Number.isInteger(defaultReleaseYear)) {
    const inferred = albums.filter((item) => !item.release_date);
    inferred.forEach((item) => {
      item.release_date = String(defaultReleaseYear);
    });
    if (inferred.length > 0) {
      warnings.push(
        `${inferred.length} missing release date${inferred.length === 1 ? '' : 's'} will use list year ${defaultReleaseYear} when canonical metadata is absent`
      );
    }
  }

  const ignoredSourceIds = albums.filter((item) => item.hasSourceId).length;
  if (ignoredSourceIds > 0) {
    warnings.push(
      `${ignoredSourceIds} source album/list item ID${ignoredSourceIds === 1 ? '' : 's'} will be ignored`
    );
  }
  return albums.map(({ hasSourceId: _hasSourceId, ...album }) => album);
}

function validateEnvelope(payload, errors) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('File must contain a JSON object');
    return { list: null, albums: null };
  }
  addUnknownFieldError(
    errors,
    payload,
    ALLOWED_ENVELOPE_FIELDS,
    'Unsupported top-level fields: '
  );
  if (payload.version !== 1) errors.push('version must be 1');

  const list = payload.list;
  if (!list || typeof list !== 'object' || Array.isArray(list)) {
    errors.push('list must be an object');
  } else {
    addUnknownFieldError(
      errors,
      list,
      ALLOWED_LIST_FIELDS,
      'Unsupported list fields: '
    );
  }
  return { list, albums: payload.albums };
}

function validateTarget(targetUserId, targetUser, errors) {
  if (!targetUserId) errors.push('Select a registered user');
  else if (!targetUser) errors.push('The selected user no longer exists');
}

function validateImportEntry(entry, users) {
  const errors = [];
  const warnings = [];
  const clientId =
    typeof entry?.clientId === 'string' ? entry.clientId.trim() : '';
  const fileName =
    typeof entry?.fileName === 'string'
      ? entry.fileName.trim().slice(0, MAX_FILENAME_LENGTH)
      : '';
  const targetUserId =
    typeof entry?.targetUserId === 'string' ? entry.targetUserId.trim() : '';
  const targetUser = users.get(targetUserId);

  if (!clientId) errors.push('A clientId is required for each file');
  if (!fileName) errors.push('A fileName is required for each file');
  validateTarget(targetUserId, targetUser, errors);

  const envelope = validateEnvelope(entry?.payload, errors);
  const nameResult = validateListName(envelope.list?.name);
  if (!nameResult.valid) errors.push(nameResult.error);
  const yearResult = validateYear(envelope.list?.year);
  if (
    envelope.list?.year === null ||
    envelope.list?.year === undefined ||
    envelope.list?.year === ''
  ) {
    errors.push('List year is required');
  } else if (!yearResult.valid) {
    errors.push(yearResult.error);
  }

  const albums = normalizeAlbums(
    envelope.albums,
    errors,
    warnings,
    yearResult.valid ? yearResult.value : null
  );
  return {
    clientId,
    fileName,
    targetUserId,
    targetUsername: targetUser?.username || null,
    targetUser,
    listName: nameResult.valid ? nameResult.value : '',
    year: yearResult.valid ? yearResult.value : null,
    albums,
    warnings,
    errors,
  };
}

module.exports = {
  canonicalKey,
  validateImportEntry,
  MAX_ALBUMS_PER_LIST,
};
