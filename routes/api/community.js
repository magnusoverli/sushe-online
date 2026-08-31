const { createAsyncHandler } = require('../../middleware/async-handler');

module.exports = (app, deps) => {
  const { ensureAuthAPI, logger, communityListService } = deps;
  const asyncHandler = createAsyncHandler(logger);
  const noStore = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  app.get(
    '/api/community/main-lists',
    ensureAuthAPI,
    noStore,
    asyncHandler(async (req, res) => {
      const lists = await communityListService.getMainListSummaries(
        req.user._id
      );
      res.json({ lists });
    }, 'fetching community main lists')
  );

  app.get(
    '/api/community/main-lists/:listId',
    ensureAuthAPI,
    noStore,
    asyncHandler(async (req, res) => {
      const list = await communityListService.getMainListDetail(
        req.params.listId,
        req.user._id
      );
      if (!list) {
        return res.status(404).json({ error: 'Community list not found' });
      }
      res.json(list);
    }, 'fetching community main list')
  );
};
