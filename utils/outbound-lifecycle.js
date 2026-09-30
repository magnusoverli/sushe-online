const { AsyncLocalStorage } = require('node:async_hooks');

const requests = new AsyncLocalStorage();
const shutdown = new AbortController();

// Only safe reads inherit caller cancellation. A token rotation/write must finish
// and persist even when its initiating browser has gone away.
function outboundRequestContext(req, res, next) {
  const controller = new AbortController();
  const close = () => {
    if (!res.writableEnded) controller.abort();
    req.removeListener('aborted', close);
    res.removeListener('close', close);
    res.removeListener('finish', close);
  };
  req.once('aborted', close);
  res.once('close', close);
  res.once('finish', close);
  requests.run(controller.signal, next);
}

module.exports = {
  outboundRequestContext,
  callerSignal: () => requests.getStore(),
  withOutboundSignal: (signal, work) => requests.run(signal, work),
  shutdownSignal: shutdown.signal,
  stopOutboundRequests: () => shutdown.abort(),
};
