#!/usr/bin/env node

const { createMigrationPool } = require('../db/migration-policy');
const { positiveInteger } = require('../config/limits');
const MigrationManager = require('../db/migrations');
const logger = require('../utils/logger');

require('dotenv').config();

async function main() {
  const command = process.argv[2] || 'up';
  const pool = createMigrationPool();
  const migrationManager = new MigrationManager(pool);
  const deadline = setTimeout(
    () => {
      logger.error('Migration deployment deadline exceeded');
      process.exit(1); // Closing connections releases locks and rolls back active DDL.
    },
    positiveInteger(
      process.env.MIGRATION_DEADLINE_MS,
      1800000,
      'MIGRATION_DEADLINE_MS'
    )
  );
  deadline.unref();

  try {
    switch (command) {
      case 'up':
      case 'migrate':
        await migrationManager.runMigrations();
        if (
          process.env.BACKUP_DATABASE_URL &&
          process.env.CONTROL_DATABASE_URL
        ) {
          const {
            deploymentRoles,
            grantApplicationAccess,
          } = require('../db/deployment-roles');
          await grantApplicationAccess(pool, deploymentRoles());
        }
        break;

      case 'down':
      case 'rollback':
        await migrationManager.rollbackLastMigration();
        break;

      case 'status': {
        const status = await migrationManager.getMigrationStatus();
        console.log('\nMigration Status:');
        console.log('================');
        status.forEach((migration) => {
          const status = migration.executed ? '✓ Executed' : '✗ Pending';
          console.log(`${status} - ${migration.version}`);
        });
        break;
      }

      case 'create': {
        const name = process.argv[3];
        if (!name) {
          logger.error('Migration name is required');
          logger.error('Usage: npm run migrate:create <migration_name>');
          process.exit(1);
        }
        await createMigration(name);
        break;
      }

      default:
        console.log('Usage:');
        console.log('  npm run migrate up      - Run pending migrations');
        console.log('  npm run migrate down    - Rollback last migration');
        console.log('  npm run migrate status  - Show migration status');
        console.log('  npm run migrate create <name> - Create new migration');
        break;
    }
  } catch (error) {
    // Specific ops-friendly messages for the two recoverable cases.
    if (/marked irreversible/.test(error.message)) {
      logger.error(error.message);
      logger.error(
        'Restore from backup or add a down() function to roll this migration back.'
      );
    } else if (/migrations unknown to this code version/.test(error.message)) {
      logger.error(error.message);
      logger.error(
        'This usually means the DB was migrated by a newer build. Deploy the matching version or roll the DB back.'
      );
    } else {
      logger.error('Migration command failed', {
        error: error.message,
        stack: error.stack,
      });
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    await pool.end();
  }
}

async function createMigration(name) {
  const fs = require('fs');
  const path = require('path');

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, '');
  const filename = `${timestamp}_${name.replace(/\s+/g, '_').toLowerCase()}.js`;
  const migrationsDir = path.join(__dirname, '../db/migrations/migrations');

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const template = `// ${name}
module.exports = {
  async up(pool) {
    // Add your migration logic here
    // Example:
    // await pool.query(\`
    //   ALTER TABLE users ADD COLUMN new_field TEXT
    // \`);
  },

  async down(pool) {
    // Add your rollback logic here
    // Example:
    // await pool.query(\`
    //   ALTER TABLE users DROP COLUMN new_field
    // \`);
  }
};
`;

  const filePath = path.join(migrationsDir, filename);
  fs.writeFileSync(filePath, template);

  console.log(`Created migration: ${filename}`);
  console.log(`Path: ${filePath}`);
}

if (require.main === module) {
  main().catch(() => {
    logger.error('Migration configuration failed');
    process.exitCode = 1;
  });
}

module.exports = { main };
