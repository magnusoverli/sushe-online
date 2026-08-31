const logger = require('../../utils/logger');
const {
  createCommunityListService,
} = require('../../services/community-list-service');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, csrfProtection, db } = deps;
  const service = createCommunityListService({ db });
  const middleware = [ensureAuth, ensureAdmin];
  if (typeof csrfProtection === 'function') middleware.push(csrfProtection);

  const updateVisibility = async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (typeof req.body?.revealed !== 'boolean') {
      return res.status(400).json({ error: 'revealed must be a boolean' });
    }

    try {
      const visibility = await service.setYearVisibility(
        year,
        req.body.revealed,
        req.user._id
      );
      logger.info('Admin changed user-list year visibility', {
        adminUserId: req.user._id,
        year,
        revealed: req.body.revealed,
      });
      res.json(visibility);
    } catch (error) {
      logger.error('Failed to change user-list year visibility', {
        adminUserId: req.user?._id,
        year,
        revealed: req.body?.revealed,
        error: error.message,
      });
      res.status(500).json({ error: 'Failed to update user-list visibility' });
    }
  };

  app.put(
    '/api/admin/user-list-visibility/:year',
    ...middleware,
    updateVisibility
  );
  app.patch(
    '/api/admin/user-list-visibility/:year',
    ...middleware,
    updateVisibility
  );
};
