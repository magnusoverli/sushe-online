const logger = require('../utils/logger');
const {
  incCacheHit,
  incCacheMiss,
  incResponseCacheEvictions,
  updateResponseCacheMetrics,
} = require('../utils/metrics');
const { resolveRamAccelerationConfig } = require('../config/ram-acceleration');
const { createResponseCacheConfigs } = require('./response-cache-configs');

function byteLength(value) {
  return Buffer.byteLength(value || '', 'utf8');
}

function serializeJson(data) {
  const serialized = JSON.stringify(data);
  return serialized === undefined ? 'null' : serialized;
}

class ResponseCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.defaultTTL = options.defaultTTL ?? 60000; // 1 minute default
    this.maxSize = options.maxSize ?? 1000; // Max cache entries
    this.maxBytes =
      options.maxBytes ??
      resolveRamAccelerationConfig(process.env).responseCacheMaxBytes;
    this.totalBytes = 0;
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes

    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
    this.updateMetrics();
  }

  updateMetrics() {
    updateResponseCacheMetrics(this.totalBytes, this.cache.size);
  }

  deleteEntry(key, countEviction = false) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.cache.delete(key);
    this.totalBytes -= entry.bytes || 0;
    if (countEviction) incResponseCacheEvictions();
    return true;
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.deleteEntry(key, true);
        cleaned++;
      }
    }

    // If cache is still too large, remove oldest entries (Map insertion order).
    while (
      this.cache.size > 0 &&
      (this.cache.size > this.maxSize || this.totalBytes > this.maxBytes)
    ) {
      const oldestKey = this.cache.keys().next().value;
      this.deleteEntry(oldestKey, true);
      cleaned++;
    }

    this.updateMetrics();

    if (cleaned > 0) {
      logger.debug('Response cache cleanup', {
        entriesRemoved: cleaned,
        cacheSize: this.cache.size,
        totalBytes: this.totalBytes,
      });
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
      this.deleteEntry(key, true);
      this.updateMetrics();
      return null;
    }

    // Refresh insertion order for LRU capacity eviction.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key, data, ttl = this.defaultTTL, options = {}) {
    const now = Date.now();
    const body = serializeJson(data);
    const bytes = byteLength(body);

    if (bytes > this.maxBytes) {
      logger.debug('Response cache skipped oversized entry', {
        key,
        bytes,
        maxBytes: this.maxBytes,
      });
      return false;
    }

    this.deleteEntry(key);
    const entry = {
      body,
      bytes,
      contentType: options.contentType || 'application/json; charset=utf-8',
      createdAt: now,
      expiresAt: now + ttl,
    };
    Object.defineProperty(entry, 'data', {
      enumerable: true,
      get() {
        return JSON.parse(body);
      },
    });

    this.cache.set(key, entry);
    this.totalBytes += bytes;
    this.cleanup();
    this.updateMetrics();
    return true;
  }

  invalidate(pattern) {
    // Invalidate cache entries matching a pattern
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.deleteEntry(key);
      }
    }
    this.updateMetrics();
  }

  clear() {
    this.cache.clear();
    this.totalBytes = 0;
    this.updateMetrics();
  }

  getStats() {
    return {
      size: this.cache.size,
      totalBytes: this.totalBytes,
      maxSize: this.maxSize,
      maxBytes: this.maxBytes,
    };
  }

  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

// Create global cache instance
const responseCache = new ResponseCache();

// Middleware factory for response caching
function createCacheMiddleware(options = {}) {
  const {
    ttl = 60000, // 1 minute default
    keyGenerator = null,
    shouldCache = () => true,
    onHit = null,
    onMiss = null,
  } = options;

  return (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip if shouldCache returns false
    if (!shouldCache(req)) {
      return next();
    }

    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : responseCache.generateKey(req);
    const cached = responseCache.get(cacheKey);

    if (cached) {
      // Cache hit
      incCacheHit();
      if (onHit) onHit(req, cacheKey);

      res.set({
        'X-Cache': 'HIT',
        'X-Cache-Key': cacheKey,
        'Content-Type': cached.contentType,
      });
      return res.send(cached.body);
    }

    // Cache miss - intercept response
    incCacheMiss();
    if (onMiss) onMiss(req, cacheKey);

    const originalJson = res.json;
    res.json = function (data) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        responseCache.set(cacheKey, data, ttl, {
          contentType: res.get('Content-Type'),
        });

        // Set cache headers
        res.set({
          'X-Cache': 'MISS',
          'X-Cache-Key': cacheKey,
        });
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

const cacheConfigs = createResponseCacheConfigs({
  createCacheMiddleware,
  logger,
});

// Export class for testing, plus default instances for app usage
module.exports = {
  ResponseCache,
  responseCache,
  cacheConfigs,
};
