const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('list write queue', () => {
  let createListWriteQueue;
  before(async () => {
    ({ createListWriteQueue } =
      await import('../src/js/modules/list-write-queue.js'));
  });

  function setup(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const unsaved = new Set();
    const queue = createListWriteQueue({
      markUnsaved: (id, dirty) =>
        dirty ? unsaved.add(id) : unsaved.delete(id),
    });
    return { queue, unsaved };
  }

  it('protects debounced intent immediately and flushes it before a later save', async (t) => {
    const { queue, unsaved } = setup(t);
    const calls = [];
    const first = queue.schedule('a', () => calls.push('old'), {
      kind: 'reorder',
    });
    const version = queue.getState('a').version;
    const second = queue.schedule('a', () => calls.push('order'), {
      kind: 'reorder',
    });
    assert.equal(first, second);
    assert.equal(queue.getState('a').pending, 1);
    assert.ok(queue.getState('a').version > version);
    assert.ok(unsaved.has('a'));
    const save = queue.schedule('a', () => calls.push('save'));
    assert.equal(queue.getState('a').pending, 2);
    await Promise.all([first, second, save]);
    assert.deepEqual(calls, ['order', 'save']);
    assert.equal(queue.getState('a').pending, 0);
    assert.equal(unsaved.size, 0);
  });

  it('wait includes debounced and in-flight work without blocking other lists', async (t) => {
    const { queue, unsaved } = setup(t);
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    const saving = queue.schedule('a', async () => {
      started.resolve();
      await gate.promise;
    });
    await started.promise;
    const reordering = queue.schedule('a', () => {}, { kind: 'reorder' });
    let drained = false;
    const waiting = queue.wait('a').then(() => {
      drained = true;
    });
    await queue.schedule('b', () => {});
    assert.equal(drained, false);
    assert.ok(unsaved.has('a'));
    gate.resolve();
    await Promise.all([saving, reordering, waiting]);
    assert.equal(drained, true);
    assert.equal(unsaved.size, 0);
  });

  it('keeps failed metadata protected after successful reorder and clears it after a full save', async (t) => {
    const { queue, unsaved } = setup(t);
    await assert.rejects(
      queue.schedule('a', () => {
        throw new Error('failed');
      }),
      /failed/
    );
    const reorder = queue.schedule('a', () => {}, { kind: 'reorder' });
    await queue.wait('a');
    await reorder;
    assert.equal(queue.getState('a').dirty, true);
    assert.ok(unsaved.has('a'));
    await queue.schedule('a', () => {});
    assert.equal(queue.getState('a').dirty, false);
    assert.equal(unsaved.size, 0);
  });

  it('records a coalesced failure once and retains protection until successful retry', async (t) => {
    const { queue, unsaved } = setup(t);
    const onError = t.mock.fn();
    const options = { kind: 'reorder', onError };
    const task = () => {
      throw new Error('conflict');
    };
    const first = queue.schedule('a', task, options);
    const second = queue.schedule('a', task, options);
    const rejected = [first, second].map((p) => assert.rejects(p, /conflict/));
    await queue.wait('a');
    await Promise.all(rejected);
    assert.equal(onError.mock.callCount(), 1);
    assert.deepEqual(queue.getState('a'), {
      pending: 0,
      version: 3,
      dirty: true,
    });
    assert.ok(unsaved.has('a'));
    const retry = queue.schedule('a', () => {}, { kind: 'reorder' });
    await queue.wait('a');
    await retry;
    assert.equal(queue.getState('a').dirty, false);
    assert.equal(unsaved.size, 0);
  });
});
