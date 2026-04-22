const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('app-api-client module', () => {
  let createAppApiClient;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-api-client.js');
    createAppApiClient = module.createAppApiClient;
  });

  it('adds json, csrf, and socket headers for mutating calls', async () => {
    const fetchImpl = mock.fn(async (_url, options) => ({
      ok: true,
      json: async () => ({ ok: true, headers: options.headers }),
    }));

    const client = createAppApiClient({
      getRealtimeSyncModuleInstance: () => ({
        getSocket: () => ({ id: 'sock-1' }),
      }),
      fetchImpl,
      win: { csrfToken: 'csrf-1', location: { href: '/' } },
      logger: { error: () => {} },
    });

    const result = await client.apiCall('/api/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'x' }),
    });

    assert.strictEqual(result.ok, true);
    const headers = fetchImpl.mock.calls[0].arguments[1].headers;
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['X-CSRF-Token'], 'csrf-1');
    assert.strictEqual(headers['X-Socket-ID'], 'sock-1');
  });

  it('omits json content-type for FormData bodies', async () => {
    class FakeFormData {}

    const fetchImpl = mock.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    const client = createAppApiClient({
      getRealtimeSyncModuleInstance: () => null,
      fetchImpl,
      win: { csrfToken: null, location: { href: '/' } },
      FormDataCtor: FakeFormData,
      logger: { error: () => {} },
    });

    await client.apiCall('/api/upload', {
      method: 'POST',
      body: new FakeFormData(),
    });

    const headers = fetchImpl.mock.calls[0].arguments[1].headers;
    assert.strictEqual(headers['Content-Type'], undefined);
  });

  it('redirects to login on non-oauth 401 responses', async () => {
    const win = { csrfToken: null, location: { href: '/app' } };
    const fetchImpl = mock.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    }));
    const client = createAppApiClient({
      getRealtimeSyncModuleInstance: () => null,
      fetchImpl,
      win,
      logger: { error: () => {} },
    });

    const result = await client.apiCall('/api/protected');

    assert.strictEqual(result, undefined);
    assert.strictEqual(win.location.href, '/login');
  });

  it('throws oauth errors instead of redirecting on token failure', async () => {
    const win = { csrfToken: null, location: { href: '/app' } };
    const fetchImpl = mock.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 'TOKEN_EXPIRED', error: 'token expired' }),
    }));
    const logger = { error: mock.fn() };
    const client = createAppApiClient({
      getRealtimeSyncModuleInstance: () => null,
      fetchImpl,
      win,
      logger,
    });

    await assert.rejects(() => client.apiCall('/api/protected'), {
      message: 'token expired',
    });
    assert.strictEqual(win.location.href, '/app');
    assert.strictEqual(logger.error.mock.calls.length, 1);
  });
});
