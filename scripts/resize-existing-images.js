#!/usr/bin/env node

/**
 * Migration script to resize all existing album cover images to 350x350 pixels
 * Processes both albums and list_items tables
 */

require('dotenv').config();
const sharp = require('sharp');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const BATCH_SIZE = 50; // Process 50 images at a time
const TARGET_SIZE = 350;
const JPEG_QUALITY = 85;

// Statistics tracking
const stats = {
  albums: { total: 0, processed: 0, failed: 0, skipped: 0, savedBytes: 0 },
  listItems: { total: 0, processed: 0, failed: 0, skipped: 0, savedBytes: 0 },
};

/**
 * Resize a base64-encoded image to 350x350 pixels
 */
async function resizeImage(base64Data) {
  if (!base64Data || base64Data.length === 0) {
    throw new Error('Empty image data');
  }

  const originalSize = base64Data.length;
  const buffer = Buffer.from(base64Data, 'base64');

  const resizedBuffer = await sharp(buffer)
    .resize(TARGET_SIZE, TARGET_SIZE, {
      fit: 'inside', // Maintain aspect ratio
      withoutEnlargement: true, // Don't upscale small images
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const newBase64 = resizedBuffer.toString('base64');
  const newSize = newBase64.length;

  return {
    data: newBase64,
    savedBytes: originalSize - newSize,
  };
}

/**
 * Process images in the albums table
 */
async function processAlbumsTable() {
  console.log('\n📦 Processing albums table...\n');

  // Get count
  const countResult = await pool.query(
    "SELECT COUNT(*) FROM albums WHERE cover_image IS NOT NULL AND cover_image != ''"
  );
  stats.albums.total = parseInt(countResult.rows[0].count);
  console.log(`Found ${stats.albums.total} images to process\n`);

  let offset = 0;

  while (offset < stats.albums.total) {
    const result = await pool.query(
      `SELECT album_id, cover_image, cover_image_format 
       FROM albums 
       WHERE cover_image IS NOT NULL AND cover_image != ''
       ORDER BY album_id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    for (const row of result.rows) {
      try {
        // Skip if already appears to be resized (rough heuristic: < 50KB base64)
        if (row.cover_image.length < 66667) {
          // 50KB * 4/3 for base64
          console.log(`  ⏭️  Skipping ${row.album_id} (already small)`);
          stats.albums.skipped++;
          continue;
        }

        const { data, savedBytes } = await resizeImage(row.cover_image);

        await pool.query(
          'UPDATE albums SET cover_image = $1, cover_image_format = $2 WHERE album_id = $3',
          [data, 'JPEG', row.album_id]
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

/**
 * Process images in the list_items table
 */
async function processListItemsTable() {
  console.log('\n📋 Processing list_items table...\n');

  // Get count
  const countResult = await pool.query(
    "SELECT COUNT(*) FROM list_items WHERE cover_image IS NOT NULL AND cover_image != ''"
  );
  stats.listItems.total = parseInt(countResult.rows[0].count);
  console.log(`Found ${stats.listItems.total} images to process\n`);

  let offset = 0;

  while (offset < stats.listItems.total) {
    const result = await pool.query(
      `SELECT _id, cover_image, cover_image_format 
       FROM list_items 
       WHERE cover_image IS NOT NULL AND cover_image != ''
       ORDER BY _id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    for (const row of result.rows) {
      try {
        // Skip if already appears to be resized
        if (row.cover_image.length < 66667) {
          console.log(`  ⏭️  Skipping ${row._id} (already small)`);
          stats.listItems.skipped++;
          continue;
        }

        const { data, savedBytes } = await resizeImage(row.cover_image);

        await pool.query(
          'UPDATE list_items SET cover_image = $1, cover_image_format = $2 WHERE _id = $3',
          [data, 'JPEG', row._id]
        );

        stats.listItems.processed++;
        stats.listItems.savedBytes += savedBytes;

        const savedKB = Math.round(savedBytes / 1024);
        console.log(
          `  ✓ Resized ${row._id} (saved ${savedKB} KB) [${stats.listItems.processed}/${stats.listItems.total}]`
        );
      } catch (error) {
        stats.listItems.failed++;
        console.error(`  ✗ Failed to resize ${row._id}:`, error.message);
      }
    }

    offset += BATCH_SIZE;
  }
}

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
  console.log(
    `  Space saved: ${Math.round(stats.albums.savedBytes / 1024 / 1024)} MB`
  );

  console.log('\n📋 List Items Table:');
  console.log(`  Total images: ${stats.listItems.total}`);
  console.log(`  Processed: ${stats.listItems.processed}`);
  console.log(`  Skipped: ${stats.listItems.skipped}`);
  console.log(`  Failed: ${stats.listItems.failed}`);
  console.log(
    `  Space saved: ${Math.round(stats.listItems.savedBytes / 1024 / 1024)} MB`
  );

  const totalSaved =
    (stats.albums.savedBytes + stats.listItems.savedBytes) / 1024 / 1024;
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

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✓ Database connection established');

    // Process both tables
    await processAlbumsTable();
    await processListItemsTable();

    // Print statistics
    printStats();

    // Vacuum analyze to reclaim space and update statistics
    console.log('🧹 Running VACUUM ANALYZE to reclaim space...');
    await pool.query('VACUUM ANALYZE albums');
    await pool.query('VACUUM ANALYZE list_items');
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
