const defaultLogger = require('../utils/logger');
const { ensureDb } = require('../db/postgres');
const {
  normalizeArtistName,
  sanitizeForStorage,
} = require('../utils/normalization');

const SUPPORTED_SERVICES = new Set(['spotify', 'tidal', 'lastfm']);

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

function createExternalIdentityService(deps = {}) {
  const db = ensureDb(deps.db, 'external-identity-service');
  const logger = deps.logger || defaultLogger;

  async function getAlbumServiceMapping(service, albumId) {
    const normalizedService = normalizeService(service);
    if (!albumId || !isSupportedService(normalizedService)) {
      return null;
    }

    const result = await db.raw(
      `SELECT external_album_id, external_artist, external_album, confidence, strategy
       FROM album_service_mappings
       WHERE album_id = $1 AND service = $2
       LIMIT 1`,
      [albumId, normalizedService]
    );

    if (!result.rows.length) {
      return null;
    }

    await db.raw(
      `UPDATE album_service_mappings
       SET last_used_at = NOW(), updated_at = NOW()
       WHERE album_id = $1 AND service = $2`,
      [albumId, normalizedService]
    );

    return result.rows[0];
  }

  async function upsertAlbumServiceMapping(mapping) {
    const normalizedService = normalizeService(mapping?.service);
    const albumId = mapping?.albumId;

    if (!albumId || !isSupportedService(normalizedService)) {
      return;
    }

    await db.raw(
      `INSERT INTO album_service_mappings (
         album_id, service, external_album_id, external_artist, external_album,
         confidence, strategy, created_at, updated_at, last_used_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
       ON CONFLICT (album_id, service)
       DO UPDATE SET
         external_album_id = COALESCE(EXCLUDED.external_album_id, album_service_mappings.external_album_id),
         external_artist = COALESCE(EXCLUDED.external_artist, album_service_mappings.external_artist),
         external_album = COALESCE(EXCLUDED.external_album, album_service_mappings.external_album),
         confidence = COALESCE(EXCLUDED.confidence, album_service_mappings.confidence),
         strategy = COALESCE(EXCLUDED.strategy, album_service_mappings.strategy),
         updated_at = NOW(),
         last_used_at = NOW()`,
      [
        albumId,
        normalizedService,
        mapping.externalAlbumId || null,
        mapping.externalArtist
          ? sanitizeForStorage(mapping.externalArtist)
          : null,
        mapping.externalAlbum
          ? sanitizeForStorage(mapping.externalAlbum)
          : null,
        mapping.confidence || null,
        mapping.strategy || null,
      ]
    );
  }

  async function getArtistAlias(service, canonicalArtist) {
    const normalizedService = normalizeService(service);
    const canonicalArtistKey = normalizeArtistKey(canonicalArtist);

    if (!canonicalArtistKey || !isSupportedService(normalizedService)) {
      return null;
    }

    const result = await db.raw(
      `SELECT service_artist
       FROM artist_service_aliases
       WHERE service = $1 AND canonical_artist_key = $2
       LIMIT 1`,
      [normalizedService, canonicalArtistKey]
    );

    if (!result.rows.length) {
      return null;
    }

    await db.raw(
      `UPDATE artist_service_aliases
       SET last_used_at = NOW(), updated_at = NOW()
       WHERE service = $1 AND canonical_artist_key = $2`,
      [normalizedService, canonicalArtistKey]
    );

    return result.rows[0].service_artist;
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
    getArtistAlias,
    getArtistAliasCandidates,
    upsertArtistAlias,
  };
}

module.exports = { createExternalIdentityService };
