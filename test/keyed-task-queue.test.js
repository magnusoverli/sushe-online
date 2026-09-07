const { beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('keyed task queue', () => {
  let enqueue;

  beforeEach(async () => {
    const { createKeyedTaskQueue } =
      await import('../src/js/utils/keyed-task-queue.js');
    enqueue = createKeyedTaskQueue();
  });

  it('runs same-key tasks in order, including work queued after an earlier completion', async () => {
    const firstGate = Promise.withResolvers();
    const secondGate = Promise.withResolvers();
    const secondStarted = Promise.withResolvers();
    const calls = [];
    const first = enqueue('a', () => {
      calls.push(1);
      return firstGate.promise;
    });
    const second = enqueue('a', () => {
      calls.push(2);
      secondStarted.resolve();
      return secondGate.promise;
    });
    const independent = enqueue('b', () => 'independent');
    assert.equal(await independent, 'independent');
    assert.deepEqual(calls, [1]);

    firstGate.resolve('first');
    assert.equal(await first, 'first');
    await secondStarted.promise;
    const third = enqueue('a', () => calls.push(3));
    await enqueue('b', () => {});
    assert.deepEqual(calls, [1, 2]);
    secondGate.resolve('second');
    assert.equal(await second, 'second');
    await third;
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(await enqueue('a', () => 'reused'), 'reused');
  });

  for (const synchronous of [false, true]) {
    it(`propagates ${synchronous ? 'thrown' : 'rejected'} failures without poisoning queued or later work`, async () => {
      const failure = new Error('save failed');
      const gate = Promise.withResolvers();
      const first = enqueue('a', () => {
        if (synchronous) throw failure;
        return gate.promise;
      });
      const rejected = assert.rejects(first, (error) => error === failure);
      const second = enqueue('a', () => 'recovered');
      if (!synchronous) gate.reject(failure);
      await rejected;
      assert.equal(await second, 'recovered');
      assert.equal(await enqueue('a', () => 'later'), 'later');
    });
  }
});
