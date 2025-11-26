// logger-testable.js
// Testable version that exports the Logger class directly

const fs = require('fs');
const path = require('path');

// Log levels
const LogLevels = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LogLevelNames = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

class Logger {
  constructor(options = {}) {
    this.level = options.level ?? LogLevels.INFO;
    this.logDir = options.logDir || './logs';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;

    // Async file writing queue
    this.writeQueue = [];
    this.isWriting = false;
    this.batchSize = options.batchSize || 50;
    this.flushInterval = options.flushInterval || 1000;

    // Ensure log directory exists
    if (this.enableFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Start periodic flush for async logging
    if (this.enableFile) {
      this.flushTimer = setInterval(() => {
        this.flushWriteQueue();
      }, this.flushInterval);
    }
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const levelName = LogLevelNames[level];

    const logEntry = {
      timestamp,
      level: levelName,
      message,
      ...meta,
    };

    return JSON.stringify(logEntry);
  }

  writeToFile(level, formattedMessage) {
    if (!this.enableFile) return;

    const date = new Date().toISOString().split('T')[0];
    const filename = `${date}.log`;
    const filepath = path.join(this.logDir, filename);
    const logLine = formattedMessage + '\n';

    // Add to async write queue instead of synchronous write
    this.writeQueue.push({ filepath, logLine });

    // Flush immediately if queue is getting large
    if (this.writeQueue.length >= this.batchSize) {
      this.flushWriteQueue();
    }
  }

  async flushWriteQueue() {
    if (this.isWriting || this.writeQueue.length === 0) return;

    this.isWriting = true;
    const batch = this.writeQueue.splice(0, this.batchSize);

    // Group by filepath for efficient writing
    const fileGroups = new Map();
    for (const { filepath, logLine } of batch) {
      if (!fileGroups.has(filepath)) {
        fileGroups.set(filepath, []);
      }
      fileGroups.get(filepath).push(logLine);
    }

    // Write all files asynchronously
    const writePromises = Array.from(fileGroups.entries()).map(
      async ([filepath, lines]) => {
        try {
          const content = lines.join('');
          await fs.promises.appendFile(filepath, content);
        } catch (err) {
          // Fallback to console if file write fails
          // eslint-disable-next-line no-console
          console.error('Failed to write to log file:', err);
          // eslint-disable-next-line no-console
          console.error('Lost log entries:', lines.length);
        }
      }
    );

    try {
      await Promise.all(writePromises);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Batch log write failed:', err);
    } finally {
      this.isWriting = false;

      // Process any new items that arrived during write
      if (this.writeQueue.length > 0) {
        setImmediate(() => this.flushWriteQueue());
      }
    }
  }

  // Graceful shutdown - flush remaining logs
  async shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining logs
    while (this.writeQueue.length > 0) {
      await this.flushWriteQueue();
    }
  }

  writeToConsole(level, message, meta = {}) {
    if (!this.enableConsole) return;

    const timestamp = new Date().toISOString();
    const levelName = LogLevelNames[level];
    const colors = {
      ERROR: '\x1b[31m', // Red
      WARN: '\x1b[33m', // Yellow
      INFO: '\x1b[36m', // Cyan
      DEBUG: '\x1b[90m', // Gray
    };
    const reset = '\x1b[0m';

    const color = colors[levelName] || '';
    const prefix = `${color}[${timestamp}] ${levelName}:${reset}`;

    if (typeof message === 'object') {
      // eslint-disable-next-line no-console
      console.log(prefix, JSON.stringify(message, null, 2));
    } else {
      // eslint-disable-next-line no-console
      console.log(prefix, message);
    }

    if (Object.keys(meta).length > 0) {
      // eslint-disable-next-line no-console
      console.log('  Meta:', JSON.stringify(meta, null, 2));
    }
  }

  log(level, message, meta = {}) {
    if (level > this.level) return;

    const formattedMessage = this.formatMessage(level, message, meta);

    this.writeToConsole(level, message, meta);
    this.writeToFile(level, formattedMessage);
  }

  error(message, meta = {}) {
    this.log(LogLevels.ERROR, message, meta);
  }

  warn(message, meta = {}) {
    this.log(LogLevels.WARN, message, meta);
  }

  info(message, meta = {}) {
    this.log(LogLevels.INFO, message, meta);
  }

  debug(message, meta = {}) {
    this.log(LogLevels.DEBUG, message, meta);
  }

  // Request logging middleware
  requestLogger() {
    return (req, res, next) => {
      const start = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          userId: req.user?._id,
        };

        if (res.statusCode >= 400) {
          this.warn('HTTP Request', logData);
        } else {
          this.info('HTTP Request', logData);
        }
      });

      next();
    };
  }
}

module.exports = { Logger, LogLevels, LogLevelNames };
