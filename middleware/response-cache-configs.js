function createResponseCacheConfigs({ createCacheMiddleware, logger }) {
  return {
    static: createCacheMiddleware({
      ttl: 300000,
      shouldCache: (req) => req.user && req.path.includes('/api/'),
    }),
    userSpecific: createCacheMiddleware({
      ttl: 300000,
      shouldCache: (req) =>
        req.user &&
        !(req.path === '/api/app-bootstrap' && req.query?.selectedListId) &&
        (req.path.includes('/api/lists') ||
          req.path === '/api/app-bootstrap' ||
          req.path === '/api/groups'),
    }),
    public: createCacheMiddleware({
      ttl: 600000,
      keyGenerator: (req) => `public:${req.method}:${req.originalUrl}`,
      shouldCache: (req) =>
        req.path.includes('/api/proxy/') || req.path.includes('/api/unfurl'),
    }),
    aggregate: createCacheMiddleware({
      ttl: 600000,
      keyGenerator: (req) => `aggregate:${req.method}:${req.originalUrl}`,
      shouldCache: (req) => req.path.startsWith('/api/aggregate-list/'),
    }),
    images: createCacheMiddleware({
      ttl: 3600000,
      keyGenerator: (req) => {
        const url = req.query.url || '';
        try {
          const parsedUrl = new URL(url);
          return `image:${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
        } catch {
          return `image:invalid:${url}`;
        }
      },
      shouldCache: (req) => req.path === '/api/proxy/image',
      onHit: (req, key) => logger.debug('Image cache hit', { key }),
      onMiss: (req, key) => logger.debug('Image cache miss', { key }),
    }),
  };
}

module.exports = { createResponseCacheConfigs };
