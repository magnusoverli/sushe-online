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
      if (onHit) onHit(req, cacheKey);

      // Set cache headers
      res.set({
        'X-Cache': 'HIT',
        'X-Cache-Key': cacheKey,
      });

      return res.json(cached.data);
    }

    // Cache miss - intercept response
    if (onMiss) onMiss(req, cacheKey);

    const originalJson = res.json;
    res.json = function (data) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        responseCache.set(cacheKey, data, ttl);

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

// Predefined cache configurations for common use cases
const cacheConfigs = {
  // Static data that rarely changes (albums, genres)
  static: createCacheMiddleware({
    ttl: 300000, // 5 minutes
    shouldCache: (req) => {
      // Only cache for authenticated users to avoid leaking data
      return req.user && req.path.includes('/api/');
    },
  }),

  // User-specific data with moderate TTL
  // Cache is invalidated on any list modification (see routes/api.js POST /api/lists/:name)
  // so longer TTL is safe and improves perceived performance
  userSpecific: createCacheMiddleware({
    ttl: 300000, // 5 minutes - safe because cache is invalidated on writes
    shouldCache: (req) => {
      return req.user && req.path.includes('/api/lists');
    },
  }),

  // Public data with longer TTL
  public: createCacheMiddleware({
    ttl: 600000, // 10 minutes
    keyGenerator: (req) => `public:${req.method}:${req.originalUrl}`,
    shouldCache: (req) => {
      return (
        req.path.includes('/api/proxy/') || req.path.includes('/api/unfurl')
      );
    },
  }),

  // Album cover images with very long TTL (URLs don't change)
  images: createCacheMiddleware({
    ttl: 3600000, // 1 hour - images rarely change
    keyGenerator: (req) => `image:${req.query.url}`, // Key by image URL only
    shouldCache: (req) => {
      return req.path === '/api/proxy/image';
    },
    onHit: (req, key) => {
      logger.debug(`Image cache hit: ${key}`);
    },
    onMiss: (req, key) => {
      logger.debug(`Image cache miss: ${key}`);
    },
  }),
};

// Export class for testing, plus default instances for app usage
module.exports = {
  ResponseCache,
  responseCache,
  cacheConfigs,
};
