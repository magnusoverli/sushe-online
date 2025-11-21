#!/usr/bin/env node

/**
 * Migration script to remove duplicate data from list_items table
 * NULL-ifies fields that match albums table to save storage
 *
 * Expected savings: ~13 MB (87% reduction in duplicated data)
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const stats = {
  totalItems: 0,
  coverImageNulled: 0,
  coverFormatNulled: 0,
  artistNulled: 0,
  albumNulled: 0,
  releaseDateNulled: 0,
  countryNulled: 0,
  genre1Nulled: 0,
  genre2Nulled: 0,
  tracksNulled: 0,
  savedSpace: 0,
  errors: 0,
};

async function deduplicateListItems() {
  console.log('🚀 Starting list_items deduplication migration...\n');
  console.log('Target: Remove duplicate data that matches albums table');
  console.log(
    'Strategy: NULL = "use albums table", value = "custom override"\n'
  );

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get all list_items with albums data
    console.log('📊 Analyzing list_items for duplicates...\n');
    const res = await client.query(`
      SELECT 
        li._id,
        li.album_id,
        li.artist, a.artist as album_artist,
        li.album, a.album as album_album,
        li.release_date, a.release_date as album_release_date,
        li.country, a.country as album_country,
        li.genre_1, a.genre_1 as album_genre_1,
        li.genre_2, a.genre_2 as album_genre_2,
        li.tracks, a.tracks as album_tracks,
        li.cover_image, a.cover_image as album_cover_image,
        li.cover_image_format, a.cover_image_format as album_cover_image_format,
        LENGTH(li.cover_image) as cover_size
      FROM list_items li
      INNER JOIN albums a ON li.album_id = a.album_id
      WHERE li.album_id IS NOT NULL AND li.album_id != ''
    `);

    stats.totalItems = res.rows.length;
    console.log(`Found ${stats.totalItems} list items with album references\n`);

    if (stats.totalItems === 0) {
      console.log('✅ No items to process. Exiting.\n');
      await client.query('ROLLBACK');
      return;
    }

    console.log('🔄 Processing items...\n');
    let processed = 0;

    for (const row of res.rows) {
      const updates = [];

      // Helper to check if values match (handles null/empty string)
      const valuesMatch = (v1, v2) => {
        const normalized1 = v1 === '' || v1 === null ? null : v1;
        const normalized2 = v2 === '' || v2 === null ? null : v2;
        return normalized1 === normalized2;
      };

      // Check cover_image (biggest savings)
      if (
        row.cover_image &&
        valuesMatch(row.cover_image, row.album_cover_image)
      ) {
        updates.push('cover_image = NULL');
        stats.coverImageNulled++;
        stats.savedSpace += row.cover_size || 0;
      }

      // Check cover_image_format
      if (
        row.cover_image_format &&
        valuesMatch(row.cover_image_format, row.album_cover_image_format)
      ) {
        updates.push('cover_image_format = NULL');
        stats.coverFormatNulled++;
      }

      // Check text fields
      if (row.artist && valuesMatch(row.artist, row.album_artist)) {
        updates.push('artist = NULL');
        stats.artistNulled++;
      }

      if (row.album && valuesMatch(row.album, row.album_album)) {
        updates.push('album = NULL');
        stats.albumNulled++;
      }

      if (
        row.release_date &&
        valuesMatch(row.release_date, row.album_release_date)
      ) {
        updates.push('release_date = NULL');
        stats.releaseDateNulled++;
      }

      if (row.country && valuesMatch(row.country, row.album_country)) {
        updates.push('country = NULL');
        stats.countryNulled++;
      }

      if (row.genre_1 && valuesMatch(row.genre_1, row.album_genre_1)) {
        updates.push('genre_1 = NULL');
        stats.genre1Nulled++;
      }

      if (row.genre_2 && valuesMatch(row.genre_2, row.album_genre_2)) {
        updates.push('genre_2 = NULL');
        stats.genre2Nulled++;
      }

      // Check tracks (JSONB - needs deep comparison)
      if (row.tracks && row.album_tracks) {
        try {
          const tracksEqual =
            JSON.stringify(row.tracks) === JSON.stringify(row.album_tracks);
          if (tracksEqual) {
            updates.push('tracks = NULL');
            stats.tracksNulled++;
          }
        } catch (err) {
          console.error(
            `  ⚠️  Error comparing tracks for item ${row._id}:`,
            err.message
          );
          stats.errors++;
        }
      }

      // Apply updates if any duplicates found
      if (updates.length > 0) {
        try {
          await client.query(
            `UPDATE list_items SET ${updates.join(', ')}, updated_at = NOW() WHERE _id = $1`,
            [row._id]
          );
        } catch (err) {
          console.error(`  ❌ Error updating item ${row._id}:`, err.message);
          stats.errors++;
        }
      }

      processed++;
      if (processed % 50 === 0) {
        console.log(
          `  Progress: ${processed}/${stats.totalItems} items processed...`
        );
      }
    }

    console.log(`\n✅ All ${processed} items processed!\n`);

    // Commit changes
    await client.query('COMMIT');
    console.log('✅ Transaction committed\n');

    // Run VACUUM ANALYZE to reclaim space and update statistics
    console.log('🧹 Running VACUUM ANALYZE to reclaim space...');
    await client.query('VACUUM ANALYZE list_items');
    console.log('✅ Database optimization complete\n');

    // Print statistics
    console.log('============================================================');
    console.log('📊 Migration Complete!');
    console.log(
      '============================================================\n'
    );

    console.log('Items processed:');
    console.log(`  Total: ${stats.totalItems}`);
    console.log(`  Errors: ${stats.errors}\n`);

    console.log('Fields NULL-ified (duplicates removed):');
    console.log(`  cover_image: ${stats.coverImageNulled}`);
    console.log(`  cover_image_format: ${stats.coverFormatNulled}`);
    console.log(`  artist: ${stats.artistNulled}`);
    console.log(`  album: ${stats.albumNulled}`);
    console.log(`  release_date: ${stats.releaseDateNulled}`);
    console.log(`  country: ${stats.countryNulled}`);
    console.log(`  genre_1: ${stats.genre1Nulled}`);
    console.log(`  genre_2: ${stats.genre2Nulled}`);
    console.log(`  tracks (JSONB): ${stats.tracksNulled}\n`);

    const totalFieldsNulled =
      stats.coverImageNulled +
      stats.coverFormatNulled +
      stats.artistNulled +
      stats.albumNulled +
      stats.releaseDateNulled +
      stats.countryNulled +
      stats.genre1Nulled +
      stats.genre2Nulled +
      stats.tracksNulled;

    console.log(`Total fields NULL-ified: ${totalFieldsNulled}`);
    console.log(
      `Space saved: ${(stats.savedSpace / 1024 / 1024).toFixed(2)} MB\n`
    );

    console.log(
      '============================================================\n'
    );

    // Verification query
    console.log('🔍 Running verification query...\n');
    const verifyRes = await client.query(`
      SELECT 
        pg_size_pretty(pg_total_relation_size('list_items')) as list_items_size,
        COUNT(*) as total_list_items,
        COUNT(*) FILTER (WHERE cover_image IS NOT NULL) as items_with_cover,
        COUNT(*) FILTER (WHERE cover_image IS NULL AND album_id IS NOT NULL) as items_using_album_cover
      FROM list_items
    `);

    console.log('Current state:');
    console.log(
      `  list_items table size: ${verifyRes.rows[0].list_items_size}`
    );
    console.log(`  Total items: ${verifyRes.rows[0].total_list_items}`);
    console.log(
      `  Items with custom covers: ${verifyRes.rows[0].items_with_cover}`
    );
    console.log(
      `  Items using albums table cover: ${verifyRes.rows[0].items_using_album_cover}\n`
    );

    console.log('✅ Migration successful!\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err);
    console.error('Stack:', err.stack);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
deduplicateListItems().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
