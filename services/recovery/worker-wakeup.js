// Notifications are hints only. Reconcile durable jobs after subscribing,
// after reconnecting, and periodically in case a notification was missed.
function createWorkerWakeup(pool) {
  let client,
    pending = false,
    resume;
  function wake() {
    pending = true;
    resume?.();
  }
  function disconnect() {
    if (client) {
      client.removeListener('notification', wake);
      client.removeListener('error', disconnect);
      client.release(true);
      client = null;
    }
    wake();
  }
  async function subscribe() {
    if (client) return;
    client = await pool.connect();
    client.on('notification', wake);
    client.on('error', disconnect);
    try {
      await client.query('LISTEN sushe_recovery_received');
    } catch (error) {
      disconnect();
      throw error;
    }
  }
  async function wait() {
    if (!pending)
      await new Promise((resolve) => {
        const timer = setTimeout(done, client ? 5000 : 500);
        function done() {
          clearTimeout(timer);
          resume = null;
          resolve(undefined);
        }
        resume = done;
      });
    pending = false;
  }
  return { subscribe, wait, wake, disconnect };
}

module.exports = { createWorkerWakeup };
