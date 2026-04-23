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
  const {
    ensureAuth,
    ensureAdmin,
    invalidateUserCache,
    userService,
    users,
    usersAsync,
    lists,
    listsAsync,
  } = deps;

  const deleteUser =
    userService && typeof userService.deleteUser === 'function'
      ? (userId) => userService.deleteUser(userId)
      : (userId) =>
          new Promise((resolve, reject) => {
            lists.remove({ userId }, { multi: true }, (listErr) => {
              if (listErr) {
                listErr.userFacingMessage = 'Error deleting user data';
                return reject(listErr);
              }

              users.remove({ _id: userId }, {}, (userErr, numRemoved) => {
                if (userErr) return reject(userErr);
                resolve(numRemoved > 0);
              });
            });
          });

  const setAdminRole =
    userService && typeof userService.setAdminRole === 'function'
      ? (userId, isAdmin) => userService.setAdminRole(userId, isAdmin)
      : (userId, isAdmin) =>
          usersAsync.update(
            { _id: userId },
            isAdmin
              ? { $set: { role: 'admin', adminGrantedAt: new Date() } }
              : { $unset: { role: true, adminGrantedAt: true } }
          );

  const getUserLists =
    userService && typeof userService.getUserLists === 'function'
      ? (userId) => userService.getUserLists(userId)
      : async (userId) => {
          const userLists = await listsAsync.findWithCounts({ userId });
          return userLists.map((list) => ({
            name: list.name,
            albumCount: list.itemCount,
            createdAt: list.createdAt,
            updatedAt: list.updatedAt,
          }));
        };

  // Admin: Delete user
  app.post('/admin/delete-user', ensureAuth, ensureAdmin, async (req, res) => {
    const { userId } = req.body;

    if (userId === req.user._id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    try {
      const deleted = await deleteUser(userId);

      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (typeof invalidateUserCache === 'function') {
        invalidateUserCache(userId);
      }

      logger.info(`Admin ${req.user.email} deleted user with ID: ${userId}`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Error deleting user', { error: err.message, userId });
      return res.status(500).json({
        error: err.userFacingMessage || 'Error deleting user',
      });
    }
  });

  // Admin: Make user admin
  app.post('/admin/make-admin', ensureAuth, ensureAdmin, async (req, res) => {
    const { userId } = req.body;

    try {
      const updated = await setAdminRole(userId, true);

      if (updated === 0 || updated === false) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (typeof invalidateUserCache === 'function') {
        invalidateUserCache(userId);
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
      const updated = await setAdminRole(userId, false);

      if (updated === 0 || updated === false) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (typeof invalidateUserCache === 'function') {
        invalidateUserCache(userId);
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
        const userLists = await getUserLists(userId);
        res.json({ lists: userLists });
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
