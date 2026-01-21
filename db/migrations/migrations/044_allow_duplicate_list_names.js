const logger = require('../../../utils/logger');

/**
 * Migration: Allow duplicate list names in different categories
 *
 * This migration changes the unique constraint on lists to allow the same
 * list name in different groups (years/collections). It also ensures all
 * lists belong to a group and updates last_selected_list to store list IDs.
 *
 * Changes:
 * 1. Ensure all orphaned lists belong to an "Uncategorized" group
 * 2. Drop the old unique constraint (user_id, name)
 * 3. Add new unique constraint (user_id, name, group_id)
 * 4. Make group_id NOT NULL
 * 5. Migrate last_selected_list from name-based to ID-based
 */

async function up(pool) {
  logger.info(
    'Starting migration: Allow duplicate list names in different categories'
  );

  // Step 1: Create "Uncategorized" groups for users with orphaned lists
  logger.info('Step 1: Creating Uncategorized groups for orphaned lists...');

  // Find users with orphaned lists who don't have an Uncategorized group
  const orphanedUsersResult = await pool.query(`
    SELECT DISTINCT l.user_id
    FROM lists l
    WHERE l.group_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM list_groups g 
      WHERE g.user_id = l.user_id 
      AND g.name = 'Uncategorized' 
      AND g.year IS NULL
    )
  `);

  for (const row of orphanedUsersResult.rows) {
    const userId = row.user_id;

    // Get max sort_order for this user's groups
    const maxOrderResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM list_groups WHERE user_id = $1`,
      [userId]
    );

    // Create Uncategorized group
    await pool.query(
      `
      INSERT INTO list_groups (_id, user_id, name, year, sort_order, created_at, updated_at)
      VALUES (encode(gen_random_bytes(12), 'hex'), $1, 'Uncategorized', NULL, $2, NOW(), NOW())
    `,
      [userId, maxOrderResult.rows[0].next_order]
    );
  }

  // Step 2: Assign all orphaned lists to their user's Uncategorized group
  logger.info('Step 2: Assigning orphaned lists to Uncategorized groups...');

  const assignResult = await pool.query(`
    UPDATE lists l
    SET group_id = g.id, updated_at = NOW()
    FROM list_groups g
    WHERE l.user_id = g.user_id 
    AND g.name = 'Uncategorized' 
    AND g.year IS NULL
    AND l.group_id IS NULL
  `);

  logger.info(
    `Assigned ${assignResult.rowCount} orphaned lists to Uncategorized groups`
  );

  // Verify no orphaned lists remain
  const orphanCheck = await pool.query(
    `SELECT COUNT(*) as count FROM lists WHERE group_id IS NULL`
  );
  if (parseInt(orphanCheck.rows[0].count, 10) > 0) {
    throw new Error(
      `Migration failed: ${orphanCheck.rows[0].count} lists still have no group_id`
    );
  }

  // Step 3: Drop the old unique constraint
  logger.info('Step 3: Dropping old unique constraint (user_id, name)...');

  // Check if constraint exists before dropping
  const constraintCheck = await pool.query(`
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'lists' AND constraint_name = 'unique_user_name'
  `);

  if (constraintCheck.rows.length > 0) {
    await pool.query(`ALTER TABLE lists DROP CONSTRAINT unique_user_name`);
    logger.info('Dropped constraint: unique_user_name');
  } else {
    logger.info('Constraint unique_user_name does not exist, skipping drop');
  }

  // Step 4: Add new unique constraint (user_id, name, group_id)
  logger.info(
    'Step 4: Adding new unique constraint (user_id, name, group_id)...'
  );

  await pool.query(`
    ALTER TABLE lists 
    ADD CONSTRAINT unique_user_group_name UNIQUE(user_id, name, group_id)
  `);

  // Step 5: Make group_id NOT NULL
  logger.info('Step 5: Making group_id NOT NULL...');

  await pool.query(`ALTER TABLE lists ALTER COLUMN group_id SET NOT NULL`);

  // Step 6: Migrate last_selected_list from name to ID
  logger.info('Step 6: Migrating last_selected_list from name to ID...');

  // Update users where last_selected_list is a name (not an ID format)
  // IDs are 24 hex chars, names could be anything
  const migrateLSL = await pool.query(`
    UPDATE users u
    SET last_selected_list = l._id
    FROM lists l
    WHERE u.last_selected_list IS NOT NULL
    AND u.last_selected_list = l.name
    AND l.user_id = u._id
  `);

  logger.info(
    `Migrated ${migrateLSL.rowCount} users' last_selected_list to list IDs`
  );

  // Log final stats
  const stats = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM lists) as total_lists,
      (SELECT COUNT(*) FROM lists WHERE group_id IS NOT NULL) as lists_with_group,
      (SELECT COUNT(*) FROM list_groups) as total_groups,
      (SELECT COUNT(*) FROM list_groups WHERE year IS NULL) as collection_groups
  `);

  logger.info('Migration complete', {
    totalLists: stats.rows[0].total_lists,
    listsWithGroup: stats.rows[0].lists_with_group,
    totalGroups: stats.rows[0].total_groups,
    collectionGroups: stats.rows[0].collection_groups,
  });
}

async function down(pool) {
  logger.info('Rolling back migration: Allow duplicate list names...');

  // Step 1: Make group_id nullable again
  await pool.query(`ALTER TABLE lists ALTER COLUMN group_id DROP NOT NULL`);

  // Step 2: Drop the new constraint
  const constraintCheck = await pool.query(`
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'lists' AND constraint_name = 'unique_user_group_name'
  `);

  if (constraintCheck.rows.length > 0) {
    await pool.query(
      `ALTER TABLE lists DROP CONSTRAINT unique_user_group_name`
    );
  }

  // Step 3: Re-add the old constraint
  // Note: This may fail if there are now duplicate names
  try {
    await pool.query(`
      ALTER TABLE lists 
      ADD CONSTRAINT unique_user_name UNIQUE(user_id, name)
    `);
  } catch (err) {
    logger.error(
      'Failed to re-add unique_user_name constraint - duplicate names may exist',
      {
        error: err.message,
      }
    );
    throw err;
  }

  // Step 4: Migrate last_selected_list back from ID to name
  await pool.query(`
    UPDATE users u
    SET last_selected_list = l.name
    FROM lists l
    WHERE u.last_selected_list IS NOT NULL
    AND u.last_selected_list = l._id
    AND l.user_id = u._id
  `);

  logger.info('Rollback complete');
}

module.exports = { up, down };
