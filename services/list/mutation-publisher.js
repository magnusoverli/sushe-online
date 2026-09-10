function createListMutationPublisher({
  responseCache,
  aggregateList,
  getBroadcast,
  logger,
}) {
  return async ({ userId, years }) => {
    try {
      responseCache.invalidate(`:${userId}`);
      for (const year of years) aggregateList.scheduleRecompute(year);
      getBroadcast()?.libraryUpdated(userId);
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
