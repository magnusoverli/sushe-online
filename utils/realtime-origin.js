const { AsyncLocalStorage } = require('node:async_hooks');

const origins = new AsyncLocalStorage();

function withRealtimeOrigin(socketId, callback) {
  const origin = { socketId, active: true };
  return origins.run(origin, () =>
    callback(() => {
      origin.active = false;
    })
  );
}

function getRealtimeOrigin() {
  const origin = origins.getStore();
  return origin?.active ? origin.socketId : undefined;
}

module.exports = { withRealtimeOrigin, getRealtimeOrigin };
