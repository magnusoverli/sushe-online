/**
 * Process-Level Error and Signal Handlers
 *
 * Handles unhandled rejections, uncaught exceptions, and graceful shutdown
 * via SIGTERM/SIGINT signals.
 */

const logger = require('../utils/logger');
const { shutdown: shutdownWebSocket } = require('../utils/websocket');

/**
 * Register process-level error handlers and graceful shutdown hooks.
 * Should be called early in the application lifecycle.
 */
function registerProcessHandlers() {
  // Log any unhandled errors so the server doesn't fail silently
  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled promise rejection', {
      error: err.message,
      stack: err.stack,
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', {
      error: err.message,
      stack: err.stack,
    });
  });

  // Graceful shutdown handling for async logger and cache
  async function gracefulShutdown(signal) {
    logger.info(`${signal} received, shutting down gracefully`);
    await logger.shutdown();

    // Shutdown WebSocket server
    shutdownWebSocket();

    // Shutdown response cache if it exists
    try {
      const { responseCache } = require('../middleware/response-cache');
      responseCache.shutdown();
    } catch (_e) {
      // Cache module might not be loaded yet
    }

    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { registerProcessHandlers };
