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
 * Normalize artist and album names for canonical lookup
 * Used to find existing albums regardless of casing or whitespace
 *
 * @param {string|null|undefined} value - Value to normalize
 * @returns {string} - Normalized value (lowercase, trimmed)
 */
function normalizeForLookup(value) {
  return String(value || '')
    .toLowerCase()
    .trim();
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
 * Factory function to create album canonical utilities with injectable dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL pool instance
 * @param {Object} deps.logger - Logger instance (optional)
 * @returns {Object} - Album canonical utility functions
 */
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
   * Smart merge metadata: combine new data with existing, preferring better quality
   *
   * Rules:
   * - album_id: Prefer non-NULL (external IDs over internal)
   * - Text fields: Keep existing if present, otherwise use new
   * - cover_image: Prefer larger file size (higher quality)
   * - tracks: Keep existing if present, otherwise use new
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

    return {
      // Prefer external album_id over internal/NULL
      album_id:
        existing.album_id && !existing.album_id.startsWith('internal-')
          ? existing.album_id
          : newData.album_id || existing.album_id,

      // Text fields: keep existing if non-empty, otherwise use new
      artist: existing.artist || newData.artist || '',
      album: existing.album || newData.album || '',
      release_date: existing.release_date || newData.release_date || '',
      country: existing.country || newData.country || '',
      genre_1: existing.genre_1 || newData.genre_1 || newData.genre || '',
      genre_2: existing.genre_2 || newData.genre_2 || '',

      // Tracks: keep existing if present
      tracks:
        existing.tracks ||
        (Array.isArray(newData.tracks) ? newData.tracks : null),

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
   * Upsert an album with canonical deduplication
   *
   * This is the main entry point. It will:
   * 1. Check if an album with the same artist/album name already exists
   * 2. If exists: smart merge metadata and return existing album_id
   * 3. If new: insert and return new album_id
   *
   * @param {Object} albumData - Album data to upsert
   * @param {string} albumData.album_id - External album ID (optional)
   * @param {string} albumData.artist - Artist name
   * @param {string} albumData.album - Album name
   * @param {string} albumData.release_date - Release date (optional)
   * @param {string} albumData.country - Country (optional)
   * @param {string} albumData.genre_1 - Primary genre (optional)
   * @param {string} albumData.genre_2 - Secondary genre (optional)
   * @param {Array} albumData.tracks - Track listing (optional)
   * @param {Buffer|string} albumData.cover_image - Cover image (optional)
   * @param {string} albumData.cover_image_format - Cover image format (optional)
   * @param {Date} timestamp - Timestamp for created_at/updated_at
   * @param {Object} client - Database client (optional, for transactions)
   * @returns {Promise<Object>} - { albumId, wasInserted, wasMerged }
   */
  async function upsertCanonical(albumData, timestamp, client = null) {
    const db = client || pool;

    // Check for existing album by normalized name
    const existing = await findByNormalizedName(
      albumData.artist,
      albumData.album,
      db
    );

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

    // New album - insert it
    // Generate internal ID if no external ID provided
    const albumId = albumData.album_id || generateInternalAlbumId();

    // Convert cover image to Buffer if needed
    let coverImageBuffer = null;
    if (albumData.cover_image) {
      coverImageBuffer = Buffer.isBuffer(albumData.cover_image)
        ? albumData.cover_image
        : Buffer.from(albumData.cover_image, 'base64');
    }

    await db.query(
      `INSERT INTO albums (
        album_id, artist, album, release_date, country,
        genre_1, genre_2, tracks, cover_image, cover_image_format,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        albumId,
        albumData.artist || '',
        albumData.album || '',
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
  normalizeForLookup,
  generateInternalAlbumId,
  isBetterCoverImage,
};
