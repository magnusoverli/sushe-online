/**
 * Image Processing Utilities
 *
 * Shared constants and functions for album cover image processing.
 * Centralizes image resize/compress logic used by:
 * - services/cover-fetch-queue.js (background cover fetching)
 * - services/image-refetch.js (batch image re-fetching)
 * - routes/api/proxies.js (image proxy endpoint)
 *
 * All images are processed to a consistent format:
 * - Resized to 512x512 (maintaining aspect ratio, no upscaling)
 * - Converted to JPEG at 85% quality
 */

const sharp = require('sharp');

/** Target size in pixels for processed images */
const TARGET_SIZE = 512;

/**
 * JPEG quality for processed images (0-100).
 * 85 is visually indistinguishable from 100 at the 512px display size while
 * producing markedly smaller files; raising it disables most JPEG compression.
 */
const JPEG_QUALITY = 85;

/** Maximum decoded bytes accepted for manual cover uploads (5 MB). */
const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

/** iTunes artwork request size (larger than TARGET_SIZE for quality) */
const ITUNES_IMAGE_SIZE = 600;

/**
 * Process an image buffer: resize to TARGET_SIZE and convert to JPEG.
 *
 * @param {Buffer} buffer - Raw image buffer
 * @returns {Promise<Buffer>} - Processed JPEG buffer
 */
async function processImage(buffer) {
  return sharp(Buffer.from(buffer))
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

/**
 * Convert an iTunes artworkUrl100 to a higher resolution URL.
 *
 * @param {string} artworkUrl100 - iTunes 100x100 artwork URL
 * @returns {string} - Higher resolution artwork URL
 */
function upscaleItunesArtworkUrl(artworkUrl100) {
  return artworkUrl100.replace(
    /\/\d+x\d+bb\./,
    `/${ITUNES_IMAGE_SIZE}x${ITUNES_IMAGE_SIZE}bb.`
  );
}

/**
 * Normalize a cover_image value from the database.
 * Handles both BYTEA buffers and legacy base64 TEXT columns.
 *
 * @param {Buffer|string} coverImage - Raw cover image from database
 * @returns {Buffer} - Normalized image buffer
 */
function normalizeImageBuffer(coverImage) {
  return Buffer.isBuffer(coverImage)
    ? coverImage
    : Buffer.from(coverImage, 'base64');
}

function decodeImagePayload(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload !== 'string' || payload.trim().length === 0) {
    throw new Error('cover_image is required');
  }

  const base64 = payload.includes(',') ? payload.split(',').pop() : payload;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw new Error('cover_image is invalid');
  }
  if (buffer.length > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error('cover_image exceeds 5 MB');
  }
  return buffer;
}

async function processUploadedCoverImage(payload) {
  const buffer = decodeImagePayload(payload);
  const processed = await processImage(buffer);
  return { buffer: processed, format: 'JPEG' };
}

module.exports = {
  TARGET_SIZE,
  JPEG_QUALITY,
  ITUNES_IMAGE_SIZE,
  MAX_UPLOAD_IMAGE_BYTES,
  processImage,
  upscaleItunesArtworkUrl,
  normalizeImageBuffer,
  decodeImagePayload,
  processUploadedCoverImage,
};
