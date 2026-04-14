// services/telegram.js
// Telegram Bot API wrapper for admin notifications
// Supports forum topics (message_thread_id) for organized notification channels

const crypto = require('crypto');
const logger = require('../utils/logger');
const { createConfigManager } = require('./telegram/config-manager');
const { decrypt, encrypt } = require('./telegram/crypto-utils');
const {
  createNotificationHelpers,
} = require('./telegram/notification-helpers');
const {
  createRecommendationsNotifier,
} = require('./telegram/recommendations-notifier');
const { createWebhookHandler } = require('./telegram/webhook-handler');

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

  /**
   * Upload a photo to Telegram using multipart/form-data
   * @param {string} token - Bot token
   * @param {Buffer} imageBuffer - Image data as buffer
   * @param {string} imageFormat - Image format (jpeg, png, etc.)
   * @param {Object} params - Additional params (chat_id, caption, etc.)
   */
  async function uploadPhoto(token, imageBuffer, imageFormat, params = {}) {
    const url = `${TELEGRAM_API}${token}/sendPhoto`;

    // Create form data manually for Node.js fetch
    const boundary = `----FormBoundary${crypto.randomBytes(16).toString('hex')}`;
    const filename = `cover.${imageFormat || 'jpg'}`;
    const mimeType = `image/${imageFormat || 'jpeg'}`;

    // Build multipart body
    const parts = [];

    // Add the photo file
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="photo"; filename="${filename}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
    );
    parts.push(imageBuffer);
    parts.push('\r\n');

    // Add other params
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        parts.push(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${value}\r\n`
        );
      }
    }

    parts.push(`--${boundary}--\r\n`);

    // Combine parts into single buffer
    const bodyParts = parts.map((part) =>
      Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8')
    );
    const body = Buffer.concat(bodyParts);

    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length.toString(),
      },
      body: body,
    });

    const data = await response.json();

    if (!data.ok) {
      log.error('Telegram photo upload error', {
        error_code: data.error_code,
        description: data.description,
      });
      throw new Error(data.description || 'Failed to upload photo');
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
  const recommendations = createRecommendationsNotifier(
    pool,
    apiRequest,
    uploadPhoto,
    configManager,
    log
  );

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
    setRecommendationsEnabled: configManager.setRecommendationsEnabled,

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

    // Recommendations
    sendRecommendationNotification: recommendations.sendNotification,
    getRecommendationThreads: recommendations.getThreads,
  };
}

module.exports = {
  createTelegramNotifier,
};
