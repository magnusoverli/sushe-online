const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const { createWebSocketService } = require('../utils/websocket.js');

// Mock logger
const createMockLogger = () => ({
  error: mock.fn(),
  warn: mock.fn(),
  info: mock.fn(),
  debug: mock.fn(),
});

// =============================================================================
// WebSocket Service Creation Tests
// =============================================================================

test('createWebSocketService should return an object with expected methods', () => {
  const service = createWebSocketService();

  assert.strictEqual(typeof service.setup, 'function');
  assert.strictEqual(typeof service.broadcast, 'object');
  assert.strictEqual(typeof service.getIO, 'function');
  assert.strictEqual(typeof service.shutdown, 'function');
});

test('broadcast object should have all expected methods', () => {
  const service = createWebSocketService();

  assert.strictEqual(typeof service.broadcast.listUpdated, 'function');
  assert.strictEqual(typeof service.broadcast.listCreated, 'function');
  assert.strictEqual(typeof service.broadcast.listDeleted, 'function');
  assert.strictEqual(typeof service.broadcast.listRenamed, 'function');
  assert.strictEqual(typeof service.broadcast.listMainChanged, 'function');
});

test('getIO should return null before setup', () => {
  const service = createWebSocketService();

  assert.strictEqual(service.getIO(), null);
});

// =============================================================================
// Broadcast Method Tests (before setup - should log warning)
// =============================================================================

test('broadcast.listUpdated should log warning when not initialized', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  // Should not throw, just log warning
  service.broadcast.listUpdated('user123', 'My List');

  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(
    mockLogger.warn.mock.calls[0].arguments[0].includes('not initialized')
  );
});

test('broadcast.listCreated should log warning when not initialized', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  service.broadcast.listCreated('user123', 'New List', 2024);

  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(
    mockLogger.warn.mock.calls[0].arguments[0].includes('not initialized')
  );
});

test('broadcast.listDeleted should log warning when not initialized', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  service.broadcast.listDeleted('user123', 'Old List');

  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(
    mockLogger.warn.mock.calls[0].arguments[0].includes('not initialized')
  );
});

test('broadcast.listRenamed should log warning when not initialized', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  service.broadcast.listRenamed('user123', 'Old Name', 'New Name');

  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(
    mockLogger.warn.mock.calls[0].arguments[0].includes('not initialized')
  );
});

test('broadcast.listMainChanged should log warning when not initialized', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  service.broadcast.listMainChanged('user123', 'My List', true);

  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(
    mockLogger.warn.mock.calls[0].arguments[0].includes('not initialized')
  );
});

// =============================================================================
// Shutdown Tests
// =============================================================================

test('shutdown should not throw when called before setup', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  // Should not throw
  assert.doesNotThrow(() => service.shutdown());
});

// =============================================================================
// Integration Tests with Mock Socket.io
// =============================================================================

test('setup should accept httpServer and sessionMiddleware', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  // Socket.io requires a real HTTP server or specific mock structure
  // This test verifies the function exists and has correct signature
  assert.strictEqual(typeof service.setup, 'function');
  assert.strictEqual(service.setup.length, 2); // Expects 2 parameters
});

// =============================================================================
// Broadcast Tests with Mock IO
// =============================================================================

test('broadcast.listUpdated should log warning and not throw when io not initialized', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  // Should not throw when called without setup
  assert.doesNotThrow(() => {
    service.broadcast.listUpdated('user123', 'My List');
  });

  // Should have logged a warning
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('broadcast methods should accept correct parameters', () => {
  const mockLogger = createMockLogger();
  const service = createWebSocketService({ logger: mockLogger });

  // All broadcast methods should accept their expected parameters without throwing
  assert.doesNotThrow(() => {
    service.broadcast.listUpdated('user123', 'My List', {
      excludeSocketId: 'socket-abc',
    });
  });

  assert.doesNotThrow(() => {
    service.broadcast.listCreated('user456', 'New Album List', 2024);
  });

  assert.doesNotThrow(() => {
    service.broadcast.listDeleted('user789', 'Old List');
  });

  assert.doesNotThrow(() => {
    service.broadcast.listRenamed('user999', 'Old Name', 'New Name');
  });

  assert.doesNotThrow(() => {
    service.broadcast.listMainChanged('userABC', 'Main List', true);
  });

  // Each should have logged a warning since io is not initialized
  assert.strictEqual(mockLogger.warn.mock.calls.length, 5);
});

// =============================================================================
// Default Export Tests
// =============================================================================

test('module exports default instance methods', () => {
  const websocket = require('../utils/websocket.js');

  // Default instance methods should be exported
  assert.strictEqual(typeof websocket.setup, 'function');
  assert.strictEqual(typeof websocket.broadcast, 'object');
  assert.strictEqual(typeof websocket.getIO, 'function');
  assert.strictEqual(typeof websocket.shutdown, 'function');

  // Factory should also be exported
  assert.strictEqual(typeof websocket.createWebSocketService, 'function');
});
