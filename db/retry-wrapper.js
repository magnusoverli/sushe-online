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
  healthCheck,
};
