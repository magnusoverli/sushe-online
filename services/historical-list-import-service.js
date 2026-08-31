const crypto = require('crypto');
const { ensureDb } = require('../db/postgres');
const {
  canonicalKey,
  validateImportEntry,
  MAX_ALBUMS_PER_LIST,
} = require('./historical-list-import-validation');

const MAX_IMPORTS = 25;

class HistoricalImportError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'HistoricalImportError';
    this.status = status;
    this.details = details;
  }
}

function hashImports(imports) {
  const stable = imports.map((entry) => ({
    targetUserId: entry.targetUserId,
    listName: entry.listName,
    year: entry.year,
    albums: entry.albums,
  }));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stable))
    .digest('hex');
}

function toPreviewEntry(entry) {
  return {
    clientId: entry.clientId,
    fileName: entry.fileName,
    targetUserId: entry.targetUserId,
    targetUsername: entry.targetUsername,
    listName: entry.listName,
    year: entry.year,
    albumCount: entry.albumCount,
    existingCanonicalCount: entry.existingCanonicalCount,
    newCanonicalCount: entry.newCanonicalCount,
    warnings: entry.warnings,
    errors: entry.errors,
    canCommit: entry.errors.length === 0,
  };
}

function validateBatch(imports) {
  if (!Array.isArray(imports) || imports.length === 0) {
    throw new HistoricalImportError(
      400,
      'imports must contain at least one file'
    );
  }
  if (imports.length > MAX_IMPORTS) {
    throw new HistoricalImportError(
      400,
      `A maximum of ${MAX_IMPORTS} files can be imported at once`
    );
  }
  const clientIds = imports.map((entry) => entry?.clientId).filter(Boolean);
  if (new Set(clientIds).size !== clientIds.length) {
    throw new HistoricalImportError(
      400,
      'Each import must have a unique clientId'
    );
  }
}

function markBatchDuplicates(imports) {
  const keys = new Map();
  for (const entry of imports) {
    if (!entry.targetUserId || !entry.listName || entry.year === null) continue;
    const key = `${entry.targetUserId}::${entry.year}::${entry.listName}`;
    const previous = keys.get(key);
    if (previous) {
      entry.errors.push(`Duplicates file ${previous} in this import batch`);
    } else {
      keys.set(key, entry.fileName || entry.clientId);
    }
  }
}

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

function createImportOne({ listService, invalidateListCaches, logger }) {
  return async (entry, adminUser, previewHash) => {
    try {
      const created = await listService.createList(entry.targetUserId, {
        name: entry.listName,
        year: entry.year,
        albums: entry.albums,
      });
      invalidateListCaches(entry.targetUserId, null, { groups: true });
      logger.info('Admin imported historical list', {
        adminUserId: adminUser?._id,
        targetUserId: entry.targetUserId,
        listId: created.listId,
        listName: entry.listName,
        year: entry.year,
        albumCount: entry.albumCount,
        previewHash,
      });
      return {
        clientId: entry.clientId,
        status: 'imported',
        listId: created.listId,
      };
    } catch (error) {
      logger.error('Historical list import failed', {
        adminUserId: adminUser?._id,
        targetUserId: entry.targetUserId,
        listName: entry.listName,
        year: entry.year,
        error: error.message,
      });
      return {
        clientId: entry.clientId,
        status: 'failed',
        error: error.userFacingMessage || error.message || 'Import failed',
      };
    }
  };
}

async function commitSequentially({
  rawImports,
  users,
  normalizeImport,
  importOne,
  adminUser,
  previewHash,
}) {
  const results = [];
  for (const rawEntry of rawImports) {
    // Resolve after each committed list so later files reuse canonical albums
    // created earlier in this same batch.
    const entry = await normalizeImport(rawEntry, users);
    if (entry.errors.length > 0) {
      results.push({
        clientId: entry.clientId,
        status: 'failed',
        error: entry.errors.join('; '),
      });
      continue;
    }
    results.push(await importOne(entry, adminUser, previewHash));
  }
  return results;
}

function createHistoricalListImportService(deps = {}) {
  const db = ensureDb(deps.db, 'historical-list-import-service');
  const listService = deps.listService;
  const logger = deps.logger || require('../utils/logger');
  const invalidateListCaches = deps.invalidateListCaches || (() => {});

  if (!listService || typeof listService.createList !== 'function') {
    throw new Error('historical-list-import-service requires deps.listService');
  }
  const importOne = createImportOne({
    listService,
    invalidateListCaches,
    logger,
  });

  async function loadUsers(imports) {
    const userIds = [
      ...new Set(
        imports
          .map((entry) => entry?.targetUserId)
          .filter((id) => typeof id === 'string' && id.length > 0)
      ),
    ];
    if (userIds.length === 0) return new Map();
    const result = await db.raw(
      `SELECT _id, username, email
       FROM users
       WHERE _id = ANY($1::text[])`,
      [userIds],
      { name: 'historical-import-load-users', retryable: true }
    );
    return new Map(result.rows.map((user) => [user._id, user]));
  }

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

  async function listNameExists(entry) {
    const result = await db.raw(
      `SELECT 1
       FROM lists
       WHERE user_id = $1 AND year = $2 AND name = $3
       LIMIT 1`,
      [entry.targetUserId, entry.year, entry.listName],
      { name: 'historical-import-list-conflict', retryable: true }
    );
    return result.rows.length > 0;
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

  async function normalizeImport(rawEntry, users) {
    const entry = validateImportEntry(rawEntry, users);
    await applyCanonicalMatches(entry);
    if (
      entry.targetUser &&
      entry.year !== null &&
      entry.listName &&
      (await listNameExists(entry))
    ) {
      entry.errors.push(
        'A list with this name already exists for this user and year'
      );
    }
    const albumCount = entry.albums.length;
    const albums = entry.albums.map(
      ({
        artistKey: _artistKey,
        albumKey: _albumKey,
        position: _position,
        ...item
      }) => item
    );
    delete entry.targetUser;
    return {
      ...entry,
      albums,
      albumCount,
      errors: [...new Set(entry.errors)],
    };
  }

  async function buildPreview(body) {
    const imports = body?.imports;
    validateBatch(imports);
    const users = await loadUsers(imports);
    const normalized = [];
    for (const entry of imports) {
      normalized.push(await normalizeImport(entry, users));
    }
    markBatchDuplicates(normalized);
    reconcileNewCanonicalAlbums(normalized);

    const responseImports = normalized.map(toPreviewEntry);
    return {
      previewHash: hashImports(normalized),
      canCommit: responseImports.every((entry) => entry.canCommit),
      imports: responseImports,
      normalized,
    };
  }

  async function preview(body) {
    const result = await buildPreview(body);
    return {
      previewHash: result.previewHash,
      canCommit: result.canCommit,
      imports: result.imports,
    };
  }

  async function commit(body, adminUser) {
    if (!body?.previewHash || typeof body.previewHash !== 'string') {
      throw new HistoricalImportError(400, 'previewHash is required');
    }
    const previewResult = await buildPreview(body);
    if (previewResult.previewHash !== body.previewHash) {
      throw new HistoricalImportError(
        409,
        'Import files changed after preview'
      );
    }
    if (!previewResult.canCommit) {
      throw new HistoricalImportError(422, 'Import preview contains errors', {
        imports: previewResult.imports,
      });
    }

    const users = await loadUsers(body.imports);
    const results = await commitSequentially({
      rawImports: body.imports,
      users,
      normalizeImport,
      importOne,
      adminUser,
      previewHash: body.previewHash,
    });
    const imported = results.filter(
      (result) => result.status === 'imported'
    ).length;
    return {
      success: imported === results.length,
      imported,
      failed: results.length - imported,
      results,
    };
  }

  return { preview, commit };
}

module.exports = {
  createHistoricalListImportService,
  HistoricalImportError,
  MAX_IMPORTS,
  MAX_ALBUMS_PER_LIST,
};
