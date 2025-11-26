// response-cache-testable.js
// Testable version that exports the ResponseCache class directly

const logger = require('../utils/logger');

class ResponseCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.defaultTTL = options.defaultTTL || 60000; // 1 minute default
    this.maxSize = options.maxSize || 1000; // Max cache entries
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes

    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    // If cache is still too large, remove oldest entries
    if (this.cache.size > this.maxSize) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt
      );

      const toRemove = this.cache.size - this.maxSize;
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0]);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Response cache cleanup: removed ${cleaned} entries`);
    }
  }

  generateKey(req) {
    // Create cache key from method, path, and user ID (for user-specific data)
    const userId = req.user?._id || 'anonymous';
    return `${req.method}:${req.originalUrl}:${userId}`;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  set(key, data, ttl = this.defaultTTL) {
    const now = Date.now();
    this.cache.set(key, {
      data,
      createdAt: now,
      expiresAt: now + ttl,
    });
  }

  invalidate(pattern) {
    // Invalidate cache entries matching a pattern
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }

  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

module.exports = { ResponseCache };
