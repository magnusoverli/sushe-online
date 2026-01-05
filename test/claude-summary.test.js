const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const {
  createClaudeSummaryService,
  SUMMARY_SOURCE,
} = require('../utils/claude-summary.js');

// =============================================================================
// createClaudeSummaryService tests
// =============================================================================

test('createClaudeSummaryService should create service with dependencies', () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  assert.ok(service);
  assert.strictEqual(typeof service.fetchClaudeSummary, 'function');
  assert.strictEqual(service.SUMMARY_SOURCE, SUMMARY_SOURCE);
});

test('SUMMARY_SOURCE should be "claude"', () => {
  assert.strictEqual(SUMMARY_SOURCE, 'claude');
});

// =============================================================================
// fetchClaudeSummary tests
// =============================================================================

test('fetchClaudeSummary should return not found for empty input', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('', '');
  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);
});

test('fetchClaudeSummary should return not found for null input', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary(null, null);
  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);
});

test('fetchClaudeSummary should return summary for successful API call', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockSummary =
    'This is a great album released in 2020. It features innovative production and received critical acclaim.';

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          {
            type: 'text',
            text: mockSummary,
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Radiohead', 'OK Computer');

  assert.strictEqual(result.summary, mockSummary);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, true);
  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 1);

  // Verify API call parameters
  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.strictEqual(callArgs.model, 'claude-haiku-4-5');
  assert.ok(callArgs.tools);
  assert.strictEqual(callArgs.tools[0].type, 'web_search_20250305');
  assert.strictEqual(callArgs.tools[0].name, 'web_search');
  assert.strictEqual(callArgs.tools[0].max_uses, 3);
  assert.ok(callArgs.messages[0].content.includes('OK Computer'));
  assert.ok(callArgs.messages[0].content.includes('Radiohead'));
});

test('fetchClaudeSummary should handle API response with no text content', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'web_search',
            input: { query: 'test' },
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('fetchClaudeSummary should handle rate limit error (429)', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const rateLimitError = new Error('Rate limit exceeded');
  rateLimitError.status = 429;

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        throw rateLimitError;
      }),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('fetchClaudeSummary should handle server error (500)', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const serverError = new Error('Internal server error');
  serverError.status = 500;

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        throw serverError;
      }),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);
  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
});

test('fetchClaudeSummary should handle network error', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const networkError = new Error('Network error');

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        throw networkError;
      }),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);
  assert.strictEqual(mockLogger.error.mock.calls.length, 1);
});

test('fetchClaudeSummary should handle missing API key', async () => {
  // Temporarily remove API key
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.source, SUMMARY_SOURCE);
  assert.strictEqual(result.found, false);

  // Restore API key
  if (originalApiKey) {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test('fetchClaudeSummary should validate summary length', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const veryShortSummary = 'Short';

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          {
            type: 'text',
            text: veryShortSummary,
          },
        ],
        usage: {
          input_tokens: 80,
          output_tokens: 10,
        },
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  // Should still return the summary even if short (with warning)
  assert.strictEqual(result.summary, veryShortSummary);
  assert.strictEqual(result.found, true);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('fetchClaudeSummary should respect rate limiting', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockSummary = 'Test summary';

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          {
            type: 'text',
            text: mockSummary,
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const startTime = Date.now();
  await service.fetchClaudeSummary('Artist1', 'Album1');
  await service.fetchClaudeSummary('Artist2', 'Album2');
  const endTime = Date.now();

  // Should have waited at least 500ms between calls (rate limit: 2 req/sec)
  assert.ok(endTime - startTime >= 500);
  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 2);
});
