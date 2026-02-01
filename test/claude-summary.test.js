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
  const mediumSummary =
    'This is a medium-length summary that should pass validation and be accepted.';

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          {
            type: 'text',
            text: mediumSummary,
          },
        ],
        usage: {
          input_tokens: 80,
          output_tokens: 20,
        },
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  // Should return the summary if it meets minimum length
  assert.strictEqual(result.summary, mediumSummary);
  assert.strictEqual(result.found, true);
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

test('fetchClaudeSummary should include temperature parameter', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockSummary = 'Test summary with temperature';

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

  await service.fetchClaudeSummary('Artist', 'Album');

  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.strictEqual(callArgs.temperature, 0.3);
});

test('fetchClaudeSummary should include system message', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockSummary = 'Test summary with system message';

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

  await service.fetchClaudeSummary('Artist', 'Album');

  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.ok(callArgs.system);
  assert.ok(callArgs.system.includes('music encyclopedia'));
});

test('fetchClaudeSummary should use max_tokens default of 300', async () => {
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

  // Temporarily remove env var to test default
  const originalMaxTokens = process.env.CLAUDE_MAX_TOKENS;
  delete process.env.CLAUDE_MAX_TOKENS;

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  await service.fetchClaudeSummary('Artist', 'Album');

  const callArgs = mockAnthropic.messages.create.mock.calls[0].arguments[0];
  assert.strictEqual(callArgs.max_tokens, 300);

  // Restore env var
  if (originalMaxTokens !== undefined) {
    process.env.CLAUDE_MAX_TOKENS = originalMaxTokens;
  }
});

test('fetchClaudeSummary should reject "no information available" responses', async () => {
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
            type: 'text',
            text: 'No information available for this album.',
          },
        ],
        usage: {
          input_tokens: 80,
          output_tokens: 20,
        },
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.found, false);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
  assert.ok(
    mockLogger.warn.mock.calls[0].arguments[0].includes('invalid or no-info')
  );
});

test('fetchClaudeSummary should reject responses that are too short', async () => {
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
            type: 'text',
            text: 'Too short',
          },
        ],
        usage: {
          input_tokens: 80,
          output_tokens: 5,
        },
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.found, false);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('fetchClaudeSummary should retry on 429 with exponential backoff', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const rateLimitError = new Error('Rate limit exceeded');
  rateLimitError.status = 429;

  let callCount = 0;
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        callCount++;
        if (callCount < 3) {
          throw rateLimitError;
        }
        return {
          content: [
            {
              type: 'text',
              text: 'Success after retries. This is a longer summary that passes validation. It has enough characters to not be rejected. The album was well received.',
            },
          ],
        };
      }),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.ok(result.summary.startsWith('Success after retries'));
  assert.strictEqual(result.found, true);
  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 3);
  assert.ok(
    mockLogger.info.mock.calls.some(
      (call) => call.arguments[0] === 'Retrying Claude API call'
    )
  );
});

test('fetchClaudeSummary should retry on 500 errors', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const serverError = new Error('Internal server error');
  serverError.status = 500;

  let callCount = 0;
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        callCount++;
        if (callCount < 2) {
          throw serverError;
        }
        return {
          content: [
            {
              type: 'text',
              text: 'Success after server error retry. This is a longer summary that passes validation. It has enough characters. The album was notable.',
            },
          ],
        };
      }),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.ok(result.summary.startsWith('Success after server error retry'));
  assert.strictEqual(result.found, true);
  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 2);
});

test('fetchClaudeSummary should not retry on 400 errors', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const badRequestError = new Error('Bad request');
  badRequestError.status = 400;

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => {
        throw badRequestError;
      }),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.found, false);
  // Should only be called once (no retries)
  assert.strictEqual(mockAnthropic.messages.create.mock.calls.length, 1);
});

test('fetchClaudeSummary should strip "Based on my research" preamble', async () => {
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
            type: 'text',
            text: 'Based on my research, here is a 4-sentence summary of "Test Album" by Test Artist: This is the actual summary content. It was released in 2020. The album received critical acclaim. It features innovative production.',
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Test Artist', 'Test Album');

  assert.strictEqual(result.found, true);
  assert.ok(!result.summary.includes('Based on my research'));
  assert.ok(!result.summary.includes('here is a'));
  assert.ok(result.summary.startsWith('This is the actual summary'));
});

test('fetchClaudeSummary should strip "Here is a summary" preamble', async () => {
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
            type: 'text',
            text: 'Here is a 4-sentence summary of "Wolves of the Trench" by Grenadier: The album was released in 2023. It\'s a black metal album. Critics praised its atmospheric sound. The band explores war themes.',
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary(
    'Grenadier',
    'Wolves of the Trench'
  );

  assert.strictEqual(result.found, true);
  assert.ok(!result.summary.includes('Here is'));
  assert.ok(result.summary.startsWith('The album was released'));
});

test('fetchClaudeSummary should strip "Let me search" preamble', async () => {
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
            type: 'text',
            text: 'Let me search for more specific information about the album\'s significance. Here is a 4-sentence summary of the album "III" by Gates Of Dawn: The album features post-rock elements. Released in 2019. Known for its atmospheric compositions. The band\'s third studio album.',
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Gates Of Dawn', 'III');

  assert.strictEqual(result.found, true);
  assert.ok(!result.summary.includes('Let me search'));
  assert.ok(!result.summary.includes('Here is'));
  assert.ok(result.summary.startsWith('The album features'));
});

test('fetchClaudeSummary should handle summary without preamble', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const cleanSummary =
    'The album was released in 2021. It received widespread acclaim. Features experimental production techniques. Considered a landmark release in the genre.';

  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content: [
          {
            type: 'text',
            text: cleanSummary,
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

  assert.strictEqual(result.found, true);
  assert.strictEqual(result.summary, cleanSummary);
});
