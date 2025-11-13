const logger = require('../utils/logger');

class ResponseCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.defaultTTL = options.defaultTTL || 60000; 
    this.maxSize = options.maxSize || 1000; 
    this.cleanupInterval = options.cleanupInterval || 300000; 

    
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
    }
    this.clear();
  }
}


const responseCache = new ResponseCache();


function createCacheMiddleware(options = {}) {
  const {
    ttl = 60000, 
    keyGenerator = null,
    shouldCache = () => true,
    onHit = null,
    onMiss = null,
  } = options;

  return (req, res, next) => {
    
    if (req.method !== 'GET') {
      return next();
    }

    
    if (!shouldCache(req)) {
      return next();
    }

    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : responseCache.generateKey(req);
    const cached = responseCache.get(cacheKey);

    if (cached) {
      
      if (onHit) onHit(req, cacheKey);

      
      res.set({
        'X-Cache': 'HIT',
        'X-Cache-Key': cacheKey,
      });

      return res.json(cached.data);
    }

    
    if (onMiss) onMiss(req, cacheKey);

    const originalJson = res.json;
    res.json = function (data) {
      
      if (res.statusCode >= 200 && res.statusCode < 300) {
        responseCache.set(cacheKey, data, ttl);

        
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


const cacheConfigs = {
  
  static: createCacheMiddleware({
    ttl: 300000, 
    shouldCache: (req) => {
      
      return req.user && req.path.includes('/api/');
    },
  }),

  
  userSpecific: createCacheMiddleware({
    ttl: 60000, 
    shouldCache: (req) => {
      return req.user && req.path.includes('/api/lists');
    },
  }),

  
  public: createCacheMiddleware({
    ttl: 600000, 
    keyGenerator: (req) => `public:${req.method}:${req.originalUrl}`,
    shouldCache: (req) => {
      return (
        req.path.includes('/api/proxy/') || req.path.includes('/api/unfurl')
      );
    },
  }),

  
  images: createCacheMiddleware({
    ttl: 3600000, 
    keyGenerator: (req) => `image:${req.query.url}`, 
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

module.exports = {
  ResponseCache,
  responseCache,
  createCacheMiddleware,
  cacheConfigs,
};
