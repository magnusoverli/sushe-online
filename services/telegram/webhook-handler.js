/**
 * @param {import('../../db/types').DbFacade} db - Canonical datastore with .raw().
 */
function createWebhookHandler(db, configManager, log) {
  const pool = db; // truthy alias for existing `if (!pool)` guards below

  async function verifyWebhookSecret(secret) {
    const config = await configManager.getConfig();
    return config?.webhookSecret === secret;
  }

  function parseCallbackData(callbackData) {
    if (!callbackData) return null;

    const parts = callbackData.split(':');
    if (parts[0] === 'event' && parts.length >= 3) {
      return { type: 'event_action', eventId: parts[1], action: parts[2] };
    }

    return null;
  }

  async function getLinkedAdmin(telegramUserId) {
    log.warn('[DEBUG-TELEGRAM-LINK] getLinkedAdmin called', {
      telegramUserId,
      telegramUserIdType: typeof telegramUserId,
      poolExists: !!pool,
    });

    if (!pool) {
      log.warn('[DEBUG-TELEGRAM-LINK] pool is null, returning null');
      return null;
    }

    try {
      const countResult = await db.raw(
        'SELECT COUNT(*) as count FROM telegram_admins'
      );
      log.warn('[DEBUG-TELEGRAM-LINK] telegram_admins table count', {
        count: countResult.rows[0]?.count,
      });

      const allAdmins = await db.raw(
        'SELECT telegram_user_id, telegram_username, user_id FROM telegram_admins'
      );
      log.warn('[DEBUG-TELEGRAM-LINK] all telegram_admins entries', {
        entries: allAdmins.rows,
      });

      const result = await db.raw(
        `SELECT u.* FROM users u
         JOIN telegram_admins ta ON u._id = ta.user_id
         WHERE ta.telegram_user_id = $1`,
        [telegramUserId]
      );

      log.warn('[DEBUG-TELEGRAM-LINK] query result', {
        rowCount: result.rows.length,
        foundUser: result.rows[0]?.username || null,
      });

      return result.rows[0] || null;
    } catch (err) {
      log.error('[DEBUG-TELEGRAM-LINK] query error', {
        error: err.message,
        stack: err.stack,
      });
      return null;
    }
  }

  async function linkAdmin(telegramUserId, telegramUsername, appUserId) {
    if (!pool) return false;

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
};
