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
 * Self-iterates on TRANSIENT skips (MusicBrainz timeouts / 5xx) — it retries
 * only the skipped albums with a short backoff, so it converges to "no skips"
 * without re-firing the whole candidate set (which would re-saturate MB's
 * rolling rate-limit window). LEGITIMATE skips (404 / no native name) are left
 * alone and reported.
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
const MAX_RETRY_ROUNDS = 8;
const RETRY_PAUSE_MS = 8000; // brief breather between retry rounds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A skip is TRANSIENT (worth retrying) unless it can't change on retry:
 * no native name available, a non-MusicBrainz id, or a 4xx (e.g. 404 — the
 * release group was merged/deleted on MB). 5xx and connection timeouts
 * (mb-error) are transient.
 */
function isTransientSkip(res) {
  if (!res || res.action !== 'skip') return false;
  const r = res.reason || '';
  if (r === 'no-native-name' || r === 'non-mb-id') return false;
  if (/^mb-status-4/.test(r)) return false;
  return true;
}

async function resolveOne(pool, row, apply) {
  let res;
  try {
    res = await resolveNativeAlbumName(
      { albumId: row.album_id, artist: row.artist, album: row.album },
      { fetch, logger }
    );
  } catch (_err) {
    res = { action: 'skip', reason: 'error' };
  }

  if (res.action === 'rewrite' && apply) {
    await pool.query(
      `UPDATE albums SET artist = $1, album = $2, updated_at = NOW() WHERE album_id = $3`,
      [res.artist, res.album, row.album_id]
    );
  }
  return res;
}

function countByAction(entries, action) {
  // Null-safe: during the main pass not every entry is resolved yet.
  return entries.filter((e) => e.res && e.res.action === action).length;
}

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

    // Main pass — one result entry per album.
    const entries = rows.map((row) => ({ row, res: null }));
    for (let i = 0; i < entries.length; i++) {
      entries[i].res = await resolveOne(pool, entries[i].row, apply);
      if ((i + 1) % 25 === 0 || i + 1 === entries.length) {
        console.log(
          `  ...${i + 1}/${entries.length} ` +
            `(rewrite ${countByAction(entries, 'rewrite')}, ` +
            `review ${countByAction(entries, 'review')}, ` +
            `noop ${countByAction(entries, 'noop')}, ` +
            `skip ${countByAction(entries, 'skip')})`
        );
      }
      await sleep(MB_RATE_LIMIT_MS);
    }

    // Retry loop — only the transient skips, until none remain or we exhaust
    // the rounds. Converges without re-firing the whole set.
    for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
      const pending = entries.filter((e) => isTransientSkip(e.res));
      if (pending.length === 0) break;
      console.log(
        `\nRetry round ${round}/${MAX_RETRY_ROUNDS}: re-resolving ${pending.length} transient skip(s)...`
      );
      await sleep(RETRY_PAUSE_MS);
      for (const entry of pending) {
        entry.res = await resolveOne(pool, entry.row, apply);
        await sleep(MB_RATE_LIMIT_MS);
      }
    }

    const rewrites = entries.filter((e) => e.res.action === 'rewrite');
    const reviews = entries.filter((e) => e.res.action === 'review');
    const noop = countByAction(entries, 'noop');
    const skips = entries.filter((e) => e.res.action === 'skip');

    if (rewrites.length > 0) {
      console.log(
        `\n=== ${apply ? 'REWRITTEN' : 'WOULD REWRITE'} (${rewrites.length}) ===`
      );
      for (const { row, res } of rewrites) {
        console.log(
          `  ${row.artist} — ${row.album}\n    -> ${res.artist} — ${res.album}`
        );
      }
    }

    if (reviews.length > 0) {
      console.log(
        `\n=== REVIEW (${reviews.length}) — MusicBrainz id maps to a different album; NOT changed ===`
      );
      for (const { row, res } of reviews) {
        console.log(
          `  [${row.album_id}] stored: ${row.artist} — ${row.album}\n    mb:     ${res.native.artist} — ${res.native.album}`
        );
      }
    }

    if (skips.length > 0) {
      console.log(`\n=== REMAINING SKIPS (${skips.length}) ===`);
      for (const { row, res } of skips) {
        const kind = isTransientSkip(res) ? 'TRANSIENT' : 'legitimate';
        console.log(
          `  [${kind}] ${res.reason}: ${row.artist} — ${row.album} (${row.album_id})`
        );
      }
    }

    const transientLeft = skips.filter((e) => isTransientSkip(e.res)).length;

    console.log('\n=== Summary ===');
    console.log(`  checked:  ${entries.length}`);
    console.log(
      `  rewrite:  ${rewrites.length}${apply ? ` (applied ${rewrites.length})` : ' (dry-run)'}`
    );
    console.log(`  review:   ${reviews.length}`);
    console.log(`  noop:     ${noop}`);
    console.log(
      `  skip:     ${skips.length} (transient ${transientLeft}, legitimate ${skips.length - transientLeft})`
    );
    if (transientLeft > 0) {
      console.log(
        `\n${transientLeft} transient skip(s) still unresolved after ${MAX_RETRY_ROUNDS} rounds — re-run to retry them.`
      );
    } else if (skips.length > 0) {
      console.log('\nAll remaining skips are legitimate (not retryable).');
    }
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
