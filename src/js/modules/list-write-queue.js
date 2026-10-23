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
  const owner = Symbol('list-writes');

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
    markUnsaved(listId, true, owner);

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
        markUnsaved(
          listId,
          state.pending > 0 || state.failures.size > 0,
          owner
        );
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

// Serialize HTTP writes separately from the orchestration queue: a queued list
// save calls the API client itself, so sharing its task queue would deadlock.
const enqueueRequest = createKeyedTaskQueue();
const requestStates = new Map();

export function getListWriteState(listId) {
  const state = requestStates.get(listId);
  return { pending: state?.pending || 0, version: state?.version || 0 };
}

export async function waitForListWrites(listId) {
  while (requestStates.get(listId)?.pending)
    await requestStates.get(listId).tail.catch(() => {});
}

export function enqueueListWrite(listId, task) {
  const owner = Symbol('request');
  markListUnsaved(listId, true, owner);
  const state = requestStates.get(listId) || { pending: 0, version: 0 };
  requestStates.set(listId, state);
  state.pending++;
  state.version++;
  state.tail = enqueueRequest(listId, task).finally(() => {
    state.pending--;
    markListUnsaved(listId, false, owner);
  });
  return state.tail;
}
