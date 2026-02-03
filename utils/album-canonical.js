/**
 * Album Canonical Utilities
 *
 * Handles canonical album deduplication by ensuring only ONE entry per unique
 * artist/album combination exists in the albums table, regardless of the source
 * (Spotify, MusicBrainz, Tidal, manual entry).
 *
 * Key principles:
 * - Albums are identified by normalized artist + album name (case-insensitive, trimmed)
 * - First entry establishes the canonical record
 * - Subsequent entries enhance with better/missing metadata ("smart merge")
 * - Albums without external IDs get a generated UUID
 *
 * Follows dependency injection pattern for testability.
 */

const crypto = require('crypto');
const logger = require('./logger');
const { resolveCountryCode } = require('./musicbrainz');
const { sanitizeForStorage, normalizeForLookup } = require('./normalization');

/**
 * Generate a stable internal album ID for manually added albums
 * Uses a prefix to distinguish from external IDs (Spotify, MusicBrainz, etc.)
 *
 * @returns {string} - Generated album ID with 'internal-' prefix
 */
function generateInternalAlbumId() {
  return `internal-${crypto.randomUUID()}`;
}

/**
 * Determine if a cover image is "better" than another based on file size
 * Larger file size generally indicates higher quality/resolution
 *
 * @param {Buffer|null} newImage - New cover image buffer
 * @param {Buffer|null} existingImage - Existing cover image buffer
 * @returns {boolean} - True if new image is better (larger)
 */
function isBetterCoverImage(newImage, existingImage) {
  if (!newImage) return false;
  if (!existingImage) return true;
  return newImage.length > existingImage.length;
}

/**
 * Choose the better text value between two options.
 * Prefers longer/more specific values (e.g., "The Beatles" over "Beatles").
 *
 * @param {string|null|undefined} existing - Existing value
 * @param {string|null|undefined} newVal - New value
 * @returns {string} - The better value, or empty string if both empty
 */
function chooseBetterText(existing, newVal) {
  const a = (existing || '').trim();
  const b = (newVal || '').trim();

  if (!a && !b) return '';
  if (!a) return b;
  if (!b) return a;

  // Prefer longer/more specific value
  return b.length > a.length ? b : a;
}

/**
 * Choose genre value - prefers new value when explicitly provided.
 * Unlike chooseBetterText, this allows users to change genres to shorter values
 * or clear them entirely. Only falls back to existing if new is undefined/null.
 *
 * @param {string|null|undefined} existing - Existing genre value
 * @param {string|null|undefined} newVal - New genre value from user
 * @returns {string} - The chosen genre, or empty string if both empty
 */
function chooseGenre(existing, newVal) {
  // If new value is explicitly provided (including empty string to clear), use it
  if (newVal !== undefined && newVal !== null) {
    return (newVal || '').trim();
  }
  // Fall back to existing only if new value is not provided
  return (existing || '').trim();
}

/**
 * Choose the better track list between two options.
 * Prefers the one with more tracks, or non-null over null.
 *
 * @param {Array|null} existing - Existing tracks array
 * @param {Array|null} newTracks - New tracks array
 * @returns {Array|null} - The better track list
 */
function chooseBetterTracks(existing, newTracks) {
  const existingArr = Array.isArray(existing) ? existing : null;
  const newArr = Array.isArray(newTracks) ? newTracks : null;

  if (!existingArr && !newArr) return null;
  if (!existingArr) return newArr;
  if (!newArr) return existingArr;

  // Prefer the one with more tracks
  return newArr.length > existingArr.length ? newArr : existingArr;
}

/**
 * Factory function to create album canonical utilities with injectable dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance (optional)
 * @returns {Object} - Album canonical utility functions
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive utility module with multiple related functions
function createAlbumCanonical(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;

  if (!pool) {
    throw new Error('PostgreSQL pool is required');
  }

  /**
   * Find an existing canonical album by normalized artist and album name
   *
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<Object|null>} - Existing album record or null
   */
  async function findByNormalizedName(artist, album, client = null) {
    const db = client || pool;
    const normalizedArtist = normalizeForLookup(artist);
    const normalizedAlbum = normalizeForLookup(album);

    // Skip lookup if both are empty
    if (!normalizedArtist && !normalizedAlbum) {
      return null;
    }

    const result = await db.query(
      `SELECT 
        album_id, artist, album, release_date, country, 
        genre_1, genre_2, tracks, cover_image, cover_image_format,
        summary, summary_fetched_at, summary_source,
        created_at, updated_at
      FROM albums 
      WHERE LOWER(TRIM(COALESCE(artist, ''))) = $1 
        AND LOWER(TRIM(COALESCE(album, ''))) = $2
      ORDER BY 
        CASE WHEN album_id IS NOT NULL THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1`,
      [normalizedArtist, normalizedAlbum]
    );

    return result.rows[0] || null;
  }

  /**
   * Find an existing canonical album by album_id
   *
   * @param {string} albumId - External album ID (e.g., MusicBrainz, Spotify)
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<Object|null>} - Existing album record or null
   */
  async function findByAlbumId(albumId, client = null) {
    if (!albumId) {
      return null;
    }

    const db = client || pool;

    const result = await db.query(
      `SELECT 
        album_id, artist, album, release_date, country, 
        genre_1, genre_2, tracks, cover_image, cover_image_format,
        summary, summary_fetched_at, summary_source,
        created_at, updated_at
      FROM albums 
      WHERE album_id = $1
      LIMIT 1`,
      [albumId]
    );

    return result.rows[0] || null;
  }

  /**
   * Smart merge metadata: combine new data with existing, preferring better quality
   *
   * Rules:
   * - album_id: Prefer external IDs over internal
   * - Text fields: Prefer longer/more specific value (e.g., full date > year only)
   * - cover_image: Prefer larger file size (higher quality)
   * - tracks: Prefer the list with more tracks
   * - summary fields: Keep existing (don't overwrite fetched summaries)
   *
   * @param {Object} existing - Existing album record from database
   * @param {Object} newData - New album data being added
   * @returns {Object} - Merged album data
   */
  function smartMergeMetadata(existing, newData) {
    // Convert new cover image to Buffer if needed
    let newCoverBuffer = null;
    if (newData.cover_image) {
      newCoverBuffer = Buffer.isBuffer(newData.cover_image)
        ? newData.cover_image
        : Buffer.from(newData.cover_image, 'base64');
    }

    // Determine which cover image to use
    const useCoverImage = isBetterCoverImage(
      newCoverBuffer,
      existing.cover_image
    );

    // Determine best album_id: prefer external over internal
    let bestAlbumId;
    if (existing.album_id && !existing.album_id.startsWith('internal-')) {
      bestAlbumId = existing.album_id;
    } else if (newData.album_id && !newData.album_id.startsWith('internal-')) {
      bestAlbumId = newData.album_id;
    } else {
      bestAlbumId = existing.album_id || newData.album_id;
    }

    return {
      album_id: bestAlbumId,

      // Text fields: prefer longer/more specific value, sanitize artist/album for consistency
      artist: sanitizeForStorage(
        chooseBetterText(existing.artist, newData.artist)
      ),
      album: sanitizeForStorage(
        chooseBetterText(existing.album, newData.album)
      ),
      release_date: chooseBetterText(
        existing.release_date,
        newData.release_date
      ),
      country: chooseBetterText(existing.country, newData.country),
      // Genres: prefer user's explicit choice over "better text" heuristics
      genre_1: chooseGenre(existing.genre_1, newData.genre_1 ?? newData.genre),
      genre_2: chooseGenre(existing.genre_2, newData.genre_2),

      // Tracks: prefer the list with more tracks
      tracks: chooseBetterTracks(existing.tracks, newData.tracks),

      // Cover image: use better quality (larger file size)
      cover_image: useCoverImage ? newCoverBuffer : existing.cover_image,
      cover_image_format: useCoverImage
        ? newData.cover_image_format || ''
        : existing.cover_image_format || '',

      // Summary: never overwrite (these are fetched asynchronously)
      summary: existing.summary,
      summary_fetched_at: existing.summary_fetched_at,
      summary_source: existing.summary_source,
    };
  }

  /**
   * Upsert an album with canonical deduplication.
   * Uses INSERT...ON CONFLICT for atomic upsert (single query instead of 3).
   *
   * @param {Object} albumData - Album data (album_id, artist, album, release_date, etc.)
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<Object>} - { albumId, wasInserted, wasMerged, needsSummaryFetch, needsCoverFetch }
   */
  async function upsertCanonical(albumData, timestamp, client = null) {
    const db = client || pool;

    // Sanitize artist and album names for consistent storage
    const sanitizedArtist = sanitizeForStorage(albumData.artist);
    const sanitizedAlbum = sanitizeForStorage(albumData.album);

    // Convert cover image to Buffer if needed
    let coverImageBuffer = null;
    if (albumData.cover_image) {
      coverImageBuffer = Buffer.isBuffer(albumData.cover_image)
        ? albumData.cover_image
        : Buffer.from(albumData.cover_image, 'base64');
    }

    // Generate album_id if not provided
    const albumId = albumData.album_id || generateInternalAlbumId();

    // Prepare common values
    const releaseDate = albumData.release_date || '';
    // Auto-resolve 2-letter country codes to full names (backward compatible)
    const countryInput = albumData.country || '';
    const country =
      countryInput.length === 2
        ? resolveCountryCode(countryInput) || countryInput // Resolve code, fallback to code if unmapped
        : countryInput; // Already full name (backward compat)
    const genre1 = albumData.genre_1 || albumData.genre || '';
    const genre2 = albumData.genre_2 || '';
    const tracks = Array.isArray(albumData.tracks)
      ? JSON.stringify(albumData.tracks)
      : null;
    const coverFormat = albumData.cover_image_format || '';

    // Use different conflict strategies based on whether album_id exists
    if (albumData.album_id) {
      // Path 1: Album WITH external ID - conflict on album_id
      // Uses idx_albums_album_id_unique index
      const result = await db.query(
        `INSERT INTO albums (
          album_id, artist, album, release_date, country,
          genre_1, genre_2, tracks, cover_image, cover_image_format,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (album_id) 
        WHERE album_id IS NOT NULL AND album_id != ''
        DO UPDATE SET
          -- Smart merge: prefer non-empty incoming values over existing
          artist = CASE 
            WHEN EXCLUDED.artist != '' THEN EXCLUDED.artist 
            ELSE albums.artist 
          END,
          album = CASE 
            WHEN EXCLUDED.album != '' THEN EXCLUDED.album 
            ELSE albums.album 
          END,
          release_date = CASE 
            WHEN EXCLUDED.release_date != '' THEN EXCLUDED.release_date 
            ELSE albums.release_date 
          END,
          country = CASE 
            WHEN EXCLUDED.country != '' THEN EXCLUDED.country 
            ELSE albums.country 
          END,
          genre_1 = CASE 
            WHEN EXCLUDED.genre_1 != '' THEN EXCLUDED.genre_1 
            ELSE albums.genre_1 
          END,
          genre_2 = CASE 
            WHEN EXCLUDED.genre_2 != '' THEN EXCLUDED.genre_2 
            ELSE albums.genre_2 
          END,
          tracks = COALESCE(EXCLUDED.tracks, albums.tracks),
          -- Cover image: prefer larger file (better quality)
          cover_image = CASE 
            WHEN EXCLUDED.cover_image IS NOT NULL AND 
                 (albums.cover_image IS NULL OR 
                  LENGTH(EXCLUDED.cover_image) > LENGTH(albums.cover_image))
            THEN EXCLUDED.cover_image
            ELSE albums.cover_image
          END,
          cover_image_format = CASE 
            WHEN EXCLUDED.cover_image IS NOT NULL THEN EXCLUDED.cover_image_format
            ELSE albums.cover_image_format
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING 
          album_id,
          (xmax = 0) AS was_inserted,
          cover_image IS NULL AS needs_cover_fetch,
          summary_fetched_at IS NULL AS needs_summary_fetch,
          tracks IS NULL AS needs_tracks_fetch`,
        [
          albumId,
          sanitizedArtist,
          sanitizedAlbum,
          releaseDate,
          country,
          genre1,
          genre2,
          tracks,
          coverImageBuffer,
          coverFormat,
          timestamp,
          timestamp,
        ]
      );

      const row = result.rows[0];
      log.debug('Album upsert (with album_id)', {
        artist: albumData.artist,
        album: albumData.album,
        albumId: row.album_id,
        wasInserted: row.was_inserted,
      });

      return {
        albumId: row.album_id,
        wasInserted: row.was_inserted,
        wasMerged: !row.was_inserted,
        needsSummaryFetch: row.needs_summary_fetch,
        needsCoverFetch: row.needs_cover_fetch,
        needsTracksFetch: row.needs_tracks_fetch,
      };
    } else {
      // Path 2: Album WITHOUT external ID - conflict on normalized name
      // Uses idx_albums_normalized_name_unique index
      const normalizedArtist = normalizeForLookup(sanitizedArtist);
      const normalizedAlbum = normalizeForLookup(sanitizedAlbum);

      const result = await db.query(
        `INSERT INTO albums (
          album_id, artist, album, release_date, country,
          genre_1, genre_2, tracks, cover_image, cover_image_format,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (LOWER(TRIM(COALESCE(artist, ''))), LOWER(TRIM(COALESCE(album, ''))))
        WHERE album_id IS NULL OR album_id = ''
        DO UPDATE SET
          -- Prefer external album_id over internal UUID
          album_id = CASE
            WHEN albums.album_id LIKE 'internal-%' AND EXCLUDED.album_id NOT LIKE 'internal-%'
            THEN EXCLUDED.album_id
            ELSE albums.album_id
          END,
          release_date = CASE 
            WHEN EXCLUDED.release_date != '' THEN EXCLUDED.release_date 
            ELSE albums.release_date 
          END,
          country = CASE 
            WHEN EXCLUDED.country != '' THEN EXCLUDED.country 
            ELSE albums.country 
          END,
          genre_1 = CASE 
            WHEN EXCLUDED.genre_1 != '' THEN EXCLUDED.genre_1 
            ELSE albums.genre_1 
          END,
          genre_2 = CASE 
            WHEN EXCLUDED.genre_2 != '' THEN EXCLUDED.genre_2 
            ELSE albums.genre_2 
          END,
          tracks = COALESCE(EXCLUDED.tracks, albums.tracks),
          cover_image = CASE 
            WHEN EXCLUDED.cover_image IS NOT NULL AND 
                 (albums.cover_image IS NULL OR 
                  LENGTH(EXCLUDED.cover_image) > LENGTH(albums.cover_image))
            THEN EXCLUDED.cover_image
            ELSE albums.cover_image
          END,
          cover_image_format = CASE 
            WHEN EXCLUDED.cover_image IS NOT NULL THEN EXCLUDED.cover_image_format
            ELSE albums.cover_image_format
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING 
          album_id,
          (xmax = 0) AS was_inserted,
          cover_image IS NULL AS needs_cover_fetch,
          summary_fetched_at IS NULL AS needs_summary_fetch,
          tracks IS NULL AS needs_tracks_fetch`,
        [
          albumId,
          sanitizedArtist,
          sanitizedAlbum,
          releaseDate,
          country,
          genre1,
          genre2,
          tracks,
          coverImageBuffer,
          coverFormat,
          timestamp,
          timestamp,
        ]
      );

      const row = result.rows[0];
      log.debug('Album upsert (without album_id)', {
        artist: albumData.artist,
        album: albumData.album,
        albumId: row.album_id,
        wasInserted: row.was_inserted,
        normalizedKey: `${normalizedArtist}|${normalizedAlbum}`,
      });

      return {
        albumId: row.album_id,
        wasInserted: row.was_inserted,
        wasMerged: !row.was_inserted,
        needsSummaryFetch: row.needs_summary_fetch,
        needsCoverFetch: row.needs_cover_fetch,
        needsTracksFetch: row.needs_tracks_fetch,
      };
    }
  }

  /**
   * Batch upsert multiple albums at once using UNNEST
   * Significantly faster than individual upserts for bulk operations
   *
   * @param {Array<Object>} albums - Array of album data objects
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (for transactions)
   * @returns {Promise<Map>} - Map of artist|album -> result object
   */
  async function batchUpsertCanonical(albums, timestamp, client = null) {
    if (!albums || albums.length === 0) return new Map();

    // For single album, use regular upsert
    if (albums.length === 1) {
      const result = await upsertCanonical(albums[0], timestamp, client);
      const key = `${albums[0].artist}|${albums[0].album}`;
      return new Map([[key, result]]);
    }

    const db = client || pool;
    const results = new Map();

    // Separate albums with/without album_id (different conflict strategies)
    const withId = [];
    const withoutId = [];

    for (const album of albums) {
      const sanitizedArtist = sanitizeForStorage(album.artist);
      const sanitizedAlbum = sanitizeForStorage(album.album);

      const albumData = {
        original: album,
        album_id: album.album_id || generateInternalAlbumId(),
        artist: sanitizedArtist,
        album: sanitizedAlbum,
        release_date: album.release_date || '',
        country: album.country || '',
        genre_1: album.genre_1 || album.genre || '',
        genre_2: album.genre_2 || '',
        tracks: Array.isArray(album.tracks)
          ? JSON.stringify(album.tracks)
          : null,
        key: `${album.artist}|${album.album}`,
      };

      if (album.album_id) {
        withId.push(albumData);
      } else {
        withoutId.push(albumData);
      }
    }

    // Batch 1: Albums WITH album_id
    if (withId.length > 0) {
      const albumIds = withId.map((a) => a.album_id);
      const artists = withId.map((a) => a.artist);
      const albumNames = withId.map((a) => a.album);
      const releaseDates = withId.map((a) => a.release_date);
      const countries = withId.map((a) => a.country);
      const genres1 = withId.map((a) => a.genre_1);
      const genres2 = withId.map((a) => a.genre_2);
      const tracksList = withId.map((a) => a.tracks);

      const result = await db.query(
        `INSERT INTO albums (
          album_id, artist, album, release_date, country, genre_1, genre_2, 
          tracks, created_at, updated_at
        )
        SELECT * FROM UNNEST(
          $1::text[], $2::text[], $3::text[], $4::text[], 
          $5::text[], $6::text[], $7::text[], $8::jsonb[],
          $9::timestamptz, $10::timestamptz
        ) AS t(album_id, artist, album, release_date, country, genre_1, genre_2, tracks, created_at, updated_at)
        ON CONFLICT (album_id) 
        WHERE album_id IS NOT NULL AND album_id != ''
        DO UPDATE SET
          artist = CASE 
            WHEN EXCLUDED.artist != '' THEN EXCLUDED.artist 
            ELSE albums.artist 
          END,
          album = CASE 
            WHEN EXCLUDED.album != '' THEN EXCLUDED.album 
            ELSE albums.album 
          END,
          release_date = CASE 
            WHEN EXCLUDED.release_date != '' THEN EXCLUDED.release_date 
            ELSE albums.release_date 
          END,
          country = CASE 
            WHEN EXCLUDED.country != '' THEN EXCLUDED.country 
            ELSE albums.country 
          END,
          genre_1 = CASE 
            WHEN EXCLUDED.genre_1 != '' THEN EXCLUDED.genre_1 
            ELSE albums.genre_1 
          END,
          genre_2 = CASE 
            WHEN EXCLUDED.genre_2 != '' THEN EXCLUDED.genre_2 
            ELSE albums.genre_2 
          END,
          tracks = COALESCE(EXCLUDED.tracks, albums.tracks),
          updated_at = EXCLUDED.updated_at
        RETURNING 
          album_id, artist, album,
          (xmax = 0) AS was_inserted,
          cover_image IS NULL AS needs_cover_fetch,
          summary_fetched_at IS NULL AS needs_summary_fetch,
          tracks IS NULL AS needs_tracks_fetch`,
        [
          albumIds,
          artists,
          albumNames,
          releaseDates,
          countries,
          genres1,
          genres2,
          tracksList,
          timestamp,
          timestamp,
        ]
      );

      // Map results by artist|album key
      result.rows.forEach((row) => {
        const key = `${row.artist}|${row.album}`;
        results.set(key, {
          albumId: row.album_id,
          wasInserted: row.was_inserted,
          wasMerged: !row.was_inserted,
          needsSummaryFetch: row.needs_summary_fetch,
          needsCoverFetch: row.needs_cover_fetch,
          needsTracksFetch: row.needs_tracks_fetch,
        });
      });

      log.debug('Batch upsert (with album_id)', {
        count: withId.length,
        inserted: result.rows.filter((r) => r.was_inserted).length,
        updated: result.rows.filter((r) => !r.was_inserted).length,
      });
    }

    // Batch 2: Albums WITHOUT album_id
    if (withoutId.length > 0) {
      const albumIds = withoutId.map((a) => a.album_id);
      const artists = withoutId.map((a) => a.artist);
      const albumNames = withoutId.map((a) => a.album);
      const releaseDates = withoutId.map((a) => a.release_date);
      const countries = withoutId.map((a) => a.country);
      const genres1 = withoutId.map((a) => a.genre_1);
      const genres2 = withoutId.map((a) => a.genre_2);
      const tracksList = withoutId.map((a) => a.tracks);

      const result = await db.query(
        `INSERT INTO albums (
          album_id, artist, album, release_date, country, genre_1, genre_2, 
          tracks, created_at, updated_at
        )
        SELECT * FROM UNNEST(
          $1::text[], $2::text[], $3::text[], $4::text[], 
          $5::text[], $6::text[], $7::text[], $8::jsonb[],
          $9::timestamptz, $10::timestamptz
        ) AS t(album_id, artist, album, release_date, country, genre_1, genre_2, tracks, created_at, updated_at)
        ON CONFLICT (LOWER(TRIM(COALESCE(artist, ''))), LOWER(TRIM(COALESCE(album, ''))))
        WHERE album_id IS NULL OR album_id = ''
        DO UPDATE SET
          album_id = CASE
            WHEN albums.album_id LIKE 'internal-%' AND EXCLUDED.album_id NOT LIKE 'internal-%'
            THEN EXCLUDED.album_id
            ELSE albums.album_id
          END,
          release_date = CASE 
            WHEN EXCLUDED.release_date != '' THEN EXCLUDED.release_date 
            ELSE albums.release_date 
          END,
          country = CASE 
            WHEN EXCLUDED.country != '' THEN EXCLUDED.country 
            ELSE albums.country 
          END,
          genre_1 = CASE 
            WHEN EXCLUDED.genre_1 != '' THEN EXCLUDED.genre_1 
            ELSE albums.genre_1 
          END,
          genre_2 = CASE 
            WHEN EXCLUDED.genre_2 != '' THEN EXCLUDED.genre_2 
            ELSE albums.genre_2 
          END,
          tracks = COALESCE(EXCLUDED.tracks, albums.tracks),
          updated_at = EXCLUDED.updated_at
        RETURNING 
          album_id, artist, album,
          (xmax = 0) AS was_inserted,
          cover_image IS NULL AS needs_cover_fetch,
          summary_fetched_at IS NULL AS needs_summary_fetch,
          tracks IS NULL AS needs_tracks_fetch`,
        [
          albumIds,
          artists,
          albumNames,
          releaseDates,
          countries,
          genres1,
          genres2,
          tracksList,
          timestamp,
          timestamp,
        ]
      );

      // Map results by artist|album key
      result.rows.forEach((row) => {
        const key = `${row.artist}|${row.album}`;
        results.set(key, {
          albumId: row.album_id,
          wasInserted: row.was_inserted,
          wasMerged: !row.was_inserted,
          needsSummaryFetch: row.needs_summary_fetch,
          needsCoverFetch: row.needs_cover_fetch,
          needsTracksFetch: row.needs_tracks_fetch,
        });
      });

      log.debug('Batch upsert (without album_id)', {
        count: withoutId.length,
        inserted: result.rows.filter((r) => r.was_inserted).length,
        updated: result.rows.filter((r) => !r.was_inserted).length,
      });
    }

    return results;
  }

  return {
    findByNormalizedName,
    findByAlbumId,
    smartMergeMetadata,
    upsertCanonical,
    batchUpsertCanonical,
    normalizeForLookup,
    generateInternalAlbumId,
    isBetterCoverImage,
  };
}

// Export factory and helper functions
module.exports = {
  createAlbumCanonical,
  sanitizeForStorage,
  normalizeForLookup,
  generateInternalAlbumId,
  isBetterCoverImage,
  chooseBetterText,
  chooseBetterTracks,
};
