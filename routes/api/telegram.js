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
  const { db, logger, usersAsync } = deps;
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
        telegramNotifier = createTelegramNotifier({ db, logger });
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

        logger.debug('Telegram callback received', {
          callbackData,
          telegramUserId: telegramUser.id,
        });

        // Parse the callback data
        const parsed = telegramNotifier.parseCallbackData(callbackData);

        logger.debug('Parsed Telegram callback data', { parsed });

        if (parsed?.type === 'event_action') {
          // Try to get linked admin user, but don't require it
          let adminUser = await telegramNotifier.getLinkedAdmin(
            telegramUser.id
          );

          logger.debug('Telegram linked-admin lookup result', {
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

            logger.debug('Using Telegram user directly (not linked)', {
              telegramUserId: telegramUser.id,
              telegramUsername: telegramUser.username,
            });
          }

          // Get admin event service
          let adminEventService = app.locals.adminEventService;
          if (!adminEventService) {
            adminEventService = createAdminEventService({
              db: db || usersAsync,
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
