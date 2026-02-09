const logger = require('../../../utils/logger');

/**
 * Migration: Add personal recommendations tables
 *
 * Creates 4 tables:
 * - weekly_new_releases: Shared pool of new album releases gathered weekly from multiple sources
 * - personal_recommendation_lists: Per-user weekly recommendation lists with generation metadata
 * - personal_recommendation_items: Individual album recommendations within a list
 * - personal_recommendation_prompts: User custom prompt preferences for recommendations
 */

async function up(pool) {
  logger.info(
    'Running migration 053: Adding personal recommendations tables...'
  );

  // 1. Shared weekly new release pool
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_new_releases (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      album_id TEXT NOT NULL REFERENCES albums(album_id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('spotify', 'musicbrainz', 'claude_search')),
      release_date DATE,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      genre TEXT,
      verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(week_start, album_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_weekly_new_releases_week
    ON weekly_new_releases(week_start)
  `);

  // 2. Personal recommendation lists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personal_recommendation_lists (
      id SERIAL PRIMARY KEY,
      _id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      model TEXT NOT NULL,
      prompt_snapshot TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      UNIQUE(user_id, week_start)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_personal_rec_lists_user_week
    ON personal_recommendation_lists(user_id, week_start DESC)
  `);

  // 3. Albums in personal recommendation lists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personal_recommendation_items (
      id SERIAL PRIMARY KEY,
      _id TEXT UNIQUE NOT NULL,
      list_id TEXT NOT NULL REFERENCES personal_recommendation_lists(_id) ON DELETE CASCADE,
      album_id TEXT NOT NULL REFERENCES albums(album_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      reasoning TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(list_id, album_id),
      UNIQUE(list_id, position)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_personal_rec_items_list
    ON personal_recommendation_items(list_id, position)
  `);

  // 4. User prompt preferences
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personal_recommendation_prompts (
      id SERIAL PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      custom_prompt TEXT CHECK (char_length(custom_prompt) <= 1000),
      is_enabled BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  logger.info(
    'Migration 053 completed: Personal recommendations tables created'
  );
}

async function down(pool) {
  logger.info(
    'Rolling back migration 053: Dropping personal recommendations tables...'
  );

  await pool.query(
    'DROP TABLE IF EXISTS personal_recommendation_items CASCADE'
  );
  await pool.query(
    'DROP TABLE IF EXISTS personal_recommendation_lists CASCADE'
  );
  await pool.query(
    'DROP TABLE IF EXISTS personal_recommendation_prompts CASCADE'
  );
  await pool.query('DROP TABLE IF EXISTS weekly_new_releases CASCADE');

  logger.info('Rollback 053 complete: Personal recommendations tables dropped');
}

module.exports = { up, down };
