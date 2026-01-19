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

/**
 * Sanitize artist/album names for consistent storage.
 * Converts Unicode variants to ASCII equivalents for better cross-source matching.
 *
 * This is applied at storage time to ensure data from different sources
 * (Spotify, MusicBrainz, manual entry) uses consistent character encoding.
 *
 * Examples:
 * - "…and Oceans" (ellipsis U+2026) → "...and Oceans" (three periods)
 * - "Mötley Crüe" → preserved (diacritics are intentional for display)
 * - "  Artist  " → "Artist" (trimmed whitespace)
 *
 * @param {string|null|undefined} value - Value to sanitize
 * @returns {string} - Sanitized value
 */
function sanitizeForStorage(value) {
  if (!value) return '';

  return (
    String(value)
      .trim()
      // Convert ellipsis (…) to three periods for consistent matching
      // e.g., "…and Oceans" → "...and Oceans"
      .replace(/…/g, '...')
      // Convert en-dash (–) and em-dash (—) to hyphen
      .replace(/[–—]/g, '-')
      // Normalize smart quotes to straight quotes
      // U+2018 ('), U+2019 ('), U+0060 (`) -> straight single quote
      .replace(/[\u2018\u2019`]/g, "'")
      // U+201C ("), U+201D (") -> straight double quote
      .replace(/[\u201c\u201d]/g, '"')
      // Normalize multiple spaces to single space
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Normalize artist and album names for canonical lookup
 * Used to find existing albums regardless of casing or whitespace
 *
 * @param {string|null|undefined} value - Value to normalize
 * @returns {string} - Normalized value (lowercase, trimmed, sanitized)
 */
function normalizeForLookup(value) {
  // First sanitize, then lowercase for lookup
  return sanitizeForStorage(value).toLowerCase();
}

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
   * Checks by normalized name first, then by album_id. Merges if found, inserts if new.
   *
   * @param {Object} albumData - Album data (album_id, artist, album, release_date, etc.)
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<Object>} - { albumId, wasInserted, wasMerged, needsSummaryFetch }
   */
  async function upsertCanonical(albumData, timestamp, client = null) {
    const db = client || pool;

    // Check for existing album by normalized name first
    let existing = await findByNormalizedName(
      albumData.artist,
      albumData.album,
      db
    );

    // If not found by name but has an album_id, check by ID
    // This handles cases where the same album exists with slightly different name spelling
    if (!existing && albumData.album_id) {
      existing = await findByAlbumId(albumData.album_id, db);
      if (existing) {
        log.debug('Album found by ID (name mismatch)', {
          incomingArtist: albumData.artist,
          incomingAlbum: albumData.album,
          existingArtist: existing.artist,
          existingAlbum: existing.album,
          albumId: albumData.album_id,
        });
      }
    }

    if (existing) {
      // Album exists - smart merge metadata
      const merged = smartMergeMetadata(existing, albumData);

      // Update if anything changed
      await db.query(
        `UPDATE albums SET
          album_id = COALESCE($1, album_id),
          artist = COALESCE(NULLIF($2, ''), artist),
          album = COALESCE(NULLIF($3, ''), album),
          release_date = COALESCE(NULLIF($4, ''), release_date),
          country = COALESCE(NULLIF($5, ''), country),
          genre_1 = COALESCE(NULLIF($6, ''), genre_1),
          genre_2 = COALESCE(NULLIF($7, ''), genre_2),
          tracks = COALESCE($8, tracks),
          cover_image = COALESCE($9, cover_image),
          cover_image_format = COALESCE(NULLIF($10, ''), cover_image_format),
          updated_at = $11
        WHERE LOWER(TRIM(COALESCE(artist, ''))) = $12 
          AND LOWER(TRIM(COALESCE(album, ''))) = $13`,
        [
          merged.album_id,
          merged.artist,
          merged.album,
          merged.release_date,
          merged.country,
          merged.genre_1,
          merged.genre_2,
          merged.tracks ? JSON.stringify(merged.tracks) : null,
          merged.cover_image,
          merged.cover_image_format,
          timestamp,
          normalizeForLookup(albumData.artist),
          normalizeForLookup(albumData.album),
        ]
      );

      // Return the album_id to use (might have been updated)
      const updatedAlbumId = merged.album_id || existing.album_id;

      log.debug('Album canonical merge', {
        artist: albumData.artist,
        album: albumData.album,
        existingId: existing.album_id,
        newId: albumData.album_id,
        resultId: updatedAlbumId,
      });

      return {
        albumId: updatedAlbumId,
        wasInserted: false,
        wasMerged: true,
        needsSummaryFetch: !existing.summary_fetched_at,
      };
    }

    // New album - generate internal ID if no external ID provided
    const albumId = albumData.album_id || generateInternalAlbumId();

    // Convert cover image to Buffer if needed
    let coverImageBuffer = null;
    if (albumData.cover_image) {
      coverImageBuffer = Buffer.isBuffer(albumData.cover_image)
        ? albumData.cover_image
        : Buffer.from(albumData.cover_image, 'base64');
    }

    // Sanitize artist and album names for consistent storage
    const sanitizedArtist = sanitizeForStorage(albumData.artist);
    const sanitizedAlbum = sanitizeForStorage(albumData.album);

    await db.query(
      `INSERT INTO albums (
        album_id, artist, album, release_date, country,
        genre_1, genre_2, tracks, cover_image, cover_image_format,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        albumId,
        sanitizedArtist,
        sanitizedAlbum,
        albumData.release_date || '',
        albumData.country || '',
        albumData.genre_1 || albumData.genre || '',
        albumData.genre_2 || '',
        Array.isArray(albumData.tracks)
          ? JSON.stringify(albumData.tracks)
          : null,
        coverImageBuffer,
        albumData.cover_image_format || '',
        timestamp,
        timestamp,
      ]
    );

    log.debug('Album canonical insert', {
      artist: albumData.artist,
      album: albumData.album,
      albumId: albumId,
      hasExternalId: !!albumData.album_id,
    });

    return {
      albumId,
      wasInserted: true,
      wasMerged: false,
      needsSummaryFetch: true,
    };
  }

  return {
    findByNormalizedName,
    findByAlbumId,
    smartMergeMetadata,
    upsertCanonical,
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
