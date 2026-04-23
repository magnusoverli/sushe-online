function createExtensionTokenHandlers(deps = {}) {
  const {
    asyncHandler,
    authService,
    db,
    generateExtensionToken,
    validateExtensionToken,
    cleanupExpiredTokens,
    usersAsync,
    sanitizeUser,
    saveSessionAsync,
    logger,
  } = deps;

  async function showExtensionAuthPage(req, res) {
    if (!req.isAuthenticated()) {
      req.session.extensionAuth = true;
      try {
        await saveSessionAsync(req);
      } catch (err) {
        logger.error('Session save error:', err);
      }
      return res.redirect('/login');
    }

    res.send(deps.extensionAuthTemplate());
  }

  const createExtensionToken = asyncHandler(async (req, res) => {
    const userAgent = req.get('User-Agent') || 'Unknown';
    const result = await authService.createExtensionToken(
      db,
      req.user._id,
      userAgent,
      generateExtensionToken
    );

    logger.info('Extension token generated', {
      userId: req.user._id,
      email: req.user.email,
    });

    res.json(result);
  }, 'generating extension token');

  const validateToken = asyncHandler(async (req, res) => {
    const authHeader = req.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const userId = await validateExtensionToken(token, db);

    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await usersAsync.findOne({ _id: userId });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ valid: true, user: sanitizeUser(user) });
  }, 'validating extension token');

  const revokeExtensionToken = asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const { revoked } = await authService.revokeExtensionToken(
      db,
      token,
      req.user._id
    );

    if (!revoked) {
      return res.status(404).json({ error: 'Token not found' });
    }

    logger.info('Extension token revoked', {
      userId: req.user._id,
      email: req.user.email,
    });

    res.json({ success: true });
  }, 'revoking extension token');

  const listExtensionTokens = asyncHandler(async (req, res) => {
    const tokens = await authService.listExtensionTokens(db, req.user._id);
    res.json({ tokens });
  }, 'listing extension tokens');

  const cleanupTokens = asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const deletedCount = await cleanupExpiredTokens(db);
    logger.info('Cleaned up expired tokens', { count: deletedCount });
    res.json({ deletedCount });
  }, 'cleaning up expired tokens');

  return {
    cleanupTokens,
    createExtensionToken,
    listExtensionTokens,
    revokeExtensionToken,
    showExtensionAuthPage,
    validateToken,
  };
}

module.exports = {
  createExtensionTokenHandlers,
};
