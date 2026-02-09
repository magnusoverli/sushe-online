const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const { createClaudeClient } = require('../utils/claude-client.js');

// =============================================================================
// Lazy client creation
// =============================================================================

test('getClient should return null when no API key is set', () => {
  const client = createClaudeClient({
    env: {},
  });

  assert.strictEqual(client.getClient(), null);
});

test('getClient should return injected anthropicClient when provided', () => {
  const mockAnthropic = { messages: { create: mock.fn() } };
  const client = createClaudeClient({
    anthropicClient: mockAnthropic,
    env: {},
  });

  assert.strictEqual(client.getClient(), mockAnthropic);
});

test('getClient should return singleton on subsequent calls', () => {
  const mockAnthropic = { messages: { create: mock.fn() } };
  const client = createClaudeClient({
    anthropicClient: mockAnthropic,
    env: {},
  });

  const first = client.getClient();
  const second = client.getClient();
  assert.strictEqual(first, second);
  assert.strictEqual(first, mockAnthropic);
});

// =============================================================================
// Rate limiting
// =============================================================================

test('waitForRateLimit should enforce minimum delay between calls', async () => {
  const client = createClaudeClient({
    env: { CLAUDE_RATE_LIMIT_MS: '100' },
  });

  const start = Date.now();
  await client.waitForRateLimit();
  await client.waitForRateLimit();
  const elapsed = Date.now() - start;

  // Second call should have waited at least 100ms
  assert.ok(elapsed >= 90, `Expected >= 90ms, got ${elapsed}ms`);
});

test('waitForRateLimit should not delay if enough time has passed', async () => {
  const client = createClaudeClient({
    env: { CLAUDE_RATE_LIMIT_MS: '10' },
  });

  await client.waitForRateLimit();
  // Wait longer than rate limit
  await new Promise((r) => setTimeout(r, 20));

  const start = Date.now();
  await client.waitForRateLimit();
  const elapsed = Date.now() - start;

  // Should not have needed to wait
  assert.ok(elapsed < 15, `Expected < 15ms, got ${elapsed}ms`);
});

// =============================================================================
// Retry with backoff
// =============================================================================

test('retryWithBackoff should return result on first success', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  const result = await client.retryWithBackoff(async () => 'success', 3);
  assert.strictEqual(result, 'success');
});

test('retryWithBackoff should retry on 429 errors', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  let callCount = 0;
  const result = await client.retryWithBackoff(async () => {
    callCount++;
    if (callCount < 2) {
      const err = new Error('Rate limited');
      err.status = 429;
      throw err;
    }
    return 'success after retry';
  }, 3);

  assert.strictEqual(result, 'success after retry');
  assert.strictEqual(callCount, 2);
  assert.ok(
    mockLogger.info.mock.calls.some(
      (call) => call.arguments[0] === 'Retrying Claude API call'
    )
  );
});

test('retryWithBackoff should retry on 5xx errors', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  let callCount = 0;
  const result = await client.retryWithBackoff(async () => {
    callCount++;
    if (callCount < 2) {
      const err = new Error('Server error');
      err.status = 500;
      throw err;
    }
    return 'success';
  }, 3);

  assert.strictEqual(result, 'success');
  assert.strictEqual(callCount, 2);
});

test('retryWithBackoff should not retry on 4xx errors (except 429)', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  const err = new Error('Bad request');
  err.status = 400;

  let callCount = 0;
  await assert.rejects(
    async () => {
      await client.retryWithBackoff(async () => {
        callCount++;
        throw err;
      }, 3);
    },
    (thrown) => {
      assert.strictEqual(thrown.status, 400);
      return true;
    }
  );

  assert.strictEqual(callCount, 1);
});

test('retryWithBackoff should not retry on 401 errors', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  const err = new Error('Unauthorized');
  err.status = 401;

  let callCount = 0;
  await assert.rejects(
    async () => {
      await client.retryWithBackoff(async () => {
        callCount++;
        throw err;
      }, 3);
    },
    (thrown) => {
      assert.strictEqual(thrown.status, 401);
      return true;
    }
  );

  assert.strictEqual(callCount, 1);
});

test('retryWithBackoff should respect Retry-After header for 429', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  let callCount = 0;
  const start = Date.now();
  const result = await client.retryWithBackoff(async () => {
    callCount++;
    if (callCount < 2) {
      const err = new Error('Rate limited');
      err.status = 429;
      err.headers = { 'retry-after': '1' }; // 1 second
      throw err;
    }
    return 'success';
  }, 3);
  const elapsed = Date.now() - start;

  assert.strictEqual(result, 'success');
  assert.ok(
    elapsed >= 900,
    `Expected >= 900ms for Retry-After, got ${elapsed}ms`
  );
});

test('retryWithBackoff should throw after all retries exhausted', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  const serverError = new Error('Server error');
  serverError.status = 500;

  let callCount = 0;
  await assert.rejects(
    async () => {
      await client.retryWithBackoff(async () => {
        callCount++;
        throw serverError;
      }, 3);
    },
    (thrown) => {
      assert.strictEqual(thrown.message, 'Server error');
      return true;
    }
  );

  assert.strictEqual(callCount, 3);
});

test('retryWithBackoff should retry on network errors (no status)', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({ logger: mockLogger, env: {} });

  let callCount = 0;
  const result = await client.retryWithBackoff(async () => {
    callCount++;
    if (callCount < 2) {
      throw new Error('ECONNREFUSED');
    }
    return 'success';
  }, 3);

  assert.strictEqual(result, 'success');
  assert.strictEqual(callCount, 2);
});

// =============================================================================
// extractTextFromContent
// =============================================================================

test('extractTextFromContent should return text from text blocks', () => {
  const client = createClaudeClient({ env: {} });

  const content = [
    { type: 'text', text: 'Hello' },
    { type: 'text', text: 'World' },
  ];

  assert.strictEqual(client.extractTextFromContent(content), 'Hello World');
});

test('extractTextFromContent should filter out non-text blocks', () => {
  const client = createClaudeClient({ env: {} });

  const content = [
    { type: 'tool_use', name: 'web_search', input: {} },
    { type: 'text', text: 'Result' },
    { type: 'tool_result', content: 'data' },
  ];

  assert.strictEqual(client.extractTextFromContent(content), 'Result');
});

test('extractTextFromContent should return null for empty array', () => {
  const client = createClaudeClient({ env: {} });
  assert.strictEqual(client.extractTextFromContent([]), null);
});

test('extractTextFromContent should return null for null input', () => {
  const client = createClaudeClient({ env: {} });
  assert.strictEqual(client.extractTextFromContent(null), null);
});

test('extractTextFromContent should return null for undefined input', () => {
  const client = createClaudeClient({ env: {} });
  assert.strictEqual(client.extractTextFromContent(undefined), null);
});

test('extractTextFromContent should return null when no text blocks exist', () => {
  const client = createClaudeClient({ env: {} });

  const content = [{ type: 'tool_use', name: 'web_search', input: {} }];

  assert.strictEqual(client.extractTextFromContent(content), null);
});

test('extractTextFromContent should trim whitespace', () => {
  const client = createClaudeClient({ env: {} });

  const content = [
    { type: 'text', text: '  Hello  ' },
    { type: 'text', text: '  World  ' },
  ];

  assert.strictEqual(client.extractTextFromContent(content), 'Hello     World');
});

// =============================================================================
// callClaude integration
// =============================================================================

test('callClaude should return null when no API key is set', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const client = createClaudeClient({
    logger: mockLogger,
    env: {},
  });

  const result = await client.callClaude({
    model: 'claude-sonnet-4-5',
    maxTokens: 400,
    messages: [{ role: 'user', content: 'Hello' }],
  });

  assert.strictEqual(result, null);
  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
});

test('callClaude should make API call and return response', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };
  const mockResponse = {
    content: [{ type: 'text', text: 'Hello response' }],
    usage: { input_tokens: 50, output_tokens: 20 },
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => mockResponse),
    },
  };

  const client = createClaudeClient({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
    env: { CLAUDE_RATE_LIMIT_MS: '0' },
    metrics: mockMetrics,
  });

  const result = await client.callClaude({
    model: 'claude-sonnet-4-5',
    maxTokens: 400,
    temperature: 0.7,
    system: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hello' }],
  });

  assert.strictEqual(result, mockResponse);
  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 1);

  // Verify API call parameters
  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.strictEqual(callArgs.model, 'claude-sonnet-4-5');
  assert.strictEqual(callArgs.max_tokens, 400);
  assert.strictEqual(callArgs.temperature, 0.7);
  assert.strictEqual(callArgs.system, 'You are helpful.');

  // Verify metrics recorded
  assert.strictEqual(mockMetrics.recordClaudeUsage.mock.calls.length, 1);
  const metricsArgs = mockMetrics.recordClaudeUsage.mock.calls[0].arguments;
  assert.strictEqual(metricsArgs[0], 'claude-sonnet-4-5');
  assert.strictEqual(metricsArgs[1], 50);
  assert.strictEqual(metricsArgs[2], 20);
  assert.strictEqual(metricsArgs[3], 'success');
});

test('callClaude should omit undefined optional parameters', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })),
    },
  };

  const client = createClaudeClient({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
    env: { CLAUDE_RATE_LIMIT_MS: '0' },
    metrics: mockMetrics,
  });

  await client.callClaude({
    model: 'claude-sonnet-4-5',
    maxTokens: 400,
    messages: [{ role: 'user', content: 'Hello' }],
    // No temperature, system, or tools
  });

  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.strictEqual(callArgs.temperature, undefined);
  assert.strictEqual(callArgs.system, undefined);
  assert.strictEqual(callArgs.tools, undefined);
});

test('callClaude should include tools when provided', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })),
    },
  };

  const client = createClaudeClient({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
    env: { CLAUDE_RATE_LIMIT_MS: '0' },
    metrics: mockMetrics,
  });

  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  ];

  await client.callClaude({
    model: 'claude-sonnet-4-5',
    maxTokens: 400,
    tools,
    messages: [{ role: 'user', content: 'Search for something' }],
  });

  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.deepStrictEqual(callArgs.tools, tools);
});

test('callClaude should throw and record metrics on API error', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };

  const apiError = new Error('Server error');
  apiError.status = 500;

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        throw apiError;
      }),
    },
  };

  const client = createClaudeClient({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
    env: { CLAUDE_RATE_LIMIT_MS: '0' },
    metrics: mockMetrics,
  });

  await assert.rejects(
    async () => {
      await client.callClaude({
        model: 'claude-sonnet-4-5',
        maxTokens: 400,
        messages: [{ role: 'user', content: 'Hello' }],
      });
    },
    (thrown) => {
      assert.strictEqual(thrown.status, 500);
      return true;
    }
  );

  // handleApiError should have been called
  assert.strictEqual(mockMetrics.recordExternalApiError.mock.calls.length, 1);
});

// =============================================================================
// handleApiError
// =============================================================================

test('handleApiError should handle 429 rate limit errors', () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };

  const client = createClaudeClient({
    logger: mockLogger,
    env: {},
    metrics: mockMetrics,
  });

  const err = new Error('Rate limited');
  err.status = 429;
  err.headers = { 'retry-after': '30' };

  client.handleApiError(err, 1000, mockLogger, 'claude-sonnet-4-5', {
    artist: 'Test',
    album: 'Album',
  });

  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(mockLogger.warn.mock.calls[0].arguments[0].includes('rate limit'));
  assert.strictEqual(mockMetrics.recordClaudeUsage.mock.calls.length, 1);
  assert.strictEqual(
    mockMetrics.recordClaudeUsage.mock.calls[0].arguments[3],
    'rate_limited'
  );
});

test('handleApiError should handle 500 server errors', () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };

  const client = createClaudeClient({
    logger: mockLogger,
    env: {},
    metrics: mockMetrics,
  });

  const err = new Error('Internal server error');
  err.status = 500;

  client.handleApiError(err, 1000, mockLogger, 'claude-sonnet-4-5');

  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
  assert.ok(
    mockLogger.error.mock.calls[0].arguments[0].includes('server error')
  );
});

test('handleApiError should handle 401 auth errors', () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };

  const client = createClaudeClient({
    logger: mockLogger,
    env: {},
    metrics: mockMetrics,
  });

  const err = new Error('Unauthorized');
  err.status = 401;

  client.handleApiError(err, 1000, mockLogger, 'claude-sonnet-4-5');

  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
  assert.ok(
    mockLogger.error.mock.calls[0].arguments[0].includes('authentication')
  );
});

test('handleApiError should handle generic errors', () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };

  const client = createClaudeClient({
    logger: mockLogger,
    env: {},
    metrics: mockMetrics,
  });

  const err = new Error('Unknown error');

  client.handleApiError(err, 1000, mockLogger, 'claude-sonnet-4-5');

  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
  assert.strictEqual(mockMetrics.recordExternalApiError.mock.calls.length, 1);
});

// =============================================================================
// DI pattern
// =============================================================================

test('createClaudeClient should use injected mock instead of real SDK', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockMetrics = {
    observeExternalApiCall: mock.fn(),
    recordExternalApiError: mock.fn(),
    recordClaudeUsage: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [{ type: 'text', text: 'mock response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })),
    },
  };

  const client = createClaudeClient({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
    env: { CLAUDE_RATE_LIMIT_MS: '0' },
    metrics: mockMetrics,
  });

  const result = await client.callClaude({
    model: 'claude-sonnet-4-5',
    maxTokens: 100,
    messages: [{ role: 'user', content: 'test' }],
  });

  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 1);
  assert.strictEqual(result.content[0].text, 'mock response');
});

test('createClaudeClient should use injected env variables', () => {
  const mockAnthropic = { messages: { create: mock.fn() } };
  const client = createClaudeClient({
    anthropicClient: mockAnthropic,
    env: { ANTHROPIC_API_KEY: 'test-key', CLAUDE_RATE_LIMIT_MS: '100' },
  });

  // Should use the injected client, not create from env key
  assert.strictEqual(client.getClient(), mockAnthropic);
});

test('default exports should be callable functions', () => {
  const defaultExports = require('../utils/claude-client.js');

  assert.strictEqual(typeof defaultExports.createClaudeClient, 'function');
  assert.strictEqual(typeof defaultExports.getClient, 'function');
  assert.strictEqual(typeof defaultExports.callClaude, 'function');
  assert.strictEqual(typeof defaultExports.extractTextFromContent, 'function');
  assert.strictEqual(typeof defaultExports.waitForRateLimit, 'function');
  assert.strictEqual(typeof defaultExports.retryWithBackoff, 'function');
  assert.strictEqual(typeof defaultExports.handleApiError, 'function');
});
