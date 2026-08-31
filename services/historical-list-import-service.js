const crypto = require('crypto');
const { ensureDb } = require('../db/postgres');
const {
  validateImportEntry,
  MAX_ALBUMS_PER_LIST,
} = require('./historical-list-import-validation');
const {
  createHistoricalImportCanonicalResolver,
  reconcileNewCanonicalAlbums,
} = require('./historical-list-import-canonical');
const {
  createImportOne,
  commitSequentially,
} = require('./historical-list-import-commit');
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
  const { applyCanonicalMatches } = createHistoricalImportCanonicalResolver(db);

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
