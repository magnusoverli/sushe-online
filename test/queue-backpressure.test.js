const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RequestQueue } = require('../utils/request-queue');

test('detached enrichment observes admission rejection without losing the committed album write', async () => {
  const queue = new RequestQueue(1, { maxPending: 1 });
  let release;
  const first = queue.add(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const second = queue.add(() => 'second');
  const warnings = [];
  await queue.addBackground(() => assert.fail('full queue started new work'), {
    kind: 'cover',
    albumId: 'synthetic',
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.equal(warnings[0][1].code, 'QUEUE_FULL');
  release();
  await Promise.all([first, second]);
});

test('queue saturation rejects immediately; cancelling queued work never starts it', async () => {
  const queue = new RequestQueue(1, { maxPending: 1 });
  let release;
  const first = queue.add(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const abort = new AbortController();
  const second = queue.add(() => assert.fail('cancelled work started'), {
    signal: abort.signal,
  });
  await assert.rejects(
    queue.add(() => {}),
    { code: 'QUEUE_FULL', status: 503 }
  );
  abort.abort();
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(queue.length, 0);
  release('done');
  assert.equal(await first, 'done');
});

test('deadline does not release active capacity until abort-ignoring work stops', async () => {
  const queue = new RequestQueue(1, { timeoutMs: 20 });
  let release;
  const first = queue.add(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await assert.rejects(first, { name: 'TimeoutError' });
  assert.equal(queue.runningCount, 1);
  let started = false;
  const second = queue.add(() => {
    started = true;
  });
  await assert.rejects(second, { name: 'TimeoutError' });
  assert.equal(started, false);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.runningCount, 0);
});
