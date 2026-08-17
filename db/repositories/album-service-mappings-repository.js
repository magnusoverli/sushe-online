const RYM_SERVICE = 'rateyourmusic';
const RYM_HINT_RANK = 10;
const DEFAULT_MAPPING_RANK = 100;
const AVAILABILITY_MAPPING_RANK = 200;
const VERIFIED_MAPPING_RANK = 1000;

const SELECT_COLUMNS = `album_id, service, external_album_id, external_artist,
  external_album, external_url, confidence, strategy, created_at, updated_at,
  last_used_at`;

/** @typedef {(sql: string, params?: any[], options?: Object) => Promise<{rows: any[], rowCount?: number}>} QueryFn */

/**
 * @param {any} db
 * @param {string} repositoryName
 * @returns {QueryFn}
 */
function createQueryAdapter(db, repositoryName) {
  if (db && typeof db.raw === 'function') {
    /** @type {QueryFn} */
    return (sql, params, options) => db.raw(sql, params, options);
  }
  if (db && typeof db.query === 'function') {
    /** @type {QueryFn} */
    return (sql, params) => db.query(sql, params);
  }
  throw new Error(`${repositoryName} requires deps.db`);
}

/** @param {unknown} value */
function normalizeNumericId(value) {
  const normalized = value == null ? null : String(value).trim();
  return normalized && /^[1-9]\d*$/.test(normalized) ? normalized : null;
}

/** @param {any} candidate */
function candidateRank(candidate) {
  if (candidate.verified) return VERIFIED_MAPPING_RANK;
  if (Number.isFinite(candidate.rank)) return candidate.rank;
  if (candidate.service === RYM_SERVICE && !candidate.externalAlbumId) {
    return RYM_HINT_RANK;
  }
  return DEFAULT_MAPPING_RANK;
}

/** @param {any} row */
function storedMappingRank(row) {
  if (!row) return -1;
  if (row.strategy === 'availability:hint:rateyourmusic') {
    return RYM_HINT_RANK;
  }
  if (
    row.service === RYM_SERVICE &&
    (normalizeNumericId(row.external_album_id) ||
      /(?:^|:)verified(?:$|:)/.test(row.strategy || ''))
  ) {
    return VERIFIED_MAPPING_RANK;
  }
  if (row.service === RYM_SERVICE && row.external_url) return RYM_HINT_RANK;
  if (String(row.strategy || '').startsWith('availability:')) {
    return AVAILABILITY_MAPPING_RANK;
  }
  return DEFAULT_MAPPING_RANK;
}

/** @param {any} current @param {any} candidate */
function conflictsAtSameRank(current, candidate) {
  if (candidateRank(candidate) !== storedMappingRank(current)) return false;
  return (
    (current.external_album_id &&
      candidate.externalAlbumId &&
      current.external_album_id !== candidate.externalAlbumId) ||
    (current.external_url &&
      candidate.externalUrl &&
      current.external_url !== candidate.externalUrl)
  );
}

/**
 * @param {any} db
 * @param {QueryFn} query
 * @param {(query: QueryFn) => Promise<any>} callback
 */
function inTransaction(db, query, callback) {
  if (typeof db.withTransaction === 'function') {
    return db.withTransaction(
      /** @param {any} client */ (client) =>
        callback(
          createQueryAdapter(client, 'album-service-mappings-repository')
        )
    );
  }
  return callback(query);
}

/** @param {{db?: any}} [deps] */
function createAlbumServiceMappingsRepository(deps = {}) {
  const db = deps.db;
  const query = createQueryAdapter(db, 'album-service-mappings-repository');

  /** @param {string} albumId @param {string} service @param {QueryFn} [runQuery] */
  async function findByAlbumAndService(albumId, service, runQuery = query) {
    if (!albumId || !service) return null;
    const result = await runQuery(
      `SELECT ${SELECT_COLUMNS}
       FROM album_service_mappings
       WHERE album_id = $1 AND service = $2
       LIMIT 1`,
      [albumId, String(service).trim().toLowerCase()],
      { name: 'album-mappings-find-by-album-service', retryable: true }
    );
    return result.rows[0] || null;
  }

  /** @param {unknown} externalAlbumId */
  async function findRateYourMusicByNumericId(externalAlbumId) {
    const numericId = normalizeNumericId(externalAlbumId);
    if (!numericId) return null;
    const result = await query(
      `SELECT ${SELECT_COLUMNS}
       FROM album_service_mappings
       WHERE service = $1 AND external_album_id = $2
       LIMIT 1`,
      [RYM_SERVICE, numericId],
      { name: 'album-mappings-find-rym-numeric-id', retryable: true }
    );
    return result.rows[0] || null;
  }

  /** @param {unknown} externalUrl */
  async function findRateYourMusicByUrl(externalUrl) {
    const normalizedUrl = String(externalUrl || '').trim();
    if (!normalizedUrl) return null;
    const result = await query(
      `SELECT ${SELECT_COLUMNS}
       FROM album_service_mappings
       WHERE service = $1 AND external_url = $2
       LIMIT 1`,
      [RYM_SERVICE, normalizedUrl],
      { name: 'album-mappings-find-rym-url', retryable: true }
    );
    return result.rows[0] || null;
  }

  /** @param {QueryFn} runQuery @param {any} candidate @param {boolean} [forUpdate] */
  async function selectCompetingMappings(
    runQuery,
    candidate,
    forUpdate = false
  ) {
    const result = await runQuery(
      `SELECT ${SELECT_COLUMNS}
       FROM album_service_mappings
       WHERE (album_id = $1 AND service = $2)
          OR (
            $2 = '${RYM_SERVICE}' AND service = '${RYM_SERVICE}' AND (
              ($3::text IS NOT NULL AND external_album_id = $3)
              OR ($4::text IS NOT NULL AND external_url = $4)
            )
          )
       ORDER BY CASE WHEN album_id = $1 THEN 0 ELSE 1 END
       ${forUpdate ? 'FOR UPDATE' : ''}`,
      [
        candidate.albumId,
        candidate.service,
        candidate.externalAlbumId,
        candidate.externalUrl,
      ]
    );
    return result.rows;
  }

  /** @param {any[]} rows @param {any} candidate */
  function identityOwner(rows, candidate) {
    return rows.find(
      (row) =>
        (candidate.externalAlbumId &&
          row.external_album_id === candidate.externalAlbumId) ||
        (candidate.externalUrl && row.external_url === candidate.externalUrl)
    );
  }

  /** @param {QueryFn} runQuery @param {any} candidate */
  async function rereadAfterConflict(runQuery, candidate) {
    const rows = await selectCompetingMappings(runQuery, candidate);
    return (
      identityOwner(rows, candidate) ||
      rows.find((row) => row.album_id === candidate.albumId) ||
      null
    );
  }

  /** @param {QueryFn} runQuery @param {any} candidate */
  async function writeCandidate(runQuery, candidate) {
    const rows = await selectCompetingMappings(runQuery, candidate, true);
    const owner = identityOwner(rows, candidate);
    if (owner && owner.album_id !== candidate.albumId) return owner;

    const current = rows.find(
      (row) =>
        row.album_id === candidate.albumId && row.service === candidate.service
    );
    if (current) {
      if (candidateRank(candidate) < storedMappingRank(current)) return current;
      if (conflictsAtSameRank(current, candidate)) return current;
      const replacesIdentity =
        candidateRank(candidate) > storedMappingRank(current);
      await runQuery('SAVEPOINT album_mapping_candidate_update');
      try {
        const updated = await runQuery(
          `UPDATE album_service_mappings
           SET external_album_id = CASE WHEN $9 THEN $3 ELSE COALESCE($3, external_album_id) END,
               external_artist = CASE WHEN $9 THEN $4 ELSE COALESCE($4, external_artist) END,
               external_album = CASE WHEN $9 THEN $5 ELSE COALESCE($5, external_album) END,
               external_url = CASE WHEN $9 THEN $6 ELSE COALESCE($6, external_url) END,
               confidence = CASE WHEN $9 THEN $7 ELSE COALESCE($7, confidence) END,
               strategy = CASE WHEN $9 THEN $8 ELSE COALESCE($8, strategy) END,
               updated_at = NOW(),
               last_used_at = NOW()
           WHERE album_id = $1 AND service = $2
           RETURNING ${SELECT_COLUMNS}`,
          [
            candidate.albumId,
            candidate.service,
            candidate.externalAlbumId,
            candidate.externalArtist,
            candidate.externalAlbum,
            candidate.externalUrl,
            candidate.confidence,
            candidate.strategy,
            replacesIdentity,
          ]
        );
        await runQuery('RELEASE SAVEPOINT album_mapping_candidate_update');
        return updated.rows[0] || current;
      } catch (error) {
        await runQuery('ROLLBACK TO SAVEPOINT album_mapping_candidate_update');
        await runQuery('RELEASE SAVEPOINT album_mapping_candidate_update');
        if (error.code !== '23505') throw error;
        return rereadAfterConflict(runQuery, candidate);
      }
    }

    const inserted = await runQuery(
      `INSERT INTO album_service_mappings (
         album_id, service, external_album_id, external_artist, external_album,
         external_url, confidence, strategy, created_at, updated_at, last_used_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        candidate.albumId,
        candidate.service,
        candidate.externalAlbumId,
        candidate.externalArtist,
        candidate.externalAlbum,
        candidate.externalUrl,
        candidate.confidence,
        candidate.strategy,
      ]
    );
    return inserted.rows[0] || rereadAfterConflict(runQuery, candidate);
  }

  /** @param {any} input */
  async function upsertCandidate(input) {
    const service = String(input?.service || '')
      .trim()
      .toLowerCase();
    const albumId = String(input?.albumId || '').trim();
    if (!albumId || !service) return null;

    const suppliedExternalAlbumId = input.externalAlbumId;
    const externalAlbumId =
      service === RYM_SERVICE
        ? normalizeNumericId(suppliedExternalAlbumId)
        : suppliedExternalAlbumId == null
          ? null
          : String(suppliedExternalAlbumId).trim() || null;
    const externalUrl = String(input.externalUrl || '').trim() || null;
    if (
      service === RYM_SERVICE &&
      suppliedExternalAlbumId != null &&
      !externalAlbumId
    ) {
      return null;
    }
    if (service === RYM_SERVICE && !externalAlbumId && !externalUrl)
      return null;
    if (!externalAlbumId && !externalUrl) return null;

    const candidate = {
      albumId,
      service,
      externalAlbumId,
      externalArtist: input.externalArtist || null,
      externalAlbum: input.externalAlbum || null,
      externalUrl,
      confidence: input.confidence ?? null,
      strategy: input.strategy || null,
      rank: input.rank,
      verified: input.verified === true,
    };
    return inTransaction(db, query, (runQuery) =>
      writeCandidate(runQuery, candidate)
    );
  }

  return {
    findByAlbumAndService,
    findRateYourMusicByNumericId,
    findRateYourMusicByUrl,
    upsertCandidate,
  };
}

module.exports = {
  RYM_HINT_RANK,
  AVAILABILITY_MAPPING_RANK,
  VERIFIED_MAPPING_RANK,
  candidateRank,
  storedMappingRank,
  conflictsAtSameRank,
  createAlbumServiceMappingsRepository,
};
