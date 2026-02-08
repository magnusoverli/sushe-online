/**
 * Admin Telegram Configuration Routes
 *
 * Handles Telegram bot setup and notification configuration:
 * - /api/admin/telegram/status - Get configuration status
 * - /api/admin/telegram/validate-token - Validate bot token
 * - /api/admin/telegram/detect-groups - Find groups bot is in
 * - /api/admin/telegram/group-info - Get group details
 * - /api/admin/telegram/save-config - Save configuration
 * - /api/admin/telegram/test - Send test message
 * - /api/admin/telegram/test-preview - Test with provided credentials
 * - /api/admin/telegram/disconnect - Disconnect Telegram
 * - /api/admin/telegram/link-account - Link admin to Telegram
 * - /api/admin/telegram/recommendations/* - Recommendation notification config
 */

const logger = require('../../utils/logger');
const { createTelegramNotifier } = require('../../services/telegram');
const { createAsyncHandler } = require('../../middleware/async-handler');

const asyncHandler = createAsyncHandler(logger);

module.exports = (app, deps, adminEventService) => {
  const { ensureAuth, ensureAdmin, pool } = deps;

  // Create telegram notifier instance
  const telegramNotifier = createTelegramNotifier({ pool, logger });

  // Wire up telegram to admin events service if provided
  if (adminEventService) {
    adminEventService.setTelegramNotifier(telegramNotifier);
  }

  // Expose telegram notifier for use by other modules
  app.locals.telegramNotifier = telegramNotifier;

  // Shared middleware stack for all admin telegram routes
  const adminAuth = [ensureAuth, ensureAdmin];

  // Get current Telegram configuration status
  app.get(
    '/api/admin/telegram/status',
    ...adminAuth,
    asyncHandler(async (_req, res) => {
      const config = await telegramNotifier.getConfig();
      if (!config) {
        return res.json({ configured: false });
      }

      res.json({
        configured: true,
        enabled: config.enabled,
        chatId: config.chatId,
        chatTitle: config.chatTitle,
        threadId: config.threadId,
        topicName: config.topicName,
        configuredAt: config.configuredAt,
      });
    }, 'getting Telegram status')
  );

  // Validate bot token
  app.post(
    '/api/admin/telegram/validate-token',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }

      const result = await telegramNotifier.validateToken(token);
      res.json(result);
    }, 'validating Telegram token')
  );

  // Detect groups the bot has been added to
  app.post(
    '/api/admin/telegram/detect-groups',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }

      const groups = await telegramNotifier.detectGroups(token);
      res.json({ groups });
    }, 'detecting Telegram groups')
  );

  // Get group info (check if forum, get topics)
  app.post(
    '/api/admin/telegram/group-info',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { token, chatId } = req.body;
      if (!token || !chatId) {
        return res.status(400).json({ error: 'Token and chatId are required' });
      }

      const info = await telegramNotifier.getChatInfo(token, chatId);
      res.json(info);
    }, 'getting Telegram group info')
  );

  // Save Telegram configuration
  app.post(
    '/api/admin/telegram/save-config',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { botToken, chatId, threadId, chatTitle, topicName } = req.body;

      if (!botToken || !chatId) {
        return res
          .status(400)
          .json({ error: 'Bot token and chat ID are required' });
      }

      const config = await telegramNotifier.saveConfig({
        botToken,
        chatId,
        threadId: threadId || null,
        chatTitle: chatTitle || 'Admin Group',
        topicName: topicName || null,
        configuredBy: req.user._id,
      });

      logger.info('Telegram configured', {
        adminUsername: req.user.username,
        adminId: req.user._id,
      });

      res.json({
        success: true,
        config: {
          chatId: config.chat_id,
          chatTitle: config.chat_title,
          threadId: config.thread_id,
          topicName: config.topic_name,
          enabled: config.enabled,
        },
      });
    }, 'saving Telegram config')
  );

  // Send test message (for saved config)
  app.post(
    '/api/admin/telegram/test',
    ...adminAuth,
    asyncHandler(async (_req, res) => {
      const result = await telegramNotifier.sendTestMessage();

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, messageId: result.messageId });
    }, 'sending test message')
  );

  // Send test message preview (before config is saved, using provided credentials)
  app.post(
    '/api/admin/telegram/test-preview',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { token, chatId, threadId } = req.body;

      if (!token || !chatId) {
        return res.status(400).json({ error: 'Token and chatId are required' });
      }

      const result = await telegramNotifier.sendTestMessageWithCredentials(
        token,
        chatId,
        threadId
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ success: true, messageId: result.messageId });
    }, 'sending test preview message')
  );

  // Disconnect Telegram
  app.delete(
    '/api/admin/telegram/disconnect',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      await telegramNotifier.disconnect();
      logger.info('Telegram disconnected', {
        adminUsername: req.user.username,
        adminId: req.user._id,
      });
      res.json({ success: true });
    }, 'disconnecting Telegram')
  );

  // Link current admin to their Telegram account
  app.post(
    '/api/admin/telegram/link-account',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { telegramUserId, telegramUsername } = req.body;

      if (!telegramUserId) {
        return res.status(400).json({ error: 'Telegram user ID is required' });
      }

      const success = await telegramNotifier.linkAdmin(
        telegramUserId,
        telegramUsername,
        req.user._id
      );

      if (!success) {
        return res.status(500).json({ error: 'Failed to link account' });
      }

      res.json({ success: true });
    }, 'linking Telegram account')
  );

  // Get recommendations Telegram status
  app.get(
    '/api/admin/telegram/recommendations/status',
    ...adminAuth,
    asyncHandler(async (_req, res) => {
      const config = await telegramNotifier.getConfig();
      const threads = await telegramNotifier.getRecommendationThreads();

      res.json({
        configured: config?.enabled || false,
        recommendationsEnabled: config?.recommendationsEnabled || false,
        chatTitle: config?.chatTitle || null,
        threads,
      });
    }, 'getting recommendations Telegram status')
  );

  // Enable/disable recommendations notifications
  app.post(
    '/api/admin/telegram/recommendations/toggle',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const { enabled } = req.body;

      // Check if base Telegram is configured
      const config = await telegramNotifier.getConfig();
      if (!config?.enabled) {
        return res.status(400).json({
          error: 'Telegram must be configured for admin events first',
        });
      }

      await telegramNotifier.setRecommendationsEnabled(enabled);

      logger.info('Admin action', {
        action: enabled
          ? 'enable_telegram_recommendations'
          : 'disable_telegram_recommendations',
        adminId: req.user._id,
        adminEmail: req.user.email,
        ip: req.ip,
      });

      res.json({ success: true, enabled });
    }, 'toggling recommendations Telegram')
  );

  // Send test recommendation notification
  app.post(
    '/api/admin/telegram/recommendations/test',
    ...adminAuth,
    asyncHandler(async (req, res) => {
      const config = await telegramNotifier.getConfig();
      if (!config?.enabled || !config?.recommendationsEnabled) {
        return res.status(400).json({
          error: 'Recommendations notifications are not enabled',
        });
      }

      const testYear = new Date().getFullYear();
      const result = await telegramNotifier.sendRecommendationNotification(
        {
          artist: 'Test Artist',
          album: 'Test Album',
          album_id: 'test-album-id',
          release_date: new Date().toISOString(),
          year: testYear,
          recommended_by: req.user.username,
          reasoning:
            'This is a test recommendation to verify the Telegram integration is working correctly.',
        },
        null // No cover image for test
      );

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true, year: testYear });
    }, 'sending test recommendation notification')
  );

  return { telegramNotifier };
};
