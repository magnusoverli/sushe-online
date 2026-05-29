#!/usr/bin/env node

/**
 * Backfill platform-availability metadata for albums already in the database.
 *
 * For every album not yet availability-resolved, seed it (existing mapping /
 * MusicBrainz / public search), expand via Odesli, union with MusicBrainz
 * direct links and store one album_service_mappings row per platform. Shares the
 * exact resolution service the live queue uses.
 *
 * Dry-run by default (resolves and prints, writes nothing); pass --apply to
 * write. --limit=N bounds the candidate set (handy for a quick check).
 *
 * Self-paced by Odesli's rate limit; TRANSIENT skips (network / 429 / 5xx) are
 * retried in bounded rounds. Legitimate skips (no seed, no links) are reported.
 *
 *   node scripts/backfill-availability.js                 # dry-run
 *   node scripts/backfill-availability.js --apply         # write
 *   node scripts/backfill-availability.js --limit=10      # bound candidates
 */

require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');
const { MusicBrainzQueue, createMbFetch } = require('../utils/request-queue');
const { ODESLI_RATE_LIMIT_MS } = require('../services/availability/platforms');
const {
  createExternalIdentityService,
} = require('../services/external-identity-service');
const {
  createOdesliClient,
} = require('../services/availability/odesli-client');
const {
  createMbUrlRelsSource,
} = require('../services/availability/mb-url-rels-source');
const {
  createSeedProviders,
} = require('../services/availability/seed-providers');
const {
  createAvailabilityResolutionService,
} = require('../services/availability-resolution-service');

const MAX_RETRY_ROUNDS = 5;
const RETRY_PAUSE_MS = 8000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientSkip(res) {
  return res && res.action === 'skip' && res.transient === true;
}

function parseLimit() {
  const arg = process.argv.find((a) => a.startsWith('--limit='));
  if (!arg) return null;
  const n = parseInt(arg.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildResolution(pool) {
  const db = { raw: (sql, params) => pool.query(sql, params) };
  const fetchFn = fetch;
  const mbFetch = createMbFetch(new MusicBrainzQueue({ fetch: fetchFn }));
  const externalIdentityService = createExternalIdentityService({ db, logger });
  return createAvailabilityResolutionService({
    logger,
    externalIdentityService,
    odesliClient: createOdesliClient({ fetch: fetchFn, logger }),
    mbUrlRelsSource: createMbUrlRelsSource({ mbFetch, logger }),
    seedProviders: createSeedProviders({
      fetch: fetchFn,
      logger,
      externalIdentityService,
    }),
  });
}

async function resolveOne(resolution, row, apply) {
  try {
    return await resolution.resolveAvailability(
      { albumId: row.album_id, artist: row.artist, album: row.album },
      { persist: apply }
    );
  } catch (err) {
    return {
      action: 'skip',
      reason: 'error',
      transient: true,
      error: err.message,
    };
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limit = parseLimit();

  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const resolution = buildResolution(pool);

  try {
    const { rows } = await pool.query(
      `SELECT a.album_id, a.artist, a.album
         FROM albums a
        WHERE a.artist IS NOT NULL AND a.album IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM album_service_mappings m
             WHERE m.album_id = a.album_id
               AND m.strategy LIKE 'availability:%'
          )
        ORDER BY a.artist, a.album
        ${limit ? `LIMIT ${limit}` : ''}`
    );

    console.log(
      `\nResolving availability for ${rows.length} album(s) ` +
        `(${apply ? 'APPLY' : 'DRY-RUN'})...\n`
    );

    const entries = rows.map((row) => ({ row, res: null }));
    for (let i = 0; i < entries.length; i++) {
      entries[i].res = await resolveOne(resolution, entries[i].row, apply);
      const r = entries[i].res;
      console.log(
        `  ${i + 1}/${entries.length}  ${r.action}` +
          (r.services ? ` [${r.services.join(', ')}]` : '') +
          (r.reason ? ` (${r.reason})` : '') +
          `  ${entries[i].row.artist} — ${entries[i].row.album}`
      );
      await sleep(ODESLI_RATE_LIMIT_MS);
    }

    for (let round = 1; round <= MAX_RETRY_ROUNDS; round++) {
      const pending = entries.filter((e) => isTransientSkip(e.res));
      if (pending.length === 0) break;
      console.log(
        `\nRetry round ${round}/${MAX_RETRY_ROUNDS}: ${pending.length} transient skip(s)...`
      );
      await sleep(RETRY_PAUSE_MS);
      for (const entry of pending) {
        entry.res = await resolveOne(resolution, entry.row, apply);
        await sleep(ODESLI_RATE_LIMIT_MS);
      }
    }

    const count = (action) =>
      entries.filter((e) => e.res.action === action).length;
    const transientLeft = entries.filter((e) => isTransientSkip(e.res)).length;

    console.log('\n=== Summary ===');
    console.log(`  checked:  ${entries.length}`);
    console.log(
      `  resolved: ${count('resolved')}${apply ? ' (written)' : ' (dry-run)'}`
    );
    console.log(`  skipped:  ${count('skip')} (transient ${transientLeft})`);
    if (!apply && count('resolved') > 0) {
      console.log('\nRe-run with --apply to write these mappings.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error('backfill-availability failed', { error: err.message });
  process.exit(1);
});
