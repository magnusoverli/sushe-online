// @ts-check
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { acceptsHistoricalChecksum } = require('./historical-checksums');

// Postgres advisory-lock key. Stable across deployments so concurrent pods
// serialize on the same lock. Fits in JS safe-integer range.
// Derived from the ASCII bytes of 'SuSh' — no semantic meaning beyond
// being app-specific and reproducible.
const MIGRATION_LOCK_KEY = 0x53755368; // 1400072552

/**
 * A migration module discovered on disk by {@link MigrationManager#getMigrationFiles}.
 * @typedef {Object} MigrationFile
 * @property {string} version - Migration filename without the `.js` extension;
 *   matches `schema_migrations.version`.
 * @property {string} filePath - Absolute path to the migration module.
 */

class MigrationManager {
  /**
   * @param {import('pg').Pool} pool - pg Pool used for migration queries and
   *   for checking out dedicated clients for transactional migrations.
   */
  constructor(pool) {
    this.pool = pool;
    /** @type {import('pg').PoolClient | null} */
    this.lockClient = null;
    /** @type {Error | undefined} */
    this.lockClientError = undefined;
    this.migrationsDir = path.join(__dirname, 'migrations');
    this.migrationTableName = 'schema_migrations';
  }

  async ensureMigrationTable() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${this.migrationTableName} (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      )
    `);
  }

  /**
   * @returns {Promise<string[]>} Versions already recorded in `schema_migrations`.
   */
  async getExecutedMigrations() {
    /** @type {import('pg').QueryResult<{ version: string }>} */
    const result = await this.query(
      `SELECT version FROM ${this.migrationTableName} ORDER BY version`
    );
    return result.rows.map((row) => row.version);
  }

  /**
   * @returns {Promise<MigrationFile[]>} Migration modules on disk, sorted by version.
   */
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

  /**
   * @param {string} filePath - Absolute path to a migration module.
   * @returns {Promise<string>} Hex-encoded SHA-256 of the file contents.
   */
  async calculateChecksum(filePath) {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * @param {MigrationFile} migration - Migration to apply.
   * @returns {Promise<void>}
   */
  async executeMigration(migration) {
    const { version, filePath } = migration;

    // Acquire a dedicated client for transaction isolation
    const client = this.lockClient || (await this.pool.connect());
    let releaseError;

    try {
      logger.info(`Executing migration: ${version}`);

      const migrationModule = require(filePath);
      const checksum = await this.calculateChecksum(filePath);

      // Start transaction on dedicated client
      await client.query('BEGIN');
      // The dedicated migration pool supplies bounded server timeouts without
      // inheriting the runtime client's shorter query deadline.

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
          await migrationModule.postMigrate(client);
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
      // Rollback transaction on the same client; if ROLLBACK itself fails,
      // poison the connection so the pool discards it instead of reusing it
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError;
        logger.error(`ROLLBACK failed after migration ${version} error:`, {
          rollbackError: rollbackError.message,
        });
      }
      logger.error(`Migration ${version} failed:`, { error: error.message });
      throw error;
    } finally {
      // Always release the client back to the pool
      if (client !== this.lockClient) client.release(releaseError);
      else if (releaseError) this.lockClientError = releaseError;
    }
  }

  /**
   * @param {MigrationFile} migration - Migration to revert.
   * @returns {Promise<void>}
   */
  async rollbackMigration(migration) {
    const { version, filePath } = migration;

    const migrationModule = require(filePath);

    // Irreversible migrations opt out explicitly. Surface the reason clearly
    // instead of either silently failing or stack-tracing from a best-effort
    // synthesized down().
    if (migrationModule.irreversible === true) {
      throw new Error(
        `Migration ${version} is marked irreversible — restore from backup instead.`
      );
    }

    // Acquire a dedicated client for transaction isolation
    const client = this.lockClient || (await this.pool.connect());
    let releaseError;

    try {
      logger.info(`Rolling back migration: ${version}`);

      // Start transaction on dedicated client
      await client.query('BEGIN');

      // Execute the rollback using the same client
      if (typeof migrationModule.down === 'function') {
        await migrationModule.down(client);
      } else {
        throw new Error(
          `Migration ${version} does not export a 'down' function ` +
            `(consider adding one or marking the migration irreversible)`
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
      // Rollback transaction on the same client; if ROLLBACK itself fails,
      // poison the connection so the pool discards it instead of reusing it
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError;
        logger.error(
          `ROLLBACK failed after rollback of migration ${version} error:`,
          { rollbackError: rollbackError.message }
        );
      }
      logger.error(`Rollback of migration ${version} failed:`, {
        error: error.message,
      });
      throw error;
    } finally {
      // Always release the client back to the pool
      if (client !== this.lockClient) client.release(releaseError);
      else if (releaseError) this.lockClientError = releaseError;
    }
  }

  /**
   * Refuse to start if the schema_migrations table references versions that
   * this code doesn't know about. Prevents a rolled-back deployment (older
   * code) from silently operating against a DB that was already migrated
   * forward by a newer build — where schema assumptions may have diverged.
   * @private
   */
  async _checkForwardSchemaGuard() {
    const migrationFiles = await this.getMigrationFiles();
    const onDisk = new Set(migrationFiles.map((m) => m.version));
    const executed = await this.getExecutedMigrations();
    const unknown = executed.filter((v) => !onDisk.has(v));
    if (unknown.length > 0) {
      const sample = unknown.slice(0, 5).join(', ');
      throw new Error(
        `Database has migrations unknown to this code version: ${sample}` +
          (unknown.length > 5 ? ` (+${unknown.length - 5} more)` : '') +
          `. Deploy a newer build that includes these migrations, or roll ` +
          `the database back before starting this version.`
      );
    }
  }

  /**
   * Run all pending migrations under a Postgres advisory lock so two app
   * instances starting simultaneously don't race. The forward-schema guard
   * runs under the lock so it sees any preceding migrator's committed work.
   */
  /** @param {() => Promise<void>} callback */
  async withMigrationLock(callback) {
    const lockClient = await this.pool.connect();
    let heldLock = false;
    let lockClientError;
    /** @param {Error} error */
    const lost = (error) => {
      this.lockClientError = error;
    };
    lockClient.on?.('error', lost);
    try {
      // Acquire the advisory lock — blocks if another pod holds it, then
      // proceeds. The lock is released by pg_advisory_unlock() or on
      // client disconnect (in finally, on release).
      await lockClient.query('SELECT pg_advisory_lock($1)', [
        MIGRATION_LOCK_KEY,
      ]);
      heldLock = true;
      this.lockClient = lockClient;
      this.lockClientError = undefined;
      await this.ensureMigrationTable();
      await this._checkForwardSchemaGuard();
      await this.verifyChecksums();
      await callback();
    } finally {
      if (heldLock) {
        try {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [
            MIGRATION_LOCK_KEY,
          ]);
        } catch (err) {
          lockClientError = err;
        }
      }
      lockClient.removeListener?.('error', lost);
      lockClient.release(lockClientError || this.lockClientError);
      this.lockClient = null;
      this.lockClientError = undefined;
    }
  }

  async verifyChecksums() {
    const rows = await this.query(
      `SELECT version, checksum FROM ${this.migrationTableName}`
    );
    const files = await this.getMigrationFiles();
    const executed = new Set(rows.rows.map((row) => row.version));
    for (const row of rows.rows) {
      const file = files.find((entry) => entry.version === row.version);
      const current = file ? await this.calculateChecksum(file.filePath) : null;
      if (
        !file ||
        (row.checksum !== current &&
          !(await acceptsHistoricalChecksum({
            version: row.version,
            recorded: row.checksum,
            current,
            executed,
            query: (sql, values) => this.query(sql, values),
          })))
      ) {
        throw new Error(
          `Migration checksum mismatch: ${row.version}. Applied migrations are immutable; restore matching migration files.`
        );
      }
    }
  }

  async validateSchema() {
    await this._checkForwardSchemaGuard();
    if ((await this.getMigrationStatus()).some((entry) => !entry.executed))
      throw new Error(
        'Database migrations are pending; run the deployment migration command before starting the app'
      );
    await this.verifyChecksums();
  }

  async runMigrations() {
    await this.withMigrationLock(async () => {
      // Re-read executed migrations AFTER acquiring the lock — another pod
      // may have just finished running migrations we thought were pending.
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
    });
  }

  async rollbackLastMigration() {
    await this.withMigrationLock(async () => {
      const result = await this.query(
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
    });
  }

  async getMigrationStatus() {
    // Strictly read-only: health/readiness probes call this. Issuing the
    // CREATE TABLE IF NOT EXISTS here would take DDL locks — and a probe
    // firing mid-pg_restore can abort the entire --single-transaction
    // restore with "relation already exists".
    const tableCheck = await this.query(
      `SELECT to_regclass($1) IS NOT NULL AS table_exists`,
      [this.migrationTableName]
    );
    const executedMigrations = tableCheck.rows[0].table_exists
      ? await this.getExecutedMigrations()
      : [];
    const migrationFiles = await this.getMigrationFiles();

    return migrationFiles.map((migration) => ({
      version: migration.version,
      executed: executedMigrations.includes(migration.version),
      filePath: migration.filePath,
    }));
  }

  /** @param {string} sql @param {unknown[]} [params] */
  query(sql, params) {
    if (this.lockClientError) return Promise.reject(this.lockClientError);
    return (this.lockClient || this.pool).query(sql, params);
  }
}

module.exports = MigrationManager;
