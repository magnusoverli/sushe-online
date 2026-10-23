// Scoped, batched notifications. Subscribers read authoritative state, rather
// than retaining the object that happened to be rendered when they mounted.
export function createStateEvents() {
  const listeners = new Map();
  const pending = new Set();
  let scheduled = false;

  function publish(key) {
    pending.add(key);
    if (scheduled) return;
    scheduled = true;
    globalThis.queueMicrotask(() => {
      scheduled = false;
      const keys = [...pending];
      pending.clear();
      const callbacks = new Set();
      for (const scope of keys) {
        for (const callback of listeners.get(scope) || [])
          callbacks.add(callback);
      }
      for (const callback of callbacks) {
        try {
          Promise.resolve(callback()).catch((error) =>
            console.error('State subscriber failed:', error)
          );
        } catch (error) {
          console.error('State subscriber failed:', error);
        }
      }
    });
  }

  function subscribe(keys, callback) {
    const scopes = Array.isArray(keys) ? keys : [keys];
    for (const key of scopes) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(callback);
    }
    return () => {
      for (const key of scopes) {
        const subscribers = listeners.get(key);
        subscribers?.delete(callback);
        if (!subscribers?.size) listeners.delete(key);
      }
    };
  }

  return { publish, subscribe };
}

export const stateEvents = createStateEvents();

export function updateUserPreferences(patch, win = globalThis.window) {
  if (win?.currentUser) Object.assign(win.currentUser, patch);
  for (const field of Object.keys(patch))
    stateEvents.publish(`preference:${field}`);
  stateEvents.publish('preferences');
}
