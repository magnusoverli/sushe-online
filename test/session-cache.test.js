const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  SessionCache,
  wrapSessionStore,
} = require('../middleware/session-cache');

describe('SessionCache', () => {
  let cache;

  beforeEach(() => {
    cache = new SessionCache({ ttl: 1000, maxSize: 10 });
  });

  describe('get', () => {
    it('should return null for non-existent session', () => {
      const result = cache.get('nonexistent');
      assert.strictEqual(result, null);
    });

    it('should return cached session data', () => {
      const sessionData = { user: 'test', cookie: {} };
      cache.set('sid123', sessionData);

      const result = cache.get('sid123');
      assert.deepStrictEqual(result, sessionData);
    });

    it('should return null for expired session', async () => {
      const shortCache = new SessionCache({ ttl: 10 }); // 10ms TTL
      shortCache.set('sid123', { user: 'test' });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 20));

      const result = shortCache.get('sid123');
      assert.strictEqual(result, null);
    });

    it('should increment hits on cache hit', () => {
      cache.set('sid123', { user: 'test' });
      cache.get('sid123');
      cache.get('sid123');

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
    });

    it('should increment misses on cache miss', () => {
      cache.get('nonexistent1');
      cache.get('nonexistent2');

      const stats = cache.getStats();
      assert.strictEqual(stats.misses, 2);
    });
  });

  describe('set', () => {
    it('should store session data', () => {
      const data = { user: 'test', cookie: { maxAge: 3600 } };
      cache.set('sid123', data);

      const result = cache.get('sid123');
      assert.deepStrictEqual(result, data);
    });

    it('should evict oldest entry when max size reached', () => {
      const smallCache = new SessionCache({ ttl: 10000, maxSize: 3 });

      smallCache.set('sid1', { n: 1 });
      smallCache.set('sid2', { n: 2 });
      smallCache.set('sid3', { n: 3 });
      smallCache.set('sid4', { n: 4 }); // Should evict sid1

      assert.strictEqual(smallCache.get('sid1'), null);
      assert.deepStrictEqual(smallCache.get('sid4'), { n: 4 });
    });

    it('should update expiration on re-set', async () => {
      const shortCache = new SessionCache({ ttl: 50 });
      shortCache.set('sid123', { user: 'test' });

      await new Promise((resolve) => setTimeout(resolve, 30));
      shortCache.set('sid123', { user: 'test' }); // Re-set extends TTL

      await new Promise((resolve) => setTimeout(resolve, 30));
      // Should still be valid because we re-set it
      const result = shortCache.get('sid123');
      assert.deepStrictEqual(result, { user: 'test' });
    });
  });

  describe('delete', () => {
    it('should remove session from cache', () => {
      cache.set('sid123', { user: 'test' });
      cache.delete('sid123');

      const result = cache.get('sid123');
      assert.strictEqual(result, null);
    });

    it('should not throw for non-existent session', () => {
      assert.doesNotThrow(() => cache.delete('nonexistent'));
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('sid1', { n: 1 });
      cache.set('sid2', { n: 2 });
      cache.set('sid3', { n: 3 });

      cache.clear();

      assert.strictEqual(cache.get('sid1'), null);
      assert.strictEqual(cache.get('sid2'), null);
      assert.strictEqual(cache.get('sid3'), null);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.set('sid1', { n: 1 });
      cache.set('sid2', { n: 2 });
      cache.get('sid1'); // hit
      cache.get('sid2'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.size, 2);
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.strictEqual(stats.hitRate, 67); // 2/3 = 66.67%
    });

    it('should handle zero total requests', () => {
      const stats = cache.getStats();
      assert.strictEqual(stats.hitRate, 0);
    });
  });
});

describe('wrapSessionStore', () => {
  let cache;

  beforeEach(() => {
    cache = new SessionCache({ ttl: 1000 });
  });

  describe('get', () => {
    it('should return cached data without calling store', (_, done) => {
      let storeGetCalled = false;
      const mockStore = {
        get: (sid, cb) => {
          storeGetCalled = true;
          cb(null, { user: 'db-user' });
        },
        set: (sid, session, cb) => cb && cb(null),
        destroy: (sid, cb) => cb && cb(null),
      };

      cache.set('sid123', { user: 'cached-user' });
      const wrappedStore = wrapSessionStore(mockStore, cache);

      wrappedStore.get('sid123', (err, session) => {
        assert.strictEqual(err, null);
        assert.deepStrictEqual(session, { user: 'cached-user' });
        assert.strictEqual(storeGetCalled, false);
        done();
      });
    });

    it('should call original store on cache miss', (_, done) => {
      let storeGetCalled = false;
      const mockStore = {
        get: (sid, cb) => {
          storeGetCalled = true;
          cb(null, { user: 'db-user' });
        },
        set: (sid, session, cb) => cb && cb(null),
        destroy: (sid, cb) => cb && cb(null),
      };

      const wrappedStore = wrapSessionStore(mockStore, cache);

      wrappedStore.get('sid123', (err, session) => {
        assert.strictEqual(err, null);
        assert.deepStrictEqual(session, { user: 'db-user' });
        assert.strictEqual(storeGetCalled, true);
        done();
      });
    });

    it('should cache result from store on miss', (_, done) => {
      let storeGetCallCount = 0;
      const mockStore = {
        get: (sid, cb) => {
          storeGetCallCount++;
          cb(null, { user: 'db-user' });
        },
        set: (sid, session, cb) => cb && cb(null),
        destroy: (sid, cb) => cb && cb(null),
      };

      const wrappedStore = wrapSessionStore(mockStore, cache);

      wrappedStore.get('sid123', () => {
        // Second call should use cache
        wrappedStore.get('sid123', (err, session) => {
          assert.deepStrictEqual(session, { user: 'db-user' });
          // Store should only be called once
          assert.strictEqual(storeGetCallCount, 1);
          done();
        });
      });
    });

    it('should return cloned data to prevent mutation', (_, done) => {
      const mockStore = {
        get: (sid, cb) => cb(null, { user: 'db-user' }),
        set: (sid, session, cb) => cb && cb(null),
        destroy: (sid, cb) => cb && cb(null),
      };

      cache.set('sid123', { user: 'cached-user', data: { count: 1 } });
      const wrappedStore = wrapSessionStore(mockStore, cache);

      wrappedStore.get('sid123', (err, session) => {
        session.data.count = 999; // Mutate

        // Get again - should have original data
        wrappedStore.get('sid123', (err2, session2) => {
          assert.strictEqual(session2.data.count, 1);
          done();
        });
      });
    });
  });

  describe('set', () => {
    it('should update cache and call original store', (_, done) => {
      let storeSetCalled = false;
      const mockStore = {
        get: (sid, cb) => cb(null, { user: 'db-user' }),
        set: (sid, session, cb) => {
          storeSetCalled = true;
          if (cb) cb(null);
        },
        destroy: (sid, cb) => cb && cb(null),
      };

      const wrappedStore = wrapSessionStore(mockStore, cache);

      wrappedStore.set('sid123', { user: 'new-user' }, () => {
        // Check cache was updated
        const cached = cache.get('sid123');
        assert.deepStrictEqual(cached, { user: 'new-user' });
        // Check original store was called
        assert.strictEqual(storeSetCalled, true);
        done();
      });
    });
  });

  describe('destroy', () => {
    it('should remove from cache and call original store', (_, done) => {
      let storeDestroyCalled = false;
      const mockStore = {
        get: (sid, cb) => cb(null, { user: 'db-user' }),
        set: (sid, session, cb) => cb && cb(null),
        destroy: (sid, cb) => {
          storeDestroyCalled = true;
          if (cb) cb(null);
        },
      };

      cache.set('sid123', { user: 'test' });
      const wrappedStore = wrapSessionStore(mockStore, cache);

      wrappedStore.destroy('sid123', () => {
        // Check cache was cleared
        const cached = cache.get('sid123');
        assert.strictEqual(cached, null);
        // Check original store was called
        assert.strictEqual(storeDestroyCalled, true);
        done();
      });
    });
  });
});
