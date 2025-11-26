const test = require('node:test');
const assert = require('node:assert');

// We need to test ResponseCache class directly, so we'll create instances
// rather than using the global singleton

// =============================================================================
// ResponseCache class tests
// =============================================================================

test('ResponseCache should initialize with default options', async () => {
  // Dynamically import to get fresh instance behavior
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  assert.strictEqual(cache.defaultTTL, 60000);
  assert.strictEqual(cache.maxSize, 1000);
  assert.strictEqual(cache.cleanupInterval, 300000);

  cache.shutdown();
});

test('ResponseCache should accept custom options', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache({
    defaultTTL: 30000,
    maxSize: 500,
    cleanupInterval: 60000,
  });

  assert.strictEqual(cache.defaultTTL, 30000);
  assert.strictEqual(cache.maxSize, 500);
  assert.strictEqual(cache.cleanupInterval, 60000);

  cache.shutdown();
});

test('ResponseCache.set and get should work correctly', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  cache.set('test-key', { foo: 'bar' });
  const result = cache.get('test-key');

  assert.ok(result);
  assert.deepStrictEqual(result.data, { foo: 'bar' });
  assert.ok(result.createdAt);
  assert.ok(result.expiresAt);

  cache.shutdown();
});

test('ResponseCache.get should return null for non-existent key', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  const result = cache.get('non-existent');
  assert.strictEqual(result, null);

  cache.shutdown();
});

test('ResponseCache.get should return null and delete expired entries', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  // Set with very short TTL
  cache.set('expiring-key', { data: 'test' }, 1);

  // Wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 10));

  const result = cache.get('expiring-key');
  assert.strictEqual(result, null);

  cache.shutdown();
});

test('ResponseCache.set should use custom TTL', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache({ defaultTTL: 60000 });

  const before = Date.now();
  cache.set('custom-ttl', { data: 'test' }, 5000);
  const entry = cache.get('custom-ttl');

  // expiresAt should be ~5000ms from now, not 60000ms
  assert.ok(entry.expiresAt - before < 10000);

  cache.shutdown();
});

test('ResponseCache.invalidate should remove matching entries', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  cache.set('user:123:lists', { lists: [] });
  cache.set('user:123:settings', { theme: 'dark' });
  cache.set('user:456:lists', { lists: [] });

  cache.invalidate('user:123');

  assert.strictEqual(cache.get('user:123:lists'), null);
  assert.strictEqual(cache.get('user:123:settings'), null);
  assert.ok(cache.get('user:456:lists')); // Should still exist

  cache.shutdown();
});

test('ResponseCache.clear should remove all entries', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  cache.set('key1', { data: 1 });
  cache.set('key2', { data: 2 });
  cache.set('key3', { data: 3 });

  cache.clear();

  assert.strictEqual(cache.get('key1'), null);
  assert.strictEqual(cache.get('key2'), null);
  assert.strictEqual(cache.get('key3'), null);

  cache.shutdown();
});

test('ResponseCache.generateKey should create unique keys per user', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  const req1 = {
    method: 'GET',
    originalUrl: '/api/lists',
    user: { _id: '123' },
  };
  const req2 = {
    method: 'GET',
    originalUrl: '/api/lists',
    user: { _id: '456' },
  };
  const req3 = { method: 'GET', originalUrl: '/api/lists' }; // Anonymous

  const key1 = cache.generateKey(req1);
  const key2 = cache.generateKey(req2);
  const key3 = cache.generateKey(req3);

  assert.strictEqual(key1, 'GET:/api/lists:123');
  assert.strictEqual(key2, 'GET:/api/lists:456');
  assert.strictEqual(key3, 'GET:/api/lists:anonymous');

  cache.shutdown();
});

test('ResponseCache.cleanup should remove expired entries', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache({ cleanupInterval: 999999 }); // Disable auto cleanup

  // Add entries with very short TTL
  cache.set('expired1', { data: 1 }, 1);
  cache.set('expired2', { data: 2 }, 1);
  cache.set('valid', { data: 3 }, 60000);

  // Wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 10));

  cache.cleanup();

  assert.strictEqual(cache.get('expired1'), null);
  assert.strictEqual(cache.get('expired2'), null);
  assert.ok(cache.get('valid'));

  cache.shutdown();
});

test('ResponseCache.cleanup should enforce maxSize by removing oldest entries', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache({ maxSize: 3, cleanupInterval: 999999 });

  // Add entries with slight delays to ensure different createdAt times
  cache.set('key1', { data: 1 }, 60000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  cache.set('key2', { data: 2 }, 60000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  cache.set('key3', { data: 3 }, 60000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  cache.set('key4', { data: 4 }, 60000);
  await new Promise((resolve) => setTimeout(resolve, 5));
  cache.set('key5', { data: 5 }, 60000);

  // Now we have 5 entries but maxSize is 3
  cache.cleanup();

  // Oldest entries (key1, key2) should be removed
  assert.strictEqual(cache.get('key1'), null);
  assert.strictEqual(cache.get('key2'), null);
  assert.ok(cache.get('key3'));
  assert.ok(cache.get('key4'));
  assert.ok(cache.get('key5'));

  cache.shutdown();
});

test('ResponseCache.shutdown should clear timer and cache', async () => {
  const { ResponseCache } = await import(
    '../middleware/response-cache-testable.js'
  );
  const cache = new ResponseCache();

  cache.set('key', { data: 'test' });
  cache.shutdown();

  assert.strictEqual(cache.get('key'), null);
  assert.strictEqual(cache.cleanupTimer, undefined);
});
