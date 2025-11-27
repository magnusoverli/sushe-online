const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

// =============================================================================
// Logger class tests
// =============================================================================

test('Logger should initialize with default options', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableFile: false, enableConsole: false });

  assert.strictEqual(logger.level, LogLevels.INFO);
  assert.strictEqual(logger.enableConsole, false);
  assert.strictEqual(logger.enableFile, false);
  assert.strictEqual(logger.batchSize, 50);
  assert.strictEqual(logger.flushInterval, 1000);

  await logger.shutdown();
});

test('Logger should accept custom options', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({
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

test('Logger should create log directory if enableFile is true', async () => {
  const { Logger } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
  });

  assert.ok(fs.existsSync(tempDir));

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.formatMessage should return valid JSON', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableFile: false, enableConsole: false });

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
  const { Logger, LogLevelNames } = await import('../utils/logger.js');
  const logger = new Logger({ enableFile: false, enableConsole: false });

  for (let level = 0; level < LogLevelNames.length; level++) {
    const formatted = logger.formatMessage(level, 'Test');
    const parsed = JSON.parse(formatted);
    assert.strictEqual(parsed.level, LogLevelNames[level]);
  }

  await logger.shutdown();
});

test('Logger.writeToFile should add to queue when enabled', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
  });

  logger.writeToFile(LogLevels.INFO, '{"test": "message"}');

  assert.strictEqual(logger.writeQueue.length, 1);
  assert.ok(logger.writeQueue[0].filepath.includes(tempDir));
  assert.ok(logger.writeQueue[0].logLine.includes('test'));

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.writeToFile should not queue when enableFile is false', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableFile: false, enableConsole: false });

  logger.writeToFile(LogLevels.INFO, '{"test": "message"}');

  assert.strictEqual(logger.writeQueue.length, 0);

  await logger.shutdown();
});

test('Logger.writeToFile should trigger flush when queue reaches batchSize', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
    batchSize: 3,
    flushInterval: 999999, // Disable timer-based flush
  });

  // Add 3 items to trigger flush
  logger.writeToFile(LogLevels.INFO, '{"msg": "1"}');
  logger.writeToFile(LogLevels.INFO, '{"msg": "2"}');
  logger.writeToFile(LogLevels.INFO, '{"msg": "3"}');

  // Wait for async flush
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Queue should be empty after flush
  assert.strictEqual(logger.writeQueue.length, 0);

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.flushWriteQueue should write to file', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
    flushInterval: 999999,
  });

  logger.writeToFile(LogLevels.INFO, '{"test": "flush"}');
  await logger.flushWriteQueue();

  // Check file was created
  const files = fs.readdirSync(tempDir);
  assert.strictEqual(files.length, 1);
  assert.ok(files[0].endsWith('.log'));

  // Check content
  const content = fs.readFileSync(path.join(tempDir, files[0]), 'utf-8');
  assert.ok(content.includes('flush'));

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.flushWriteQueue should do nothing if already writing', async () => {
  const { Logger } = await import('../utils/logger.js');
  const logger = new Logger({ enableFile: false, enableConsole: false });

  logger.isWriting = true;
  logger.writeQueue.push({ filepath: '/fake', logLine: 'test' });

  await logger.flushWriteQueue();

  // Queue should be unchanged
  assert.strictEqual(logger.writeQueue.length, 1);

  logger.isWriting = false;
  await logger.shutdown();
});

test('Logger.flushWriteQueue should do nothing if queue is empty', async () => {
  const { Logger } = await import('../utils/logger.js');
  const logger = new Logger({ enableFile: false, enableConsole: false });

  // Should not throw
  await logger.flushWriteQueue();

  await logger.shutdown();
});

test('Logger.flushWriteQueue should handle file write errors gracefully', async () => {
  const { Logger } = await import('../utils/logger.js');
  // Create logger with file disabled to avoid directory creation issues
  const logger = new Logger({
    enableConsole: false,
    enableFile: false,
    flushInterval: 999999,
  });

  // Manually enable file writing and add invalid path to queue
  // This bypasses the constructor's directory creation
  logger.enableFile = true;
  logger.writeQueue.push({
    filepath: '/nonexistent/path/that/should/fail/test.log',
    logLine: 'test\n',
  });

  // Should not throw, but handle error internally
  await logger.flushWriteQueue();

  await logger.shutdown();
});

test('Logger.flushWriteQueue should process remaining items after write', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
    batchSize: 2,
    flushInterval: 999999,
  });

  // Add more than batchSize items
  logger.writeToFile(LogLevels.INFO, '{"msg": "1"}');
  logger.writeToFile(LogLevels.INFO, '{"msg": "2"}');
  logger.writeToFile(LogLevels.INFO, '{"msg": "3"}');
  logger.writeToFile(LogLevels.INFO, '{"msg": "4"}');

  // Wait for multiple flushes
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.strictEqual(logger.writeQueue.length, 0);

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.shutdown should clear timer and flush queue', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
  });

  logger.writeToFile(LogLevels.INFO, '{"test": "shutdown"}');
  await logger.shutdown();

  assert.strictEqual(logger.flushTimer, undefined);
  assert.strictEqual(logger.writeQueue.length, 0);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.writeToConsole should not output when disabled', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableConsole: false, enableFile: false });

  // Should not throw
  logger.writeToConsole(LogLevels.INFO, 'Test message');

  await logger.shutdown();
});

test('Logger.writeToConsole should handle object messages', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableConsole: true, enableFile: false });

  // Mock console.log to capture output
  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args);

  logger.writeToConsole(LogLevels.INFO, { key: 'value' });

  // eslint-disable-next-line no-console
  console.log = originalLog;

  assert.ok(logs.length > 0);
  assert.ok(logs[0][1].includes('key'));

  await logger.shutdown();
});

test('Logger.writeToConsole should handle string messages', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableConsole: true, enableFile: false });

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args);

  logger.writeToConsole(LogLevels.INFO, 'Simple string');

  // eslint-disable-next-line no-console
  console.log = originalLog;

  assert.ok(logs.length > 0);
  assert.ok(logs[0][1].includes('Simple string'));

  await logger.shutdown();
});

test('Logger.writeToConsole should output meta when present', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({ enableConsole: true, enableFile: false });

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args);

  logger.writeToConsole(LogLevels.INFO, 'Message', { extra: 'data' });

  // eslint-disable-next-line no-console
  console.log = originalLog;

  // Should have 2 console.log calls: message and meta
  assert.strictEqual(logs.length, 2);
  assert.ok(logs[1][0].includes('Meta'));

  await logger.shutdown();
});

test('Logger.log should respect log level', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const logger = new Logger({
    level: LogLevels.WARN,
    enableConsole: false,
    enableFile: false,
  });

  const logs = [];
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  console.log = (...args) => logs.push(args);

  // These should be filtered out (INFO and DEBUG are below WARN)
  logger.log(LogLevels.INFO, 'Should not appear');
  logger.log(LogLevels.DEBUG, 'Should not appear');

  // eslint-disable-next-line no-console
  console.log = originalLog;

  assert.strictEqual(logs.length, 0);

  await logger.shutdown();
});

test('Logger convenience methods should work', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    level: LogLevels.DEBUG,
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
  });

  logger.error('Error message');
  logger.warn('Warn message');
  logger.info('Info message');
  logger.debug('Debug message');

  assert.strictEqual(logger.writeQueue.length, 4);

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.requestLogger should log successful requests as info', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    level: LogLevels.INFO,
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
  });

  const middleware = logger.requestLogger();

  // Create mock req/res
  const req = {
    method: 'GET',
    originalUrl: '/api/test',
    ip: '127.0.0.1',
    get: () => 'Test User Agent',
    user: { _id: '123' },
  };

  const res = new EventEmitter();
  res.statusCode = 200;

  const next = () => {};

  middleware(req, res, next);
  res.emit('finish');

  // Wait for async processing
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(logger.writeQueue.length > 0);
  const logEntry = logger.writeQueue[0].logLine;
  assert.ok(logEntry.includes('HTTP Request'));
  assert.ok(logEntry.includes('GET'));

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger.requestLogger should log error requests as warn', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    level: LogLevels.WARN,
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
  });

  const middleware = logger.requestLogger();

  const req = {
    method: 'POST',
    originalUrl: '/api/error',
    ip: '127.0.0.1',
    get: () => 'Test Agent',
  };

  const res = new EventEmitter();
  res.statusCode = 404;

  middleware(req, res, () => {});
  res.emit('finish');

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(logger.writeQueue.length > 0);
  const logEntry = logger.writeQueue[0].logLine;
  assert.ok(logEntry.includes('WARN'));

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger should handle level 0 (ERROR)', async () => {
  const { Logger } = await import('../utils/logger.js');
  const logger = new Logger({
    level: 0,
    enableConsole: false,
    enableFile: false,
  });

  assert.strictEqual(logger.level, 0);

  await logger.shutdown();
});

test('Logger periodic flush timer should trigger flushWriteQueue', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
    flushInterval: 50, // Very short interval to trigger quickly
    batchSize: 1000, // High batch size so manual flush doesn't trigger
  });

  // Add an item to the queue
  logger.writeToFile(LogLevels.INFO, '{"test": "timer"}');

  // Wait for the timer to flush
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Queue should be empty after timer flush
  assert.strictEqual(logger.writeQueue.length, 0);

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Logger flushWriteQueue should handle items added during write', async () => {
  const { Logger, LogLevels } = await import('../utils/logger.js');
  const tempDir = path.join(os.tmpdir(), `logger-test-${Date.now()}`);

  const logger = new Logger({
    enableConsole: false,
    enableFile: true,
    logDir: tempDir,
    batchSize: 1,
    flushInterval: 999999,
  });

  // Start a flush
  logger.writeToFile(LogLevels.INFO, '{"msg": "first"}');

  // Add more while flushing
  setTimeout(() => {
    logger.writeToFile(LogLevels.INFO, '{"msg": "during"}');
  }, 5);

  // Wait for all flushes
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.strictEqual(logger.writeQueue.length, 0);

  await logger.shutdown();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
