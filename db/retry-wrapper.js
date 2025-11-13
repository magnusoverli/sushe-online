const logger = require('../utils/logger');


async function withRetry(operation, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      
      const isRetryable =
        error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNRESET' || 
        error.code === 'ENOTFOUND' || 
        error.code === '57P01' || 
        error.code === '53300' || 
        error.code === '08006' || 
        error.code === '08001' || 
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

      const backoffDelay = delay * Math.pow(2, attempt - 1); 
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


async function retryableQuery(pool, text, params = [], maxRetries = 3) {
  return withRetry(async () => {
    return await pool.query(text, params);
  }, maxRetries);
}


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
  retryableQuery,
  healthCheck,
};
