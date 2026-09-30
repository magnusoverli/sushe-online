const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('keyed debounce', () => {
  let createKeyedDebounce, createKeyedTaskQueue;
  before(async () => {
    ({ createKeyedDebounce } =
      await import('../src/js/utils/keyed-debounce.js'));
    ({ createKeyedTaskQueue } =
      await import('../src/js/utils/keyed-task-queue.js'));
  });

  it('coalesces one key and settles every caller without delaying other keys', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const queue = createKeyedDebounce();
    const calls = [];
    const first = queue.schedule('a', () => calls.push('old'));
    const other = queue.schedule('b', () => calls.push('b'));
    t.mock.timers.tick(250);
    const latest = queue.schedule('a', () => calls.push('a'));
    assert.equal(first, latest);
    t.mock.timers.tick(250);
    await other;
    assert.deepEqual(calls, ['b']);
    t.mock.timers.tick(250);
    await Promise.all([first, latest]);
    assert.deepEqual(calls, ['b', 'a']);
    assert.equal(queue.hasPending('a'), false);
    assert.equal(queue.hasPending('b'), false);
  });

  it('reserves write order and does not replace dispatched work', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const enqueue = createKeyedTaskQueue();
    const queue = createKeyedDebounce({ enqueue });
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    const calls = [];
    const first = queue.schedule('a', async () => {
      calls.push('first');
      started.resolve();
      await gate.promise;
    });
    const intervening = enqueue('a', () => calls.push('save'));
    assert.equal(queue.flush('a'), first);
    await started.promise;
    const next = queue.schedule('a', () => calls.push('next'));
    queue.flush('a');
    assert.deepEqual(calls, ['first']);
    gate.resolve();
    await Promise.all([first, intervening, next]);
    assert.deepEqual(calls, ['first', 'save', 'next']);
  });

  it('bounds sustained coalescing with max wait', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const queue = createKeyedDebounce({ delayMs: 500, maxWaitMs: 1000 });
    const task = t.mock.fn();
    const result = queue.schedule('a', task);
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(300);
      assert.equal(queue.schedule('a', task), result);
    }
    t.mock.timers.tick(100);
    await result;
    assert.equal(task.mock.callCount(), 1);
    t.mock.timers.tick(2000);
    assert.equal(task.mock.callCount(), 1);
  });

  it('cancels queued intent, rejects shared callers and allows subsequent work', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const queue = createKeyedDebounce();
    const task = t.mock.fn();
    const first = queue.schedule('a', task);
    const second = queue.schedule('a', task);
    const rejected = [first, second].map((p) =>
      assert.rejects(p, { name: 'AbortError' })
    );
    queue.cancel('a');
    await Promise.all(rejected);
    const next = queue.schedule('a', () => 'saved');
    queue.flush('a');
    assert.equal(await next, 'saved');
    t.mock.timers.tick(2000);
    assert.equal(task.mock.callCount(), 0);
  });

  it('propagates a task failure to all callers without poisoning the queue', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const queue = createKeyedDebounce();
    const task = () => {
      throw new Error('offline');
    };
    const first = queue.schedule('a', task);
    const second = queue.schedule('a', task);
    const rejected = [first, second].map((p) => assert.rejects(p, /offline/));
    queue.flush('a');
    await Promise.all(rejected);
    const next = queue.schedule('a', () => 'recovered');
    queue.flush('a');
    assert.equal(await next, 'recovered');
  });
});
