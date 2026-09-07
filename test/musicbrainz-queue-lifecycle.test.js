const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MusicBrainzQueue, createMbFetch } = require('../utils/request-queue');
const { Response, ReadableStream, TextEncoder } = globalThis;

function clock() {
  let now = Date.parse('2026-01-01T00:00:00Z');
  let id = 0;
  const timers = new Map();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    now: () => now,
    setTimeout(fn, delay) {
      assert.ok(delay >= 0 && delay <= 2_147_483_647, 'valid Node timer delay');
      timers.set(++id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(key) {
      timers.delete(key);
    },
    get pending() {
      return timers.size;
    },
    async advance(ms = 0) {
      await flush();
      const target = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

const jsonResponse = () => Response.json({ releases: [] });
const networkError = () =>
  Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'ECONNRESET' },
  });

describe('MusicBrainz queue lifecycle', () => {
  it('rate limits every outbound retry and lets high priority pass a backoff', async () => {
    const time = clock();
    const starts = [];
    let attempts = 0;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async (url) => {
        starts.push([url, time.now()]);
        if (url === 'low' && ++attempts < 3) throw networkError();
        return jsonResponse();
      },
    });
    const low = queue.add('low', {}, 'low');
    await time.advance(1000);
    const high = queue.add('high', {}, 'high');
    await time.advance(2000);
    await Promise.all([low, high]);
    assert.deepEqual(
      starts.map(([url]) => url),
      ['low', 'low', 'high', 'low']
    );
    for (let i = 1; i < starts.length; i++) {
      assert.ok(starts[i][1] - starts[i - 1][1] >= 1000);
    }
    assert.equal(time.pending, 0);
  });

  it('wakes for new work while a retry is not ready', async () => {
    const time = clock();
    const urls = [];
    const queue = new MusicBrainzQueue({
      ...time,
      minInterval: 0,
      fetch: async (url) => {
        urls.push(url);
        if (urls.length === 1) throw networkError();
        return jsonResponse();
      },
    });
    const low = queue.add('low', {}, 'low');
    await time.advance();
    await queue.add('high', {}, 'high');
    assert.deepEqual(urls, ['low', 'high']);
    await time.advance(1000);
    await low;
  });

  it('removes queued cancellations without an outbound attempt or leaked timers', async () => {
    const time = clock();
    const urls = [];
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async (url) => {
        urls.push(url);
        return jsonResponse();
      },
    });
    await queue.add('first');
    const controller = new AbortController();
    const canceled = assert.rejects(
      queue.add('canceled', { signal: controller.signal }),
      { name: 'AbortError' }
    );
    controller.abort();
    await canceled;
    assert.equal(queue.length, 0);
    await time.advance(20000);
    assert.deepEqual(urls, ['first']);
    assert.equal(time.pending, 0);
  });

  it('rejects pre-aborted signals unchanged and cancels active noncooperative fetches', async () => {
    const time = clock();
    let calls = 0;
    let activeSignal;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: (_url, { signal }) => {
        calls++;
        activeSignal = signal;
        return new Promise(() => {});
      },
    });
    const controller = new AbortController();
    const reason = new Error('User canceled');
    const result = assert.rejects(
      queue.add('active', { signal: controller.signal }),
      (error) => error === reason
    );
    controller.abort(reason);
    await result;
    await assert.rejects(
      queue.add('never', { signal: controller.signal }),
      (error) => error === reason
    );
    await time.advance(20000);
    assert.equal(activeSignal.aborted, true);
    assert.equal(calls, 1);
    assert.equal(queue.isProcessing, false);
    assert.equal(time.pending, 0);
  });

  it('cancels a pending retry rather than retrying cancellation', async () => {
    const time = clock();
    let calls = 0;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async () => {
        calls++;
        throw networkError();
      },
    });
    const controller = new AbortController();
    const result = assert.rejects(
      queue.add('retry', { signal: controller.signal }),
      { name: 'AbortError' }
    );
    await time.advance();
    assert.equal(queue.length, 1);
    controller.abort();
    await result;
    await time.advance(20000);
    assert.equal(calls, 1);
    assert.equal(time.pending, 0);
  });

  for (const status of [429, 503]) {
    for (const dateFormat of [false, true]) {
      it(`honors ${status} Retry-After ${dateFormat ? 'date' : 'seconds'} across all work`, async () => {
        const time = clock();
        const starts = [];
        let canceledBody = false;
        const queue = new MusicBrainzQueue({
          ...time,
          fetch: async () => {
            starts.push(time.now());
            if (starts.length > 1) return jsonResponse();
            return new Response(
              new ReadableStream({
                cancel() {
                  canceledBody = true;
                },
              }),
              {
                status,
                headers: {
                  'Retry-After': dateFormat
                    ? new Date(time.now() + 3000).toUTCString()
                    : '3',
                },
              }
            );
          },
        });
        const low = queue.add('low', {}, 'low');
        await time.advance();
        const high = queue.add('high', {}, 'high');
        await time.advance(2999);
        assert.equal(starts.length, 1);
        assert.equal(canceledBody, true);
        await time.advance(1001);
        await Promise.all([low, high]);
        assert.equal(starts[1] - starts[0], 3000);
        assert.equal(starts[2] - starts[1], 1000);
      });
    }
  }

  it('bounds queued lifetime even when Retry-After exceeds the deadline', async () => {
    const time = clock();
    let calls = 0;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async () => {
        calls++;
        return new Response(null, {
          status: 429,
          headers: { 'Retry-After': '99999999999' },
        });
      },
    });
    const result = assert.rejects(queue.add('high', {}, 'high'), {
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
    });
    await time.advance(10000);
    await result;
    assert.equal(calls, 1);
    assert.equal(queue.length, 0);
    assert.equal(time.pending, 0);
  });

  it('bounds stalled bodies and low-priority attempts, including retry lifetime', async () => {
    const time = clock();
    const signals = [];
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async (_url, { signal }) => {
        signals.push(signal);
        return new Response(new ReadableStream());
      },
    });
    const result = assert.rejects(queue.add('low', {}, 'low'), {
      name: 'TimeoutError',
    });
    await time.advance(5000);
    assert.equal(signals[0].aborted, true);
    await time.advance(15000);
    await result;
    assert.equal(signals.length, 3);
    assert.ok(signals.every((signal) => signal.aborted));
    assert.equal(time.pending, 0);
  });

  it('buffers successful JSON with clone/json compatibility and corrected wire headers', async () => {
    const time = clock();
    let body;
    let signal;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async (_url, options) => {
        signal = options.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              body = controller;
            },
          }),
          {
            headers: {
              'content-type': 'application/json',
              'content-encoding': 'gzip',
              'content-length': '1',
            },
          }
        );
      },
    });
    let settled = false;
    const responsePromise = createMbFetch(queue)('json', {}, 'high').then(
      (r) => {
        settled = true;
        return r;
      }
    );
    await time.advance(1000);
    assert.equal(settled, false);
    const bytes = new TextEncoder().encode('{"ok":true}');
    body.enqueue(bytes);
    body.close();
    const response = await responsePromise;
    await time.advance(20000);
    assert.equal(signal.aborted, false);
    assert.ok(response instanceof Response);
    assert.equal(response.bodyUsed, false);
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.deepEqual(await response.clone().json(), { ok: true });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(time.pending, 0);
  });

  it('honors cancellation during body consumption without retries', async () => {
    const time = clock();
    let calls = 0;
    let bodyCanceled = false;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async () => {
        calls++;
        return new Response(
          new ReadableStream({
            cancel() {
              bodyCanceled = true;
            },
          })
        );
      },
    });
    const controller = new AbortController();
    const result = assert.rejects(
      queue.add('body', { signal: controller.signal }),
      { name: 'AbortError' }
    );
    await time.advance();
    controller.abort();
    await result;
    await time.advance(20000);
    assert.equal(calls, 1);
    assert.equal(bodyCanceled, true);
    assert.equal(time.pending, 0);
  });

  it('limits high priority to ten seconds including a stalled body', async () => {
    const time = clock();
    let calls = 0;
    const queue = new MusicBrainzQueue({
      ...time,
      fetch: async () => {
        calls++;
        return new Response(new ReadableStream());
      },
    });
    const result = assert.rejects(queue.add('high', {}, 'high'), {
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
    });
    await time.advance(10000);
    await result;
    assert.equal(calls, 1);
    assert.equal(time.pending, 0);
  });

  it('expires work waiting behind an active request without starting it', async () => {
    const time = clock();
    const urls = [];
    const queue = new MusicBrainzQueue({
      ...time,
      timeout: 20000,
      fetch: async (url) => {
        urls.push(url);
        return new Promise(() => {});
      },
    });
    const low = assert.rejects(queue.add('low', {}, 'low'), {
      name: 'TimeoutError',
    });
    const high = assert.rejects(queue.add('high', {}, 'high'), {
      name: 'TimeoutError',
    });
    await time.advance(10000);
    await high;
    assert.equal(queue.length, 0);
    assert.deepEqual(urls, ['low']);
    await time.advance(10000);
    await low;
    assert.equal(time.pending, 0);
  });
});
