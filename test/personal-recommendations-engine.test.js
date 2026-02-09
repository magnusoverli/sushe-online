const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');
const {
  createRecommendationEngine,
} = require('../utils/personal-recommendations-engine.js');

// =============================================================================
// Helper: create engine with mocked deps
// =============================================================================

function createTestEngine(options = {}) {
  const mockLogger = {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };

  const mockClaudeClient = {
    callClaude: options.callClaude || mock.fn(async () => null),
    extractTextFromContent:
      options.extractTextFromContent ||
      mock.fn((content) => {
        if (!content || !Array.isArray(content)) return null;
        const textBlocks = content.filter((b) => b.type === 'text');
        if (textBlocks.length === 0) return null;
        return textBlocks
          .map((b) => b.text)
          .join(' ')
          .trim();
      }),
  };

  const mockNormalizeAlbumKey =
    options.normalizeAlbumKey ||
    ((artist, album) =>
      `${String(artist || '')
        .toLowerCase()
        .trim()}::${String(album || '')
        .toLowerCase()
        .trim()}`);

  const engine = createRecommendationEngine({
    claudeClient: mockClaudeClient,
    logger: mockLogger,
    env: options.env || {
      PERSONAL_RECS_COUNT: '5',
      PERSONAL_RECS_MODEL: 'claude-sonnet-4-5',
    },
    normalizeAlbumKey: mockNormalizeAlbumKey,
  });

  return { engine, mockLogger, mockClaudeClient };
}

// =============================================================================
// parseClaudeRecommendations
// =============================================================================

test('parseClaudeRecommendations should parse valid JSON array', () => {
  const { engine } = createTestEngine();

  const text = JSON.stringify([
    { artist: 'Artist1', album: 'Album1', reasoning: 'Great fit' },
    { artist: 'Artist2', album: 'Album2', reasoning: 'Matches taste' },
  ]);

  const result = engine.parseClaudeRecommendations(text);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].artist, 'Artist1');
  assert.strictEqual(result[0].album, 'Album1');
  assert.strictEqual(result[0].reasoning, 'Great fit');
});

test('parseClaudeRecommendations should handle markdown-wrapped JSON', () => {
  const { engine } = createTestEngine();

  const text =
    '```json\n[{"artist": "A", "album": "B", "reasoning": "C"}]\n```';

  const result = engine.parseClaudeRecommendations(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].artist, 'A');
});

test('parseClaudeRecommendations should handle code fence without json label', () => {
  const { engine } = createTestEngine();

  const text = '```\n[{"artist": "A", "album": "B", "reasoning": "C"}]\n```';

  const result = engine.parseClaudeRecommendations(text);
  assert.strictEqual(result.length, 1);
});

test('parseClaudeRecommendations should extract JSON array from surrounding text', () => {
  const { engine } = createTestEngine();

  const text =
    'Here are my recommendations:\n[{"artist": "A", "album": "B", "reasoning": "C"}]\nHope you enjoy!';

  const result = engine.parseClaudeRecommendations(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].artist, 'A');
});

test('parseClaudeRecommendations should throw on invalid JSON', () => {
  const { engine } = createTestEngine();

  assert.throws(
    () => engine.parseClaudeRecommendations('not valid json'),
    /Failed to parse recommendations JSON/
  );
});

test('parseClaudeRecommendations should throw on empty input', () => {
  const { engine } = createTestEngine();

  assert.throws(
    () => engine.parseClaudeRecommendations(''),
    /Empty or invalid response text/
  );
});

test('parseClaudeRecommendations should throw on null input', () => {
  const { engine } = createTestEngine();

  assert.throws(
    () => engine.parseClaudeRecommendations(null),
    /Empty or invalid response text/
  );
});

test('parseClaudeRecommendations should throw on non-array JSON', () => {
  const { engine } = createTestEngine();

  assert.throws(
    () => engine.parseClaudeRecommendations('{"not": "an array"}'),
    /Expected JSON array/
  );
});

test('parseClaudeRecommendations should skip items with missing required fields', () => {
  const { engine, mockLogger } = createTestEngine();

  const text = JSON.stringify([
    { artist: 'A', album: 'B', reasoning: 'Good' },
    { artist: 'C' }, // missing album
    { album: 'D' }, // missing artist
    { artist: 'E', album: 'F', reasoning: 'Also good' },
  ]);

  const result = engine.parseClaudeRecommendations(text);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].artist, 'A');
  assert.strictEqual(result[1].artist, 'E');
  assert.strictEqual(mockLogger.warn.mock.calls.length, 2);
});

test('parseClaudeRecommendations should handle missing reasoning', () => {
  const { engine } = createTestEngine();

  const text = JSON.stringify([{ artist: 'A', album: 'B' }]);

  const result = engine.parseClaudeRecommendations(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].reasoning, '');
});

// =============================================================================
// generateRecommendations
// =============================================================================

test('generateRecommendations should return null for empty pool', async () => {
  const { engine, mockLogger } = createTestEngine();

  const result = await engine.generateRecommendations({
    newReleases: [],
  });

  assert.strictEqual(result, null);
  assert.strictEqual(mockLogger.warn.mock.calls.length, 1);
});

test('generateRecommendations should return null when Claude returns null', async () => {
  const { engine, mockLogger } = createTestEngine({
    callClaude: mock.fn(async () => null),
  });

  const result = await engine.generateRecommendations({
    newReleases: [{ artist: 'A', album: 'B' }],
  });

  assert.strictEqual(result, null);
  assert.ok(
    mockLogger.error.mock.calls.some(
      (c) =>
        c.arguments[0] ===
        'Claude API returned null response for recommendations'
    )
  );
});

test('generateRecommendations should return recommendations on success', async () => {
  const recs = [
    { artist: 'Artist1', album: 'Album1', reasoning: 'Matches rock taste' },
    { artist: 'Artist2', album: 'Album2', reasoning: 'Similar to favorites' },
  ];

  const { engine } = createTestEngine({
    callClaude: mock.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(recs) }],
      usage: { input_tokens: 500, output_tokens: 200 },
    })),
  });

  const result = await engine.generateRecommendations({
    newReleases: [
      { artist: 'Artist1', album: 'Album1' },
      { artist: 'Artist2', album: 'Album2' },
    ],
    genreAffinity: [{ name: 'Rock', score: 90 }],
  });

  assert.ok(result);
  assert.strictEqual(result.recommendations.length, 2);
  assert.strictEqual(result.recommendations[0].artist, 'Artist1');
  assert.strictEqual(result.inputTokens, 500);
  assert.strictEqual(result.outputTokens, 200);
  assert.ok(result.promptSnapshot.length > 0);
});

test('generateRecommendations should deduplicate results', async () => {
  const recs = [
    { artist: 'Artist1', album: 'Album1', reasoning: 'First' },
    { artist: 'Artist1', album: 'Album1', reasoning: 'Duplicate' },
    { artist: 'Artist2', album: 'Album2', reasoning: 'Second' },
  ];

  const { engine } = createTestEngine({
    callClaude: mock.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(recs) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })),
  });

  const result = await engine.generateRecommendations({
    newReleases: [
      { artist: 'Artist1', album: 'Album1' },
      { artist: 'Artist2', album: 'Album2' },
    ],
  });

  assert.strictEqual(result.recommendations.length, 2);
  assert.strictEqual(result.recommendations[0].reasoning, 'First');
});

test('generateRecommendations should filter out owned albums', async () => {
  const recs = [
    { artist: 'Artist1', album: 'Album1', reasoning: 'First' },
    { artist: 'Owned', album: 'OwnedAlbum', reasoning: 'User has this' },
    { artist: 'Artist2', album: 'Album2', reasoning: 'Second' },
  ];

  const { engine } = createTestEngine({
    callClaude: mock.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(recs) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })),
  });

  const result = await engine.generateRecommendations({
    newReleases: [
      { artist: 'Artist1', album: 'Album1' },
      { artist: 'Owned', album: 'OwnedAlbum' },
      { artist: 'Artist2', album: 'Album2' },
    ],
    userAlbumKeys: ['owned::ownedalbum'],
  });

  assert.strictEqual(result.recommendations.length, 2);
  assert.ok(!result.recommendations.some((r) => r.artist === 'Owned'));
});

test('generateRecommendations should cap at count', async () => {
  const recs = Array.from({ length: 10 }, (_, i) => ({
    artist: `Artist${i}`,
    album: `Album${i}`,
    reasoning: `Reason${i}`,
  }));

  const { engine } = createTestEngine({
    callClaude: mock.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(recs) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })),
    env: { PERSONAL_RECS_COUNT: '5' },
  });

  const result = await engine.generateRecommendations({
    newReleases: recs.map((r) => ({ artist: r.artist, album: r.album })),
  });

  assert.strictEqual(result.recommendations.length, 5);
});

test('generateRecommendations should return null when no text in response', async () => {
  const { engine, mockLogger } = createTestEngine({
    callClaude: mock.fn(async () => ({
      content: [{ type: 'tool_use', name: 'something' }],
      usage: { input_tokens: 100, output_tokens: 0 },
    })),
  });

  const result = await engine.generateRecommendations({
    newReleases: [{ artist: 'A', album: 'B' }],
  });

  assert.strictEqual(result, null);
  assert.ok(
    mockLogger.error.mock.calls.some(
      (c) =>
        c.arguments[0] ===
        'Claude API returned no text content for recommendations'
    )
  );
});

test('generateRecommendations should use Set for userAlbumKeys', async () => {
  const recs = [
    { artist: 'New', album: 'NewAlbum', reasoning: 'Fresh' },
    { artist: 'Owned', album: 'OwnedAlbum', reasoning: 'Already have' },
  ];

  const { engine } = createTestEngine({
    callClaude: mock.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify(recs) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })),
  });

  const result = await engine.generateRecommendations({
    newReleases: [
      { artist: 'New', album: 'NewAlbum' },
      { artist: 'Owned', album: 'OwnedAlbum' },
    ],
    userAlbumKeys: new Set(['owned::ownedalbum']),
  });

  assert.strictEqual(result.recommendations.length, 1);
  assert.strictEqual(result.recommendations[0].artist, 'New');
});
