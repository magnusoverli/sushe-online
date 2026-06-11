/**
 * App bootstrap API.
 * Combines the metadata requests the app needs immediately after load.
 */

module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    logger,
    cacheConfigs,
    listService,
    groupService,
    recommendationService,
  } = deps;

  const { createAsyncHandler } = require('../../middleware/async-handler');
  const asyncHandler = createAsyncHandler(logger);

  app.get(
    '/api/app-bootstrap',
    ensureAuthAPI,
    cacheConfigs.userSpecific,
    asyncHandler(async (req, res) => {
      const selectedListId =
        typeof req.query.selectedListId === 'string'
          ? req.query.selectedListId.trim()
          : '';

      const listsPromise = listService.getAllLists(req.user._id);
      const groupsPromise = groupService.getGroups(req.user._id);
      const yearsPromise = recommendationService.getYears().catch((error) => {
        logger.warn('Failed to load recommendation years for bootstrap', {
          userId: req.user._id,
          error: error.message,
        });
        return [];
      });
      const selectedListPromise = selectedListId
        ? listService.getListById(selectedListId, req.user._id, {
            profile: 'core',
          })
        : Promise.resolve(null);

      const [lists, groups, recommendationYears, selectedList] =
        await Promise.all([
          listsPromise,
          groupsPromise,
          yearsPromise,
          selectedListPromise,
        ]);

      res.json({
        lists,
        groups,
        recommendationYears,
        selectedListId: selectedList ? selectedList.list._id : null,
        selectedListItems: selectedList ? selectedList.items : null,
        selectedListProfile: selectedList ? 'core' : null,
      });
    }, 'loading app bootstrap')
  );
};
