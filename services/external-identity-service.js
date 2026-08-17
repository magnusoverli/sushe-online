const defaultLogger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const {
  normalizeArtistName,
  sanitizeForStorage,
} = require('../utils/normalization');
const {
  AVAILABILITY_MAPPING_RANK,
  storedMappingRank,
  createAlbumServiceMappingsRepository,
} = require('../db/repositories/album-service-mappings-repository');
const { parseAlbumLink } = require('./external-identity/album-link-policy');
const {
  AVAILABILITY_SERVICES,
  SUPPORTED_SERVICES,
} = require('./availability/platforms');
const LAST_USED_TOUCH_INTERVAL_SQL = "INTERVAL '1 hour'";

function normalizeService(service) {
  return String(service || '')
    .toLowerCase()
    .trim();
}

function normalizeArtistKey(name) {
  return normalizeArtistName(name || '');
}

function isSupportedService(service) {
  return SUPPORTED_SERVICES.has(normalizeService(service));
}

/**
 * Stored target platform availability rows for one album.
 * @param {import('../db/types').DbFacade} db
 * @param {string} albumId
 * @returns {Promise<Array<{service:string, external_album_id:string|null,
 *   external_url:string|null, confidence:number|null, strategy:string|null}>>}
 */
async function fetchAlbumAvailability(db, albumId) {
  if (!albumId) return [];

  const result = await db.raw(
    `SELECT service, external_album_id, external_url, confidence, strategy
       FROM album_service_mappings
      WHERE album_id = $1
        AND service = ANY($2)
      ORDER BY service`,
    [albumId, AVAILABILITY_SERVICES],
    { name: 'external-identity-get-album-availability', retryable: true }
  );

  return result.rows.filter(isVisibleAvailabilityMapping);
}

async function fetchAlbumAvailabilityBulk(db, albumIds) {
  if (!Array.isArray(albumIds) || albumIds.length === 0) return [];

  const result = await db.raw(
    `SELECT album_id, service, external_album_id, external_url, confidence, strategy
       FROM album_service_mappings
      WHERE album_id = ANY($1)
        AND service = ANY($2)
      ORDER BY album_id, service`,
    [albumIds, AVAILABILITY_SERVICES],
    { name: 'external-identity-get-album-availability-bulk', retryable: true }
  );

  return result.rows.filter(isVisibleAvailabilityMapping);
}

function isAvailabilityStrategy(strategy) {
  return String(strategy || '').startsWith('availability:');
}

function isVisibleAvailabilityMapping(row) {
  const parsedLink = parseAlbumLink(row.external_url, row.service);
  if (isAvailabilityStrategy(row.strategy)) {
    return Boolean(row.external_album_id || parsedLink);
  }
  return Boolean(parsedLink);
}

async function fetchAlbumAvailabilityResolutionState(db, albumId) {
  if (!albumId) return { checkedAt: null, version: 0 };
  const result = await db.raw(
    `SELECT availability_checked_at, availability_resolution_version
       FROM albums
      WHERE album_id = $1
      LIMIT 1`,
    [albumId],
    { name: 'external-identity-get-availability-state', retryable: true }
  );
  const row = result.rows[0];
  return {
    checkedAt: row?.availability_checked_at || null,
    version: Number(row?.availability_resolution_version) || 0,
  };
}

async function markAlbumAvailabilityResolved(db, albumId, version) {
  if (!albumId || !Number.isInteger(version) || version < 1) return;
  await db.raw(
    `UPDATE albums
        SET availability_checked_at = NOW(),
            availability_resolution_version = GREATEST(
              availability_resolution_version,
              $2
            )
      WHERE album_id = $1`,
    [albumId, version],
    { name: 'external-identity-mark-availability-resolved', retryable: true }
  );
}

async function preserveAvailabilityAuthority(
  repository,
  albumId,
  service,
  strategy,
  rank
) {
  if (isAvailabilityStrategy(strategy)) return { strategy, rank };

  const current = await repository.findByAlbumAndService(albumId, service);
  if (!isAvailabilityStrategy(current?.strategy)) return { strategy, rank };
  return {
    strategy: current.strategy,
    rank: Math.max(
      rank ?? Number.NEGATIVE_INFINITY,
      storedMappingRank(current)
    ),
  };
}

function createExternalIdentityService(deps = {}) {
  // ensureDb validates the canonical datastore shape at construction time but
  // is documented with a looser return type than DbFacade.
  const db = /** @type {import('../db/types').DbFacade} */ (
    ensureDb(deps.db, 'external-identity-service')
  );
  const logger = deps.logger || defaultLogger;
  const albumMappingsRepository =
    deps.albumServiceMappingsRepository ||
    createAlbumServiceMappingsRepository({ db });

  async function getAlbumServiceMapping(service, albumId) {
    const normalizedService = normalizeService(service);
    if (!albumId || !isSupportedService(normalizedService)) {
      return null;
    }

    const mapping = await albumMappingsRepository.findByAlbumAndService(
      albumId,
      normalizedService
    );
    if (!mapping) return null;

    await db.raw(
      `UPDATE album_service_mappings
          SET last_used_at = NOW(), updated_at = NOW()
        WHERE album_id = $1
          AND service = $2
          AND (last_used_at IS NULL OR last_used_at < NOW() - ${LAST_USED_TOUCH_INTERVAL_SQL})`,
      [albumId, normalizedService],
      { name: 'external-identity-touch-album-mapping', retryable: true }
    );
    return mapping;
  }

  async function upsertAlbumServiceMapping(mapping) {
    const normalizedService = normalizeService(mapping?.service);
    const albumId = mapping?.albumId;

    if (!albumId || !isSupportedService(normalizedService)) {
      return;
    }

    const parsedLink = mapping.externalUrl
      ? parseAlbumLink(mapping.externalUrl, normalizedService)
      : null;
    if (mapping.externalUrl && !parsedLink) return null;

    // Identity refreshes may add better metadata, but must not erase the fact
    // that this provider was confirmed by availability resolution.
    const authority = await preserveAvailabilityAuthority(
      albumMappingsRepository,
      albumId,
      normalizedService,
      mapping.strategy || null,
      mapping.rank ?? parsedLink?.rank
    );
    const { strategy } = authority;
    const rank =
      authority.rank === undefined &&
      normalizedService !== 'rateyourmusic' &&
      isAvailabilityStrategy(strategy)
        ? AVAILABILITY_MAPPING_RANK
        : authority.rank;

    return albumMappingsRepository.upsertCandidate({
      albumId,
      service: normalizedService,
      externalAlbumId: mapping.externalAlbumId,
      externalArtist: mapping.externalArtist
        ? sanitizeForStorage(mapping.externalArtist)
        : null,
      externalAlbum: mapping.externalAlbum
        ? sanitizeForStorage(mapping.externalAlbum)
        : null,
      externalUrl: parsedLink?.externalUrl || null,
      confidence: mapping.confidence ?? null,
      strategy,
      rank,
      verified: mapping.verified === true,
    });
  }

  // Availability reads delegate to module-scope helpers to keep the factory lean.
  const getAlbumAvailability = (albumId) => fetchAlbumAvailability(db, albumId);
  const getAlbumAvailabilityBulk = (albumIds) =>
    fetchAlbumAvailabilityBulk(db, albumIds);
  const getAlbumAvailabilityResolutionState = (albumId) =>
    fetchAlbumAvailabilityResolutionState(db, albumId);
  const markAvailabilityResolved = (albumId, version) =>
    markAlbumAvailabilityResolved(db, albumId, version);

  async function getArtistAlias(service, canonicalArtist) {
    const normalizedService = normalizeService(service);
    const canonicalArtistKey = normalizeArtistKey(canonicalArtist);

    if (!canonicalArtistKey || !isSupportedService(normalizedService)) {
      return null;
    }

    const result = await db.raw(
      `WITH selected AS (
         SELECT service_artist
         FROM artist_service_aliases
         WHERE service = $1 AND canonical_artist_key = $2
         LIMIT 1
       ), touched AS (
         UPDATE artist_service_aliases
         SET last_used_at = NOW(), updated_at = NOW()
         WHERE service = $1
           AND canonical_artist_key = $2
           AND (last_used_at IS NULL OR last_used_at < NOW() - ${LAST_USED_TOUCH_INTERVAL_SQL})
         RETURNING 1
       )
       SELECT service_artist
       FROM selected`,
      [normalizedService, canonicalArtistKey],
      { name: 'external-identity-get-artist-alias', retryable: true }
    );

    return result.rows[0]?.service_artist || null;
  }

  async function getArtistAliasCandidates(
    service,
    canonicalArtist,
    options = {}
  ) {
    const normalizedService = normalizeService(service);
    const canonicalArtistKey = normalizeArtistKey(canonicalArtist);

    if (!canonicalArtistKey || !isSupportedService(normalizedService)) {
      return [];
    }

    const { includeCrossService = false } = options;

    let result;
    if (includeCrossService) {
      result = await db.raw(
        `SELECT service, service_artist
         FROM artist_service_aliases
         WHERE canonical_artist_key = $1
         ORDER BY
           CASE
             WHEN service = $2 THEN 0
             WHEN service = 'spotify' THEN 1
             WHEN service = 'tidal' THEN 2
             WHEN service = 'lastfm' THEN 3
             ELSE 9
           END,
           updated_at DESC`,
        [canonicalArtistKey, normalizedService]
      );
    } else {
      result = await db.raw(
        `SELECT service, service_artist
         FROM artist_service_aliases
         WHERE canonical_artist_key = $1 AND service = $2
         ORDER BY updated_at DESC`,
        [canonicalArtistKey, normalizedService]
      );
    }

    const seen = new Set();
    const candidates = [];
    for (const row of result.rows) {
      const artist = row.service_artist;
      if (!artist || seen.has(artist)) continue;
      seen.add(artist);
      candidates.push(artist);
    }

    return candidates;
  }

  async function upsertArtistAlias(alias) {
    const normalizedService = normalizeService(alias?.service);
    const canonicalArtist = sanitizeForStorage(alias?.canonicalArtist || '');
    const serviceArtist = sanitizeForStorage(alias?.serviceArtist || '');

    if (
      !isSupportedService(normalizedService) ||
      !canonicalArtist ||
      !serviceArtist
    ) {
      return;
    }

    const canonicalArtistKey = normalizeArtistKey(canonicalArtist);
    const serviceArtistKey = normalizeArtistKey(serviceArtist);

    if (!canonicalArtistKey || !serviceArtistKey) {
      return;
    }

    await db.raw(
      `INSERT INTO artist_service_aliases (
         canonical_artist_key, canonical_artist, service,
         service_artist_key, service_artist, confidence,
         source_album_id, created_at, updated_at, last_used_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
       ON CONFLICT (canonical_artist_key, service)
       DO UPDATE SET
         service_artist_key = EXCLUDED.service_artist_key,
         service_artist = EXCLUDED.service_artist,
         confidence = COALESCE(EXCLUDED.confidence, artist_service_aliases.confidence),
         source_album_id = COALESCE(EXCLUDED.source_album_id, artist_service_aliases.source_album_id),
         updated_at = NOW(),
         last_used_at = NOW()`,
      [
        canonicalArtistKey,
        canonicalArtist,
        normalizedService,
        serviceArtistKey,
        serviceArtist,
        alias.confidence || null,
        alias.sourceAlbumId || null,
      ]
    );

    logger.debug('Upserted artist alias mapping', {
      service: normalizedService,
      canonicalArtist,
      serviceArtist,
      sourceAlbumId: alias.sourceAlbumId || null,
    });
  }

  return {
    getAlbumServiceMapping,
    upsertAlbumServiceMapping,
    getAlbumAvailability,
    getAlbumAvailabilityBulk,
    getAlbumAvailabilityResolutionState,
    markAlbumAvailabilityResolved: markAvailabilityResolved,
    getArtistAlias,
    getArtistAliasCandidates,
    upsertArtistAlias,
  };
}

module.exports = { createExternalIdentityService };
