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

  // Cache for config to avoid repeated DB queries
  let configCache = null;
  let configCacheTime = 0;
  const CONFIG_CACHE_TTL = 60000; // 1 minute

  /**
   * Make a request to the Telegram Bot API
   * @param {string} token - Bot token
   * @param {string} method - API method
   * @param {Object} params - Request parameters
   * @returns {Object} - API response
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

  // ============================================
  // SETUP FUNCTIONS (used during configuration)
  // ============================================

  /**
   * Validate a bot token by calling getMe
   * @param {string} token - Bot token to validate
   * @returns {Object} - { valid, bot } where bot has id, username, first_name
   */
  async function validateToken(token) {
    try {
      const bot = await apiRequest(token, 'getMe');
      return {
        valid: true,
        bot: {
          id: bot.id,
          username: bot.username,
          firstName: bot.first_name,
        },
      };
    } catch (err) {
      log.warn('Invalid Telegram bot token:', err.message);
      return { valid: false, bot: null, error: err.message };
    }
  }

  /**
   * Get recent updates to detect groups the bot has been added to
   * @param {string} token - Bot token
   * @returns {Array} - Array of unique groups
   */
  async function detectGroups(token) {
    try {
      // Delete any existing webhook first - getUpdates won't work if webhook is set
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
        // Log the update structure for debugging
        log.info(
          `detectGroups: update keys: ${Object.keys(update).join(', ')}`
        );

        // Extract chat from various update types
        let chat = null;

        // Regular messages have chat at update.message.chat
        if (update.message?.chat) {
          chat = update.message.chat;
          log.info(`detectGroups: found message.chat: ${JSON.stringify(chat)}`);
        }
        // Edited messages
        else if (update.edited_message?.chat) {
          chat = update.edited_message.chat;
          log.info(
            `detectGroups: found edited_message.chat: ${JSON.stringify(chat)}`
          );
        }
        // Channel posts
        else if (update.channel_post?.chat) {
          chat = update.channel_post.chat;
          log.info(
            `detectGroups: found channel_post.chat: ${JSON.stringify(chat)}`
          );
        }
        // my_chat_member updates (when bot is added/removed from chat)
        else if (update.my_chat_member?.chat) {
          chat = update.my_chat_member.chat;
          log.info(
            `detectGroups: found my_chat_member.chat: ${JSON.stringify(chat)}`
          );
        }
        // chat_member updates
        else if (update.chat_member?.chat) {
          chat = update.chat_member.chat;
          log.info(
            `detectGroups: found chat_member.chat: ${JSON.stringify(chat)}`
          );
        } else {
          log.info(
            `detectGroups: no recognized chat in update: ${JSON.stringify(update).substring(0, 500)}`
          );
        }

        // Check if this is a group/supergroup
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
   * @param {string} token - Bot token
   * @param {number} chatId - Chat ID to filter for
   * @returns {Array} - Array of detected topics
   */
  async function detectTopicsFromUpdates(token, chatId) {
    try {
      const updates = await apiRequest(token, 'getUpdates', { limit: 100 });
      const topics = new Map();

      // Always include General topic
      topics.set(null, { id: null, name: 'General', isGeneral: true });

      log.info(
        `detectTopicsFromUpdates: scanning ${updates.length} updates for chatId ${chatId}`
      );

      for (const update of updates) {
        const message = update.message || update.edited_message;

        // Only process messages from the target chat
        if (!message || message.chat?.id !== chatId) continue;

        // Log the message structure for debugging
        log.info(
          `detectTopicsFromUpdates: message keys: ${Object.keys(message).join(', ')}`
        );
        log.info(
          `detectTopicsFromUpdates: message_thread_id: ${message.message_thread_id}, is_topic_message: ${message.is_topic_message}`
        );

        // Check if message has a thread_id (topic)
        if (
          message.message_thread_id &&
          !topics.has(message.message_thread_id)
        ) {
          // Try to get topic name from forum_topic_created event
          let topicName = `Topic ${message.message_thread_id}`;

          // If this is a forum_topic_created message, get the name
          if (message.forum_topic_created) {
            topicName = message.forum_topic_created.name;
          }
          // If reply_to_message has forum_topic_created, get name from there
          else if (message.reply_to_message?.forum_topic_created) {
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
   * @param {string} token - Bot token
   * @param {number} chatId - Chat ID
   * @returns {Object} - Chat info including topics if forum
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

      // If it's a forum, detect topics from recent updates
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
   * @param {string} token - Bot token
   * @param {string} webhookSecret - Secret for webhook URL
   * @returns {Object} - { success, skipped, error }
   */
  async function setWebhook(token, webhookSecret) {
    if (!baseUrl) {
      log.warn('BASE_URL not configured, skipping webhook setup');
      return {
        success: false,
        skipped: true,
        error: 'BASE_URL not configured',
      };
    }

    // Telegram requires HTTPS for webhooks
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
      // Don't throw - allow config to be saved even if webhook fails
      return { success: false, skipped: false, error: err.message };
    }
  }

  /**
   * Remove webhook
   * @param {string} token - Bot token
   * @returns {boolean} - Success
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

  // ============================================
  // CONFIGURATION MANAGEMENT
  // ============================================

  /**
   * Save Telegram configuration to database
   * @param {Object} config - Configuration object
   * @param {string} config.botToken - Bot token (will be encrypted)
   * @param {number} config.chatId - Chat ID
   * @param {number} config.threadId - Topic thread ID (optional)
   * @param {string} config.chatTitle - Chat title for display
   * @param {string} config.topicName - Topic name for display
   * @param {string} config.configuredBy - Admin user ID
   * @returns {Object} - Saved config (without token)
   */
  async function saveConfig(config) {
    if (!pool) {
      throw new Error('Database pool not configured');
    }

    const encryptedToken = encrypt(config.botToken, encryptionKey);
    const webhookSecret = crypto.randomUUID();

    // Delete existing config and insert new one
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

    // Try to set webhook (not required for basic functionality)
    const webhookResult = await setWebhook(config.botToken, webhookSecret);
    if (webhookResult.skipped) {
      log.info(
        'Webhook setup skipped - notifications will work but button callbacks will not'
      );
    } else if (!webhookResult.success) {
      log.warn('Webhook setup failed:', webhookResult.error);
    }

    // Clear cache
    configCache = null;

    const savedConfig = result.rows[0];
    savedConfig.webhookActive = webhookResult.success;
    return savedConfig;
  }

  /**
   * Get current Telegram configuration
   * @param {boolean} includeToken - Whether to include decrypted token
   * @returns {Object|null} - Config or null if not configured
   */
  async function getConfig(includeToken = false) {
    if (!pool) {
      return null;
    }

    // Check cache
    if (
      configCache &&
      Date.now() - configCacheTime < CONFIG_CACHE_TTL &&
      !includeToken
    ) {
      return configCache;
    }

    const result = await pool.query('SELECT * FROM telegram_config LIMIT 1');

    if (result.rows.length === 0) {
      return null;
    }

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

    // Update cache (without token)
    if (!includeToken) {
      configCache = sanitized;
      configCacheTime = Date.now();
    }

    return sanitized;
  }

  /**
   * Check if Telegram is configured and enabled
   * @returns {boolean}
   */
  async function isConfigured() {
    const config = await getConfig();
    return config?.enabled || false;
  }

  /**
   * Disconnect Telegram (remove config and webhook)
   * @returns {boolean}
   */
  async function disconnect() {
    if (!pool) {
      return false;
    }

    const config = await getConfig(true);
    if (config?.botToken) {
      try {
        await removeWebhook(config.botToken);
      } catch (err) {
        log.warn('Error removing webhook during disconnect:', err);
      }
    }

    await pool.query('DELETE FROM telegram_config');
    configCache = null;

    log.info('Telegram disconnected');
    return true;
  }

  // ============================================
  // MESSAGING FUNCTIONS
  // ============================================

  /**
   * Send a message to the configured chat
   * @param {string} text - Message text (Markdown supported)
   * @param {Array} inlineKeyboard - Optional inline keyboard buttons
   * @returns {Object} - { success, messageId, chatId }
   */
  async function sendMessage(text, inlineKeyboard = null) {
    const config = await getConfig(true);
    if (!config?.enabled || !config.botToken) {
      return { success: false, error: 'Telegram not configured' };
    }

    const params = {
      chat_id: config.chatId,
      text,
      parse_mode: 'Markdown',
    };

    // Add thread_id for forum topics
    if (config.threadId) {
      params.message_thread_id = config.threadId;
    }

    // Add inline keyboard if provided
    if (inlineKeyboard && inlineKeyboard.length > 0) {
      params.reply_markup = {
        inline_keyboard: inlineKeyboard,
      };
    }

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

  /**
   * Edit an existing message
   * @param {number} messageId - Message ID to edit
   * @param {string} text - New message text
   * @param {Array} inlineKeyboard - Optional new inline keyboard
   * @returns {boolean} - Success
   */
  async function editMessage(messageId, text, inlineKeyboard = null) {
    const config = await getConfig(true);
    if (!config?.enabled || !config.botToken) {
      return false;
    }

    const params = {
      chat_id: config.chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
    };

    if (inlineKeyboard) {
      params.reply_markup = { inline_keyboard: inlineKeyboard };
    } else {
      params.reply_markup = { inline_keyboard: [] };
    }

    try {
      await apiRequest(config.botToken, 'editMessageText', params);
      return true;
    } catch (err) {
      // Ignore "message not modified" errors
      if (err.message.includes('message is not modified')) {
        return true;
      }
      log.error('Error editing Telegram message:', err);
      return false;
    }
  }

  /**
   * Answer a callback query (button click)
   * @param {string} callbackQueryId - Callback query ID
   * @param {string} text - Optional toast text to show user
   * @param {boolean} showAlert - Show as alert popup instead of toast
   * @returns {boolean} - Success
   */
  async function answerCallbackQuery(
    callbackQueryId,
    text = null,
    showAlert = false
  ) {
    const config = await getConfig(true);
    if (!config?.enabled || !config.botToken) {
      return false;
    }

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

  // ============================================
  // HIGH-LEVEL NOTIFICATION FUNCTIONS
  // ============================================

  /**
   * Format priority as emoji
   * @param {string} priority - Priority level
   * @returns {string} - Emoji
   */
  function priorityEmoji(priority) {
    const emojis = {
      urgent: '🔴',
      high: '🟠',
      normal: '🟡',
      low: '⚪',
    };
    return emojis[priority] || '🟡';
  }

  /**
   * Notify admins of a new event
   * @param {Object} event - Admin event from database
   * @param {Array} actions - Available actions [{id, label}]
   * @returns {Object} - { messageId, chatId } or null
   */
  async function notifyNewEvent(event, actions = []) {
    const config = await getConfig();
    if (!config?.enabled) {
      return null;
    }

    // Build message text
    const emoji = priorityEmoji(event.priority);
    const priorityLabel = event.priority.toUpperCase();
    let text = `${emoji} *${priorityLabel}* — ${event.title}\n\n`;

    if (event.description) {
      text += `${event.description}\n\n`;
    }

    // Add event data summary if present
    if (event.data && typeof event.data === 'object') {
      const data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data.username) text += `👤 User: \`${data.username}\`\n`;
      if (data.email) text += `📧 Email: \`${data.email}\`\n`;
    }

    text += `\n🆔 Event: \`${event.id.slice(0, 8)}\``;

    // Build inline keyboard from actions
    const keyboard = [];
    if (actions.length > 0) {
      const row = actions.map((action) => ({
        text: action.label,
        callback_data: `event:${event.id}:${action.id}`,
      }));
      keyboard.push(row);
    }

    const result = await sendMessage(text, keyboard);

    if (result.success) {
      return { messageId: result.messageId, chatId: result.chatId };
    }

    return null;
  }

  /**
   * Update a Telegram message after an action is taken
   * @param {Object} event - Updated event from database
   * @param {string} action - Action that was taken
   * @param {string} adminUsername - Username of admin who took action
   * @returns {boolean} - Success
   */
  async function updateEventMessage(event, action, adminUsername) {
    if (!event.telegram_message_id) {
      return false;
    }

    const statusEmoji = {
      approved: '✅',
      rejected: '❌',
      dismissed: '🗑️',
    };

    const emoji = statusEmoji[event.status] || '✓';
    let text = `${emoji} *${event.status.toUpperCase()}* — ${event.title}\n\n`;

    if (event.description) {
      text += `~${event.description}~\n\n`;
    }

    text += `${emoji} ${action.charAt(0).toUpperCase() + action.slice(1)} by *${adminUsername}*`;

    return await editMessage(event.telegram_message_id, text, []);
  }

  /**
   * Send a test message to verify configuration
   * @returns {Object} - { success, error }
   */
  async function sendTestMessage() {
    const text =
      '✅ *SuShe Admin Notifications*\n\n' +
      'This is a test message. Telegram notifications are working correctly!\n\n' +
      `🕐 Sent at: ${new Date().toISOString()}`;

    return await sendMessage(text);
  }

  /**
   * Send a test message using provided credentials (before config is saved)
   * @param {string} token - Bot token
   * @param {number} chatId - Chat ID
   * @param {number|null} threadId - Thread/topic ID
   * @returns {Object} - { success, messageId, error }
   */
  async function sendTestMessageWithCredentials(token, chatId, threadId) {
    const text =
      '✅ *SuShe Admin Notifications*\n\n' +
      'This is a test message. If you see this, the bot can send messages to this chat!\n\n' +
      `🕐 Sent at: ${new Date().toISOString()}`;

    try {
      const params = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
      };

      if (threadId) {
        params.message_thread_id = threadId;
      }

      const result = await apiRequest(token, 'sendMessage', params);

      return {
        success: true,
        messageId: result.message_id,
      };
    } catch (err) {
      log.error('Error sending test message with credentials:', err);
      return {
        success: false,
        error: err.message || 'Failed to send message',
      };
    }
  }

  // ============================================
  // WEBHOOK HANDLING
  // ============================================

  /**
   * Verify webhook secret matches
   * @param {string} secret - Secret from URL
   * @returns {boolean} - Valid
   */
  async function verifyWebhookSecret(secret) {
    const config = await getConfig();
    return config?.webhookSecret === secret;
  }

  /**
   * Parse callback data from button click
   * @param {string} callbackData - Callback data string
   * @returns {Object|null} - { type, eventId, action } or null
   */
  function parseCallbackData(callbackData) {
    if (!callbackData) return null;

    const parts = callbackData.split(':');
    if (parts[0] === 'event' && parts.length >= 3) {
      return {
        type: 'event_action',
        eventId: parts[1],
        action: parts[2],
      };
    }

    return null;
  }

  /**
   * Get Telegram user info mapped to app admin
   * @param {number} telegramUserId - Telegram user ID
   * @returns {Object|null} - App user or null
   */
  async function getLinkedAdmin(telegramUserId) {
    // #region agent log
    log.info('[DEBUG-TELEGRAM-LINK] getLinkedAdmin called', {
      telegramUserId,
      telegramUserIdType: typeof telegramUserId,
      poolExists: !!pool,
      hypothesisId: 'A,B,C',
    });
    // #endregion
    if (!pool) {
      // #region agent log
      log.info('[DEBUG-TELEGRAM-LINK] pool is null, returning null', {
        hypothesisId: 'C',
      });
      // #endregion
      return null;
    }

    try {
      // #region agent log - Check if telegram_admins table has any entries
      const countResult = await pool.query(
        'SELECT COUNT(*) as count FROM telegram_admins'
      );
      log.info('[DEBUG-TELEGRAM-LINK] telegram_admins table count', {
        count: countResult.rows[0]?.count,
        hypothesisId: 'A',
      });

      // Also check what entries exist
      const allAdmins = await pool.query(
        'SELECT telegram_user_id, telegram_username, user_id FROM telegram_admins'
      );
      log.info('[DEBUG-TELEGRAM-LINK] all telegram_admins entries', {
        entries: allAdmins.rows,
        hypothesisId: 'A,E',
      });
      // #endregion

      const result = await pool.query(
        `SELECT u.* FROM users u
         JOIN telegram_admins ta ON u._id = ta.user_id
         WHERE ta.telegram_user_id = $1`,
        [telegramUserId]
      );

      // #region agent log
      log.info('[DEBUG-TELEGRAM-LINK] query result', {
        rowCount: result.rows.length,
        foundUser: result.rows[0]?.username || null,
        hypothesisId: 'A,B,E',
      });
      // #endregion

      return result.rows[0] || null;
    } catch (err) {
      // #region agent log
      log.error('[DEBUG-TELEGRAM-LINK] query error', {
        error: err.message,
        stack: err.stack,
        hypothesisId: 'D',
      });
      // #endregion
      return null;
    }
  }

  /**
   * Link a Telegram user to an app admin
   * @param {number} telegramUserId - Telegram user ID
   * @param {string} telegramUsername - Telegram username
   * @param {string} appUserId - App user _id
   * @returns {boolean} - Success
   */
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

  return {
    // Setup functions
    validateToken,
    detectGroups,
    getChatInfo,
    setWebhook,
    removeWebhook,

    // Configuration
    saveConfig,
    getConfig,
    isConfigured,
    disconnect,

    // Messaging
    sendMessage,
    editMessage,
    answerCallbackQuery,

    // High-level notifications
    notifyNewEvent,
    updateEventMessage,
    sendTestMessage,
    sendTestMessageWithCredentials,

    // Webhook
    verifyWebhookSecret,
    parseCallbackData,
    getLinkedAdmin,
    linkAdmin,

    // Utilities
    encrypt,
    decrypt,
  };
}

module.exports = {
  createTelegramNotifier,
};
