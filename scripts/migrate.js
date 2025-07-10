#!/usr/bin/env node

const { Pool } = require('pg');
const MigrationManager = require('../db/migrations');
const logger = require('../utils/logger');

require('dotenv').config();

async function main() {
  const command = process.argv[2];

  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const migrationManager = new MigrationManager(pool);

  try {
    switch (command) {
      case 'up':
      case 'migrate':
        await migrationManager.runMigrations();
        break;

      case 'down':
      case 'rollback':
        await migrationManager.rollbackLastMigration();
        break;

      case 'status': {
        const status = await migrationManager.getMigrationStatus();
        // eslint-disable-next-line no-console
        console.log('\nMigration Status:');
        // eslint-disable-next-line no-console
        console.log('================');
        status.forEach((migration) => {
          const status = migration.executed ? '✓ Executed' : '✗ Pending';
          // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.log('Usage:');
        // eslint-disable-next-line no-console
        console.log('  npm run migrate up      - Run pending migrations');
        // eslint-disable-next-line no-console
        console.log('  npm run migrate down    - Rollback last migration');
        // eslint-disable-next-line no-console
        console.log('  npm run migrate status  - Show migration status');
        // eslint-disable-next-line no-console
        console.log('  npm run migrate create <name> - Create new migration');
        break;
    }
  } catch (error) {
    logger.error('Migration command failed:', { error: error.message });
    process.exit(1);
  } finally {
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

  // eslint-disable-next-line no-console
  console.log(`Created migration: ${filename}`);
  // eslint-disable-next-line no-console
  console.log(`Path: ${filePath}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
