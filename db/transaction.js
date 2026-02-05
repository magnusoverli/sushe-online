/**
 * Database Transaction Utilities
 *
 * Provides a centralized helper for running database operations within
 * a PostgreSQL transaction, eliminating repeated boilerplate across routes.
 *
 * Usage:
 *   const { withTransaction, TransactionAbort } = require('../db/transaction');
 *
 *   // In a route handler:
 *   try {
 *     const result = await withTransaction(pool, async (client) => {
 *       // ... business logic using client ...
 *       // Throw TransactionAbort for expected validation failures:
 *       if (!found) throw new TransactionAbort(404, { error: 'Not found' });
 *       return { success: true };
 *     });
 *     res.json(result);
 *   } catch (err) {
 *     if (err instanceof TransactionAbort) {
 *       return res.status(err.statusCode).json(err.body);
 *     }
 *     // handle unexpected errors...
 *   }
 */

/**
 * Lightweight class for expected transaction failures (validation errors, not-found, etc.)
 * Throwing this inside withTransaction() will trigger ROLLBACK and propagate
 * to the caller, where it can be caught and converted to an HTTP response.
 *
 * This is NOT an Error subclass intentionally — it represents an expected
 * control flow exit, not an unexpected failure.
 */
class TransactionAbort {
  constructor(statusCode, body) {
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * Execute a callback within a database transaction.
 *
 * Acquires a client from the pool, runs BEGIN, executes the callback,
 * and COMMITs on success. On any error (including TransactionAbort),
 * it ROLLBACKs and re-throws. The client is always released.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {function(import('pg').PoolClient): Promise<*>} callback - Async function receiving the transaction client
 * @returns {Promise<*>} - The return value of the callback
 * @throws {TransactionAbort} - For expected validation failures
 * @throws {Error} - For unexpected database or application errors
 */
async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction, TransactionAbort };
