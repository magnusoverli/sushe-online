const { timingSafeEqual } = require('node:crypto');
const { findLinkedAdmin } = require('../../db/repositories/admin-event-actors');

function matchesSecret(expected, supplied) {
  if (typeof expected !== 'string' || !expected || typeof supplied !== 'string')
    return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function getCallbackContext(callback) {
  const message = callback?.message;
  if (
    typeof callback?.id !== 'string' ||
    !callback.id ||
    !Number.isSafeInteger(callback.from?.id) ||
    callback.from.id <= 0 ||
    callback.from.is_bot !== false ||
    callback.inline_message_id != null ||
    !Number.isSafeInteger(message?.message_id) ||
    message.message_id <= 0 ||
    !Number.isSafeInteger(message.chat?.id) ||
    message.chat.id === 0 ||
    !Number.isSafeInteger(message.date) ||
    message.date <= 0 ||
    message.forward_origin != null ||
    message.forward_from != null ||
    message.forward_from_chat != null ||
    message.forward_date != null ||
    message.is_automatic_forward === true
  ) {
    return null;
  }
  return {
    telegramUserId: callback.from.id,
    chatId: message.chat.id,
    messageId: message.message_id,
  };
}

/**
 * @param {import('../../db/types').DbFacade} db - Canonical datastore with .raw().
 */
function createWebhookHandler(db, configManager, log) {
  async function verifyWebhookSecret(secret, headerSecret) {
    const config = await configManager.getConfig();
    // Existing webhook registrations use the URL secret only. New registrations
    // also send Telegram's secret-token header; reject it whenever it mismatches.
    return (
      config?.enabled === true &&
      matchesSecret(config.webhookSecret, secret) &&
      (headerSecret === undefined ||
        matchesSecret(config.webhookSecret, headerSecret))
    );
  }

  function parseCallbackData(callbackData) {
    if (
      typeof callbackData !== 'string' ||
      Buffer.byteLength(callbackData) > 64
    )
      return null;
    const match =
      /^event:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-z][a-z0-9_]{0,17})$/i.exec(
        callbackData
      );
    return match
      ? { type: 'event_action', eventId: match[1], action: match[2] }
      : null;
  }

  async function getLinkedAdmin(telegramUserId) {
    if (!db || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0)
      return null;

    try {
      return await findLinkedAdmin(db, telegramUserId);
    } catch (_err) {
      log.error('Telegram admin lookup failed');
      return null;
    }
  }

  async function linkAdmin(telegramUserId, telegramUsername, appUserId) {
    if (!db) return false;

    try {
      await db.raw(
        `INSERT INTO telegram_admins (telegram_user_id, telegram_username, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (telegram_user_id) 
         DO UPDATE SET telegram_username = $2, user_id = $3, linked_at = NOW()`,
        [telegramUserId, telegramUsername, appUserId]
      );
      return true;
    } catch (err) {
      log.error('Error linking Telegram admin:', err);
      return false;
    }
  }

  return {
    getLinkedAdmin,
    linkAdmin,
    parseCallbackData,
    verifyWebhookSecret,
  };
}

module.exports = {
  createWebhookHandler,
  getCallbackContext,
};
