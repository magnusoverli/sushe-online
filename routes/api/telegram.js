/** Telegram webhook delivery authentication; actor authorization lives in the service. */
const { createAsyncHandler } = require('../../middleware/async-handler');
const { createTelegramNotifier } = require('../../services/telegram');
const { createAdminEventService } = require('../../services/admin-events');
const {
  getCallbackContext,
} = require('../../services/telegram/webhook-handler');

module.exports = (app, { db, logger }) => {
  const asyncHandler = createAsyncHandler(logger);

  app.post(
    '/api/telegram/webhook/:secret',
    asyncHandler(async (req, res) => {
      const notifier =
        app.locals.telegramNotifier || createTelegramNotifier({ db, logger });
      const valid = await notifier.verifyWebhookSecret(
        req.params.secret,
        req.get('X-Telegram-Bot-Api-Secret-Token')
      );
      if (!valid) {
        logger.warn('Invalid Telegram webhook secret');
        return res.sendStatus(403);
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
        return res.sendStatus(400);
      const callback = req.body.callback_query;
      if (callback === undefined) return res.sendStatus(200);
      const parsed = notifier.parseCallbackData(callback?.data);
      if (!getCallbackContext(callback) || !parsed) return res.sendStatus(400);

      let service = app.locals.adminEventService;
      if (!service) {
        service = createAdminEventService({
          db,
          logger,
          telegramNotifier: notifier,
        });
        service.registerAccountApprovalHandlers();
      }
      const result = await service.executeAction(
        parsed.eventId,
        parsed.action,
        null,
        'telegram',
        callback
      );
      await notifier.answerCallbackQuery(
        callback.id,
        `${result.success ? '✓' : '✗'} ${result.message}`,
        !result.success
      );
      // Authenticated deliveries are acknowledged even when the actor is denied.
      return res.sendStatus(200);
    }, 'processing Telegram webhook')
  );
};
