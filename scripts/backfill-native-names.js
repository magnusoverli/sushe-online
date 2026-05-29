#!/usr/bin/env node

/**
 * Backfill native artist/album spelling for albums whose stored names were
 * ASCII-folded at ingestion (browser-extension URL-slug bug). For every album
 * that has a MusicBrainz id and a pure-ASCII stored name (the only ones that
 * could be slug victims), look up the native spelling from MusicBrainz and — if
 * the entity-matching gate confirms it's the SAME album — rewrite the stored
 * artist/album.
 *
 * Dry-run by default (prints what WOULD change); pass --apply to write.
 * Only albums.artist/album are touched; album_id is never changed, so
 * list_items / user_album_stats are unaffected.
 *
 *   node scripts/backfill-native-names.js            # dry-run
 *   node scripts/backfill-native-names.js --apply    # apply
 */

require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');
const { resolveNativeAlbumName } = require('../services/native-name-service');

const MB_UUID =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const MB_RATE_LIMIT_MS = 1100; // MusicBrainz: ~1 request/second
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const apply = process.argv.includes('--apply');

  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Pure-ASCII names only: a name containing non-ASCII characters cannot be a
    // slug victim (RYM slugs are ASCII), so it is already native — skip it.
    const { rows } = await pool.query(
      `SELECT album_id, artist, album
         FROM albums
        WHERE album_id ~* $1
          AND artist !~ '[^\\x20-\\x7E]'
          AND album  !~ '[^\\x20-\\x7E]'
        ORDER BY artist, album`,
      [MB_UUID]
    );

    console.log(
      `\nChecking ${rows.length} pure-ASCII album(s) with a MusicBrainz id ` +
        `(${apply ? 'APPLY' : 'DRY-RUN'})...\n`
    );

    const rewrites = [];
    const reviews = [];
    let noop = 0;
    let skip = 0;
    let applied = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let res;
      try {
        res = await resolveNativeAlbumName(
          { albumId: row.album_id, artist: row.artist, album: row.album },
          { fetch, logger }
        );
      } catch (err) {
        logger.warn('backfill: resolve failed', {
          albumId: row.album_id,
          error: err.message,
        });
        res = { action: 'skip', reason: 'error' };
      }

      if ((i + 1) % 25 === 0 || i + 1 === rows.length) {
        console.log(
          `  ...${i + 1}/${rows.length} (rewrite ${rewrites.length}, review ${reviews.length}, noop ${noop}, skip ${skip})`
        );
      }

      if (res.action === 'rewrite') {
        rewrites.push({
          row,
          native: { artist: res.artist, album: res.album },
        });
        if (apply) {
          await pool.query(
            `UPDATE albums SET artist = $1, album = $2, updated_at = NOW() WHERE album_id = $3`,
            [res.artist, res.album, row.album_id]
          );
          applied++;
        }
      } else if (res.action === 'review') {
        reviews.push({ row, native: res.native });
      } else if (res.action === 'noop') {
        noop++;
      } else {
        skip++;
      }

      await sleep(MB_RATE_LIMIT_MS);
    }

    if (rewrites.length > 0) {
      console.log(
        `=== ${apply ? 'REWRITTEN' : 'WOULD REWRITE'} (${rewrites.length}) ===`
      );
      for (const { row, native } of rewrites) {
        console.log(
          `  ${row.artist} — ${row.album}\n    -> ${native.artist} — ${native.album}`
        );
      }
      console.log('');
    }

    if (reviews.length > 0) {
      console.log(
        `=== REVIEW (${reviews.length}) — MusicBrainz id maps to a different album; NOT changed ===`
      );
      for (const { row, native } of reviews) {
        console.log(
          `  [${row.album_id}] stored: ${row.artist} — ${row.album}\n    mb:     ${native.artist} — ${native.album}`
        );
      }
      console.log('');
    }

    console.log('=== Summary ===');
    console.log(`  checked:  ${rows.length}`);
    console.log(
      `  rewrite:  ${rewrites.length}${apply ? ` (applied ${applied})` : ' (dry-run)'}`
    );
    console.log(`  review:   ${reviews.length}`);
    console.log(`  noop:     ${noop}`);
    console.log(`  skip:     ${skip}`);
    if (!apply && rewrites.length > 0) {
      console.log('\nRe-run with --apply to write these changes.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error('backfill-native-names failed', { error: err.message });
  process.exit(1);
});
