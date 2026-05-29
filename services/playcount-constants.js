/**
 * Playcount timing constants.
 *
 * The Last.fm playcount cache uses a three-tier refresh strategy. The two
 * staleness windows below are intentionally different — they answer different
 * questions — but live here together so the relationship is explicit rather
 * than scattered as bare literals across services.
 */

// Tier 1 — background sync cron. How old a user's cached data may be before the
// 24h sweep considers them due for a full re-sync.
const BACKGROUND_SYNC_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Tier 2 — list view. Cached values are ALWAYS displayed regardless of age;
// this only controls how often opening a list triggers a background refresh of
// fresher numbers from Last.fm.
const LIST_VIEW_STALE_MS = 5 * 60 * 1000; // 5 minutes

// How often the Tier-1 background sync cycle runs.
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Last.fm rate-limit pacing (~5 req/sec). Shared by every batched refresh path.
const BATCH_SIZE = 5; // albums per batch
const BATCH_DELAY_MS = 1100; // just over 1s between batches

// Delay between users within a sync cycle, and before the first cycle on boot.
const RATE_LIMIT_DELAY_MS = 2000; // 2s between users
const STARTUP_DELAY_MS = 60000; // 60s after startup

module.exports = {
  BACKGROUND_SYNC_STALE_MS,
  LIST_VIEW_STALE_MS,
  SYNC_INTERVAL_MS,
  BATCH_SIZE,
  BATCH_DELAY_MS,
  RATE_LIMIT_DELAY_MS,
  STARTUP_DELAY_MS,
};
