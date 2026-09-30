import { createKeyedTaskQueue } from '../utils/keyed-task-queue.js';
import { createKeyedDebounce } from '../utils/keyed-debounce.js';
import { markListUnsaved } from './unsaved-lists.js';

// One owner for pending writes, revision-guard generations and unload protection.
export function createListWriteQueue({
  markUnsaved = markListUnsaved,
  onIdle = () => {},
  ...timing
} = {}) {
  const enqueue = createKeyedTaskQueue();
  const debounced = createKeyedDebounce({ ...timing, enqueue });
  const states = new Map();

  function getState(listId) {
    const state = states.get(listId);
    return {
      pending: state?.pending || 0,
      version: state?.version || 0,
      dirty: Boolean(state?.failures.size),
    };
  }

  function schedule(listId, task, { kind = 'save', onError = () => {} } = {}) {
    if (!states.has(listId)) {
      states.set(listId, { pending: 0, version: 0, failures: new Set() });
    }
    const state = states.get(listId);
    const version = ++state.version;
    const isReorder = kind === 'reorder';
    if (!isReorder || !debounced.hasPending(listId)) state.pending++;
    markUnsaved(listId, true);

    const run = async () => {
      try {
        const result = await task(version);
        // A full save acknowledges the complete snapshot. A reorder must not
        // clear a failed metadata/membership write's unsaved protection.
        if (isReorder) state.failures.delete(kind);
        else state.failures.clear();
        return result;
      } catch (error) {
        state.failures.add(kind);
        onError(error, ++state.version);
        throw error;
      } finally {
        state.pending--;
        markUnsaved(listId, state.pending > 0 || state.failures.size > 0);
        if (!state.pending) onIdle(listId);
      }
    };

    if (isReorder) return debounced.schedule(listId, run);
    // An intervening save is a batch boundary, even before the timer expires.
    debounced.flush(listId);
    return enqueue(listId, run);
  }

  function wait(listId) {
    debounced.flush(listId);
    return enqueue(listId, async () => {});
  }

  return { schedule, getState, wait, flush: debounced.flush };
}
