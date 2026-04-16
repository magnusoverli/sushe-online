/**
 * Aggregate List Audit Utility
 *
 * Provides tools for detecting and fixing potential duplicate albums
 * in aggregate lists, plus manual-album reconciliation helpers.
 *
 * Follows dependency injection pattern for testability.
 */

const logger = require('../utils/logger');
const {
  findPotentialDuplicates,
  normalizeAlbumKey,
} = require('../utils/fuzzy-match');
const { withTransaction } = require('../db/transaction');
const {
  basicNormalizeAlbumKey,
  createDuplicateAuditService,
} = require('./aggregate-audit/duplicate-audit');
const {
  createManualReconciliationService,
} = require('./aggregate-audit/manual-reconciliation');
const { createDuplicateService } = require('./duplicate-service');

function createAggregateAudit(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  if (!pool) {
    throw new Error('PostgreSQL pool is required');
  }

  const duplicateAudit = createDuplicateAuditService({
    pool,
    log,
    normalizeAlbumKey,
    selectCanonicalAlbumId,
    withTransaction,
  });

  const duplicateService =
    deps.duplicateService || createDuplicateService({ pool, logger: log });

  const manualReconciliation = createManualReconciliationService({
    pool,
    log,
    normalizeAlbumKey,
    findPotentialDuplicates,
    withTransaction,
    duplicateService,
  });

  return {
    ...duplicateAudit,
    ...manualReconciliation,
    normalizeAlbumKey,
    basicNormalizeAlbumKey,
  };
}

/**
 * Select the canonical album_id from a list of IDs
 * Priority: External IDs (Spotify, MusicBrainz) > Internal IDs > Manual IDs
 *
 * @param {string[]} albumIds - Array of album IDs
 * @returns {string} The canonical album_id to use
 */
function selectCanonicalAlbumId(albumIds) {
  if (!albumIds || albumIds.length === 0) {
    return null;
  }

  const validIds = albumIds.filter((id) => id && id.trim() !== '');

  if (validIds.length === 0) {
    return null;
  }

  const spotifyId = validIds.find((id) => /^[a-zA-Z0-9]{22}$/.test(id));
  if (spotifyId) return spotifyId;

  const mbId = validIds.find((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
  if (mbId) return mbId;

  const externalId = validIds.find(
    (id) => !id.startsWith('manual-') && !id.startsWith('internal-')
  );
  if (externalId) return externalId;

  const internalId = validIds.find((id) => id.startsWith('internal-'));
  if (internalId) return internalId;

  return validIds[0];
}

module.exports = {
  createAggregateAudit,
  selectCanonicalAlbumId,
  normalizeAlbumKey,
  basicNormalizeAlbumKey,
};
