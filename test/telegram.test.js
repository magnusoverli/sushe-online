const test = require('node:test');
const assert = require('node:assert');
const { createTelegramNotifier } = require('../services/telegram.js');

// Mock logger
const createMockLogger = () => ({
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
});

// Mock fetch that returns successful Telegram API responses
const createMockFetch = (responses = {}) => {
  return async (url, _options) => {
    const method = url.split('/').pop().split('?')[0];

    // Default responses for common methods
    const defaultResponses = {
      getMe: {
        ok: true,
        result: {
          id: 123456789,
          is_bot: true,
          first_name: 'Test Bot',
          username: 'test_bot',
        },
      },
      getUpdates: {
        ok: true,
        result: [],
      },
      getChat: {
        ok: true,
        result: {
          id: -1001234567890,
          title: 'Test Group',
          type: 'supergroup',
          is_forum: false,
        },
      },
      sendMessage: {
        ok: true,
        result: {
          message_id: 12345,
          chat: { id: -1001234567890 },
        },
      },
      editMessageText: {
        ok: true,
        result: true,
      },
      answerCallbackQuery: {
        ok: true,
        result: true,
      },
      setWebhook: {
        ok: true,
        result: true,
      },
      deleteWebhook: {
        ok: true,
        result: true,
      },
    };

    const response = responses[method] ||
      defaultResponses[method] || { ok: true, result: {} };

    return {
      ok: response.ok !== false,
      json: async () => response,
    };
  };
};

// Mock pool for database operations
const createMockPool = (config = null) => {
  let storedConfig = config;

  return {
    query: async (sql, params = []) => {
      // SELECT telegram_config
      if (sql.includes('SELECT') && sql.includes('telegram_config')) {
        if (storedConfig) {
          return { rows: [storedConfig] };
        }
        return { rows: [] };
      }

      // DELETE telegram_config
      if (sql.includes('DELETE') && sql.includes('telegram_config')) {
        storedConfig = null;
        return { rows: [] };
      }

      // INSERT telegram_config
      if (sql.includes('INSERT INTO telegram_config')) {
        storedConfig = {
          id: 1,
          bot_token_encrypted: params[0],
          chat_id: params[1],
          thread_id: params[2],
          chat_title: params[3],
          topic_name: params[4],
          webhook_secret: params[5],
          enabled: params[6],
          configured_at: new Date(),
          configured_by: params[7],
        };
        return { rows: [storedConfig] };
      }

      // telegram_admins queries
      if (sql.includes('telegram_admins')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
};

// =============================================================================
// validateToken tests
// =============================================================================

test('validateToken should return valid for correct token', async () => {
  const logger = createMockLogger();
  const fetch = createMockFetch();
  const notifier = createTelegramNotifier({ logger, fetch });

  const result = await notifier.validateToken('123:ABC');

  assert.strictEqual(result.valid, true);
  assert.ok(result.bot);
  assert.strictEqual(result.bot.username, 'test_bot');
});

test('validateToken should return invalid for bad token', async () => {
  const logger = createMockLogger();
  const fetch = createMockFetch({
    getMe: { ok: false, description: 'Unauthorized' },
  });
  const notifier = createTelegramNotifier({ logger, fetch });

  const result = await notifier.validateToken('invalid');

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.bot, null);
});

// =============================================================================
// detectGroups tests
// =============================================================================

test('detectGroups should parse updates and find groups', async () => {
  const logger = createMockLogger();
  const fetch = createMockFetch({
    getUpdates: {
      ok: true,
      result: [
        {
          message: {
            chat: {
              id: -1001234567890,
              title: 'Admin Group',
              type: 'supergroup',
              is_forum: true,
            },
          },
        },
        {
          message: {
            chat: {
              id: -987654321,
              title: 'Regular Group',
              type: 'group',
            },
          },
        },
      ],
    },
  });
  const notifier = createTelegramNotifier({ logger, fetch });

  const groups = await notifier.detectGroups('123:ABC');

  assert.ok(Array.isArray(groups));
  assert.strictEqual(groups.length, 2);
  assert.ok(groups.some((g) => g.title === 'Admin Group'));
  assert.ok(groups.some((g) => g.title === 'Regular Group'));
});

test('detectGroups should return empty array when no groups found', async () => {
  const logger = createMockLogger();
  const fetch = createMockFetch({
    getUpdates: { ok: true, result: [] },
  });
  const notifier = createTelegramNotifier({ logger, fetch });

  const groups = await notifier.detectGroups('123:ABC');

  assert.ok(Array.isArray(groups));
  assert.strictEqual(groups.length, 0);
});

// =============================================================================
// getChatInfo tests
// =============================================================================

test('getChatInfo should return chat details', async () => {
  const logger = createMockLogger();
  const fetch = createMockFetch({
    getChat: {
      ok: true,
      result: {
        id: -1001234567890,
        title: 'Test Forum',
        type: 'supergroup',
        is_forum: true,
      },
    },
  });
  const notifier = createTelegramNotifier({ logger, fetch });

  const info = await notifier.getChatInfo('123:ABC', -1001234567890);

  assert.strictEqual(info.id, -1001234567890);
  assert.strictEqual(info.title, 'Test Forum');
  assert.strictEqual(info.isForum, true);
  assert.ok(Array.isArray(info.topics));
});

// =============================================================================
// isConfigured tests
// =============================================================================

test('isConfigured should return false when not configured', async () => {
  const logger = createMockLogger();
  const pool = createMockPool(null);
  const notifier = createTelegramNotifier({ logger, pool });

  const configured = await notifier.isConfigured();

  assert.strictEqual(configured, false);
});

test('isConfigured should return true when enabled', async () => {
  const logger = createMockLogger();
  const pool = createMockPool({
    id: 1,
    bot_token_encrypted: 'encrypted',
    chat_id: -123,
    enabled: true,
    webhook_secret: 'secret-123',
  });
  const notifier = createTelegramNotifier({ logger, pool });

  const configured = await notifier.isConfigured();

  assert.strictEqual(configured, true);
});

// =============================================================================
// sendMessage tests
// =============================================================================

test('sendMessage should send message when configured', async () => {
  const logger = createMockLogger();
  const fetch = createMockFetch();

  // We need a pool with config that has decryptable token
  const encryptionKey = 'test-key-that-is-at-least-32-chars!';
  const pool = createMockPool();
  const notifier = createTelegramNotifier({
    logger,
    pool,
    fetch,
    encryptionKey,
    baseUrl: 'https://test.example.com',
  });

  // First save a config
  await notifier.saveConfig({
    botToken: '123:ABC',
    chatId: -123,
    chatTitle: 'Test',
    configuredBy: 'admin-1',
  });

  const result = await notifier.sendMessage('Test message');

  assert.strictEqual(result.success, true);
  assert.ok(result.messageId);
});

test('sendMessage should fail when not configured', async () => {
  const logger = createMockLogger();
  const pool = createMockPool(null);
  const notifier = createTelegramNotifier({ logger, pool });

  const result = await notifier.sendMessage('Test message');

  assert.strictEqual(result.success, false);
  assert.ok(result.error);
});

// =============================================================================
// parseCallbackData tests
// =============================================================================

test('parseCallbackData should parse event action callback', () => {
  const logger = createMockLogger();
  const notifier = createTelegramNotifier({ logger });

  const parsed = notifier.parseCallbackData('event:abc-123:approve');

  assert.ok(parsed);
  assert.strictEqual(parsed.type, 'event_action');
  assert.strictEqual(parsed.eventId, 'abc-123');
  assert.strictEqual(parsed.action, 'approve');
});

test('parseCallbackData should return null for invalid data', () => {
  const logger = createMockLogger();
  const notifier = createTelegramNotifier({ logger });

  assert.strictEqual(notifier.parseCallbackData(null), null);
  assert.strictEqual(notifier.parseCallbackData(''), null);
  assert.strictEqual(notifier.parseCallbackData('invalid'), null);
});

// =============================================================================
// verifyWebhookSecret tests
// =============================================================================

test('verifyWebhookSecret should return true for matching secret', async () => {
  const logger = createMockLogger();
  const pool = createMockPool({
    id: 1,
    webhook_secret: 'my-secret-123',
    enabled: true,
  });
  const notifier = createTelegramNotifier({ logger, pool });

  const valid = await notifier.verifyWebhookSecret('my-secret-123');

  assert.strictEqual(valid, true);
});

test('verifyWebhookSecret should return false for wrong secret', async () => {
  const logger = createMockLogger();
  const pool = createMockPool({
    id: 1,
    webhook_secret: 'correct-secret',
    enabled: true,
  });
  const notifier = createTelegramNotifier({ logger, pool });

  const valid = await notifier.verifyWebhookSecret('wrong-secret');

  assert.strictEqual(valid, false);
});

// =============================================================================
// encrypt/decrypt tests
// =============================================================================

test('encrypt and decrypt should round-trip correctly', () => {
  const { encrypt, decrypt } = createTelegramNotifier({});

  const key = 'this-is-a-secret-key-at-least-32-chars';
  const plaintext = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

  const encrypted = encrypt(plaintext, key);
  const decrypted = decrypt(encrypted, key);

  assert.strictEqual(decrypted, plaintext);
  assert.notStrictEqual(encrypted, plaintext);
});

test('encrypt should throw for short key', () => {
  const { encrypt } = createTelegramNotifier({});

  assert.throws(() => {
    encrypt('test', 'short');
  }, /at least 32 characters/);
});

// =============================================================================
// notifyNewEvent tests
// =============================================================================

test('notifyNewEvent should format and send event notification', async () => {
  const logger = createMockLogger();
  const encryptionKey = 'test-key-that-is-at-least-32-chars!';

  let sentMessage = null;
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('sendMessage')) {
      sentMessage = body;
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: { message_id: 999, chat: { id: -123 } },
      }),
    };
  };

  const pool = createMockPool();
  const notifier = createTelegramNotifier({
    logger,
    pool,
    fetch,
    encryptionKey,
    baseUrl: 'https://test.example.com',
  });

  // Save config first
  await notifier.saveConfig({
    botToken: '123:ABC',
    chatId: -123,
    chatTitle: 'Test',
    configuredBy: 'admin-1',
  });

  const event = {
    id: 'event-123',
    event_type: 'account_approval',
    title: 'New user registration',
    description: 'User requests access',
    priority: 'high',
    data: { username: 'testuser', email: 'test@example.com' },
  };

  const actions = [
    { id: 'approve', label: 'Approve' },
    { id: 'reject', label: 'Reject' },
  ];

  const result = await notifier.notifyNewEvent(event, actions);

  assert.ok(result);
  assert.strictEqual(result.messageId, 999);
  assert.ok(sentMessage);
  assert.ok(sentMessage.text.includes('New user registration'));
  assert.ok(sentMessage.reply_markup);
  assert.ok(sentMessage.reply_markup.inline_keyboard);
  assert.strictEqual(sentMessage.reply_markup.inline_keyboard[0].length, 2);
});

// =============================================================================
// disconnect tests
// =============================================================================

test('disconnect should remove config and webhook', async () => {
  const logger = createMockLogger();
  const encryptionKey = 'test-key-that-is-at-least-32-chars!';
  const fetch = createMockFetch();
  const pool = createMockPool();

  const notifier = createTelegramNotifier({
    logger,
    pool,
    fetch,
    encryptionKey,
    baseUrl: 'https://test.example.com',
  });

  // Save config first
  await notifier.saveConfig({
    botToken: '123:ABC',
    chatId: -123,
    chatTitle: 'Test',
    configuredBy: 'admin-1',
  });

  // Verify configured
  let configured = await notifier.isConfigured();
  assert.strictEqual(configured, true);

  // Disconnect
  const success = await notifier.disconnect();
  assert.strictEqual(success, true);

  // Verify disconnected
  configured = await notifier.isConfigured();
  assert.strictEqual(configured, false);
});
