const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Response, ReadableStream } = globalThis;
const { createBoundedFetch } = require('../utils/bounded-fetch');

test('SDK streaming keeps progress live but bounds bytes and total body lifetime', async () => {
  let cancelCount = 0;
  const fetch = createBoundedFetch({
    streaming: true,
    timeoutMs: 30,
    maxBytes: 8,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelCount++;
          },
        })
      ),
  });
  const response = await fetch('https://sdk.test');
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1]));
  await assert.rejects(reader.read(), { name: 'TimeoutError' });
  assert.equal(cancelCount, 1);
  const oversized = createBoundedFetch({
    streaming: true,
    maxBytes: 8,
    fetch: async () => new Response('123456789'),
  });
  await assert.rejects((await oversized('https://sdk.test')).text(), {
    code: 'RESPONSE_TOO_LARGE',
  });
});

test('provider deadlines cover delayed headers and stalled bodies and close sockets', async () => {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === '/headers') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fetch = createBoundedFetch({ timeoutMs: 80 });
  try {
    for (const path of ['/headers', '/body'])
      await assert.rejects(
        fetch(`http://127.0.0.1:${server.address().port}${path}`),
        { name: 'TimeoutError' }
      );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('oversized decoded bodies cancel the stream and no provider write is retried', async () => {
  let calls = 0;
  let cancelled = false;
  const fetch = createBoundedFetch({
    maxBytes: 16,
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(17));
          },
          cancel() {
            cancelled = true;
          },
        })
      );
    },
  });
  await assert.rejects(
    fetch('https://provider.test/token', { method: 'POST' }),
    { code: 'RESPONSE_TOO_LARGE' }
  );
  assert.equal(calls, 1);
  assert.ok(cancelled);
});

test('redirects never forward bearer credentials and error bodies are bounded', async () => {
  let calls = 0;
  const fetch = createBoundedFetch({
    fetch: async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      return new Response('redirect', {
        status: 302,
        headers: { location: 'https://attacker.test' },
      });
    },
  });
  await assert.rejects(
    fetch('https://provider.test', {
      headers: { Authorization: 'Bearer synthetic' },
    }),
    /redirect rejected/
  );
  assert.equal(calls, 1);
  const failing = createBoundedFetch({
    maxBytes: 4,
    fetch: async () => new Response('too big', { status: 503 }),
  });
  await assert.rejects(failing('https://provider.test'), {
    code: 'RESPONSE_TOO_LARGE',
  });
});

test('abort-ignoring transports are bounded and late response bodies are cancelled', async () => {
  let deliver;
  let cancelled = false;
  const fetch = createBoundedFetch({
    timeoutMs: 20,
    fetch: () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  });
  await assert.rejects(fetch('https://provider.test'), {
    name: 'TimeoutError',
  });
  deliver(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      })
    )
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(cancelled);
});

test('buffered responses preserve JSON, status and headers; external abort cancels body', async () => {
  const fetch = createBoundedFetch({
    fetch: async () =>
      Response.json({ ok: true }, { headers: { 'retry-after': '2' } }),
  });
  const response = await fetch('https://provider.test');
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('retry-after'), '2');
  const abort = new AbortController();
  let cancelled = false;
  const blocked = createBoundedFetch({
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        })
      ),
  });
  const pending = blocked('https://provider.test', { signal: abort.signal });
  setImmediate(() => abort.abort());
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(cancelled);
});
