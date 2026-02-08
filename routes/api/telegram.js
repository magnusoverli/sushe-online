/**
 * Telegram Webhook API Routes
 *
 * Handles Telegram bot callbacks for admin actions.
 */

const { createAsyncHandler } = require('../../middleware/async-handler');

/**
 * Register Telegram routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { pool, logger } = deps;
  const asyncHandler = createAsyncHandler(logger);

  const { createTelegramNotifier } = require('../../services/telegram');
  const { createAdminEventService } = require('../../services/admin-events');

  // POST /api/telegram/webhook/:secret - Telegram webhook endpoint
  app.post(
    '/api/telegram/webhook/:secret',
    asyncHandler(async (req, res) => {
      // Get telegram notifier from app.locals (set by admin routes)
      // If not available, create a temporary one for verification
      let telegramNotifier = app.locals.telegramNotifier;
      if (!telegramNotifier) {
        telegramNotifier = createTelegramNotifier({ pool, logger });
      }

      // Verify the webhook secret
      const isValid = await telegramNotifier.verifyWebhookSecret(
        req.params.secret
      );
      if (!isValid) {
        logger.warn('Invalid Telegram webhook secret');
        return res.sendStatus(403);
      }

      const update = req.body;

      // Handle callback queries (button clicks)
      if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const callbackData = callbackQuery.data;
        const telegramUser = callbackQuery.from;

        logger.warn('[DEBUG-TELEGRAM-LINK] Telegram callback received', {
          callbackData,
          telegramUserId: telegramUser.id,
          telegramUserIdType: typeof telegramUser.id,
          telegramUsername: telegramUser.username,
        });

        // Parse the callback data
        const parsed = telegramNotifier.parseCallbackData(callbackData);

        logger.warn('[DEBUG-TELEGRAM-LINK] Parsed callback data', { parsed });

        if (parsed?.type === 'event_action') {
          // Try to get linked admin user, but don't require it
          let adminUser = await telegramNotifier.getLinkedAdmin(
            telegramUser.id
          );

          logger.warn('[DEBUG-TELEGRAM-LINK] getLinkedAdmin result', {
            adminUserFound: !!adminUser,
            adminUsername: adminUser?.username || null,
            telegramUserId: telegramUser.id,
          });

          // If not linked, use Telegram user info directly (skip linking requirement)
          if (!adminUser) {
            adminUser = {
              _id: `telegram:${telegramUser.id}`,
              username: telegramUser.username || `telegram_${telegramUser.id}`,
              source: 'telegram',
              telegramUserId: telegramUser.id,
            };

            logger.warn(
              '[DEBUG-TELEGRAM-LINK] Using Telegram user directly (no linking required)',
              {
                telegramUserId: telegramUser.id,
                telegramUsername: telegramUser.username,
                pseudoAdminUser: adminUser,
              }
            );
          }

          // Get admin event service
          let adminEventService = app.locals.adminEventService;
          if (!adminEventService) {
            adminEventService = createAdminEventService({
              pool,
              logger,
              telegramNotifier,
            });
          }

          // Execute the action
          const result = await adminEventService.executeAction(
            parsed.eventId,
            parsed.action,
            adminUser,
            'telegram'
          );

          if (result.success) {
            await telegramNotifier.answerCallbackQuery(
              callbackQuery.id,
              `✓ ${result.message}`
            );

            // Send a confirmation message in the topic thread
            const confirmText =
              `✅ *Action Completed*\n\n` +
              `*${parsed.action.charAt(0).toUpperCase() + parsed.action.slice(1)}* by @${adminUser.username}\n` +
              `${result.message}`;
            await telegramNotifier.sendMessage(confirmText);
          } else {
            await telegramNotifier.answerCallbackQuery(
              callbackQuery.id,
              `✗ ${result.message}`,
              true
            );

            // Send a failure message in the topic thread
            const failText =
              `❌ *Action Failed*\n\n` +
              `Attempted *${parsed.action}* by @${adminUser.username}\n` +
              `Error: ${result.message}`;
            await telegramNotifier.sendMessage(failText);
          }
        } else {
          // Unknown callback data
          await telegramNotifier.answerCallbackQuery(
            callbackQuery.id,
            'Unknown action'
          );
        }
      }

      // Always respond 200 to Telegram
      res.sendStatus(200);
    }, 'processing Telegram webhook')
  );
};
