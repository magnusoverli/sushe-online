/**
 * Session Cache Middleware
 *
 * Provides an in-memory cache layer for session store reads.
 * Reduces database round-trips by caching session data with configurable TTL.
 *
 * Follows dependency injection pattern for testability.
 */

const logger = require('../utils/logger');

/**
 * Simple in-memory session cache with TTL support
 */
class SessionCache {
  /**
   * @param {Object} options - Cache options
   * @param {number} options.ttl - Time-to-live in milliseconds (default: 30000)
   * @param {number} options.maxSize - Maximum cache entries (default: 1000)
   */
  constructor(options = {}) {
    this.cache = new Map();
    this.ttl = options.ttl || 30000; // 30 seconds default
    this.maxSize = options.maxSize || 1000;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get a session from cache
   * @param {string} sid - Session ID
   * @returns {Object|null} - Session data or null if not found/expired
   */
  get(sid) {
    const entry = this.cache.get(sid);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(sid);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  /**
   * Store a session in cache
   * @param {string} sid - Session ID
   * @param {Object} data - Session data
   */
  set(sid, data) {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }

    this.cache.set(sid, {
      data,
      expiresAt: Date.now() + this.ttl,
    });
  }

  /**
   * Remove a session from cache
   * @param {string} sid - Session ID
   */
  delete(sid) {
    this.cache.delete(sid);
  }

  /**
   * Clear all cached sessions
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0,
    };
  }
}

/**
 * Wrap a session store with caching layer
 * Intercepts get/set/destroy operations to maintain cache consistency
 *
 * @param {Object} store - Original session store (e.g., connect-pg-simple instance)
 * @param {SessionCache} cache - SessionCache instance
 * @param {Object} options - Options
 * @param {boolean} options.logStats - Log cache stats periodically (default: false)
 * @returns {Object} - Wrapped store
 */
function wrapSessionStore(store, cache, options = {}) {
  const originalGet = store.get.bind(store);
  const originalSet = store.set.bind(store);
  const originalDestroy = store.destroy.bind(store);

  // Wrap get - check cache first, fallback to store
  store.get = function (sid, callback) {
    const cached = cache.get(sid);
    if (cached) {
      // Clone to prevent mutation of cached data
      return callback(null, JSON.parse(JSON.stringify(cached)));
    }

    originalGet(sid, (err, session) => {
      if (!err && session) {
        cache.set(sid, session);
      }
      callback(err, session);
    });
  };

  // Wrap set - update cache and store
  store.set = function (sid, session, callback) {
    cache.set(sid, session);
    originalSet(sid, session, callback);
  };

  // Wrap destroy - remove from cache and store
  store.destroy = function (sid, callback) {
    cache.delete(sid);
    originalDestroy(sid, callback);
  };

  // Optional: Log stats periodically
  if (options.logStats) {
    setInterval(() => {
      const stats = cache.getStats();
      if (stats.hits + stats.misses > 0) {
        logger.debug('Session cache stats', stats);
      }
    }, 60000); // Every minute
  }

  return store;
}

/**
 * Create a session cache middleware instance
 * Factory function for dependency injection
 *
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.logger - Logger instance
 * @returns {Object} - SessionCache class and wrapSessionStore function
 */
function createSessionCache(deps = {}) {
  const log = deps.logger || logger;

  // Return modified versions that use injected logger
  return {
    SessionCache,
    wrapSessionStore: (store, cache, options = {}) => {
      return wrapSessionStore(store, cache, { ...options, logger: log });
    },
  };
}

module.exports = {
  SessionCache,
  wrapSessionStore,
  createSessionCache,
};
