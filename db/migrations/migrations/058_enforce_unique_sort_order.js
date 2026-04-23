const logger = require('../../../utils/logger');

async function constraintExists(pool, tableName, constraintName) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_name = $1 AND constraint_name = $2`,
    [tableName, constraintName]
  );
  return result.rows.length > 0;
}

async function up(pool) {
  logger.info('Normalizing sort_order values before enforcing uniqueness...');

  await pool.query(`
    WITH ranked_groups AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY sort_order ASC, created_at ASC, id ASC
        ) - 1 AS next_sort_order
      FROM list_groups
    )
    UPDATE list_groups g
    SET sort_order = ranked_groups.next_sort_order,
        updated_at = NOW()
    FROM ranked_groups
    WHERE g.id = ranked_groups.id
      AND g.sort_order IS DISTINCT FROM ranked_groups.next_sort_order
  `);

  await pool.query(`
    WITH ranked_lists AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY group_id
          ORDER BY sort_order ASC, created_at ASC, id ASC
        ) - 1 AS next_sort_order
      FROM lists
      WHERE group_id IS NOT NULL
    )
    UPDATE lists l
    SET sort_order = ranked_lists.next_sort_order,
        updated_at = NOW()
    FROM ranked_lists
    WHERE l.id = ranked_lists.id
      AND l.sort_order IS DISTINCT FROM ranked_lists.next_sort_order
  `);

  if (
    !(await constraintExists(
      pool,
      'list_groups',
      'list_groups_user_sort_order_unique'
    ))
  ) {
    await pool.query(`
      ALTER TABLE list_groups
      ADD CONSTRAINT list_groups_user_sort_order_unique
      UNIQUE (user_id, sort_order)
      DEFERRABLE INITIALLY IMMEDIATE
    `);
  }

  if (
    !(await constraintExists(pool, 'lists', 'lists_group_sort_order_unique'))
  ) {
    await pool.query(`
      ALTER TABLE lists
      ADD CONSTRAINT lists_group_sort_order_unique
      UNIQUE (group_id, sort_order)
      DEFERRABLE INITIALLY IMMEDIATE
    `);
  }
}

async function down(pool) {
  logger.info('Removing sort_order uniqueness constraints...');

  await pool.query(`
    ALTER TABLE lists
    DROP CONSTRAINT IF EXISTS lists_group_sort_order_unique
  `);

  await pool.query(`
    ALTER TABLE list_groups
    DROP CONSTRAINT IF EXISTS list_groups_user_sort_order_unique
  `);
}

module.exports = { up, down };
