/**
 * Health Check and Metrics Routes
 *
 * Provides endpoints for:
 * - Database health checks
 * - Health monitoring UI
 * - General health API
 * - Prometheus metrics (IP-restricted)
 */

const logger = require('../utils/logger');
const { healthCheck } = require('../db/retry-wrapper');
const { getMetrics, getContentType } = require('../utils/metrics');

/**
 * Register health check and metrics routes.
 * @param {Object} app - Express app instance
 * @param {Object} pool - PostgreSQL connection pool
 */
function registerHealthRoutes(app, pool) {
  // Database health check endpoint
  app.get('/health/db', async (req, res) => {
    try {
      const health = await healthCheck(pool);
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      logger.error('Health check endpoint error', { error: error.message });
      res.status(503).json({
        status: 'unhealthy',
        database: 'error',
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Health monitoring UI page
  app.get('/health', (req, res) => {
    res.render('health');
  });

  // General health check API endpoint
  app.get('/api/health', async (req, res) => {
    try {
      const dbHealth = await healthCheck(pool);
      const health = {
        status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        database: dbHealth,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
      };

      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      logger.error('General health check error', { error: error.message });
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });

  // Prometheus metrics endpoint
  // Protected by IP whitelist: only localhost and private network IPs
  app.get('/metrics', async (req, res) => {
    // Simple IP-based protection for metrics endpoint
    const clientIp = req.ip || req.connection.remoteAddress || '';
    const isLocalhost =
      clientIp === '127.0.0.1' ||
      clientIp === '::1' ||
      clientIp === '::ffff:127.0.0.1';
    const isPrivateNetwork =
      /^(::ffff:)?(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(
        clientIp
      );

    // In development, allow all access
    const isDevelopment = process.env.NODE_ENV !== 'production';

    if (!isLocalhost && !isPrivateNetwork && !isDevelopment) {
      logger.warn('Metrics endpoint access denied', { ip: clientIp });
      return res.status(403).json({ error: 'Forbidden' });
    }

    try {
      res.set('Content-Type', getContentType());
      res.end(await getMetrics());
    } catch (error) {
      logger.error('Error generating metrics', { error: error.message });
      res.status(500).json({ error: 'Failed to generate metrics' });
    }
  });
}

module.exports = { registerHealthRoutes };
