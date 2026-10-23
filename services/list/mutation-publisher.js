function createListMutationPublisher({
  responseCache,
  aggregateList,
  getBroadcast,
  logger,
}) {
  return async ({ userId, years, changes = [] }) => {
    try {
      responseCache.invalidate(`:${userId}`);
      for (const year of years) aggregateList.scheduleRecompute(year);
      const broadcast = getBroadcast();
      if (changes.length) {
        for (const change of changes)
          broadcast?.listUpdated(userId, change.listId, {
            revision: change.revision,
          });
      } else broadcast?.libraryUpdated(userId);
      responseCache.invalidate('GET:/api/community/');
      responseCache.invalidate('GET:/api/recommendations/');
      broadcast?.sharedViewsUpdated?.();
    } catch (error) {
      // Persistence succeeded. Never ask a caller to retry a committed write
      // because notification transport failed; reconnect refreshes the library.
      logger.error('List mutation publication failed', {
        userId,
        error: error.message,
      });
    }
  };
}
module.exports = { createListMutationPublisher };
