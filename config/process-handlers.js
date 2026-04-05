/**
 * Process-level error and signal handlers.
 *
 * Handles unhandled rejections, uncaught exceptions, and graceful shutdown.
 */

const defaultLogger = require('../utils/logger');
const { shutdown: defaultShutdownWebSocket } = require('../utils/websocket');

function createProcessHandlers(deps = {}) {
  const logger = deps.logger || defaultLogger;
  const processRef = deps.processRef || process;
  const shutdownWebSocket = deps.shutdownWebSocket || defaultShutdownWebSocket;
  const getResponseCache =
    deps.getResponseCache ||
    (() => {
      try {
        const { responseCache } = require('../middleware/response-cache');
        return responseCache;
      } catch (_error) {
        return null;
      }
    });
  const forceExitTimeoutMs = deps.forceExitTimeoutMs || 10000;

  let handlersRegistered = false;
  let shuttingDown = false;

  async function gracefulShutdown(signal, options = {}) {
    const exitCode = options.exitCode ?? 0;
    const closeHttpServer = options.closeHttpServer;
    const runCleanup = options.runCleanup;
    const closeDatabasePool = options.closeDatabasePool;

    if (shuttingDown) {
      logger.warn('Shutdown already in progress', { signal });
      return;
    }

    shuttingDown = true;
    logger.info('Shutdown initiated', { signal, exitCode });

    const forceExitTimer = setTimeout(() => {
      logger.error('Forced shutdown timeout reached', {
        timeoutMs: forceExitTimeoutMs,
      });
      processRef.exit(1);
    }, forceExitTimeoutMs);

    if (typeof forceExitTimer.unref === 'function') {
      forceExitTimer.unref();
    }

    try {
      if (typeof closeHttpServer === 'function') {
        await closeHttpServer();
      }

      if (typeof runCleanup === 'function') {
        await runCleanup();
      }

      shutdownWebSocket();

      const responseCache = getResponseCache();
      if (responseCache && typeof responseCache.shutdown === 'function') {
        responseCache.shutdown();
      }

      if (typeof closeDatabasePool === 'function') {
        await closeDatabasePool();
      }
    } catch (error) {
      logger.error('Error during shutdown sequence', {
        error: error.message,
      });
    } finally {
      clearTimeout(forceExitTimer);
      if (typeof logger.shutdown === 'function') {
        await logger.shutdown();
      }
      processRef.exit(exitCode);
    }
  }

  function registerProcessHandlers(options = {}) {
    if (handlersRegistered) {
      return;
    }

    handlersRegistered = true;

    processRef.on('unhandledRejection', (err) => {
      logger.error('Unhandled promise rejection', {
        error: err?.message || String(err),
        stack: err?.stack,
      });
    });

    processRef.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', {
        error: err?.message || String(err),
        stack: err?.stack,
      });

      return gracefulShutdown('uncaughtException', {
        ...options,
        exitCode: 1,
      });
    });

    processRef.on('SIGTERM', () => {
      return gracefulShutdown('SIGTERM', { ...options, exitCode: 0 });
    });

    processRef.on('SIGINT', () => {
      return gracefulShutdown('SIGINT', { ...options, exitCode: 0 });
    });
  }

  return {
    registerProcessHandlers,
    gracefulShutdown,
  };
}

const defaultHandlers = createProcessHandlers();

module.exports = {
  createProcessHandlers,
  registerProcessHandlers: defaultHandlers.registerProcessHandlers,
};
