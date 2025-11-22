const logger = require('../utils/logger');

/**
 * Retry wrapper for database operations to handle transient failures
 * @param {Function} operation - The database operation to execute
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Base delay between retries in milliseconds
 * @returns {Promise} - Result of the operation
 */
async function withRetry(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // Define retryable error conditions
      const isRetryable =
        error.code === 'ECONNREFUSED' || // Connection refused
        error.code === 'ETIMEDOUT' || // Connection timeout
        error.code === 'ECONNRESET' || // Connection reset
        error.code === 'ENOTFOUND' || // DNS lookup failed
        error.code === '57P01' || // PostgreSQL admin shutdown
        error.code === '53300' || // PostgreSQL too many connections
        error.code === '08006' || // Connection failure
        error.code === '08001' || // Unable to connect
        (error.message && error.message.includes('connection terminated'));

      if (attempt === maxRetries || !isRetryable) {
        logger.error('Database operation failed after retries', {
          error: error.message,
          code: error.code,
          attempts: attempt,
          operation: operation.name || 'unnamed',
        });
        throw error;
      }

      const backoffDelay = delay * Math.pow(2, attempt - 1); // Exponential backoff
      logger.warn(
        `Database operation failed, retrying ${attempt}/${maxRetries}`,
        {
          error: error.message,
          code: error.code,
          nextRetryIn: `${backoffDelay}ms`,
        }
      );

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Health check function that verifies database connectivity
 * @param {Object} pool - Database connection pool
 * @returns {Promise<Object>} - Health status object
 */
async function healthCheck(pool) {
  try {
    const start = Date.now();
    await pool.query('SELECT 1 as health_check');
    const duration = Date.now() - start;

    return {
      status: 'healthy',
      database: 'connected',
      responseTime: duration,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  withRetry,
  healthCheck,
};
