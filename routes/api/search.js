/**
 * Search API Routes
 *
 * Thin HTTP adapter over album-search-service. Cross-list substring search
 * scoped to the authenticated user.
 *
 * Auth uses ensureAuthAPI, which accepts EITHER a session cookie (desktop web)
 * OR a bearer token (browser extension / future mobile client) — so this one
 * endpoint is reusable by every client without change.
 */

module.exports = (app, deps) => {
  const { ensureAuthAPI, logger, searchService, searchRateLimit } = deps;

  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  // Field groups a client may opt into beyond the always-on artist + album.
  const OPTIONAL_FIELDS = new Set(['meta', 'notes', 'tracks']);

  function parseFields(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return [];
    return raw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => OPTIONAL_FIELDS.has(part));
  }

  // Search albums across the current user's lists.
  app.get(
    '/api/search/albums',
    searchRateLimit,
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const result = await searchService.searchUserAlbums({
        userId: req.user._id,
        query: typeof req.query.q === 'string' ? req.query.q : '',
        fields: parseFields(req.query.fields),
        limit: req.query.limit,
      });
      res.json(result);
    }, 'searching albums')
  );
};
