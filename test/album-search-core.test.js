const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('album-search-core createSearchRunner', () => {
  let createSearchRunner;

  beforeEach(async () => {
    const module = await import('../src/js/modules/album-search-core.js');
    createSearchRunner = module.createSearchRunner;
  });

  function setup(overrides = {}) {
    const calls = [];
    const apiCall = mock.fn(async (url) => {
      const q = new URL(url, 'http://x').searchParams.get('q');
      const fields = new URL(url, 'http://x').searchParams.get('fields');
      calls.push({ url, q, fields });
      return { results: [], q };
    });
    const onResults = mock.fn();
    const onError = mock.fn();
    const onCleared = mock.fn();
    const runner = createSearchRunner({
      apiCall,
      onResults,
      onError,
      onCleared,
      logger: { warn() {} },
      ...overrides,
    });
    return { runner, apiCall, onResults, onError, onCleared, calls };
  }

  it('builds the request URL with q + limit and no fields by default', async () => {
    const { runner, calls, onResults } = setup();
    await runner.run('kid');
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/api\/search\/albums\?/);
    assert.strictEqual(calls[0].q, 'kid');
    assert.strictEqual(calls[0].fields, null);
    assert.strictEqual(onResults.mock.calls.length, 1);
  });

  it('includes selected field groups when getFields returns some', async () => {
    const { runner, calls } = setup({ getFields: () => ['meta', 'notes'] });
    await runner.run('doom');
    assert.strictEqual(calls[0].fields, 'meta,notes');
  });

  it('applies the sequence guard: a superseded request is dropped', async () => {
    const apiCall = mock.fn((url) => {
      const q = new URL(url, 'http://x').searchParams.get('q');
      if (q === 'slow')
        return new Promise((r) => setTimeout(() => r({ q }), 20));
      return Promise.resolve({ q });
    });
    const onResults = mock.fn();
    const runner = createSearchRunner({
      apiCall,
      onResults,
      logger: { warn() {} },
    });

    runner.run('slow'); // seq 1, resolves later
    runner.run('fast'); // seq 2, resolves first
    await wait(40);

    assert.strictEqual(onResults.mock.calls.length, 1);
    assert.strictEqual(onResults.mock.calls[0].arguments[1], 'fast');
  });

  it('swallows AbortError without reporting an error', async () => {
    const apiCall = mock.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const onError = mock.fn();
    const runner = createSearchRunner({
      apiCall,
      onError,
      logger: { warn() {} },
    });
    await runner.run('x');
    assert.strictEqual(onError.mock.calls.length, 0);
  });

  it('reports non-abort errors via onError', async () => {
    const apiCall = mock.fn(async () => {
      throw new Error('500');
    });
    const onError = mock.fn();
    const runner = createSearchRunner({
      apiCall,
      onError,
      logger: { warn() {} },
    });
    await runner.run('x');
    assert.strictEqual(onError.mock.calls.length, 1);
  });

  it('schedule() ignores queries below the minimum length and clears', async () => {
    const { runner, apiCall, onCleared } = setup({ debounceMs: 1 });
    runner.schedule('a'); // 1 char < MIN_CHARS (2)
    await wait(10);
    assert.strictEqual(apiCall.mock.calls.length, 0);
    assert.strictEqual(onCleared.mock.calls.length, 1);
  });

  it('schedule() debounces then runs the trimmed query', async () => {
    const { runner, calls } = setup({ debounceMs: 5 });
    runner.schedule('  kid  ');
    assert.strictEqual(calls.length, 0); // not yet (debounced)
    await wait(20);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].q, 'kid');
  });

  it('reset() cancels a pending debounced search', async () => {
    const { runner, apiCall } = setup({ debounceMs: 5 });
    runner.schedule('kid');
    runner.reset();
    await wait(20);
    assert.strictEqual(apiCall.mock.calls.length, 0);
  });

  it('rerun() re-issues the last query', async () => {
    const { runner, calls } = setup();
    await runner.run('kid');
    runner.rerun();
    await wait(5);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].q, 'kid');
  });
});
