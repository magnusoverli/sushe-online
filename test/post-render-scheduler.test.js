const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

describe('post-render-scheduler module', () => {
  let createPostRenderScheduler;
  let scheduleDeferredStartup;
  let FIRST_LIST_RENDERED_EVENT;

  beforeEach(async () => {
    const module = await import('../src/js/modules/post-render-scheduler.js');
    createPostRenderScheduler = module.createPostRenderScheduler;
    scheduleDeferredStartup = module.scheduleDeferredStartup;
    FIRST_LIST_RENDERED_EVENT = module.FIRST_LIST_RENDERED_EVENT;
  });

  it('waits for two animation frames before scheduling idle work', () => {
    const rafCallbacks = [];
    const idleCalls = [];
    const task = mock.fn();
    const { schedulePostRenderTask } = createPostRenderScheduler({
      requestAnimationFrameFn(callback) {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      },
      requestIdleCallbackFn(callback, options) {
        idleCalls.push({ callback, options });
        return idleCalls.length;
      },
    });

    schedulePostRenderTask(task, { timeoutMs: 1234 });

    assert.strictEqual(rafCallbacks.length, 1);
    rafCallbacks[0]();
    assert.strictEqual(rafCallbacks.length, 2);
    assert.strictEqual(idleCalls.length, 0);

    rafCallbacks[1]();
    assert.strictEqual(idleCalls.length, 1);
    assert.deepStrictEqual(idleCalls[0].options, { timeout: 1234 });

    idleCalls[0].callback();
    assert.strictEqual(task.mock.calls.length, 1);
  });

  it('uses timeout fallback and preserves delayed tasks', () => {
    const timeouts = [];
    const task = mock.fn();
    const { schedulePostRenderTask } = createPostRenderScheduler({
      setTimeoutFn(callback, ms) {
        timeouts.push({ callback, ms });
        return timeouts.length;
      },
    });

    schedulePostRenderTask(task, { delayMs: 250 });

    assert.strictEqual(timeouts[0].ms, 0);
    timeouts[0].callback();
    assert.strictEqual(timeouts[1].ms, 250);
    timeouts[1].callback();
    assert.strictEqual(timeouts[2].ms, 0);
    timeouts[2].callback();

    assert.strictEqual(task.mock.calls.length, 1);
  });

  it('starts deferred startup after first-list event or immediately on interaction', () => {
    const listeners = new Map();
    const timeouts = [];
    const scheduledTasks = [];
    const task = mock.fn();
    const doc = {
      addEventListener(eventName, handler) {
        listeners.set(`doc:${eventName}`, handler);
      },
    };
    const win = {
      addEventListener(eventName, handler) {
        listeners.set(`win:${eventName}`, handler);
      },
    };

    scheduleDeferredStartup(task, {
      doc,
      win,
      immediateOnInteraction: true,
      timeoutMs: 500,
      schedulePostRenderTask(callback, options) {
        scheduledTasks.push({ callback, options });
      },
      setTimeoutFn(callback, ms) {
        timeouts.push({ callback, ms });
      },
    });

    assert.strictEqual(timeouts[0].ms, 1500);
    listeners.get(`doc:${FIRST_LIST_RENDERED_EVENT}`)();

    assert.strictEqual(task.mock.calls.length, 0);
    assert.deepStrictEqual(scheduledTasks[0].options, { timeoutMs: 500 });
    scheduledTasks[0].callback();
    assert.strictEqual(task.mock.calls.length, 1);

    listeners.get('win:pointerdown')();
    timeouts[0].callback();
    assert.strictEqual(task.mock.calls.length, 1);

    const interactionTask = mock.fn();
    scheduleDeferredStartup(interactionTask, {
      doc,
      win,
      immediateOnInteraction: true,
      schedulePostRenderTask() {
        throw new Error('interaction should run immediately');
      },
      setTimeoutFn() {},
    });

    listeners.get('win:keydown')();
    assert.strictEqual(interactionTask.mock.calls.length, 1);
  });
});
