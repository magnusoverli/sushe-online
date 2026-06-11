const logger = require('../../../utils/logger');

/**
 * Three verified divergences between a fresh migration-built schema and the
 * long-lived production database. Each step is conditional, so this is a
 * no-op on databases that are already in the production shape.
 *
 * 1. users.reset_expires — the code writes/compares epoch milliseconds
 *    (db/repositories/users-repository.js), which requires BIGINT; 001
 *    created it as TIMESTAMPTZ, breaking password reset on fresh builds.
 * 2. lists UNIQUE(user_id, name) — 044 replaced this with
 *    unique_user_group_name but only dropped the constraint under one of its
 *    two historical names, so fresh builds still reject duplicate list names
 *    across groups.
 * 3. albums._id — dead column from the pre-canonical era; nothing reads or
 *    writes it (061 already relaxed its NOT NULL), but its unique index
 *    taxes every album insert on fresh builds.
 */
async function up(pool) {
  logger.info('Aligning fresh-built schema with production shape...');

  // 1. reset_expires: TIMESTAMPTZ -> BIGINT (epoch ms)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'reset_expires'
          AND data_type = 'timestamp with time zone'
      ) THEN
        ALTER TABLE users
        ALTER COLUMN reset_expires TYPE BIGINT
        USING (extract(epoch FROM reset_expires) * 1000)::bigint;
        RAISE NOTICE 'users.reset_expires converted to BIGINT epoch ms';
      END IF;
    END $$;
  `);

  // 2. Drop the per-user list-name unique constraint under both historical names
  await pool.query(
    `ALTER TABLE lists DROP CONSTRAINT IF EXISTS lists_user_id_name_key`
  );
  await pool.query(
    `ALTER TABLE lists DROP CONSTRAINT IF EXISTS unique_user_name`
  );

  // 3. Drop the dead albums._id column (and its unique index with it)
  await pool.query(`ALTER TABLE albums DROP COLUMN IF EXISTS _id`);

  logger.info('Fresh-schema alignment complete');
}

async function down() {
  logger.info(
    '066_align_fresh_schema_with_prod matches production state and does not roll back'
  );
}

module.exports = { up, down };
