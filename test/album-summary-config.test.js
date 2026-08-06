const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  createAlbumSummaryConfig,
} = require('../services/album-summary-config.js');

// The stored configuration is the source of truth. The environment is a
// starting point only — reading it as authority is what let a stale host-side
// compose file pin production to a model the code could not talk to.

function makeDb(rows = [], onWrite = () => {}) {
  return {
    statements: [],
    async raw(sql, params) {
      this.statements.push({ sql, params });
      onWrite(sql, params);
      if (sql.includes('SELECT')) return { rows };
      return { rows: [], rowCount: 1 };
    },
  };
}

const quietLog = { warn() {}, info() {}, error() {} };

describe('album summary config', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      model: process.env.CLAUDE_MODEL,
      effort: process.env.CLAUDE_SUMMARY_EFFORT,
      maxTokens: process.env.CLAUDE_MAX_TOKENS,
    };
    delete process.env.CLAUDE_MODEL;
    delete process.env.CLAUDE_SUMMARY_EFFORT;
    delete process.env.CLAUDE_MAX_TOKENS;
  });

  function restoreEnv() {
    for (const [k, v] of [
      ['CLAUDE_MODEL', savedEnv.model],
      ['CLAUDE_SUMMARY_EFFORT', savedEnv.effort],
      ['CLAUDE_MAX_TOKENS', savedEnv.maxTokens],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it('prefers the stored row over the environment', async () => {
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-5';
    try {
      const db = makeDb([
        { model: 'claude-opus-5', effort: 'high', max_tokens: 8192 },
      ]);
      const store = createAlbumSummaryConfig({ db, logger: quietLog });

      const config = await store.getConfig();

      assert.strictEqual(config.model, 'claude-opus-5');
      assert.strictEqual(config.effort, 'high');
      assert.strictEqual(config.maxTokens, 8192);
      assert.strictEqual(config.source, 'stored');
    } finally {
      restoreEnv();
    }
  });

  it('falls back to the environment when nothing is stored', async () => {
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-5';
    process.env.CLAUDE_MAX_TOKENS = '1024';
    try {
      const store = createAlbumSummaryConfig({
        db: makeDb([]),
        logger: quietLog,
      });

      const config = await store.getConfig();

      assert.strictEqual(config.model, 'claude-sonnet-4-5');
      assert.strictEqual(config.maxTokens, 1024);
      assert.strictEqual(config.source, 'environment');
    } finally {
      restoreEnv();
    }
  });

  it('falls back rather than failing when the table is unreachable', async () => {
    // A missing table must not stop summaries being generated.
    const db = {
      async raw() {
        throw new Error('relation "album_summary_config" does not exist');
      },
    };
    const store = createAlbumSummaryConfig({ db, logger: quietLog });

    const config = await store.getConfig();

    assert.strictEqual(config.source, 'environment');
    assert.ok(config.model);
    restoreEnv();
  });

  it('replaces rather than accumulates rows', async () => {
    const db = makeDb([]);
    const store = createAlbumSummaryConfig({ db, logger: quietLog });

    await store.saveConfig(
      { model: 'claude-opus-5', effort: 'high' },
      'admin1'
    );

    const sql = db.statements.map((s) => s.sql).join(' ');
    assert.match(sql, /DELETE FROM album_summary_config/);
    assert.match(sql, /INSERT INTO album_summary_config/);
    restoreEnv();
  });

  it('rejects an effort level the API would refuse', async () => {
    const store = createAlbumSummaryConfig({
      db: makeDb([]),
      logger: quietLog,
    });

    await assert.rejects(
      () => store.saveConfig({ model: 'claude-opus-5', effort: 'turbo' }),
      /effort must be one of/
    );
    restoreEnv();
  });

  it('requires a model', async () => {
    const store = createAlbumSummaryConfig({
      db: makeDb([]),
      logger: quietLog,
    });

    await assert.rejects(() => store.saveConfig({}), /model is required/);
    restoreEnv();
  });

  it('rejects a nonsensical token budget', async () => {
    const store = createAlbumSummaryConfig({
      db: makeDb([]),
      logger: quietLog,
    });

    await assert.rejects(
      () => store.saveConfig({ model: 'claude-opus-5', maxTokens: 0 }),
      /positive integer/
    );
    restoreEnv();
  });

  it('serves a saved change immediately, not after the cache expires', async () => {
    let rows = [];
    const db = {
      async raw(sql, params) {
        if (sql.includes('SELECT')) return { rows };
        if (sql.includes('INSERT')) {
          rows = [
            { model: params[0], effort: params[1], max_tokens: params[2] },
          ];
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const store = createAlbumSummaryConfig({ db, logger: quietLog });

    await store.getConfig(); // populate the cache
    await store.saveConfig({ model: 'claude-opus-5', effort: 'max' });

    const after = await store.getConfig();
    assert.strictEqual(after.model, 'claude-opus-5');
    restoreEnv();
  });
});
