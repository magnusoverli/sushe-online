const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

class MigrationManager {
  constructor(pool) {
    this.pool = pool;
    this.migrationsDir = path.join(__dirname, 'migrations');
    this.migrationTableName = 'schema_migrations';
  }

  async ensureMigrationTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.migrationTableName} (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      )
    `);
  }

  async getExecutedMigrations() {
    const result = await this.pool.query(
      `SELECT version FROM ${this.migrationTableName} ORDER BY version`
    );
    return result.rows.map((row) => row.version);
  }

  async getMigrationFiles() {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
      return [];
    }

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith('.js'))
      .sort();

    return files.map((file) => {
      const version = file.replace('.js', '');
      const filePath = path.join(this.migrationsDir, file);
      return { version, filePath };
    });
  }

  async calculateChecksum(filePath) {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async executeMigration(migration) {
    const { version, filePath } = migration;

    // Acquire a dedicated client for transaction isolation
    const client = await this.pool.connect();

    try {
      logger.info(`Executing migration: ${version}`);

      const migrationModule = require(filePath);
      const checksum = await this.calculateChecksum(filePath);

      // Start transaction on dedicated client
      await client.query('BEGIN');

      // Execute the migration using the same client
      if (typeof migrationModule.up === 'function') {
        await migrationModule.up(client);
      } else {
        throw new Error(
          `Migration ${version} does not export an 'up' function`
        );
      }

      // Record the migration on the same client
      await client.query(
        `INSERT INTO ${this.migrationTableName} (version, name, checksum) VALUES ($1, $2, $3)`,
        [version, path.basename(filePath, '.js'), checksum]
      );

      // Commit transaction
      await client.query('COMMIT');

      logger.info(`Migration ${version} executed successfully`);

      // Run post-migration hook outside transaction (for VACUUM, etc.)
      // Use pool here since transaction is complete
      if (typeof migrationModule.postMigrate === 'function') {
        try {
          logger.info(`Running post-migration hook for ${version}...`);
          await migrationModule.postMigrate(this.pool);
          logger.info(`Post-migration hook for ${version} completed`);
        } catch (postError) {
          // Log but don't fail - the migration itself succeeded
          logger.warn(
            `Post-migration hook for ${version} failed (non-fatal):`,
            {
              error: postError.message,
            }
          );
        }
      }
    } catch (error) {
      // Rollback transaction on the same client
      await client.query('ROLLBACK');
      logger.error(`Migration ${version} failed:`, { error: error.message });
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  }

  async rollbackMigration(migration) {
    const { version, filePath } = migration;

    // Acquire a dedicated client for transaction isolation
    const client = await this.pool.connect();

    try {
      logger.info(`Rolling back migration: ${version}`);

      const migrationModule = require(filePath);

      // Start transaction on dedicated client
      await client.query('BEGIN');

      // Execute the rollback using the same client
      if (typeof migrationModule.down === 'function') {
        await migrationModule.down(client);
      } else {
        throw new Error(
          `Migration ${version} does not export a 'down' function`
        );
      }

      // Remove the migration record on the same client
      await client.query(
        `DELETE FROM ${this.migrationTableName} WHERE version = $1`,
        [version]
      );

      // Commit transaction
      await client.query('COMMIT');

      logger.info(`Migration ${version} rolled back successfully`);
    } catch (error) {
      // Rollback transaction on the same client
      await client.query('ROLLBACK');
      logger.error(`Rollback of migration ${version} failed:`, {
        error: error.message,
      });
      throw error;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  }

  async runMigrations() {
    await this.ensureMigrationTable();

    const executedMigrations = await this.getExecutedMigrations();
    const migrationFiles = await this.getMigrationFiles();

    const pendingMigrations = migrationFiles.filter(
      (migration) => !executedMigrations.includes(migration.version)
    );

    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Found ${pendingMigrations.length} pending migrations`);

    for (const migration of pendingMigrations) {
      await this.executeMigration(migration);
    }

    logger.info('All migrations completed successfully');
  }

  async rollbackLastMigration() {
    await this.ensureMigrationTable();

    const result = await this.pool.query(
      `SELECT version FROM ${this.migrationTableName} ORDER BY executed_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      logger.info('No migrations to rollback');
      return;
    }

    const lastVersion = result.rows[0].version;
    const migrationFiles = await this.getMigrationFiles();
    const migration = migrationFiles.find((m) => m.version === lastVersion);

    if (!migration) {
      throw new Error(`Migration file for version ${lastVersion} not found`);
    }

    await this.rollbackMigration(migration);
  }

  async getMigrationStatus() {
    await this.ensureMigrationTable();

    const executedMigrations = await this.getExecutedMigrations();
    const migrationFiles = await this.getMigrationFiles();

    return migrationFiles.map((migration) => ({
      version: migration.version,
      executed: executedMigrations.includes(migration.version),
      filePath: migration.filePath,
    }));
  }
}

module.exports = MigrationManager;
