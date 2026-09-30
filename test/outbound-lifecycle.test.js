const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { outboundRequestContext } = require('../utils/outbound-lifecycle');
const { createBoundedFetch } = require('../utils/bounded-fetch');

test('browser disconnect cancels safe reads but lets rotating-token writes complete', async () => {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), { writableEnded: false });
  let readSignal, writeSignal, finishWrite;
  const read = createBoundedFetch({
    fetch: (_url, { signal }) => {
      readSignal = signal;
      return new Promise(() => {});
    },
  });
  const write = createBoundedFetch({
    fetch: (_url, { signal }) => {
      writeSignal = signal;
      return new Promise((resolve) => {
        finishWrite = () =>
          resolve(globalThis.Response.json({ token: 'synthetic' }));
      });
    },
  });
  let pendingRead, pendingWrite;
  outboundRequestContext(req, res, () => {
    pendingRead = read('https://provider.test/read');
    pendingWrite = write('https://provider.test/token', { method: 'POST' });
  });
  res.emit('close');
  await assert.rejects(pendingRead, { name: 'AbortError' });
  assert.equal(readSignal.aborted, true);
  assert.equal(writeSignal.aborted, false);
  finishWrite();
  assert.deepEqual(await (await pendingWrite).json(), { token: 'synthetic' });
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});
