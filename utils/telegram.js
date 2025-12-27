// utils/telegram.js
// Telegram Bot API wrapper for admin notifications
// Supports forum topics (message_thread_id) for organized notification channels

const logger = require('./logger');
const crypto = require('crypto');

// Simple encryption for bot token storage
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a string using AES-256-GCM
 * @param {string} text - Text to encrypt
 * @param {string} key - Encryption key (from environment)
 * @returns {string} - Encrypted string (iv:authTag:encrypted)
 */
function encrypt(text, key) {
  if (!key || key.length < 32) {
    throw new Error('Encryption key must be at least 32 characters');
  }
  const keyBuffer = crypto.scryptSync(key, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string encrypted with encrypt()
 * @param {string} encryptedText - Encrypted string
 * @param {string} key - Encryption key
 * @returns {string} - Decrypted text
 */
function decrypt(encryptedText, key) {
  if (!key || key.length < 32) {
    throw new Error('Encryption key must be at least 32 characters');
  }
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const keyBuffer = crypto.scryptSync(key, 'salt', 32);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================
// SETUP HELPER FUNCTIONS
// ============================================

/**
 * Extract chat from a Telegram update object
 * @param {Object} update - Telegram update
 * @param {Object} log - Logger instance
 * @returns {Object|null} - Chat object or null
 */
function extractChatFromUpdate(update, log) {
  if (update.message?.chat) {
    log.info(
      `detectGroups: found message.chat: ${JSON.stringify(update.message.chat)}`
    );
    return update.message.chat;
  }
  if (update.edited_message?.chat) {
    log.info(
      `detectGroups: found edited_message.chat: ${JSON.stringify(update.edited_message.chat)}`
    );
    return update.edited_message.chat;
  }
  if (update.channel_post?.chat) {
    log.info(
      `detectGroups: found channel_post.chat: ${JSON.stringify(update.channel_post.chat)}`
    );
    return update.channel_post.chat;
  }
  if (update.my_chat_member?.chat) {
    log.info(
      `detectGroups: found my_chat_member.chat: ${JSON.stringify(update.my_chat_member.chat)}`
    );
    return update.my_chat_member.chat;
  }
  if (update.chat_member?.chat) {
    log.info(
      `detectGroups: found chat_member.chat: ${JSON.stringify(update.chat_member.chat)}`
    );
    return update.chat_member.chat;
  }
  log.info(
    `detectGroups: no recognized chat in update: ${JSON.stringify(update).substring(0, 500)}`
  );
  return null;
}

/**
 * Create setup functions for bot configuration
 */
function createSetupHelpers(apiRequest, log) {
  /**
   * Validate a bot token by calling getMe
   */
  async function validateToken(token) {
    try {
      const bot = await apiRequest(token, 'getMe');
      return {
        valid: true,
        bot: { id: bot.id, username: bot.username, firstName: bot.first_name },
      };
    } catch (err) {
      log.warn('Invalid Telegram bot token:', err.message);
      return { valid: false, bot: null, error: err.message };
    }
  }

  /**
   * Get recent updates to detect groups the bot has been added to
   */
  async function detectGroups(token) {
    try {
      try {
        await apiRequest(token, 'deleteWebhook', {
          drop_pending_updates: false,
        });
        log.info('detectGroups: cleared existing webhook to enable getUpdates');
      } catch (webhookErr) {
        log.warn('detectGroups: could not clear webhook:', webhookErr.message);
      }

      const updates = await apiRequest(token, 'getUpdates', { limit: 100 });
      const groups = new Map();

      log.info(`detectGroups: received ${updates.length} updates`);

      for (const update of updates) {
        log.info(
          `detectGroups: update keys: ${Object.keys(update).join(', ')}`
        );
        const chat = extractChatFromUpdate(update, log);

        if (chat && ['group', 'supergroup'].includes(chat.type)) {
          if (!groups.has(chat.id)) {
            log.info(`detectGroups: found group "${chat.title}" (${chat.id})`);
            groups.set(chat.id, {
              id: chat.id,
              title: chat.title || 'Unknown Group',
              type: chat.type,
              isForum: chat.is_forum || false,
            });
          }
        }
      }

      log.info(`detectGroups: returning ${groups.size} unique groups`);
      return Array.from(groups.values());
    } catch (err) {
      log.error('Error detecting groups:', err);
      throw err;
    }
  }

  /**
   * Detect topics from updates for a specific forum group
   */
  async function detectTopicsFromUpdates(token, chatId) {
    try {
      const updates = await apiRequest(token, 'getUpdates', { limit: 100 });
      const topics = new Map();
      topics.set(null, { id: null, name: 'General', isGeneral: true });

      log.info(
        `detectTopicsFromUpdates: scanning ${updates.length} updates for chatId ${chatId}`
      );

      for (const update of updates) {
        const message = update.message || update.edited_message;
        if (!message || message.chat?.id !== chatId) continue;

        log.info(
          `detectTopicsFromUpdates: message keys: ${Object.keys(message).join(', ')}`
        );
        log.info(
          `detectTopicsFromUpdates: message_thread_id: ${message.message_thread_id}, is_topic_message: ${message.is_topic_message}`
        );

        if (
          message.message_thread_id &&
          !topics.has(message.message_thread_id)
        ) {
          let topicName = `Topic ${message.message_thread_id}`;
          if (message.forum_topic_created) {
            topicName = message.forum_topic_created.name;
          } else if (message.reply_to_message?.forum_topic_created) {
            topicName = message.reply_to_message.forum_topic_created.name;
          }

          topics.set(message.message_thread_id, {
            id: message.message_thread_id,
            name: topicName,
            isGeneral: false,
          });
          log.info(
            `detectTopicsFromUpdates: found topic "${topicName}" (${message.message_thread_id})`
          );
        }
      }

      return Array.from(topics.values());
    } catch (err) {
      log.error('Error detecting topics from updates:', err);
      return [{ id: null, name: 'General', isGeneral: true }];
    }
  }

  /**
   * Get chat info and check if it's a forum with topics
   */
  async function getChatInfo(token, chatId) {
    try {
      const chat = await apiRequest(token, 'getChat', { chat_id: chatId });
      const info = {
        id: chat.id,
        title: chat.title,
        type: chat.type,
        isForum: chat.is_forum || false,
        topics: [],
      };

      if (info.isForum) {
        info.topics = await detectTopicsFromUpdates(token, chatId);
        log.info(
          `getChatInfo: detected ${info.topics.length} topics for forum "${chat.title}"`
        );
      }

      return info;
    } catch (err) {
      log.error('Error getting chat info:', err);
      throw err;
    }
  }

  /**
   * Set webhook for receiving callbacks
   */
  async function setWebhook(token, webhookSecret, baseUrl) {
    if (!baseUrl) {
      log.warn('BASE_URL not configured, skipping webhook setup');
      return {
        success: false,
        skipped: true,
        error: 'BASE_URL not configured',
      };
    }

    if (!baseUrl.startsWith('https://')) {
      log.warn(
        'BASE_URL is not HTTPS, skipping webhook setup. Callbacks from Telegram buttons will not work.'
      );
      return {
        success: false,
        skipped: true,
        error: 'HTTPS required for webhooks',
      };
    }

    const webhookUrl = `${baseUrl}/api/telegram/webhook/${webhookSecret}`;

    try {
      await apiRequest(token, 'setWebhook', {
        url: webhookUrl,
        allowed_updates: ['callback_query', 'message'],
        drop_pending_updates: true,
      });
      log.info('Telegram webhook set successfully');
      return { success: true, skipped: false };
    } catch (err) {
      log.error('Error setting webhook:', err);
      return { success: false, skipped: false, error: err.message };
    }
  }

  /**
   * Remove webhook
   */
  async function removeWebhook(token) {
    try {
      await apiRequest(token, 'deleteWebhook', { drop_pending_updates: true });
      log.info('Telegram webhook removed');
      return true;
    } catch (err) {
      log.error('Error removing webhook:', err);
      throw err;
    }
  }

  return {
    validateToken,
    detectGroups,
    getChatInfo,
    setWebhook,
    removeWebhook,
  };
}

// ============================================
// CONFIG MANAGER HELPER
// ============================================

/**
 * Create configuration management functions
 */
function createConfigManager(pool, encryptionKey, log, setupHelpers, baseUrl) {
  let configCache = null;
  let configCacheTime = 0;
  const CONFIG_CACHE_TTL = 60000;

  async function saveConfig(config) {
    if (!pool) throw new Error('Database pool not configured');

    const encryptedToken = encrypt(config.botToken, encryptionKey);
    const webhookSecret = crypto.randomUUID();

    await pool.query('DELETE FROM telegram_config');

    const result = await pool.query(
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

    const result = await pool.query('SELECT * FROM telegram_config LIMIT 1');
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

    await pool.query('DELETE FROM telegram_config');
    configCache = null;
    log.info('Telegram disconnected');
    return true;
  }

  return { saveConfig, getConfig, isConfigured, disconnect };
}

// ============================================
// MESSAGING HELPER
// ============================================

/**
 * Create messaging functions
 */
function createMessenger(apiRequest, configManager, log) {
  async function sendMessage(text, inlineKeyboard = null) {
    const config = await configManager.getConfig(true);
    if (!config?.enabled || !config.botToken) {
      return { success: false, error: 'Telegram not configured' };
    }

    const params = { chat_id: config.chatId, text, parse_mode: 'Markdown' };
    if (config.threadId) params.message_thread_id = config.threadId;
    if (inlineKeyboard?.length > 0)
      params.reply_markup = { inline_keyboard: inlineKeyboard };

    try {
      const result = await apiRequest(config.botToken, 'sendMessage', params);
      return {
        success: true,
        messageId: result.message_id,
        chatId: config.chatId,
      };
    } catch (err) {
      log.error('Error sending Telegram message:', err);
      return { success: false, error: err.message };
    }
  }

  async function editMessage(messageId, text, inlineKeyboard = null) {
    const config = await configManager.getConfig(true);
    if (!config?.enabled || !config.botToken) return false;

    const params = {
      chat_id: config.chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard || [] },
    };

    try {
      await apiRequest(config.botToken, 'editMessageText', params);
      return true;
    } catch (err) {
      if (err.message.includes('message is not modified')) return true;
      log.error('Error editing Telegram message:', err);
      return false;
    }
  }

  async function answerCallbackQuery(
    callbackQueryId,
    text = null,
    showAlert = false
  ) {
    const config = await configManager.getConfig(true);
    if (!config?.enabled || !config.botToken) return false;

    const params = { callback_query_id: callbackQueryId };
    if (text) {
      params.text = text;
      params.show_alert = showAlert;
    }

    try {
      await apiRequest(config.botToken, 'answerCallbackQuery', params);
      return true;
    } catch (err) {
      log.error('Error answering callback query:', err);
      return false;
    }
  }

  return { sendMessage, editMessage, answerCallbackQuery };
}

// ============================================
// NOTIFICATION HELPER
// ============================================

/**
 * Format priority as emoji
 */
function priorityEmoji(priority) {
  const emojis = { urgent: '🔴', high: '🟠', normal: '🟡', low: '⚪' };
  return emojis[priority] || '🟡';
}

/**
 * Create notification functions
 */
function createNotificationHelpers(apiRequest, configManager, messenger, log) {
  async function notifyNewEvent(event, actions = []) {
    const config = await configManager.getConfig();
    if (!config?.enabled) return null;

    const emoji = priorityEmoji(event.priority);
    let text = `${emoji} *${event.priority.toUpperCase()}* — ${event.title}\n\n`;

    if (event.description) text += `${event.description}\n\n`;

    if (event.data && typeof event.data === 'object') {
      const data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data.username) text += `👤 User: \`${data.username}\`\n`;
      if (data.email) text += `📧 Email: \`${data.email}\`\n`;
    }

    text += `\n🆔 Event: \`${event.id.slice(0, 8)}\``;

    const keyboard = [];
    if (actions.length > 0) {
      keyboard.push(
        actions.map((a) => ({
          text: a.label,
          callback_data: `event:${event.id}:${a.id}`,
        }))
      );
    }

    const result = await messenger.sendMessage(text, keyboard);
    return result.success
      ? { messageId: result.messageId, chatId: result.chatId }
      : null;
  }

  async function updateEventMessage(event, action, adminUsername) {
    if (!event.telegram_message_id) return false;

    const statusEmoji = { approved: '✅', rejected: '❌', dismissed: '🗑️' };
    const emoji = statusEmoji[event.status] || '✓';
    let text = `${emoji} *${event.status.toUpperCase()}* — ${event.title}\n\n`;

    if (event.description) text += `~${event.description}~\n\n`;
    text += `${emoji} ${action.charAt(0).toUpperCase() + action.slice(1)} by *${adminUsername}*`;

    return await messenger.editMessage(event.telegram_message_id, text, []);
  }

  async function sendTestMessage() {
    const text =
      '✅ *SuShe Admin Notifications*\n\n' +
      'This is a test message. Telegram notifications are working correctly!\n\n' +
      `🕐 Sent at: ${new Date().toISOString()}`;
    return await messenger.sendMessage(text);
  }

  async function sendTestMessageWithCredentials(token, chatId, threadId) {
    const text =
      '✅ *SuShe Admin Notifications*\n\n' +
      'This is a test message. If you see this, the bot can send messages to this chat!\n\n' +
      `🕐 Sent at: ${new Date().toISOString()}`;

    try {
      const params = { chat_id: chatId, text, parse_mode: 'Markdown' };
      if (threadId) params.message_thread_id = threadId;
      const result = await apiRequest(token, 'sendMessage', params);
      return { success: true, messageId: result.message_id };
    } catch (err) {
      log.error('Error sending test message with credentials:', err);
      return { success: false, error: err.message || 'Failed to send message' };
    }
  }

  return {
    notifyNewEvent,
    updateEventMessage,
    sendTestMessage,
    sendTestMessageWithCredentials,
  };
}

// ============================================
// WEBHOOK HELPER
// ============================================

/**
 * Create webhook handling functions
 */
function createWebhookHandler(pool, configManager, log) {
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
      const countResult = await pool.query(
        'SELECT COUNT(*) as count FROM telegram_admins'
      );
      log.warn('[DEBUG-TELEGRAM-LINK] telegram_admins table count', {
        count: countResult.rows[0]?.count,
      });

      const allAdmins = await pool.query(
        'SELECT telegram_user_id, telegram_username, user_id FROM telegram_admins'
      );
      log.warn('[DEBUG-TELEGRAM-LINK] all telegram_admins entries', {
        entries: allAdmins.rows,
      });

      const result = await pool.query(
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
      await pool.query(
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

  return { verifyWebhookSecret, parseCallbackData, getLinkedAdmin, linkAdmin };
}

// ============================================
// MAIN FACTORY
// ============================================

/**
 * Create Telegram notifier with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pool - PostgreSQL connection pool
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetch - Fetch function
 * @param {string} deps.encryptionKey - Key for encrypting bot token
 * @param {string} deps.baseUrl - Base URL for webhook
 */
function createTelegramNotifier(deps = {}) {
  const log = deps.logger || logger;
  const pool = deps.pool;
  const fetchFn = deps.fetch || global.fetch;
  const encryptionKey = deps.encryptionKey || process.env.SESSION_SECRET;
  const baseUrl = deps.baseUrl || process.env.BASE_URL;

  const TELEGRAM_API = 'https://api.telegram.org/bot';

  /**
   * Make a request to the Telegram Bot API
   */
  async function apiRequest(token, method, params = {}) {
    const url = `${TELEGRAM_API}${token}/${method}`;
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!data.ok) {
      log.error(`Telegram API error: ${method}`, {
        error_code: data.error_code,
        description: data.description,
      });
      throw new Error(data.description || 'Telegram API error');
    }

    return data.result;
  }

  // Create helper modules
  const setupHelpers = createSetupHelpers(apiRequest, log);
  const configManager = createConfigManager(
    pool,
    encryptionKey,
    log,
    setupHelpers,
    baseUrl
  );
  const messenger = createMessenger(apiRequest, configManager, log);
  const notifications = createNotificationHelpers(
    apiRequest,
    configManager,
    messenger,
    log
  );
  const webhook = createWebhookHandler(pool, configManager, log);

  return {
    // Setup functions
    validateToken: setupHelpers.validateToken,
    detectGroups: setupHelpers.detectGroups,
    getChatInfo: setupHelpers.getChatInfo,
    setWebhook: (token, webhookSecret) =>
      setupHelpers.setWebhook(token, webhookSecret, baseUrl),
    removeWebhook: setupHelpers.removeWebhook,

    // Configuration
    saveConfig: configManager.saveConfig,
    getConfig: configManager.getConfig,
    isConfigured: configManager.isConfigured,
    disconnect: configManager.disconnect,

    // Messaging
    sendMessage: messenger.sendMessage,
    editMessage: messenger.editMessage,
    answerCallbackQuery: messenger.answerCallbackQuery,

    // High-level notifications
    notifyNewEvent: notifications.notifyNewEvent,
    updateEventMessage: notifications.updateEventMessage,
    sendTestMessage: notifications.sendTestMessage,
    sendTestMessageWithCredentials:
      notifications.sendTestMessageWithCredentials,

    // Webhook
    verifyWebhookSecret: webhook.verifyWebhookSecret,
    parseCallbackData: webhook.parseCallbackData,
    getLinkedAdmin: webhook.getLinkedAdmin,
    linkAdmin: webhook.linkAdmin,

    // Utilities
    encrypt,
    decrypt,
  };
}

module.exports = {
  createTelegramNotifier,
};
