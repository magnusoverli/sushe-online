const test = require('node:test');
const assert = require('node:assert');

// Mock logger to avoid file operations
const mockLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

// Mock the logger module before requiring response-cache
require.cache[require.resolve('../utils/logger')] = {
  exports: mockLogger,
};

const {
  ResponseCache,
  responseCache,
} = require('../middleware/response-cache');

// CRITICAL: Stop the global cache's interval timer immediately to prevent hanging
responseCache.shutdown();

/**
 * Helper to create a cache instance for testing.
 * Immediately clears the cleanup timer to prevent test hangs.
 */
function createTestCache(options = {}) {
  const cache = new ResponseCache(options);
  // Clear the interval timer immediately - we'll call cleanup manually in tests
  if (cache.cleanupTimer) {
    clearInterval(cache.cleanupTimer);
    cache.cleanupTimer = null;
  }
  return cache;
}

test.describe('ResponseCache Class', () => {
  test.describe('Basic Cache Operations', () => {
    test('should store and retrieve cached data', () => {
      const cache = createTestCache({ defaultTTL: 60000 });

      cache.set('test-key', { data: 'test-value' });
      const result = cache.get('test-key');

      assert.ok(result);
      assert.deepStrictEqual(result.data, { data: 'test-value' });
    });

    test('should return null for non-existent keys', () => {
      const cache = createTestCache();
      const result = cache.get('non-existent-key');
      assert.strictEqual(result, null);
    });

    test('should respect TTL and expire entries', async () => {
      const cache = createTestCache({ defaultTTL: 50 });

      cache.set('expire-key', { data: 'test' });

      // Should exist immediately
      let result = cache.get('expire-key');
      assert.ok(result);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be expired now (get() checks expiry and removes)
      result = cache.get('expire-key');
      assert.strictEqual(result, null);
    });

    test('should use custom TTL when provided', async () => {
      const cache = createTestCache({ defaultTTL: 10000 });

      // Set with short custom TTL
      cache.set('custom-ttl-key', { data: 'test' }, 50);

      // Wait for custom TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = cache.get('custom-ttl-key');
      assert.strictEqual(result, null);
    });

    test('should clear all cached entries', () => {
      const cache = createTestCache();

      cache.set('key1', { data: '1' });
      cache.set('key2', { data: '2' });
      cache.set('key3', { data: '3' });

      cache.clear();

      assert.strictEqual(cache.get('key1'), null);
      assert.strictEqual(cache.get('key2'), null);
      assert.strictEqual(cache.get('key3'), null);
    });
  });

  test.describe('Cache Size Management', () => {
    test('should enforce max size limit during cleanup', () => {
      const cache = createTestCache({ maxSize: 3 });

      // Add 4 entries (exceeding max)
      cache.set('key1', { data: '1' });
      cache.set('key2', { data: '2' });
      cache.set('key3', { data: '3' });
      cache.set('key4', { data: '4' });

      // Manually trigger cleanup
      cache.cleanup();

      // Cache size should be at or below max
      assert.ok(cache.cache.size <= 3);
    });

    test('should remove oldest entries when exceeding max size', () => {
      const cache = createTestCache({ maxSize: 2 });

      // Add entries
      cache.set('oldest', { data: '1' });
      cache.set('middle', { data: '2' });
      cache.set('newest', { data: '3' });

      cache.cleanup();

      // Oldest should be removed, newest should remain
      assert.strictEqual(cache.get('oldest'), null);
      assert.ok(cache.get('newest'));
    });
  });

  test.describe('Cleanup Operations', () => {
    test('should remove expired entries during cleanup', async () => {
      const cache = createTestCache({ defaultTTL: 50 });

      cache.set('expire1', { data: '1' });
      cache.set('expire2', { data: '2' });
      cache.set('long-lived', { data: '3' }, 10000);

      // Wait for first two to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      cache.cleanup();

      assert.strictEqual(cache.get('expire1'), null);
      assert.strictEqual(cache.get('expire2'), null);
      assert.ok(cache.get('long-lived'));
    });

    test('should stop cleanup timer on shutdown', () => {
      const cache = new ResponseCache({ cleanupInterval: 1000 });

      assert.ok(cache.cleanupTimer);

      cache.shutdown();

      assert.strictEqual(cache.cleanupTimer, undefined);
      assert.strictEqual(cache.cache.size, 0);
    });
  });

  test.describe('Cache Invalidation', () => {
    test('should invalidate entries matching a pattern', () => {
      const cache = createTestCache();

      cache.set('GET:/api/lists/1:user123', { data: 'list1' });
      cache.set('GET:/api/lists/2:user123', { data: 'list2' });
      cache.set('GET:/api/albums:user123', { data: 'albums' });

      cache.invalidate('/api/lists');

      assert.strictEqual(cache.get('GET:/api/lists/1:user123'), null);
      assert.strictEqual(cache.get('GET:/api/lists/2:user123'), null);
      assert.ok(cache.get('GET:/api/albums:user123')); // Different pattern
    });

    test('should invalidate by user ID pattern', () => {
      const cache = createTestCache();

      cache.set('GET:/api/data:user123', { data: 'data1' });
      cache.set('GET:/api/other:user123', { data: 'data2' });
      cache.set('GET:/api/data:user456', { data: 'data3' });

      cache.invalidate('user123');

      assert.strictEqual(cache.get('GET:/api/data:user123'), null);
      assert.strictEqual(cache.get('GET:/api/other:user123'), null);
      assert.ok(cache.get('GET:/api/data:user456')); // Different user
    });
  });

  test.describe('Key Generation', () => {
    test('should generate unique keys based on method, URL, and user', () => {
      const cache = createTestCache();

      const req1 = {
        method: 'GET',
        originalUrl: '/api/lists',
        user: { _id: 'user123' },
      };

      const req2 = {
        method: 'GET',
        originalUrl: '/api/lists',
        user: { _id: 'user456' },
      };

      const req3 = {
        method: 'POST',
        originalUrl: '/api/lists',
        user: { _id: 'user123' },
      };

      const key1 = cache.generateKey(req1);
      const key2 = cache.generateKey(req2);
      const key3 = cache.generateKey(req3);

      assert.notStrictEqual(key1, key2); // Different users
      assert.notStrictEqual(key1, key3); // Different methods
    });

    test('should handle anonymous users', () => {
      const cache = createTestCache();

      const req = {
        method: 'GET',
        originalUrl: '/api/public',
        // No user property
      };

      const key = cache.generateKey(req);
      assert.ok(key.includes('anonymous'));
    });

    test('should include full URL in key', () => {
      const cache = createTestCache();

      const req = {
        method: 'GET',
        originalUrl: '/api/lists?filter=active',
        user: { _id: 'user1' },
      };

      const key = cache.generateKey(req);
      assert.ok(key.includes('/api/lists?filter=active'));
    });
  });

  test.describe('Security - User Isolation', () => {
    test('should prevent cache poisoning between users', () => {
      const cache = createTestCache();

      // User 1 caches data
      const user1Req = {
        method: 'GET',
        originalUrl: '/api/sensitive',
        user: { _id: 'user1' },
      };
      const key1 = cache.generateKey(user1Req);
      cache.set(key1, { secret: 'user1-data' });

      // User 2 should NOT get user1's data
      const user2Req = {
        method: 'GET',
        originalUrl: '/api/sensitive',
        user: { _id: 'user2' },
      };
      const key2 = cache.generateKey(user2Req);
      const user2Data = cache.get(key2);

      assert.strictEqual(user2Data, null);
      assert.notStrictEqual(key1, key2);
    });

    test('should isolate cache by user ID in key', () => {
      const cache = createTestCache();

      cache.set('GET:/api/data:alice', { data: 'alice-data' });
      cache.set('GET:/api/data:bob', { data: 'bob-data' });

      const aliceData = cache.get('GET:/api/data:alice');
      const bobData = cache.get('GET:/api/data:bob');

      assert.strictEqual(aliceData.data.data, 'alice-data');
      assert.strictEqual(bobData.data.data, 'bob-data');
      assert.notDeepStrictEqual(aliceData, bobData);
    });
  });

  test.describe('Memory Management', () => {
    test('should not grow beyond max size after cleanup', () => {
      const cache = createTestCache({ maxSize: 100 });

      // Add many entries
      for (let i = 0; i < 200; i++) {
        cache.set(`key-${i}`, { data: `value-${i}` });
      }

      cache.cleanup();

      // Should enforce max size
      assert.ok(cache.cache.size <= 100);
    });

    test('should handle rapid cache writes without issues', () => {
      const cache = createTestCache();

      // Rapid writes
      for (let i = 0; i < 1000; i++) {
        cache.set(`rapid-${i}`, { data: i });
      }

      // Should still be functional
      const result = cache.get('rapid-500');
      assert.ok(result);
      assert.strictEqual(result.data.data, 500);
    });
  });

  test.describe('Cache Data Integrity', () => {
    test('should store exact data without mutation', () => {
      const cache = createTestCache();

      const originalData = { complex: { nested: { value: 123 } } };
      cache.set('test-key', originalData);

      const retrieved = cache.get('test-key');

      assert.deepStrictEqual(retrieved.data, originalData);
    });

    test('should handle null values', () => {
      const cache = createTestCache();

      cache.set('null-value', null);

      const nullResult = cache.get('null-value');

      assert.ok(nullResult); // Entry exists
      assert.strictEqual(nullResult.data, null);
    });

    test('should handle various data types', () => {
      const cache = createTestCache();

      cache.set('string', 'test-string');
      cache.set('number', 42);
      cache.set('boolean', true);
      cache.set('array', [1, 2, 3]);
      cache.set('object', { key: 'value' });

      assert.strictEqual(cache.get('string').data, 'test-string');
      assert.strictEqual(cache.get('number').data, 42);
      assert.strictEqual(cache.get('boolean').data, true);
      assert.deepStrictEqual(cache.get('array').data, [1, 2, 3]);
      assert.deepStrictEqual(cache.get('object').data, { key: 'value' });
    });

    test('should store entry metadata correctly', () => {
      const cache = createTestCache({ defaultTTL: 5000 });
      const before = Date.now();

      cache.set('meta-test', { value: 'test' });

      const after = Date.now();
      const entry = cache.get('meta-test');

      assert.ok(entry.createdAt >= before);
      assert.ok(entry.createdAt <= after);
      assert.ok(entry.expiresAt > entry.createdAt);
      assert.ok(entry.expiresAt <= after + 5000);
    });
  });
});
