const logger = require('../../../utils/logger');
const sharp = require('sharp');

/**
 * Migration to upgrade album cover images from 256x256 to 512x512 @ 100% JPEG quality
 *
 * This migration:
 * - Processes images in batches to avoid memory issues
 * - Upgrades images smaller than 200KB (likely 256x256 @ 85%)
 * - Skips already high-quality images (>200KB)
 * - Logs progress for monitoring
 *
 * Note: This may take several minutes on large datasets.
 * The migration is safe to run multiple times (idempotent).
 */

const BATCH_SIZE = 50; // Process 50 images at a time
const TARGET_SIZE = 512;
const JPEG_QUALITY = 100;
const MAX_SIZE_BYTES = 200 * 1024; // 200KB - skip images larger than this

// Track statistics
const stats = {
  albums: { total: 0, processed: 0, failed: 0, skipped: 0, savedBytes: 0 },
  listItems: { total: 0, processed: 0, failed: 0, skipped: 0, savedBytes: 0 },
};

/**
 * Resize a binary image buffer to 512x512 pixels @ 100% quality
 * @param {Buffer} imageBuffer - Raw image binary data
 * @returns {Promise<{buffer: Buffer, savedBytes: number}>}
 */
async function resizeImage(imageBuffer) {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error('Empty image data');
  }

  const originalSize = imageBuffer.length;

  const resizedBuffer = await sharp(imageBuffer)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'inside', // Maintain aspect ratio
      withoutEnlargement: true, // Don't upscale small images
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const sizeChange = resizedBuffer.length - originalSize;

  return {
    buffer: resizedBuffer,
    savedBytes: sizeChange, // Can be negative (images get larger)
  };
}

/**
 * Process images in the albums table
 */
async function processAlbumsTable(pool) {
  logger.info('Processing albums table for image quality upgrade...');

  // Get count
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM albums WHERE cover_image IS NOT NULL'
  );
  stats.albums.total = parseInt(countResult.rows[0].count);
  logger.info(`Found ${stats.albums.total} images in albums table`);

  if (stats.albums.total === 0) {
    return;
  }

  let offset = 0;

  while (offset < stats.albums.total) {
    const result = await pool.query(
      `SELECT album_id, cover_image, cover_image_format 
       FROM albums 
       WHERE cover_image IS NOT NULL
       ORDER BY album_id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    for (const row of result.rows) {
      try {
        const imageBuffer = Buffer.isBuffer(row.cover_image)
          ? row.cover_image
          : Buffer.from(row.cover_image, 'base64');

        // Skip if already appears to be high-quality (>200KB)
        if (imageBuffer.length >= MAX_SIZE_BYTES) {
          logger.debug(`Skipping ${row.album_id} (already high-quality)`);
          stats.albums.skipped++;
          continue;
        }

        const { buffer: resizedBuffer, savedBytes } =
          await resizeImage(imageBuffer);

        await pool.query(
          'UPDATE albums SET cover_image = $1, cover_image_format = $2 WHERE album_id = $3',
          [resizedBuffer, 'JPEG', row.album_id]
        );

        stats.albums.processed++;
        stats.albums.savedBytes += savedBytes;

        if (stats.albums.processed % 10 === 0) {
          logger.info(
            `Albums progress: ${stats.albums.processed}/${stats.albums.total}`
          );
        }
      } catch (error) {
        stats.albums.failed++;
        logger.error(`Failed to upgrade image for album ${row.album_id}`, {
          error: error.message,
        });
      }
    }

    offset += BATCH_SIZE;
  }

  logger.info(
    `Albums table complete: ${stats.albums.processed} upgraded, ${stats.albums.skipped} skipped, ${stats.albums.failed} failed`
  );
}

/**
 * Process images in the list_items table
 */
async function processListItemsTable(pool) {
  logger.info('Processing list_items table for image quality upgrade...');

  // Get count
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM list_items WHERE cover_image IS NOT NULL'
  );
  stats.listItems.total = parseInt(countResult.rows[0].count);
  logger.info(`Found ${stats.listItems.total} images in list_items table`);

  if (stats.listItems.total === 0) {
    return;
  }

  let offset = 0;

  while (offset < stats.listItems.total) {
    const result = await pool.query(
      `SELECT _id, cover_image, cover_image_format 
       FROM list_items 
       WHERE cover_image IS NOT NULL
       ORDER BY _id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    for (const row of result.rows) {
      try {
        const imageBuffer = Buffer.isBuffer(row.cover_image)
          ? row.cover_image
          : Buffer.from(row.cover_image, 'base64');

        // Skip if already appears to be high-quality
        if (imageBuffer.length >= MAX_SIZE_BYTES) {
          logger.debug(`Skipping list_item ${row._id} (already high-quality)`);
          stats.listItems.skipped++;
          continue;
        }

        const { buffer: resizedBuffer, savedBytes } =
          await resizeImage(imageBuffer);

        await pool.query(
          'UPDATE list_items SET cover_image = $1, cover_image_format = $2 WHERE _id = $3',
          [resizedBuffer, 'JPEG', row._id]
        );

        stats.listItems.processed++;
        stats.listItems.savedBytes += savedBytes;

        if (stats.listItems.processed % 10 === 0) {
          logger.info(
            `List items progress: ${stats.listItems.processed}/${stats.listItems.total}`
          );
        }
      } catch (error) {
        stats.listItems.failed++;
        logger.error(`Failed to upgrade image for list_item ${row._id}`, {
          error: error.message,
        });
      }
    }

    offset += BATCH_SIZE;
  }

  logger.info(
    `List items table complete: ${stats.listItems.processed} upgraded, ${stats.listItems.skipped} skipped, ${stats.listItems.failed} failed`
  );
}

module.exports = {
  async up(pool) {
    logger.info('Starting image quality upgrade migration (256x256 → 512x512)');
    logger.info(`Target: ${TARGET_SIZE}x${TARGET_SIZE} @ ${JPEG_QUALITY}% JPEG`);

    try {
      await processAlbumsTable(pool);
      await processListItemsTable(pool);

      // Calculate total statistics
      const totalProcessed = stats.albums.processed + stats.listItems.processed;
      const totalSkipped = stats.albums.skipped + stats.listItems.skipped;
      const totalFailed = stats.albums.failed + stats.listItems.failed;
      const totalSizeChange =
        stats.albums.savedBytes + stats.listItems.savedBytes;

      logger.info('Image quality upgrade migration complete', {
        totalProcessed,
        totalSkipped,
        totalFailed,
        sizeChangeKB: Math.round(totalSizeChange / 1024),
        albums: stats.albums,
        listItems: stats.listItems,
      });

      // Run VACUUM ANALYZE to reclaim space and update statistics
      logger.info('Running VACUUM ANALYZE to optimize tables...');
      await pool.query('VACUUM ANALYZE albums');
      await pool.query('VACUUM ANALYZE list_items');
      logger.info('Database optimization complete');
    } catch (error) {
      logger.error('Image quality upgrade migration failed', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  },

  async down(pool) {
    // This migration cannot be easily reversed as it would require
    // re-fetching original images or downgrading quality
    logger.warn(
      'Image quality upgrade migration cannot be reversed automatically'
    );
    logger.warn('Images will remain at higher quality (512x512 @ 100%)');
    logger.warn(
      'To revert, you would need to restore from a database backup or re-fetch images'
    );
  },
};

