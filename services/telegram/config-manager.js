const crypto = require('crypto');
const { decrypt, encrypt } = require('./crypto-utils');

/**
 * @param {object} poolOrDb - Either a pg Pool (legacy) or a datastore with .raw().
 *   A datastore is detected via duck-typing on .raw; anything else is adapted.
 */
function createConfigManager(
  poolOrDb,
  encryptionKey,
  log,
  setupHelpers,
  baseUrl
) {
  let configCache = null;
  let configCacheTime = 0;
  const CONFIG_CACHE_TTL = 60000;
  const db =
    poolOrDb && typeof poolOrDb.raw === 'function'
      ? poolOrDb
      : poolOrDb
        ? { raw: (sql, params) => poolOrDb.query(sql, params) }
        : null;
  const pool = db; // legacy name used for null-check in bodies

  async function saveConfig(config) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    const encryptedToken = encrypt(config.botToken, encryptionKey);
    const webhookSecret = crypto.randomUUID();

    await db.raw('DELETE FROM telegram_config');

    const result = await db.raw(
      `INSERT INTO telegram_config 
       (bot_token_encrypted, chat_id, thread_id, chat_title, topic_name, 
        webhook_secret, enabled, configured_at, configured_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
       RETURNING id, chat_id, thread_id, chat_title, topic_name, webhook_secret, enabled, configured_at`,
      [
        encryptedToken,
        config.chatId,
        config.threadId || null,
        config.chatTitle,
        config.topicName || null,
        webhookSecret,
        true,
        config.configuredBy,
      ]
    );

    const webhookResult = await setupHelpers.setWebhook(
      config.botToken,
      webhookSecret,
      baseUrl
    );

    if (webhookResult.skipped) {
      log.info(
        'Webhook setup skipped - notifications will work but button callbacks will not'
      );
    } else if (!webhookResult.success) {
      log.warn('Webhook setup failed:', webhookResult.error);
    }

    configCache = null;

    const savedConfig = result.rows[0];
    savedConfig.webhookActive = webhookResult.success;

    return savedConfig;
  }

  async function getConfig(includeToken = false) {
    if (!pool) return null;

    if (
      configCache &&
      Date.now() - configCacheTime < CONFIG_CACHE_TTL &&
      !includeToken
    ) {
      return configCache;
    }

    const result = await db.raw('SELECT * FROM telegram_config LIMIT 1');
    if (result.rows.length === 0) return null;

    const config = result.rows[0];
    const sanitized = {
      id: config.id,
      chatId: config.chat_id,
      threadId: config.thread_id,
      chatTitle: config.chat_title,
      topicName: config.topic_name,
      webhookSecret: config.webhook_secret,
      enabled: config.enabled,
      recommendationsEnabled: config.recommendations_enabled || false,
      configuredAt: config.configured_at,
    };

    if (includeToken && config.bot_token_encrypted) {
      sanitized.botToken = decrypt(config.bot_token_encrypted, encryptionKey);
    }

    if (!includeToken) {
      configCache = sanitized;
      configCacheTime = Date.now();
    }

    return sanitized;
  }

  async function isConfigured() {
    const config = await getConfig();
    return config?.enabled || false;
  }

  async function disconnect() {
    if (!pool) return false;

    const config = await getConfig(true);
    if (config?.botToken) {
      try {
        await setupHelpers.removeWebhook(config.botToken);
      } catch (err) {
        log.warn('Error removing webhook during disconnect:', err);
      }
    }

    await db.raw('DELETE FROM telegram_config');
    configCache = null;
    log.info('Telegram disconnected');

    return true;
  }

  async function setRecommendationsEnabled(enabled) {
    if (!pool) return false;

    await db.raw('UPDATE telegram_config SET recommendations_enabled = $1', [
      enabled,
    ]);
    configCache = null;

    return true;
  }

  return {
    disconnect,
    getConfig,
    isConfigured,
    saveConfig,
    setRecommendationsEnabled,
  };
}

module.exports = {
  createConfigManager,
};
