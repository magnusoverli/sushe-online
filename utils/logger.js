const pino = require('pino');
const crypto = require('crypto');

// Log levels mapping for compatibility with existing code
const LogLevels = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LogLevelNames = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

// Map our log levels to pino levels
const pinoLevelMap = {
  0: 'error',
  1: 'warn',
  2: 'info',
  3: 'debug',
};

/**
 * Determine if we should use pretty printing (development) or JSON (production)
 * Respects NO_COLOR and FORCE_COLOR environment variables
 */
function shouldUsePrettyPrint() {
  // In test environment, never use pretty print
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  // NO_COLOR disables pretty printing
  if (process.env.NO_COLOR === '1' || process.env.NO_COLOR === 'true') {
    return false;
  }

  // Production always uses JSON
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // Development uses pretty print by default
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Create a pino logger instance with optional configuration
 * @param {Object} options - Logger options
 * @param {number} options.level - Log level (0=ERROR, 1=WARN, 2=INFO, 3=DEBUG)
 * @param {boolean} options.enableConsole - Whether to output to console (default: true)
 * @param {boolean} options.enableFile - Whether to enable file logging (ignored, pino uses streams)
 * @param {string} options.logDir - Log directory (ignored, pino uses streams)
 * @param {Object} options.pinoOptions - Additional pino options for testing
 * @returns {Object} Logger instance with info, warn, error, debug methods
 */
function createLogger(options = {}) {
  const level = options.level ?? LogLevels.INFO;
  const enableConsole = options.enableConsole !== false;
  const pinoLevel = pinoLevelMap[level] || 'info';

  // Build pino configuration
  const pinoConfig = {
    level: pinoLevel,
    base: { service: 'sushe-online' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Merge any test-specific options
    ...options.pinoOptions,
  };

  // Create the pino instance
  let pinoLogger;

  if (!enableConsole) {
    // Silent logger for tests
    pinoLogger = pino(
      pinoConfig,
      pino.destination({ sync: true, write: () => {} })
    );
  } else if (shouldUsePrettyPrint()) {
    // Development: use pino-pretty if available, otherwise basic formatting
    try {
      const pretty = require('pino-pretty');
      pinoLogger = pino(
        pinoConfig,
        pretty({
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,service',
        })
      );
    } catch {
      // pino-pretty not installed, use default
      pinoLogger = pino(pinoConfig);
    }
  } else {
    // Production: single-line JSON to stdout
    pinoLogger = pino(pinoConfig);
  }

  // Create wrapper object that maintains backward compatibility
  const logger = {
    // Expose pino instance for advanced usage
    _pino: pinoLogger,

    // Keep track of options for compatibility
    level,
    enableConsole,
    enableFile: options.enableFile || false,
    logDir: options.logDir || './logs',
    batchSize: options.batchSize || 50,
    flushInterval: options.flushInterval || 1000,

    // Legacy properties for test compatibility
    writeQueue: [],
    isWriting: false,
    flushTimer: undefined,

    /**
     * Format a log message (kept for backward compatibility)
     */
    formatMessage(lvl, message, meta = {}) {
      const timestamp = new Date().toISOString();
      const levelName = LogLevelNames[lvl];

      const logEntry = {
        timestamp,
        level: levelName,
        message,
        ...meta,
      };

      return JSON.stringify(logEntry);
    },

    /**
     * Core log method
     */
    log(lvl, message, meta = {}) {
      if (lvl > level) return;

      const pinoLvl = pinoLevelMap[lvl] || 'info';

      // Flatten meta into the log entry
      if (typeof message === 'object') {
        pinoLogger[pinoLvl](message);
      } else {
        pinoLogger[pinoLvl](meta, message);
      }
    },

    /**
     * Log error messages
     */
    error(message, meta = {}) {
      if (typeof message === 'object') {
        pinoLogger.error(message);
      } else {
        pinoLogger.error(meta, message);
      }
    },

    /**
     * Log warning messages
     */
    warn(message, meta = {}) {
      if (level < LogLevels.WARN) return;
      if (typeof message === 'object') {
        pinoLogger.warn(message);
      } else {
        pinoLogger.warn(meta, message);
      }
    },

    /**
     * Log info messages
     */
    info(message, meta = {}) {
      if (level < LogLevels.INFO) return;
      if (typeof message === 'object') {
        pinoLogger.info(message);
      } else {
        pinoLogger.info(meta, message);
      }
    },

    /**
     * Log debug messages
     */
    debug(message, meta = {}) {
      if (level < LogLevels.DEBUG) return;
      if (typeof message === 'object') {
        pinoLogger.debug(message);
      } else {
        pinoLogger.debug(meta, message);
      }
    },

    /**
     * Create a child logger with bound context
     */
    child(bindings) {
      const childPino = pinoLogger.child(bindings);
      return {
        _pino: childPino,
        error: (msg, meta = {}) => childPino.error(meta, msg),
        warn: (msg, meta = {}) => childPino.warn(meta, msg),
        info: (msg, meta = {}) => childPino.info(meta, msg),
        debug: (msg, meta = {}) => childPino.debug(meta, msg),
      };
    },

    /**
     * Request logging middleware
     * Uses pino-http under the hood but maintains the same interface
     */
    requestLogger() {
      return (req, res, next) => {
        const start = Date.now();

        // Generate request ID if not present
        if (!req.id) {
          req.id = req.headers['x-request-id'] || crypto.randomUUID();
        }

        // Set response header
        res.setHeader('X-Request-Id', req.id);

        res.on('finish', () => {
          const duration = Date.now() - start;
          const logData = {
            requestId: req.id,
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration_ms: duration,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            userId: req.user?._id,
            username: req.user?.username,
          };

          if (res.statusCode >= 400) {
            pinoLogger.warn(logData, 'HTTP Request');
          } else {
            pinoLogger.info(logData, 'HTTP Request');
          }
        });

        next();
      };
    },

    // Legacy methods for backward compatibility
    writeToFile() {
      // No-op: pino handles output streams
    },

    writeToConsole() {
      // No-op: pino handles console output
    },

    async flushWriteQueue() {
      // No-op: pino handles flushing
    },

    async shutdown() {
      // Flush pino if it has a flush method
      if (pinoLogger.flush) {
        pinoLogger.flush();
      }
      // Clear any timers (for compatibility)
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = undefined;
      }
    },
  };

  return logger;
}

// Create default logger instance
const logger = createLogger({
  level: process.env.LOG_LEVEL
    ? LogLevels[process.env.LOG_LEVEL.toUpperCase()]
    : LogLevels.INFO,
  enableConsole: process.env.NODE_ENV !== 'test',
  enableFile: process.env.NODE_ENV === 'production',
});

// Export both the factory (for testing) and the default instance
module.exports = logger;
module.exports.createLogger = createLogger;
module.exports.Logger = createLogger; // Alias for backward compatibility
module.exports.LogLevels = LogLevels;
module.exports.LogLevelNames = LogLevelNames;
