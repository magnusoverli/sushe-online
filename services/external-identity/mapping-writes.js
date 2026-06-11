const { sanitizeForStorage } = require('../../utils/normalization');

async function upsertAlbumServiceMapping(db, mapping, normalizedService) {
  await db.raw(
    `INSERT INTO album_service_mappings (
       album_id, service, external_album_id, external_artist, external_album,
       external_url, confidence, strategy, created_at, updated_at, last_used_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
     ON CONFLICT (album_id, service)
     DO UPDATE SET
       external_album_id = COALESCE(EXCLUDED.external_album_id, album_service_mappings.external_album_id),
       external_artist = COALESCE(EXCLUDED.external_artist, album_service_mappings.external_artist),
       external_album = COALESCE(EXCLUDED.external_album, album_service_mappings.external_album),
       external_url = COALESCE(EXCLUDED.external_url, album_service_mappings.external_url),
       confidence = COALESCE(EXCLUDED.confidence, album_service_mappings.confidence),
       -- Availability labels must not be downgraded by identity-search writers.
       strategy = CASE
         WHEN album_service_mappings.strategy LIKE 'availability:%'
          AND (EXCLUDED.strategy IS NULL OR EXCLUDED.strategy NOT LIKE 'availability:%')
         THEN album_service_mappings.strategy
         ELSE COALESCE(EXCLUDED.strategy, album_service_mappings.strategy)
       END,
       updated_at = NOW(),
       last_used_at = NOW()`,
    [
      mapping.albumId,
      normalizedService,
      mapping.externalAlbumId || null,
      mapping.externalArtist
        ? sanitizeForStorage(mapping.externalArtist)
        : null,
      mapping.externalAlbum ? sanitizeForStorage(mapping.externalAlbum) : null,
      mapping.externalUrl || null,
      mapping.confidence || null,
      mapping.strategy || null,
    ]
  );
}

module.exports = { upsertAlbumServiceMapping };
