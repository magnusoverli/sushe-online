function createSecurityHandlers(deps = {}) {
  const {
    authService,
    userService,
    invalidateUserCache,
    saveSessionSafe,
    adminCodeState,
    logger,
    respondWithError,
    respondWithSuccess,
    isValidPassword,
  } = deps;

  async function changePassword(req, res) {
    try {
      const result = await authService.changePassword(
        req.user._id,
        req.user.hash,
        req.body,
        isValidPassword
      );

      if (!result.success) {
        return respondWithError(req, res, 400, result.error, '/');
      }

      const updated = await userService.updatePasswordHash(
        req.user._id,
        result.newHash
      );

      if (!updated) {
        return respondWithError(req, res, 404, 'User not found', '/');
      }

      if (invalidateUserCache) {
        invalidateUserCache(req.user._id);
      }

      return respondWithSuccess(req, res, 'Password updated successfully', '/');
    } catch (error) {
      logger.error('Password change error', {
        error: error.message,
        userId: req.user._id,
      });
      return respondWithError(req, res, 500, 'Error changing password', '/');
    }
  }

  async function requestAdmin(req, res) {
    logger.info('Admin request received', {
      email: req.user.email,
      userId: req.user._id,
      requestId: req.id,
    });

    try {
      const { code } = req.body;
      const codeResult = authService.validateAdminCode(
        code,
        req.user._id,
        adminCodeState
      );

      if (!codeResult.valid) {
        logger.info('Invalid code attempt');

        const attempts = req.adminAttempts;
        attempts.count++;
        adminCodeState.adminCodeAttempts.set(req.user._id, attempts);

        return respondWithError(req, res, 400, codeResult.error, '/');
      }

      adminCodeState.adminCodeAttempts.delete(req.user._id);

      const updated = await userService.setAdminRole(req.user._id, true);

      if (!updated) {
        return respondWithError(req, res, 404, 'User not found', '/');
      }

      if (invalidateUserCache) {
        invalidateUserCache(req.user._id);
      }

      logger.info(`Admin access granted to: ${req.user.email}`);
      authService.finalizeAdminCodeUsage(adminCodeState, req.user.email);

      req.user.role = 'admin';
      saveSessionSafe(req, 'admin role update');

      return respondWithSuccess(req, res, 'Admin access granted!', '/');
    } catch (error) {
      logger.error('Admin request error', {
        error: error.message,
        userId: req.user._id,
      });
      return respondWithError(
        req,
        res,
        500,
        'Error processing admin request',
        '/'
      );
    }
  }

  return {
    changePassword,
    requestAdmin,
  };
}

module.exports = {
  createSecurityHandlers,
};
