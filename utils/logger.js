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
    this.level = options.level || LogLevels.INFO;
    this.logDir = options.logDir || './logs';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;

    // Ensure log directory exists
    if (this.enableFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
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

    try {
      fs.appendFileSync(filepath, logLine);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to write to log file:', err);
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

// Create default logger instance
const logger = new Logger({
  level: process.env.LOG_LEVEL
    ? LogLevels[process.env.LOG_LEVEL.toUpperCase()]
    : LogLevels.INFO,
  enableConsole: process.env.NODE_ENV !== 'test',
  enableFile: process.env.NODE_ENV === 'production',
});

module.exports = logger;
