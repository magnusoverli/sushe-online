/**
 * Admin User Management Routes
 *
 * Handles user CRUD operations:
 * - /admin/delete-user - Delete a user
 * - /admin/make-admin - Grant admin privileges
 * - /admin/revoke-admin - Revoke admin privileges
 * - /admin/user-lists/:userId - Get user's lists
 */

const logger = require('../../utils/logger');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin, users, usersAsync, lists, listsAsync } =
    deps;

  // Admin: Delete user
  app.post('/admin/delete-user', ensureAuth, ensureAdmin, (req, res) => {
    const { userId } = req.body;

    if (userId === req.user._id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // Delete user's lists first
    lists.remove({ userId }, { multi: true }, (err) => {
      if (err) {
        logger.error('Error deleting user lists', {
          error: err.message,
          userId,
        });
        return res.status(500).json({ error: 'Error deleting user data' });
      }

      // Then delete the user
      users.remove({ _id: userId }, {}, (err, numRemoved) => {
        if (err) {
          logger.error('Error deleting user', { error: err.message, userId });
          return res.status(500).json({ error: 'Error deleting user' });
        }

        if (numRemoved === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        logger.info(`Admin ${req.user.email} deleted user with ID: ${userId}`);
        res.json({ success: true });
      });
    });
  });

  // Admin: Make user admin
  app.post('/admin/make-admin', ensureAuth, ensureAdmin, async (req, res) => {
    const { userId } = req.body;

    try {
      const numUpdated = await usersAsync.update(
        { _id: userId },
        { $set: { role: 'admin', adminGrantedAt: new Date() } }
      );

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.info(
        `Admin ${req.user.email} granted admin to user ID: ${userId}`
      );
      res.json({ success: true });
    } catch (err) {
      logger.error('Error granting admin', {
        error: err.message,
        targetUserId: userId,
        adminId: req.user._id,
      });
      return res.status(500).json({ error: 'Error granting admin privileges' });
    }
  });

  // Admin: Revoke admin
  app.post('/admin/revoke-admin', ensureAuth, ensureAdmin, async (req, res) => {
    const { userId } = req.body;

    // Prevent revoking your own admin rights
    if (userId === req.user._id) {
      return res
        .status(400)
        .json({ error: 'Cannot revoke your own admin privileges' });
    }

    try {
      const numUpdated = await usersAsync.update(
        { _id: userId },
        { $unset: { role: true, adminGrantedAt: true } }
      );

      if (numUpdated === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      logger.info(
        `Admin ${req.user.email} revoked admin from user ID: ${userId}`
      );
      res.json({ success: true });
    } catch (err) {
      logger.error('Error revoking admin', {
        error: err.message,
        targetUserId: userId,
        adminId: req.user._id,
      });
      return res.status(500).json({ error: 'Error revoking admin privileges' });
    }
  });

  // Admin: Get user lists
  app.get(
    '/admin/user-lists/:userId',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { userId } = req.params;

      try {
        const userLists = await listsAsync.findWithCounts({ userId });
        const listsData = userLists.map((list) => ({
          name: list.name,
          albumCount: list.itemCount,
          createdAt: list.createdAt,
          updatedAt: list.updatedAt,
        }));

        res.json({ lists: listsData });
      } catch (err) {
        logger.error('Error fetching user lists', {
          error: err.message,
          targetUserId: userId,
        });
        res.status(500).json({ error: 'Error fetching user lists' });
      }
    }
  );
};
