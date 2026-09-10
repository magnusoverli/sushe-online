const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createPublicRequest } = require('../utils/public-request');
const { validateUnfurlTarget } = require('../utils/unfurl-url');

function harness(
  responses,
  lookup = async () => [{ address: '93.184.216.34', family: 4 }]
) {
  const calls = [];
  const fetch = createPublicRequest({
    lookup,
    request(url, options, callback) {
      calls.push({ url, options });
      const req = new EventEmitter();
      req.end = () => {
        const response = responses.shift();
        const body = Readable.from(response.chunks || [Buffer.from('preview')]);
        body.statusCode = response.status || 200;
        body.headers = { 'content-type': 'text/html', ...response.headers };
        process.nextTick(() => callback(body));
      };
      return req;
    },
  });
  return { fetch, calls };
}

test('rejects mapped IPv6, non-public IPs, and trailing-dot local hostnames before connecting', async () => {
  const { fetch, calls } = harness([]);
  for (const host of [
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
    '[::]',
    '[64:ff9b::7f00:1]',
    '127.1',
    'localhost.',
    '10.0.0.1',
    '169.254.169.254',
    '[2001:db8::1]',
  ]) {
    assert.equal(validateUnfurlTarget(`http://${host}`).valid, false, host);
    await assert.rejects(fetch(`http://${host}`));
  }
  assert.equal(calls.length, 0);
});

test('rejects private DNS answers including mixed public/private records', async () => {
  const { fetch, calls } = harness([], async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  await assert.rejects(fetch('https://example.com'), /non-public/);
  assert.equal(calls.length, 0);
});

test('pins approved DNS address without changing Host or TLS destination name', async () => {
  let lookups = 0;
  const { fetch, calls } = harness([{}], async () => {
    lookups++;
    return [{ address: '93.184.216.34', family: 4 }];
  });
  const result = await fetch('https://example.com/page');
  assert.equal(result.buffer.toString(), 'preview');
  assert.equal(calls[0].url.hostname, 'example.com');
  assert.equal(calls[0].options.agent, false);
  calls[0].options.lookup('example.com', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
  });
  assert.equal(lookups, 1);
});

test('revalidates redirects and never connects to private redirect targets', async () => {
  const { fetch, calls } = harness([
    { status: 302, headers: { location: 'http://127.0.0.1/private' } },
  ]);
  await assert.rejects(fetch('https://example.com'), /not allowed/);
  assert.equal(calls.length, 1);
});

test('host allowlist applies to redirected images and response sizes are bounded', async () => {
  const redirect = harness([
    { status: 302, headers: { location: 'https://other.example/image' } },
  ]);
  await assert.rejects(
    redirect.fetch('https://example.com', { allowedHosts: ['example.com'] }),
    /host not allowed/
  );
  const oversized = harness([{ chunks: [Buffer.alloc(10), Buffer.alloc(10)] }]);
  await assert.rejects(
    oversized.fetch('https://example.com', { maxBytes: 15 }),
    /size limit/
  );
});

test('aborted DNS resolution and unsupported ports never issue a request', async () => {
  const { fetch, calls } = harness([], () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = fetch('https://example.com', { signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(fetch('https://example.com:1234'), /port not allowed/);
  assert.equal(calls.length, 0);
});
