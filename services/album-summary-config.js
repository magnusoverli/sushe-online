// services/album-summary-config.js
// Stored configuration for the album-summary model.

const DEFAULTS = {
  model: 'claude-sonnet-5',
  effort: 'medium',
  maxTokens: 4096,
};

/** Effort levels the API accepts. Anything else is a 400. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

const CACHE_TTL_MS = 60000;

/**
 * Environment values, used only until an admin saves a configuration.
 *
 * These are a starting point, not the source of truth. Reading them as
 * authority is what let a stale host-side compose file pin production to a
 * model the code could not talk to, with nothing in the UI to reveal it.
 */
function envDefaults() {
  const maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '', 10);
  return {
    model: process.env.CLAUDE_MODEL || DEFAULTS.model,
    effort: EFFORT_LEVELS.includes(process.env.CLAUDE_SUMMARY_EFFORT || '')
      ? process.env.CLAUDE_SUMMARY_EFFORT
      : DEFAULTS.effort,
    maxTokens:
      Number.isFinite(maxTokens) && maxTokens > 0
        ? maxTokens
        : DEFAULTS.maxTokens,
  };
}

/**
 * @param {Object} deps
 * @param {Object} [deps.db] - Datastore with .raw()
 * @param {Object} [deps.logger]
 */
function createAlbumSummaryConfig(deps = {}) {
  const { db } = deps;
  const log = deps.logger || console;

  let cache = null;
  let cachedAt = 0;

  function invalidate() {
    cache = null;
    cachedAt = 0;
  }

  /**
   * The configuration in force: the stored row if there is one, otherwise the
   * environment, otherwise the built-in defaults.
   *
   * @returns {Promise<{model: string, effort: string, maxTokens: number,
   *   source: 'stored'|'environment'}>}
   */
  async function getConfig() {
    if (cache && Date.now() - cachedAt < CACHE_TTL_MS) {
      return cache;
    }

    const fromEnv = { ...envDefaults(), source: 'environment' };

    try {
      const result = await db.raw(
        'SELECT model, effort, max_tokens FROM album_summary_config LIMIT 1'
      );
      const row = result.rows[0];
      cache = row
        ? {
            model: row.model,
            effort: row.effort || fromEnv.effort,
            maxTokens: row.max_tokens || fromEnv.maxTokens,
            source: 'stored',
          }
        : fromEnv;
    } catch (err) {
      // A missing table or an unreachable database must not stop summaries
      // being generated — fall back rather than fail.
      log.warn?.('Could not read album summary config; using environment', {
        error: err.message,
      });
      cache = fromEnv;
    }

    cachedAt = Date.now();
    return cache;
  }

  /**
   * Replace the stored configuration.
   *
   * @param {{model: string, effort?: string|null, maxTokens?: number|null}} next
   * @param {string|null} [updatedBy] - Admin user _id, for attribution.
   */
  async function saveConfig(next, updatedBy = null) {
    if (!next?.model || typeof next.model !== 'string') {
      throw new Error('model is required');
    }
    if (next.effort != null && !EFFORT_LEVELS.includes(next.effort)) {
      throw new Error(`effort must be one of ${EFFORT_LEVELS.join(', ')}`);
    }
    if (next.maxTokens != null) {
      const n = Number(next.maxTokens);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error('maxTokens must be a positive integer');
      }
    }

    // Singleton row, matching the telegram_config idiom already in the schema.
    await db.raw('DELETE FROM album_summary_config');
    await db.raw(
      `INSERT INTO album_summary_config (model, effort, max_tokens, updated_at, updated_by)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [
        next.model,
        next.effort ?? null,
        next.maxTokens == null ? null : Number(next.maxTokens),
        updatedBy,
      ]
    );

    invalidate();
    return getConfig();
  }

  return { getConfig, saveConfig, invalidate };
}

module.exports = {
  createAlbumSummaryConfig,
  EFFORT_LEVELS,
  DEFAULTS,
  envDefaults,
};
