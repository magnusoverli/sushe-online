const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const {
  createClaudeSummaryService,
  SUMMARY_SOURCE,
} = require('../utils/claude-summary.js');

/** The Message shape both the plain and streamed calls resolve to. */
function finalMessageWith(content) {
  return {
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      server_tool_use: { web_search_requests: 1 },
    },
  };
}

/** Minimal stand-in for the SDK's MessageStream. */
function makeStream(content, events = []) {
  const listeners = {};
  return {
    on(name, fn) {
      (listeners[name] ||= []).push(fn);
      return this;
    },
    async finalMessage() {
      for (const event of events) {
        for (const fn of listeners.streamEvent || []) fn(event);
      }
      return finalMessageWith(content);
    },
  };
}

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
  // Model comes from CLAUDE_MODEL env var, defaults to claude-sonnet-5
  const expectedModel = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
  assert.strictEqual(callArgs.model, expectedModel);
  assert.ok(callArgs.tools);
  assert.strictEqual(callArgs.tools[0].type, 'web_search_20260318');
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
  assert.ok(
    mockLogger.warn.mock.calls
      .map((c) => c.arguments[0])
      .includes('Claude API returned no text content'),
    'expected the no-content warning'
  );
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
  assert.ok(
    mockLogger.warn.mock.calls
      .map((c) => c.arguments[0])
      .includes('Claude API rate limit exceeded'),
    'expected the rate-limit warning'
  );
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

test('fetchClaudeSummary should timeout stalled Claude requests', async () => {
  const originalTimeoutMs = process.env.CLAUDE_REQUEST_TIMEOUT_MS;
  try {
    process.env.CLAUDE_REQUEST_TIMEOUT_MS = '25';

    const mockLogger = {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
      debug: mock.fn(),
    };

    const mockAnthropic = {
      messages: {
        create: mock.fn(
          () =>
            new Promise(() => {
              // Never resolves - simulates hung HTTP request
            })
        ),
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
    assert.ok(mockLogger.warn.mock.calls.length >= 1);
  } finally {
    if (originalTimeoutMs === undefined) {
      delete process.env.CLAUDE_REQUEST_TIMEOUT_MS;
    } else {
      process.env.CLAUDE_REQUEST_TIMEOUT_MS = originalTimeoutMs;
    }
  }
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

test('fetchClaudeSummary must not send temperature (Sonnet 5 rejects it)', async () => {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockSummary = 'Test summary without temperature';

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
  // Sonnet 5 and every 4.7+ model return a 400 for a non-default temperature,
  // top_p or top_k, so the parameter must be omitted entirely.
  assert.strictEqual(callArgs.temperature, undefined);
  assert.strictEqual(callArgs.top_p, undefined);
  assert.strictEqual(callArgs.top_k, undefined);
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

test('fetchClaudeSummary should use max_tokens default of 4096', async () => {
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
  // Thinking is on by default on Sonnet 5 and shares this budget with the
  // visible text, so it has to leave room for both.
  assert.strictEqual(callArgs.max_tokens, 4096);

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
  assert.ok(
    mockLogger.warn.mock.calls.some((c) =>
      /invalid or no-info response/.test(c.arguments[0])
    ),
    'expected the no-info rejection to be logged'
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
  assert.ok(
    mockLogger.warn.mock.calls.some((c) =>
      /invalid or no-info response/.test(c.arguments[0])
    ),
    'expected the no-info rejection to be logged'
  );
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

test('fetchClaudeSummary should strip "I need to search" meta-commentary', async () => {
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
            text: 'I need to search for more information about the artist\'s ideological associations to complete the requirements. The album "Filosofem" was released in 1996. It is a black metal album. Known for its atmospheric and minimalist approach.',
          },
        ],
      })),
    },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });

  const result = await service.fetchClaudeSummary('Burzum', 'Filosofem');

  assert.strictEqual(result.found, true);
  assert.ok(!result.summary.includes('I need to search'));
  assert.ok(!result.summary.includes('to complete the requirements'));
  assert.ok(result.summary.startsWith('The album "Filosofem"'));
});

test('fetchClaudeSummary should strip "I will search" meta-commentary', async () => {
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
            text: 'I will search for more details about this release. The album features post-punk influences. Released in 2018. Critics praised its raw energy.',
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
  assert.ok(!result.summary.includes('I will search'));
  assert.ok(result.summary.startsWith('The album features'));
});

test('fetchClaudeSummary should strip "Unable to find" meta-commentary', async () => {
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
            text: 'Unable to find complete information about ideological associations. The album was released in 2020. Features progressive metal elements. Received positive reviews from critics.',
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
  assert.ok(!result.summary.includes('Unable to find'));
  assert.ok(result.summary.startsWith('The album was released'));
});

test('honors the Retry-After header on a 429 from the SDK', async () => {
  // Regression: APIError.headers is a WHATWG Headers instance, so indexing it
  // by name always yields undefined. The old code did exactly that, which
  // silently disabled Retry-After handling — a 429 fell through to plain
  // exponential backoff instead of waiting as long as the API asked.
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const rateLimited = Object.assign(new Error('rate limited'), {
    status: 429,
    headers: new Headers({ 'retry-after': '0' }),
  });
  const mockAnthropic = {
    messages: { create: mock.fn(async () => Promise.reject(rateLimited)) },
  };

  const service = createClaudeSummaryService({
    logger: mockLogger,
    anthropicClient: mockAnthropic,
  });
  await service.fetchClaudeSummary('Artist', 'Album');

  const rateLimitLog = mockLogger.warn.mock.calls
    .map((c) => c.arguments)
    .find(([msg]) => msg === 'Claude API rate limit exceeded');

  assert.ok(rateLimitLog, 'expected a rate-limit warning to be logged');
  assert.strictEqual(
    rateLimitLog[1].retryAfter,
    '0',
    'Retry-After must be read via Headers.get(), not by indexing'
  );
});

// =============================================================================
// Pre-search narration must never reach the stored summary
// =============================================================================

const FACTUAL =
  'Reign in Blood is the third studio album by American thrash metal band Slayer, ' +
  'released on October 7, 1986 through Def Jam Recordings. Produced by Rick Rubin, ' +
  'it is widely regarded as one of the most influential thrash metal records ever made. ' +
  'The album drew controversy for the track Angel of Death, which describes the ' +
  'experiments of Josef Mengele at Auschwitz without editorial comment.';

function makeService(content, extra = {}) {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
  const mockAnthropic = {
    messages: {
      create: mock.fn(async () => ({
        content,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          server_tool_use: { web_search_requests: 1 },
        },
        ...extra,
      })),
    },
  };
  return {
    mockLogger,
    service: createClaudeSummaryService({
      logger: mockLogger,
      anthropicClient: mockAnthropic,
    }),
  };
}

test('narration emitted before the search is dropped from the summary', async () => {
  // The exact shape a server-tool turn returns: the model narrates, searches,
  // then answers. Only the post-search text is the answer.
  const { service } = makeService([
    {
      type: 'text',
      text: 'I will do the search and find out what you want about this album, then produce a summary.',
    },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'Slayer' } },
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: FACTUAL },
  ]);

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.strictEqual(result.found, true);
  assert.strictEqual(result.summary, FACTUAL);
  assert.ok(
    !/I will do the search/i.test(result.summary),
    'pre-search narration must not survive into the summary'
  );
});

test('narration is dropped regardless of its phrasing', async () => {
  // The point of extracting by position: wording the regex list has never seen
  // is still removed, because it is removed for being in the wrong place.
  const { service } = makeService([
    {
      type: 'text',
      text: 'Right then — hunting down the details on this one before I write anything up!',
    },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'Slayer' } },
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: FACTUAL },
  ]);

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.strictEqual(result.summary, FACTUAL);
});

test('narration is dropped across multiple search rounds', async () => {
  const { service } = makeService([
    { type: 'text', text: "I'll start by searching." },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'a' } },
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: 'That was not enough, let me search again.' },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'b' } },
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: FACTUAL },
  ]);

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.strictEqual(result.summary, FACTUAL);
});

test('thinking blocks are not treated as a search boundary', async () => {
  // Thinking is on by default on Sonnet 5. It must not shift the boundary, or
  // a no-search turn would lose its only text block.
  const { service } = makeService([
    { type: 'thinking', thinking: 'internal reasoning' },
    { type: 'text', text: FACTUAL },
  ]);

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.strictEqual(result.summary, FACTUAL);
});

test('a turn that searches and then says nothing yields no summary', async () => {
  // Falling back to the pre-search text here is precisely the original bug.
  const { mockLogger, service } = makeService([
    { type: 'text', text: 'I will look this up and report back shortly.' },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'a' } },
    { type: 'web_search_tool_result', content: [] },
  ]);

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.found, false);
  assert.ok(
    mockLogger.warn.mock.calls
      .map((c) => c.arguments[0])
      .includes('Claude produced no text after its final search')
  );
});

test('narration surviving into the answer block is rejected, not stored', async () => {
  const { mockLogger, service } = makeService([
    { type: 'server_tool_use', name: 'web_search', input: { query: 'a' } },
    { type: 'web_search_tool_result', content: [] },
    {
      type: 'text',
      text: "I'm afraid the sources here conflict with one another, so treat the following with caution before relying on any of it for anything at all.",
    },
  ]);

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.strictEqual(result.summary, null);
  assert.strictEqual(result.found, false);
  const rejected = mockLogger.warn.mock.calls
    .map((c) => c.arguments)
    .find(([msg]) => msg === 'Claude returned invalid or no-info response');
  assert.ok(rejected, 'expected the meta-commentary rejection to be logged');
  assert.strictEqual(rejected[1].reason, 'meta_commentary');
});

test('album titles beginning with "I" are not mistaken for narration', async () => {
  // "I Am" (Nas), "I Against I" (Bad Brains). A summary opening on the title
  // must survive — a false positive here silently loses a valid summary.
  for (const opening of [
    'I Am is the third studio album by American rapper Nas',
    'I Against I is the third studio album by American hardcore punk band Bad Brains',
  ]) {
    const text = `${opening}, and it is regarded as a landmark of its genre, widely praised on release and since.`;
    const { service } = makeService([
      { type: 'server_tool_use', name: 'web_search', input: { query: 'a' } },
      { type: 'web_search_tool_result', content: [] },
      { type: 'text', text },
    ]);

    const result = await service.fetchClaudeSummary('Artist', 'Album');

    assert.strictEqual(result.summary, text, `must not reject: ${opening}`);
    assert.strictEqual(result.found, true);
  }
});

// =============================================================================
// A broken service must never look like an album nobody has written about
// =============================================================================

test('a missing API key reports not_configured, not an absent summary', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const service = createClaudeSummaryService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.reason, 'not_configured');
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('a request timeout is a service fault, not an absent summary', async () => {
  const mockAnthropic = {
    messages: {
      create: mock.fn(
        () => new Promise(() => {}) // never settles; the timeout must fire
      ),
    },
  };
  const saved = process.env.CLAUDE_REQUEST_TIMEOUT_MS;
  process.env.CLAUDE_REQUEST_TIMEOUT_MS = '30';
  try {
    const service = createClaudeSummaryService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      anthropicClient: mockAnthropic,
    });
    const result = await service.fetchClaudeSummary('Artist', 'Album');
    assert.strictEqual(result.found, false);
    assert.strictEqual(
      result.reason,
      'timeout',
      'a timeout is a service fault, not an album without coverage'
    );
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_REQUEST_TIMEOUT_MS;
    else process.env.CLAUDE_REQUEST_TIMEOUT_MS = saved;
  }
});

test('the default request timeout leaves room for a slow Sonnet 5 turn', () => {
  // Measured summaries run 17-51s; the old 30s default failed about half.
  const saved = process.env.CLAUDE_REQUEST_TIMEOUT_MS;
  delete process.env.CLAUDE_REQUEST_TIMEOUT_MS;
  try {
    const withTimeoutSrc = require('fs').readFileSync(
      require.resolve('../utils/claude-summary.js'),
      'utf8'
    );
    const match = withTimeoutSrc.match(
      /CLAUDE_REQUEST_TIMEOUT_MS \|\| '(\d+)'/
    );
    assert.ok(match, 'expected a default request timeout');
    assert.ok(
      parseInt(match[1], 10) >= 60000,
      `default timeout ${match[1]}ms is too tight for Sonnet 5`
    );
  } finally {
    if (saved !== undefined) process.env.CLAUDE_REQUEST_TIMEOUT_MS = saved;
  }
});

// =============================================================================
// API failures are classified, not lumped together
// =============================================================================

// "The Claude API call failed, check the server logs" is useless to whoever is
// looking at the screen. A rejected key, a busy model and a slow response call
// for three different reactions.

function serviceWithError(err) {
  return createClaudeSummaryService({
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    anthropicClient: {
      messages: {
        create: mock.fn(async () => {
          throw err;
        }),
      },
    },
  });
}

test('a rejected API key is reported as an auth error, with the API message', async () => {
  const err = new Error(
    '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'
  );
  err.status = 401;

  const result = await serviceWithError(err).fetchClaudeSummary('A', 'B');

  assert.strictEqual(result.reason, 'auth_error');
  assert.match(result.reasonDetail, /401/);
  assert.match(
    result.reasonDetail,
    /invalid x-api-key/,
    "the API's own words are what identify the fault"
  );
  assert.ok(
    !/^HTTP 401: 401/.test(result.reasonDetail),
    'the status must not be repeated'
  );
});

test('an overloaded model is distinguished from a rate limit', async () => {
  const overloaded = new Error('529 overloaded');
  overloaded.status = 529;
  const busy = new Error('429 rate limit');
  busy.status = 429;

  assert.strictEqual(
    (await serviceWithError(overloaded).fetchClaudeSummary('A', 'B')).reason,
    'overloaded'
  );
  assert.strictEqual(
    (await serviceWithError(busy).fetchClaudeSummary('A', 'B')).reason,
    'rate_limited'
  );
});

test('a server error is reported as upstream, not as a generic failure', async () => {
  const err = new Error('500 internal');
  err.status = 500;

  const result = await serviceWithError(err).fetchClaudeSummary('A', 'B');

  assert.strictEqual(result.reason, 'upstream_error');
});

test('a timeout names the budget it exceeded', async () => {
  const saved = process.env.CLAUDE_REQUEST_TIMEOUT_MS;
  process.env.CLAUDE_REQUEST_TIMEOUT_MS = '5000';
  try {
    const service = createClaudeSummaryService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      anthropicClient: {
        messages: { create: mock.fn(() => new Promise(() => {})) },
      },
    });
    const result = await service.fetchClaudeSummary('A', 'B');
    assert.strictEqual(result.reason, 'timeout');
    assert.match(result.reasonDetail, /5s/);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_REQUEST_TIMEOUT_MS;
    else process.env.CLAUDE_REQUEST_TIMEOUT_MS = saved;
  }
});

// =============================================================================
// Summary reads as an encyclopedia entry, not as a reply to a request
// =============================================================================

test('drops sentences reporting what the sources did not contain', async () => {
  // The exact shapes that reached a user: absence reporting and source
  // narration, which read as research notes rather than a reference entry.
  const withAbsence =
    '"Cryptic Monolith" is the debut full-length album by Null Existence, a ' +
    'two-piece deathcore band from Washington, United States, formed in 2021. ' +
    'As of the search results, the album had not yet accumulated professional ' +
    'reviews. No notable political, religious, or social ideological ' +
    'associations for the band were found in available sources.';

  const service = createClaudeSummaryService({
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    anthropicClient: {
      messages: {
        create: async () =>
          finalMessageWith([{ type: 'text', text: withAbsence }]),
      },
    },
  });

  const result = await service.fetchClaudeSummary(
    'Null Existence',
    'Cryptic Monolith'
  );

  assert.ok(result.summary.startsWith('"Cryptic Monolith" is the debut'));
  assert.ok(
    !/as of the search results/i.test(result.summary),
    'source narration must not survive'
  );
  assert.ok(
    !/were found in available sources/i.test(result.summary),
    'absence reporting must not survive'
  );
  assert.ok(
    !/not yet accumulated professional reviews/i.test(result.summary),
    'no-reviews-yet reporting must not survive'
  );
});

test('closes the gap citation markers leave before punctuation', async () => {
  const spaced =
    'Reign in Blood is a 1986 album by Slayer . It was produced by Rick Rubin , and remains influential across thrash metal to this day.';

  const service = createClaudeSummaryService({
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    anthropicClient: {
      messages: {
        create: async () => finalMessageWith([{ type: 'text', text: spaced }]),
      },
    },
  });

  const result = await service.fetchClaudeSummary('Slayer', 'Reign in Blood');

  assert.ok(!/ \./.test(result.summary), 'no space before a full stop');
  assert.ok(!/ ,/.test(result.summary), 'no space before a comma');
  assert.match(result.summary, /by Slayer\. It was/);
});

// =============================================================================
// Streamed progress
// =============================================================================

test('reports the phases of the turn as they happen', async () => {
  const events = [
    { type: 'content_block_start', content_block: { type: 'thinking' } },
    { type: 'content_block_start', content_block: { type: 'server_tool_use' } },
    { type: 'content_block_start', content_block: { type: 'server_tool_use' } },
    { type: 'content_block_start', content_block: { type: 'text' } },
  ];

  const service = createClaudeSummaryService({
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    anthropicClient: {
      messages: {
        stream: () =>
          makeStream([{ type: 'text', text: 'A'.repeat(300) }], events),
      },
    },
  });

  const seen = [];
  await service.fetchClaudeSummary('Artist', 'Album', {}, (update) =>
    seen.push(update)
  );

  const phases = seen.map((s) => s.phase);
  assert.ok(phases.includes('searching'), 'search phase must be reported');
  assert.ok(phases.includes('writing'), 'writing phase must be reported');
  assert.strictEqual(
    seen[seen.length - 1].searches,
    2,
    'each server tool use counts as a search'
  );
});

test('a throwing progress listener cannot break the summary', async () => {
  // Progress is decoration; it must never take down the request it describes.
  const service = createClaudeSummaryService({
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    anthropicClient: {
      messages: {
        stream: () =>
          makeStream(
            [{ type: 'text', text: 'B'.repeat(300) }],
            [{ type: 'content_block_start', content_block: { type: 'text' } }]
          ),
      },
    },
  });

  const result = await service.fetchClaudeSummary('Artist', 'Album', {}, () => {
    throw new Error('listener exploded');
  });

  assert.strictEqual(result.found, true);
});
