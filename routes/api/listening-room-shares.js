const { createAsyncHandler } = require('../../middleware/async-handler');

module.exports = (
  app,
  {
    ensureAuthAPI,
    logger,
    listeningRoomShareService,
    baseUrl = process.env.BASE_URL,
  }
) => {
  const asyncHandler = createAsyncHandler(logger);
  const route = '/api/lists/:id/listening-room-share';
  app.post(
    route,
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { token, ...summary } =
        await listeningRoomShareService.createOrRenew(
          req.params.id,
          req.user._id
        );
      const origin = (
        baseUrl || `${req.protocol}://${req.get('host')}`
      ).replace(/\/+$/, '');
      res.set('Cache-Control', 'no-store');
      res.json({ url: `${origin}/lr/${token}`, ...summary });
    }, 'sharing list with Doom Room')
  );
  app.delete(
    route,
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      await listeningRoomShareService.stop(req.params.id, req.user._id);
      res.status(204).end();
    }, 'stopping Doom Room sharing')
  );
};
