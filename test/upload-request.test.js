const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const { requestWithUploadProgress } =
    await import('../src/js/modules/upload-request.js');
  const { createAppApiClient } =
    await import('../src/js/modules/app-api-client.js');
  const requests = [];
  const progress = [];
  const win = {
    csrfToken: 'initial',
    location: { href: 'http://localhost/app' },
  };
  const uploadImpl = (url, options) =>
    requestWithUploadProgress(url, options, () => {
      const xhr = {
        upload: {},
        headers: {},
        open(method, url) {
          this.method = method;
          this.url = url;
        },
        setRequestHeader(name, value) {
          this.headers[name] = value;
        },
        getResponseHeader() {
          return 'application/json';
        },
        send(body) {
          this.body = body;
        },
        abort() {
          this.onabort();
        },
        respond(status, data, responseURL = 'http://localhost/admin/restore') {
          Object.assign(this, {
            status,
            responseURL,
            responseText: JSON.stringify(data),
          });
          this.onload();
        },
      };
      requests.push(xhr);
      return xhr;
    });
  const client = createAppApiClient({
    uploadImpl,
    win,
    getRealtimeSyncModuleInstance: () => ({
      getSocket: () => ({ id: 'socket' }),
    }),
    fetchImpl: async (url) => {
      assert.equal(url, '/api/auth/csrf');
      return { ok: true, json: async () => ({ csrfToken: 'refreshed' }) };
    },
    logger: { error() {} },
  });
  const start = (options = {}) =>
    client.apiCall('/admin/restore', {
      method: 'POST',
      body: new FormData(),
      onUploadProgress: (event) => progress.push(event),
      ...options,
    });
  return { requests, progress, win, start };
}

test('upload sends multipart and security headers, reports bytes, and waits for the response', async () => {
  const { start, requests, progress } = await fixture();
  let finished = false;
  const pending = start().then((result) => {
    finished = true;
    return result;
  });
  const xhr = requests[0];
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.headers['Content-Type'], undefined);
  assert.equal(xhr.headers['X-CSRF-Token'], 'initial');
  assert.equal(xhr.headers['X-Socket-ID'], 'socket');
  assert.ok(xhr.body instanceof FormData);
  xhr.upload.onprogress({ loaded: 50, total: 100, lengthComputable: true });
  assert.deepEqual(progress.at(-1), {
    loaded: 50,
    total: 100,
    complete: false,
  });
  xhr.upload.onprogress({ loaded: 70, total: 0, lengthComputable: false });
  assert.equal(progress.at(-1).total, 0);
  xhr.upload.onload();
  await Promise.resolve();
  assert.equal(finished, false, 'Sending all bytes is not server acceptance');
  assert.equal(progress.at(-1).complete, true);
  xhr.respond(202, { restoreId: 'job' });
  assert.deepEqual(await pending, { restoreId: 'job' });
});

test('uploads retain the single CSRF-refresh retry and reset progress', async () => {
  const { start, requests, progress } = await fixture();
  const pending = start();
  requests[0].respond(403, { code: 'CSRF_INVALID' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers['X-CSRF-Token'], 'refreshed');
  assert.equal(progress.at(-1).loaded, 0);
  requests[1].respond(403, { code: 'CSRF_INVALID', error: 'Invalid token' });
  await assert.rejects(pending, { status: 403, code: 'CSRF_INVALID' });
  assert.equal(requests.length, 2);
});

test('upload HTTP failures retain backend error codes', async () => {
  const { start, requests } = await fixture();
  const pending = start();
  requests[0].respond(409, {
    code: 'RESTORE_IN_PROGRESS',
    error: 'Restore in progress',
  });
  await assert.rejects(pending, { status: 409, code: 'RESTORE_IN_PROGRESS' });
});

test('upload network failures are not automatically retried', async () => {
  const { start, requests } = await fixture();
  const pending = start();
  requests[0].onerror();
  await assert.rejects(pending, /connection interrupted/);
  assert.equal(requests.length, 1);
});

test('upload cancellation and already-aborted signals reject without replay', async () => {
  const { start, requests } = await fixture();
  const controller = new AbortController();
  const pending = start({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(start({ signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(requests[1].body, undefined);
});

test('upload login redirects use the existing session-expired behavior', async () => {
  const { start, requests, win } = await fixture();
  const pending = start();
  requests[0].respond(200, {}, 'http://localhost/login');
  await assert.rejects(pending, { code: 'SESSION_EXPIRED' });
  assert.equal(win.location.href, '/login');
});
