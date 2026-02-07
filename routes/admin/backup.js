/**
 * Admin Database Backup/Restore Routes
 *
 * Handles database backup and restore operations:
 * - /admin/backup - Download database backup (pg_dump)
 * - /admin/restore - Restore database from backup file
 */

const logger = require('../../utils/logger');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, upload, pool } = deps;

  // PostgreSQL client configuration
  const pgMajor = process.env.PG_MAJOR || '18';
  const binDir = process.env.PG_BIN || `/usr/lib/postgresql/${pgMajor}/bin`;
  const pgDumpCmd = fs.existsSync(path.join(binDir, 'pg_dump'))
    ? path.join(binDir, 'pg_dump')
    : process.env.PG_DUMP || 'pg_dump';
  const pgRestoreCmd = fs.existsSync(path.join(binDir, 'pg_restore'))
    ? path.join(binDir, 'pg_restore')
    : process.env.PG_RESTORE || 'pg_restore';

  // Check if running in Docker (Unix socket connection)
  const isDocker =
    process.env.DATABASE_URL &&
    process.env.DATABASE_URL.includes('host=/var/run/postgresql');

  // Admin: Backup entire database using pg_dump
  app.get('/admin/backup', ensureAuth, ensureAdmin, (req, res) => {
    // For Docker setup, connect via TCP to the 'db' service
    const dbUrl = process.env.DATABASE_URL || '';

    let dump;
    if (isDocker) {
      // Running in Docker - connect via TCP to the 'db' service
      const env = {
        ...process.env,
        PGHOST: 'db',
        PGPORT: '5432',
        PGDATABASE: 'sushe',
        PGUSER: 'postgres',
        PGPASSWORD: 'example',
      };

      dump = spawn(pgDumpCmd, ['-Fc'], { env });
      logger.info('Using pg_dump with TCP connection to database service');
    } else {
      // Local development - use DATABASE_URL
      dump = spawn(pgDumpCmd, ['-Fc', '-d', dbUrl]);
      logger.info('Using pg_dump with DATABASE_URL connection');
    }

    // Collect backup data in memory to verify before sending
    const chunks = [];
    const stderrChunks = [];

    dump.stdout.on('data', (chunk) => {
      chunks.push(chunk);
    });

    dump.stderr.on('data', (d) => {
      // Collect stderr output but don't treat warnings as errors
      // pg_dump writes warnings to stderr even on successful dumps
      stderrChunks.push(d.toString());
    });

    dump.on('error', (err) => {
      logger.error('Backup error:', err);
      if (!res.headersSent) {
        res.status(500).send('Error creating backup');
      }
    });

    dump.on('close', (code) => {
      // Log any stderr output (warnings, notices, etc.)
      if (stderrChunks.length > 0) {
        const stderrOutput = stderrChunks.join('');
        if (code !== 0) {
          logger.error('pg_dump error output:', stderrOutput);
        } else {
          // Log warnings but don't fail the backup
          logger.warn('pg_dump warnings:', stderrOutput);
        }
      }

      // Only fail if exit code is non-zero
      if (code !== 0) {
        logger.error('pg_dump exited with code', code);
        if (!res.headersSent) {
          res.status(500).send('Error creating backup');
        }
        return;
      }

      const backup = Buffer.concat(chunks);

      // Verify backup integrity by checking magic bytes
      if (backup.length < 5 || backup.slice(0, 5).toString() !== 'PGDMP') {
        logger.error('Backup verification failed: invalid format');
        if (!res.headersSent) {
          res.status(500).send('Backup verification failed');
        }
        return;
      }

      // Backup is valid, send to user
      logger.info(
        `Backup created successfully (${(backup.length / 1024 / 1024).toFixed(2)} MB)`
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="sushe-db.dump"'
      );
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(backup);
    });
  });

  // Admin: Restore database from pg_dump file
  app.post(
    '/admin/restore',
    ensureAuth,
    ensureAdmin,
    upload.single('backup'),
    async (req, res) => {
      const restoreStartTime = Date.now();
      const restoreId = `restore_${restoreStartTime}`;

      logger.info(`[${restoreId}] === DATABASE RESTORE STARTED ===`, {
        user: req.user.username,
        fileSize: req.file?.size,
        clientIp: req.ip,
        timestamp: new Date().toISOString(),
      });

      if (!req.file) {
        logger.error(`[${restoreId}] No file uploaded`);
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const tmpFile = req.file.path;
      const fileSize = req.file.size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

      logger.info(`[${restoreId}] File upload complete`, {
        tmpFile,
        fileSize,
        fileSizeMB: `${fileSizeMB} MB`,
        uploadDuration: `${Date.now() - restoreStartTime}ms`,
      });

      // Validate that the file is a valid PostgreSQL dump file
      try {
        const validationStart = Date.now();
        const header = Buffer.alloc(5);
        const fd = fs.openSync(tmpFile, 'r');
        fs.readSync(fd, header, 0, 5, 0);
        fs.closeSync(fd);

        if (header.toString() !== 'PGDMP') {
          logger.error(`[${restoreId}] Invalid backup file header`, {
            header: header.toString(),
          });
          fs.unlinkSync(tmpFile);
          return res.status(400).json({
            error: 'Invalid backup file. Must be a PostgreSQL dump file.',
          });
        }

        logger.info(`[${restoreId}] File validation passed`, {
          validationDuration: `${Date.now() - validationStart}ms`,
        });
      } catch (err) {
        logger.error(`[${restoreId}] Error validating backup file:`, err);
        fs.unlinkSync(tmpFile);
        return res.status(400).json({
          error: 'Unable to validate backup file',
        });
      }

      const pgRestoreStart = Date.now();

      // For Docker setup, connect via TCP instead of Unix socket
      const dbUrl = process.env.DATABASE_URL || '';

      // Pre-restore: Drop all tables in public schema with CASCADE
      // This prevents foreign key constraint errors when restoring older backups
      // that don't have newer tables (e.g., album_distinct_pairs)
      try {
        logger.info(
          `[${restoreId}] Dropping all tables before restore to avoid FK conflicts`
        );

        // Get all table names in public schema
        const tablesResult = await pool.query(`
          SELECT tablename FROM pg_tables 
          WHERE schemaname = 'public'
        `);

        if (tablesResult.rows.length > 0) {
          const tableNames = tablesResult.rows
            .map((r) => `"${r.tablename}"`)
            .join(', ');
          await pool.query(`DROP TABLE IF EXISTS ${tableNames} CASCADE`);
          logger.info(
            `[${restoreId}] Dropped ${tablesResult.rows.length} tables`
          );
        }

        // Also drop the migration tracking table so migrations re-run
        await pool.query('DROP TABLE IF EXISTS migrations CASCADE');
        logger.info(`[${restoreId}] Dropped migrations table`);
      } catch (dropErr) {
        logger.warn(
          `[${restoreId}] Pre-restore table drop failed (non-fatal)`,
          {
            error: dropErr.message,
          }
        );
        // Continue with restore anyway - pg_restore --clean may still work
      }

      let restore;
      if (isDocker) {
        // Running in Docker - connect via TCP to the 'db' service
        const env = {
          ...process.env,
          PGHOST: 'db',
          PGPORT: '5432',
          PGDATABASE: 'sushe',
          PGUSER: 'postgres',
          PGPASSWORD: 'example',
        };

        logger.info(`[${restoreId}] Starting pg_restore process via TCP`, {
          command: pgRestoreCmd,
          args: [
            '--clean',
            '--if-exists',
            '--single-transaction',
            '-d',
            'sushe',
          ],
        });

        restore = spawn(
          pgRestoreCmd,
          ['--clean', '--if-exists', '--single-transaction', '-d', 'sushe'],
          { env }
        );

        // Pipe the backup file content to pg_restore via stdin
        const fileStream = fs.createReadStream(tmpFile);
        fileStream.pipe(restore.stdin);
        fileStream.on('error', (err) => {
          logger.error(`[${restoreId}] Error reading backup file:`, err);
        });
      } else {
        // Local development fallback
        logger.info(`[${restoreId}] Starting pg_restore process`, {
          command: pgRestoreCmd,
          args: ['--clean', '--if-exists', '--single-transaction', '-d', '***'],
        });

        restore = spawn(pgRestoreCmd, [
          '--clean',
          '--if-exists',
          '--single-transaction',
          '-d',
          dbUrl,
          tmpFile,
        ]);
      }

      let stderrData = '';
      restore.stderr.on('data', (data) => {
        const output = data.toString();
        stderrData += output;
        logger.error(`[${restoreId}] pg_restore stderr:`, output);
      });

      restore.on('error', (err) => {
        const elapsed = Date.now() - pgRestoreStart;
        logger.error(`[${restoreId}] Restore process error`, {
          error: err.message,
          elapsed: `${elapsed}ms`,
        });

        if (!res.headersSent) {
          res.status(500).json({ error: 'Error restoring database' });
        } else {
          logger.error(
            `[${restoreId}] Cannot send error response - headers already sent`
          );
        }
      });

      restore.on('exit', async (code) => {
        const pgRestoreDuration = Date.now() - pgRestoreStart;
        logger.info(`[${restoreId}] pg_restore process exited`, {
          exitCode: code,
          duration: `${pgRestoreDuration}ms`,
          durationSeconds: (pgRestoreDuration / 1000).toFixed(2),
        });

        fs.unlink(tmpFile, () => {});

        if (code === 0) {
          // Clear all sessions after restore using direct SQL
          try {
            const sessionClearStart = Date.now();
            await pool.query('DELETE FROM session');
            logger.info(`[${restoreId}] All sessions cleared`, {
              duration: `${Date.now() - sessionClearStart}ms`,
            });
          } catch (err) {
            logger.error(
              `[${restoreId}] Error clearing sessions after restore:`,
              err
            );
          }

          const totalDuration = Date.now() - restoreStartTime;
          logger.info(`[${restoreId}] Sending success response to client`, {
            totalDuration: `${totalDuration}ms`,
            totalSeconds: (totalDuration / 1000).toFixed(2),
            responseHeadersSent: res.headersSent,
          });

          if (!res.headersSent) {
            res.json({
              success: true,
              message:
                'Database restored successfully. Server will restart in 3 seconds...',
            });
            logger.info(
              `[${restoreId}] Success response sent, headers now sent: ${res.headersSent}`
            );
          } else {
            logger.error(
              `[${restoreId}] CRITICAL: Cannot send response - headers already sent!`
            );
          }

          // Schedule server restart to clear prepared statement cache
          logger.info(
            `[${restoreId}] Scheduling server restart in 3 seconds...`
          );
          setTimeout(() => {
            logger.info(`[${restoreId}] Restarting server now...`);

            // In development with nodemon, touch a file to trigger restart
            // In production, Docker's restart policy will handle the exit
            if (process.env.NODE_ENV === 'development') {
              const triggerFile = path.join(
                __dirname,
                '../../.restart-trigger'
              );
              let restartTriggered = false;
              try {
                // Touch the file to trigger nodemon's file watcher
                const now = new Date();
                fs.utimesSync(triggerFile, now, now);
                logger.info(
                  `[${restoreId}] Triggered nodemon restart via file touch`
                );
                restartTriggered = true;
              } catch (_err) {
                // File doesn't exist, create it
                try {
                  fs.writeFileSync(triggerFile, String(Date.now()));
                  logger.info(
                    `[${restoreId}] Created restart trigger file for nodemon`
                  );
                  restartTriggered = true;
                } catch (createErr) {
                  logger.warn(
                    `[${restoreId}] Could not create restart trigger file`,
                    { error: createErr.message }
                  );
                }
              }

              // In dev mode, if file touch succeeded, nodemon will restart gracefully
              // No need to call process.exit()
              if (restartTriggered) {
                logger.info(
                  `[${restoreId}] Nodemon will restart gracefully via file change detection`
                );
                return;
              }
            }

            // Exit the process - Docker will restart the container in production
            // Or fallback if file touch failed in development
            logger.info(
              `[${restoreId}] Triggering hard restart via process.exit()`
            );
            process.exit(1);
          }, 3000);
        } else {
          const totalDuration = Date.now() - restoreStartTime;
          logger.error(`[${restoreId}] pg_restore failed`, {
            exitCode: code,
            totalDuration: `${totalDuration}ms`,
            stderrSample: stderrData.slice(-500), // Last 500 chars of stderr
          });

          if (!res.headersSent) {
            res.status(500).json({ error: 'Error restoring database' });
          } else {
            logger.error(
              `[${restoreId}] Cannot send error response - headers already sent`
            );
          }
        }

        logger.info(
          `[${restoreId}] === DATABASE RESTORE COMPLETED (exit code: ${code}) ===`
        );
      });

      // Log if the connection closes unexpectedly
      req.on('close', () => {
        const elapsed = Date.now() - restoreStartTime;
        logger.warn(`[${restoreId}] Client connection closed`, {
          elapsed: `${elapsed}ms`,
          finished: req.complete,
        });
      });

      res.on('finish', () => {
        const elapsed = Date.now() - restoreStartTime;
        logger.info(`[${restoreId}] Response finished event fired`, {
          elapsed: `${elapsed}ms`,
          statusCode: res.statusCode,
        });
      });

      res.on('close', () => {
        const elapsed = Date.now() - restoreStartTime;
        logger.warn(`[${restoreId}] Response connection closed`, {
          elapsed: `${elapsed}ms`,
          finished: res.writableEnded,
        });
      });
    }
  );
};
