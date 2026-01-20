#!/usr/bin/env node

/**
 * Migration script to resize all existing album cover images to 512x512 pixels
 * Processes the albums table only (list_items no longer stores cover images)
 *
 * NOTE: This script works with BYTEA columns (binary data) instead of
 * base64-encoded TEXT. The cover_image columns store raw binary data.
 */

require('dotenv').config();
const sharp = require('sharp');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const BATCH_SIZE = 50; // Process 50 images at a time
const TARGET_SIZE = 512;
const JPEG_QUALITY = 100;
const MAX_SIZE_BYTES = 200 * 1024; // 200KB - skip images smaller than this

// Statistics tracking
const stats = {
  albums: { total: 0, processed: 0, failed: 0, skipped: 0, savedBytes: 0 },
};

/**
 * Resize a binary image buffer to 512x512 pixels
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

  const savedBytes = originalSize - resizedBuffer.length;

  return {
    buffer: resizedBuffer,
    savedBytes,
  };
}

/**
 * Process images in the albums table
 */
async function processAlbumsTable() {
  console.log('\n📦 Processing albums table...\n');

  // Get count - BYTEA columns use IS NOT NULL (no empty string check)
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM albums WHERE cover_image IS NOT NULL'
  );
  stats.albums.total = parseInt(countResult.rows[0].count);
  console.log(`Found ${stats.albums.total} images to process\n`);

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
        // Handle both BYTEA (Buffer) and legacy TEXT (base64 string) formats
        const imageBuffer = Buffer.isBuffer(row.cover_image)
          ? row.cover_image
          : Buffer.from(row.cover_image, 'base64');

        // Skip if already appears to be resized (rough heuristic: < 50KB)
        if (imageBuffer.length < MAX_SIZE_BYTES) {
          console.log(
            `  ⏭️  Skipping ${row.album_id} (already small: ${Math.round(imageBuffer.length / 1024)}KB)`
          );
          stats.albums.skipped++;
          continue;
        }

        const { buffer: resizedBuffer, savedBytes } =
          await resizeImage(imageBuffer);

        // Store as BYTEA (Buffer) directly
        await pool.query(
          'UPDATE albums SET cover_image = $1, cover_image_format = $2 WHERE album_id = $3',
          [resizedBuffer, 'JPEG', row.album_id]
        );

        stats.albums.processed++;
        stats.albums.savedBytes += savedBytes;

        const savedKB = Math.round(savedBytes / 1024);
        console.log(
          `  ✓ Resized ${row.album_id} (saved ${savedKB} KB) [${stats.albums.processed}/${stats.albums.total}]`
        );
      } catch (error) {
        stats.albums.failed++;
        console.error(`  ✗ Failed to resize ${row.album_id}:`, error.message);
      }
    }

    offset += BATCH_SIZE;
  }
}

// Note: processListItemsTable removed - list_items no longer stores cover images
// All cover images are stored in the canonical albums table only

/**
 * Print final statistics
 */
function printStats() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Complete!');
  console.log('='.repeat(60));

  console.log('\n📦 Albums Table:');
  console.log(`  Total images: ${stats.albums.total}`);
  console.log(`  Processed: ${stats.albums.processed}`);
  console.log(`  Skipped: ${stats.albums.skipped}`);
  console.log(`  Failed: ${stats.albums.failed}`);

  const totalSaved = stats.albums.savedBytes / 1024 / 1024;
  console.log(`\n💾 Total space saved: ${Math.round(totalSaved)} MB`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting image resize migration...');
  console.log(`Target size: ${TARGET_SIZE}×${TARGET_SIZE} pixels`);
  console.log(`JPEG quality: ${JPEG_QUALITY}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Skip threshold: ${MAX_SIZE_BYTES / 1024}KB`);
  console.log('NOTE: Working with BYTEA (binary) columns');

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✓ Database connection established');

    // Process albums table (list_items no longer has cover images)
    await processAlbumsTable();

    // Print statistics
    printStats();

    // Vacuum analyze to reclaim space and update statistics
    console.log('🧹 Running VACUUM ANALYZE to reclaim space...');
    await pool.query('VACUUM ANALYZE albums');
    console.log('✓ Database optimization complete\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
main();
