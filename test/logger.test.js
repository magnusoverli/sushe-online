const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

// =============================================================================
// Logger class tests (pino-based implementation)
// =============================================================================

test('Logger should initialize with default options', async () => {
  const { createLogger, LogLevels } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  assert.strictEqual(logger.level, LogLevels.INFO);
  assert.strictEqual(logger.enableConsole, false);
  assert.strictEqual(logger.batchSize, 50);
  assert.strictEqual(logger.flushInterval, 1000);
  assert.ok(logger._pino, 'Should have pino instance');

  await logger.shutdown();
});

test('Logger should accept custom log level', async () => {
  const { createLogger, LogLevels } = await import('../utils/logger.js');
  const logger = createLogger({
    level: LogLevels.DEBUG,
    enableConsole: false,
  });

  assert.strictEqual(logger.level, LogLevels.DEBUG);

  await logger.shutdown();
});

test('Logger should accept custom options for backward compatibility', async () => {
  const { createLogger, LogLevels } = await import('../utils/logger.js');
  const logger = createLogger({
    level: LogLevels.DEBUG,
    enableConsole: false,
    enableFile: false,
    batchSize: 100,
    flushInterval: 500,
  });

  assert.strictEqual(logger.level, LogLevels.DEBUG);
  assert.strictEqual(logger.batchSize, 100);
  assert.strictEqual(logger.flushInterval, 500);

  await logger.shutdown();
});

test('Logger.formatMessage should return valid JSON (backward compatibility)', async () => {
  const { createLogger, LogLevels } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const formatted = logger.formatMessage(LogLevels.INFO, 'Test message', {
    key: 'value',
  });
  const parsed = JSON.parse(formatted);

  assert.ok(parsed.timestamp);
  assert.strictEqual(parsed.level, 'INFO');
  assert.strictEqual(parsed.message, 'Test message');
  assert.strictEqual(parsed.key, 'value');

  await logger.shutdown();
});

test('Logger.formatMessage should handle all log levels', async () => {
  const { createLogger, LogLevelNames } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  for (let level = 0; level < LogLevelNames.length; level++) {
    const formatted = logger.formatMessage(level, 'Test');
    const parsed = JSON.parse(formatted);
    assert.strictEqual(parsed.level, LogLevelNames[level]);
  }

  await logger.shutdown();
});

test('Logger convenience methods should exist and not throw', async () => {
  const { createLogger, LogLevels } = await import('../utils/logger.js');
  const logger = createLogger({
    level: LogLevels.DEBUG,
    enableConsole: false,
  });

  // These should not throw
  assert.doesNotThrow(() => logger.error('Error message'));
  assert.doesNotThrow(() => logger.warn('Warn message'));
  assert.doesNotThrow(() => logger.info('Info message'));
  assert.doesNotThrow(() => logger.debug('Debug message'));

  // With meta objects
  assert.doesNotThrow(() => logger.error('Error', { detail: 'test' }));
  assert.doesNotThrow(() => logger.info({ message: 'Object message' }));

  await logger.shutdown();
});

test('Logger.log should respect log level', async () => {
  const { createLogger, LogLevels } = await import('../utils/logger.js');
  const logger = createLogger({
    level: LogLevels.WARN,
    enableConsole: false,
  });

  // These should not throw even when filtered
  assert.doesNotThrow(() => logger.log(LogLevels.INFO, 'Should be filtered'));
  assert.doesNotThrow(() =>
    logger.log(LogLevels.DEBUG, 'Should also be filtered')
  );
  assert.doesNotThrow(() => logger.log(LogLevels.WARN, 'Should be logged'));
  assert.doesNotThrow(() => logger.log(LogLevels.ERROR, 'Should be logged'));

  await logger.shutdown();
});

test('Logger.requestLogger should return middleware function', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const middleware = logger.requestLogger();

  assert.strictEqual(typeof middleware, 'function');
  assert.strictEqual(middleware.length, 3); // (req, res, next)

  await logger.shutdown();
});

test('Logger.requestLogger should generate request ID if not present', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const middleware = logger.requestLogger();

  const req = {
    method: 'GET',
    originalUrl: '/api/test',
    ip: '127.0.0.1',
    get: () => 'Test User Agent',
    headers: {},
  };

  const res = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = () => {};

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  middleware(req, res, next);

  assert.ok(nextCalled, 'next() should be called');
  assert.ok(req.id, 'Request should have an ID');
  assert.ok(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      req.id
    ),
    'Request ID should be UUID format'
  );

  await logger.shutdown();
});

test('Logger.requestLogger should use existing X-Request-Id header', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const middleware = logger.requestLogger();
  const existingId = 'existing-request-id-12345';

  const req = {
    method: 'GET',
    originalUrl: '/api/test',
    ip: '127.0.0.1',
    get: () => 'Test User Agent',
    headers: {
      'x-request-id': existingId,
    },
  };

  const res = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = () => {};

  middleware(req, res, () => {});

  assert.strictEqual(req.id, existingId, 'Should use existing request ID');

  await logger.shutdown();
});

test('Logger.requestLogger should log on response finish', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const middleware = logger.requestLogger();

  const req = {
    method: 'POST',
    originalUrl: '/api/data',
    ip: '192.168.1.1',
    get: () => 'Mozilla/5.0',
    headers: {},
    user: { _id: 'user123' },
  };

  const res = new EventEmitter();
  res.statusCode = 201;
  const headers = {};
  res.setHeader = (name, value) => {
    headers[name] = value;
  };

  middleware(req, res, () => {});

  // Emit finish event
  res.emit('finish');

  assert.ok(headers['X-Request-Id'], 'Should set X-Request-Id header');

  await logger.shutdown();
});

test('Logger.requestLogger should warn for 4xx/5xx responses', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const middleware = logger.requestLogger();

  const req = {
    method: 'GET',
    originalUrl: '/api/notfound',
    ip: '127.0.0.1',
    get: () => 'Test Agent',
    headers: {},
  };

  const res = new EventEmitter();
  res.statusCode = 404;
  res.setHeader = () => {};

  middleware(req, res, () => {});

  // Should not throw on error status codes
  assert.doesNotThrow(() => res.emit('finish'));

  await logger.shutdown();
});

test('Logger should handle level 0 (ERROR)', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({
    level: 0,
    enableConsole: false,
  });

  assert.strictEqual(logger.level, 0);

  await logger.shutdown();
});

test('Logger legacy methods should exist for backward compatibility', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  // These legacy methods should exist but be no-ops
  assert.strictEqual(typeof logger.writeToFile, 'function');
  assert.strictEqual(typeof logger.writeToConsole, 'function');
  assert.strictEqual(typeof logger.flushWriteQueue, 'function');
  assert.strictEqual(typeof logger.shutdown, 'function');

  // Should not throw
  assert.doesNotThrow(() => logger.writeToFile());
  assert.doesNotThrow(() => logger.writeToConsole());
  await assert.doesNotReject(() => logger.flushWriteQueue());
  await assert.doesNotReject(() => logger.shutdown());
});

test('Logger should have writeQueue for backward compatibility', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  assert.ok(Array.isArray(logger.writeQueue));

  await logger.shutdown();
});

test('Logger.shutdown should clear flushTimer if set', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  // Simulate a timer being set
  logger.flushTimer = setInterval(() => {}, 10000);

  await logger.shutdown();

  assert.strictEqual(logger.flushTimer, undefined);
});

test('Logger.child should create child logger with bound context', async () => {
  const { createLogger } = await import('../utils/logger.js');
  const logger = createLogger({ enableConsole: false });

  const childLogger = logger.child({ requestId: 'test-123' });

  assert.ok(childLogger);
  assert.strictEqual(typeof childLogger.info, 'function');
  assert.strictEqual(typeof childLogger.error, 'function');
  assert.strictEqual(typeof childLogger.warn, 'function');
  assert.strictEqual(typeof childLogger.debug, 'function');

  // Should not throw
  assert.doesNotThrow(() => childLogger.info('Test message'));

  await logger.shutdown();
});

test('Default logger export should work', async () => {
  const logger = await import('../utils/logger.js');

  // Default export should have all methods
  assert.strictEqual(typeof logger.default.info, 'function');
  assert.strictEqual(typeof logger.default.error, 'function');
  assert.strictEqual(typeof logger.default.warn, 'function');
  assert.strictEqual(typeof logger.default.debug, 'function');
  assert.strictEqual(typeof logger.default.requestLogger, 'function');
});

test('Logger should export LogLevels and LogLevelNames', async () => {
  const { LogLevels, LogLevelNames } = await import('../utils/logger.js');

  assert.strictEqual(LogLevels.ERROR, 0);
  assert.strictEqual(LogLevels.WARN, 1);
  assert.strictEqual(LogLevels.INFO, 2);
  assert.strictEqual(LogLevels.DEBUG, 3);

  assert.deepStrictEqual(LogLevelNames, ['ERROR', 'WARN', 'INFO', 'DEBUG']);
});

test('Logger should export createLogger factory and Logger alias', async () => {
  const { createLogger, Logger } = await import('../utils/logger.js');

  assert.strictEqual(typeof createLogger, 'function');
  assert.strictEqual(typeof Logger, 'function');
  assert.strictEqual(createLogger, Logger); // Should be the same function
});
