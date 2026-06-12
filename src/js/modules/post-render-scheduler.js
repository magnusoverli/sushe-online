export const FIRST_LIST_RENDERED_EVENT = 'sushe:first-list-rendered';

export function createPostRenderScheduler(deps = {}) {
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const requestAnimationFrameFn =
    deps.requestAnimationFrameFn || win?.requestAnimationFrame?.bind(win);
  const requestIdleCallbackFn =
    deps.requestIdleCallbackFn || win?.requestIdleCallback?.bind(win);

  function schedulePostRenderTask(task, options = {}) {
    if (typeof task !== 'function') return null;

    const { delayMs = 0, timeoutMs = 2000 } = options;
    const runWhenIdle = () => {
      if (typeof requestIdleCallbackFn === 'function') {
        return requestIdleCallbackFn(() => task(), { timeout: timeoutMs });
      }

      return setTimeoutFn(task, 0);
    };
    const runAfterDelay = () => {
      if (delayMs > 0) {
        return setTimeoutFn(runWhenIdle, delayMs);
      }

      return runWhenIdle();
    };

    if (typeof requestAnimationFrameFn === 'function') {
      return requestAnimationFrameFn(() => {
        requestAnimationFrameFn(runAfterDelay);
      });
    }

    return setTimeoutFn(runAfterDelay, 0);
  }

  return { schedulePostRenderTask };
}

export function scheduleDeferredStartup(task, options = {}) {
  if (typeof task !== 'function') return;

  const doc =
    options.doc || (typeof document !== 'undefined' ? document : null);
  const win = options.win || (typeof window !== 'undefined' ? window : null);
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const {
    immediateOnInteraction = false,
    timeoutMs = 2500,
    schedulePostRenderTask = createPostRenderScheduler({
      win,
      setTimeoutFn,
    }).schedulePostRenderTask,
  } = options;
  let started = false;

  const start = (runImmediately = false) => {
    if (started) return;
    started = true;

    if (runImmediately) {
      task();
      return;
    }

    schedulePostRenderTask(task, { timeoutMs });
  };

  doc?.addEventListener?.(FIRST_LIST_RENDERED_EVENT, () => start(), {
    once: true,
  });

  if (immediateOnInteraction) {
    win?.addEventListener?.('pointerdown', () => start(true), {
      once: true,
      passive: true,
    });
    win?.addEventListener?.('keydown', () => start(true), { once: true });
  }

  setTimeoutFn(() => start(), timeoutMs + 1000);
}
