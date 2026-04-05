const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const { createProcessHandlers } = require('../config/process-handlers.js');

function createMockProcess() {
  const handlers = {};

  return {
    handlers,
    on: (event, handler) => {
      handlers[event] = handler;
    },
    exit: mock.fn(),
  };
}

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
    shutdown: mock.fn(async () => {}),
  };
}

describe('createProcessHandlers', () => {
  it('registers signal and error handlers', () => {
    const processRef = createMockProcess();
    const logger = createMockLogger();
    const handlers = createProcessHandlers({ processRef, logger });

    handlers.registerProcessHandlers();

    assert.strictEqual(typeof processRef.handlers.SIGTERM, 'function');
    assert.strictEqual(typeof processRef.handlers.SIGINT, 'function');
    assert.strictEqual(
      typeof processRef.handlers.unhandledRejection,
      'function'
    );
    assert.strictEqual(
      typeof processRef.handlers.uncaughtException,
      'function'
    );
  });

  it('runs shutdown sequence and exits with code 0 on SIGTERM', async () => {
    const processRef = createMockProcess();
    const logger = createMockLogger();
    const shutdownWebSocket = mock.fn();
    const closeHttpServer = mock.fn(async () => {});
    const runCleanup = mock.fn(async () => {});
    const closeDatabasePool = mock.fn(async () => {});
    const responseCache = { shutdown: mock.fn() };

    const handlers = createProcessHandlers({
      processRef,
      logger,
      shutdownWebSocket,
      getResponseCache: () => responseCache,
      forceExitTimeoutMs: 1000,
    });

    handlers.registerProcessHandlers({
      closeHttpServer,
      runCleanup,
      closeDatabasePool,
    });

    await processRef.handlers.SIGTERM();

    assert.strictEqual(closeHttpServer.mock.calls.length, 1);
    assert.strictEqual(runCleanup.mock.calls.length, 1);
    assert.strictEqual(shutdownWebSocket.mock.calls.length, 1);
    assert.strictEqual(responseCache.shutdown.mock.calls.length, 1);
    assert.strictEqual(closeDatabasePool.mock.calls.length, 1);
    assert.strictEqual(logger.shutdown.mock.calls.length, 1);
    assert.strictEqual(processRef.exit.mock.calls.length, 1);
    assert.strictEqual(processRef.exit.mock.calls[0].arguments[0], 0);
  });

  it('exits with code 1 on uncaughtException', async () => {
    const processRef = createMockProcess();
    const logger = createMockLogger();
    const handlers = createProcessHandlers({
      processRef,
      logger,
      forceExitTimeoutMs: 1000,
    });

    handlers.registerProcessHandlers();

    await processRef.handlers.uncaughtException(new Error('boom'));

    assert.strictEqual(logger.error.mock.calls.length >= 1, true);
    assert.strictEqual(processRef.exit.mock.calls.length, 1);
    assert.strictEqual(processRef.exit.mock.calls[0].arguments[0], 1);
  });

  it('registerProcessHandlers is idempotent', () => {
    const processRef = createMockProcess();
    const logger = createMockLogger();
    const handlers = createProcessHandlers({ processRef, logger });

    handlers.registerProcessHandlers();
    handlers.registerProcessHandlers();

    const registeredEvents = Object.keys(processRef.handlers);
    assert.strictEqual(registeredEvents.length, 4);
  });
});
