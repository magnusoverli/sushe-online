const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  parseModelId,
  webSearchToolVersion,
  buildWebSearchTool,
  describeModel,
} = require('../utils/claude-model-capabilities.js');

// The app must adapt its request to whichever model an admin picks. Sending a
// parameter a model does not accept is a hard 400 on every request — that is
// how a stale production override took every summary down.

describe('parseModelId', () => {
  const cases = [
    ['claude-sonnet-5', 'sonnet', 5],
    ['claude-opus-4-6', 'opus', 4.6],
    ['claude-sonnet-4-5-20250929', 'sonnet', 4.5],
    ['claude-haiku-4-5-20251001', 'haiku', 4.5],
    ['claude-fable-5', 'fable', 5],
    // Cloud providers decorate the id; the generation must still be readable.
    ['anthropic.claude-sonnet-4-5-v1:0', 'sonnet', 4.5],
    ['claude-sonnet-4-5@20250929', 'sonnet', 4.5],
  ];

  for (const [id, family, generation] of cases) {
    it(`reads ${id}`, () => {
      assert.deepStrictEqual(parseModelId(id), { family, generation });
    });
  }

  it('returns nulls for an unrecognised id rather than guessing', () => {
    assert.deepStrictEqual(parseModelId('some-future-model'), {
      family: null,
      generation: null,
    });
  });
});

describe('webSearchToolVersion', () => {
  it('gives 4.6+ models the version with dynamic filtering', () => {
    for (const id of ['claude-sonnet-5', 'claude-opus-4-6', 'claude-fable-5']) {
      assert.strictEqual(webSearchToolVersion(id), 'web_search_20260318', id);
    }
  });

  it('gives older models the basic tool they can actually use', () => {
    for (const id of [
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ]) {
      assert.strictEqual(webSearchToolVersion(id), 'web_search_20250305', id);
    }
  });

  it('defaults an unknown model to the universally accepted tool', () => {
    assert.strictEqual(
      webSearchToolVersion('some-future-model'),
      'web_search_20250305',
      'an unrecognised model must degrade, not error'
    );
  });
});

describe('buildWebSearchTool', () => {
  it('sets response_inclusion only on the version that has it', () => {
    const modern = buildWebSearchTool('claude-sonnet-5', null);
    assert.strictEqual(modern.type, 'web_search_20260318');
    assert.strictEqual(modern.response_inclusion, 'excluded');
  });

  it('omits response_inclusion for the basic tool', () => {
    // Sending it would be a 400 — the same class of bug as sending effort to a
    // model without it.
    const basic = buildWebSearchTool('claude-sonnet-4-5-20250929', null);
    assert.strictEqual(basic.type, 'web_search_20250305');
    assert.ok(!('response_inclusion' in basic));
  });
});

describe('describeModel', () => {
  const withEffort = {
    id: 'claude-sonnet-5',
    display_name: 'Claude Sonnet 5',
    max_tokens: 128000,
    max_input_tokens: 1000000,
    capabilities: {
      effort: {
        supported: true,
        low: { supported: true },
        medium: { supported: true },
        high: { supported: true },
        xhigh: { supported: true },
        max: { supported: true },
      },
      thinking: { types: { adaptive: { supported: true } } },
    },
  };

  it('reports the effort levels a model actually offers', () => {
    const d = describeModel(withEffort);
    assert.strictEqual(d.supportsEffort, true);
    assert.deepStrictEqual(d.effortLevels, [
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    assert.strictEqual(d.maxOutputTokens, 128000);
    assert.strictEqual(d.maxInputTokens, 1000000);
  });

  it('reports a model that rejects effort as not supporting it', () => {
    const d = describeModel({
      id: 'claude-sonnet-4-5-20250929',
      display_name: 'Claude Sonnet 4.5',
      capabilities: { effort: { supported: false } },
    });
    assert.strictEqual(d.supportsEffort, false);
    assert.deepStrictEqual(d.effortLevels, []);
  });

  it('treats absent capabilities as no effort', () => {
    // capabilities is nullable on the wire. Omitting a supported effort costs a
    // default; sending an unsupported one costs the whole request.
    const d = describeModel({ id: 'claude-x-9', capabilities: null });
    assert.strictEqual(d.supportsEffort, false);
    assert.deepStrictEqual(d.effortLevels, []);
  });

  it('excludes a level the model does not offer', () => {
    const d = describeModel({
      id: 'claude-opus-4-6',
      capabilities: {
        effort: {
          supported: true,
          low: { supported: true },
          medium: { supported: true },
          high: { supported: true },
          xhigh: null,
          max: { supported: true },
        },
      },
    });
    assert.ok(!d.effortLevels.includes('xhigh'));
  });
});
