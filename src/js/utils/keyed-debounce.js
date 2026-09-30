import { createKeyedTaskQueue } from './keyed-task-queue.js';

// Reserve queue order when intent arrives, not when the debounce timer fires.
// All callers in a batch share its result; dispatched batches are never replaced.
export function createKeyedDebounce({
  enqueue = createKeyedTaskQueue(),
  delayMs = 500,
  maxWaitMs = 2000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const pending = new Map();

  function release(key, error) {
    const batch = pending.get(key);
    if (!batch) return;
    pending.delete(key);
    clearTimeoutFn(batch.timer);
    clearTimeoutFn(batch.deadline);
    batch.error = error;
    batch.ready();
    return batch.result;
  }

  function schedule(key, task) {
    let batch = pending.get(key);
    if (!batch) {
      let ready;
      const gate = new Promise((resolve) => {
        ready = resolve;
      });
      batch = { task, ready, timer: null, deadline: null, error: null };
      const current = batch;
      batch.result = enqueue(key, async () => {
        await gate;
        if (current.error) throw current.error;
        return current.task();
      });
      pending.set(key, batch);
      batch.deadline = setTimeoutFn(() => release(key), maxWaitMs);
    }
    batch.task = task;
    clearTimeoutFn(batch.timer);
    batch.timer = setTimeoutFn(() => release(key), delayMs);
    return batch.result;
  }

  return {
    schedule,
    hasPending: (key) => pending.has(key),
    flush: (key) => release(key),
    cancel: (key, reason = new DOMException('Task canceled', 'AbortError')) =>
      release(key, reason),
  };
}
