// Serialize work on one resource without blocking independent resources.
export function createKeyedTaskQueue() {
  const pending = new Map();

  return (key, task) => {
    const previous = pending.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(task);
    pending.set(key, result);
    const cleanup = () => {
      if (pending.get(key) === result) pending.delete(key);
    };
    result.then(cleanup, cleanup);
    return result;
  };
}
