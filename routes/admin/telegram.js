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
const { createTelegramNotifier } = require('../../utils/telegram');

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

  // Get current Telegram configuration status
  app.get(
    '/api/admin/telegram/status',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
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
      } catch (error) {
        logger.error('Error getting Telegram status', { error: error.message });
        res.status(500).json({ error: 'Failed to get status' });
      }
    }
  );

  // Validate bot token
  app.post(
    '/api/admin/telegram/validate-token',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token } = req.body;
        if (!token) {
          return res.status(400).json({ error: 'Token is required' });
        }

        const result = await telegramNotifier.validateToken(token);
        res.json(result);
      } catch (error) {
        logger.error('Error validating Telegram token', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to validate token' });
      }
    }
  );

  // Detect groups the bot has been added to
  app.post(
    '/api/admin/telegram/detect-groups',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token } = req.body;
        if (!token) {
          return res.status(400).json({ error: 'Token is required' });
        }

        const groups = await telegramNotifier.detectGroups(token);
        res.json({ groups });
      } catch (error) {
        logger.error('Error detecting Telegram groups', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to detect groups' });
      }
    }
  );

  // Get group info (check if forum, get topics)
  app.post(
    '/api/admin/telegram/group-info',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token, chatId } = req.body;
        if (!token || !chatId) {
          return res
            .status(400)
            .json({ error: 'Token and chatId are required' });
        }

        const info = await telegramNotifier.getChatInfo(token, chatId);
        res.json(info);
      } catch (error) {
        logger.error('Error getting Telegram group info', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to get group info' });
      }
    }
  );

  // Save Telegram configuration
  app.post(
    '/api/admin/telegram/save-config',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
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
      } catch (error) {
        logger.error('Error saving Telegram config', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Failed to save configuration' });
      }
    }
  );

  // Send test message (for saved config)
  app.post(
    '/api/admin/telegram/test',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const result = await telegramNotifier.sendTestMessage();

        if (!result.success) {
          return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, messageId: result.messageId });
      } catch (error) {
        logger.error('Error sending test message', { error: error.message });
        res.status(500).json({ error: 'Failed to send test message' });
      }
    }
  );

  // Send test message preview (before config is saved, using provided credentials)
  app.post(
    '/api/admin/telegram/test-preview',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { token, chatId, threadId } = req.body;

        if (!token || !chatId) {
          return res
            .status(400)
            .json({ error: 'Token and chatId are required' });
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
      } catch (error) {
        logger.error('Error sending test preview message', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to send test message' });
      }
    }
  );

  // Disconnect Telegram
  app.delete(
    '/api/admin/telegram/disconnect',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        await telegramNotifier.disconnect();
        logger.info('Telegram disconnected', {
          adminUsername: req.user.username,
          adminId: req.user._id,
        });
        res.json({ success: true });
      } catch (error) {
        logger.error('Error disconnecting Telegram', {
          error: error.message,
          adminId: req.user._id,
        });
        res.status(500).json({ error: 'Failed to disconnect' });
      }
    }
  );

  // Link current admin to their Telegram account
  app.post(
    '/api/admin/telegram/link-account',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const { telegramUserId, telegramUsername } = req.body;

        if (!telegramUserId) {
          return res
            .status(400)
            .json({ error: 'Telegram user ID is required' });
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
      } catch (error) {
        logger.error('Error linking Telegram account', {
          error: error.message,
          userId: req.user._id,
        });
        res.status(500).json({ error: 'Failed to link account' });
      }
    }
  );

  // Get recommendations Telegram status
  app.get(
    '/api/admin/telegram/recommendations/status',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
        const config = await telegramNotifier.getConfig();
        const threads = await telegramNotifier.getRecommendationThreads();

        res.json({
          configured: config?.enabled || false,
          recommendationsEnabled: config?.recommendationsEnabled || false,
          chatTitle: config?.chatTitle || null,
          threads,
        });
      } catch (error) {
        logger.error('Error getting recommendations Telegram status', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to get status' });
      }
    }
  );

  // Enable/disable recommendations notifications
  app.post(
    '/api/admin/telegram/recommendations/toggle',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
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
      } catch (error) {
        logger.error('Error toggling recommendations Telegram', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to toggle setting' });
      }
    }
  );

  // Send test recommendation notification
  app.post(
    '/api/admin/telegram/recommendations/test',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      try {
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
      } catch (error) {
        logger.error('Error sending test recommendation notification', {
          error: error.message,
        });
        res.status(500).json({ error: 'Failed to send test notification' });
      }
    }
  );

  return { telegramNotifier };
};
