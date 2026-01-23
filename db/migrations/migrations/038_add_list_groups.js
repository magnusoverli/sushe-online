const logger = require('../../../utils/logger');

/**
 * Migration: Add unified list_groups table
 *
 * Introduces a unified grouping system where both year-based groups and
 * custom collections coexist. Lists belong to exactly one group.
 *
 * - Year-groups: auto-created when a list has a year, participate in aggregates
 * - Collections: user-created custom categories, no year association
 *
 * All groups support drag-and-drop reordering via sort_order.
 */

async function up(pool) {
  logger.info('Creating list_groups table and migrating existing data...');

  // Step 0: Enable pgcrypto extension for gen_random_bytes
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // Step 1: Create list_groups table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS list_groups (
      id SERIAL PRIMARY KEY,
      _id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      year INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      
      CONSTRAINT list_groups_user_name_unique UNIQUE(user_id, name),
      CONSTRAINT list_groups_year_range CHECK (year IS NULL OR (year >= 1000 AND year <= 9999))
    )
  `);

  // Unique constraint: one year-group per year per user (NULL years excluded)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_list_groups_user_year_unique 
    ON list_groups(user_id, year) 
    WHERE year IS NOT NULL
  `);

  // Index for efficient user lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_list_groups_user 
    ON list_groups(user_id)
  `);

  // Step 2: Add group_id and sort_order to lists table
  await pool.query(`
    ALTER TABLE lists 
    ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES list_groups(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE lists 
    ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0
  `);

  // Index for efficient group lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lists_group 
    ON lists(group_id)
  `);

  // Step 3: Migrate existing data - create year-groups from existing years
  // Generate sort_order so years are in descending order (newest first)
  await pool.query(`
    INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
    SELECT 
      encode(gen_random_bytes(12), 'hex'),
      user_id,
      year::text,
      year,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY year DESC) - 1,
      MIN(created_at),
      NOW()
    FROM lists
    WHERE year IS NOT NULL
    GROUP BY user_id, year
    ON CONFLICT (user_id, name) DO NOTHING
  `);

  // Step 4: Assign group_id to lists that have years
  await pool.query(`
    UPDATE lists l
    SET group_id = g.id
    FROM list_groups g
    WHERE l.user_id = g.user_id 
      AND l.year = g.year 
      AND l.year IS NOT NULL
      AND l.group_id IS NULL
  `);

  // Step 5: Create "Uncategorized" collection for users with orphaned lists
  await pool.query(`
    INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
    SELECT 
      encode(gen_random_bytes(12), 'hex'),
      user_id,
      'Uncategorized',
      NULL,
      COALESCE((SELECT MAX(sort_order) + 1 FROM list_groups g2 WHERE g2.user_id = lists.user_id), 0),
      NOW(),
      NOW()
    FROM lists
    WHERE year IS NULL AND group_id IS NULL
    GROUP BY user_id
    ON CONFLICT (user_id, name) DO NOTHING
  `);

  // Step 6: Assign orphaned lists to their user's Uncategorized collection
  await pool.query(`
    UPDATE lists l
    SET group_id = g.id
    FROM list_groups g
    WHERE l.user_id = g.user_id 
      AND g.name = 'Uncategorized' 
      AND g.year IS NULL
      AND l.group_id IS NULL
  `);

  // Step 7: Set sort_order for lists within each group (alphabetical initially)
  await pool.query(`
    WITH ranked_lists AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY name) - 1 as new_order
      FROM lists
      WHERE group_id IS NOT NULL
    )
    UPDATE lists l
    SET sort_order = r.new_order
    FROM ranked_lists r
    WHERE l.id = r.id
  `);

  // Log migration stats
  const groupStats = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE year IS NOT NULL) as year_groups,
      COUNT(*) FILTER (WHERE year IS NULL) as collections
    FROM list_groups
  `);

  const listStats = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE group_id IS NOT NULL) as assigned,
      COUNT(*) FILTER (WHERE group_id IS NULL) as orphaned
    FROM lists
  `);

  logger.info('Migration complete', {
    yearGroups: groupStats.rows[0].year_groups,
    collections: groupStats.rows[0].collections,
    assignedLists: listStats.rows[0].assigned,
    orphanedLists: listStats.rows[0].orphaned,
  });
}

async function down(pool) {
  logger.info('Rolling back list_groups migration...');

  // Remove group_id and sort_order from lists
  await pool.query('DROP INDEX IF EXISTS idx_lists_group');
  await pool.query('ALTER TABLE lists DROP COLUMN IF EXISTS group_id');
  await pool.query('ALTER TABLE lists DROP COLUMN IF EXISTS sort_order');

  // Drop list_groups table
  await pool.query('DROP INDEX IF EXISTS idx_list_groups_user');
  await pool.query('DROP INDEX IF EXISTS idx_list_groups_user_year_unique');
  await pool.query('DROP TABLE IF EXISTS list_groups');

  logger.info('Rollback complete');
}

module.exports = { up, down };
