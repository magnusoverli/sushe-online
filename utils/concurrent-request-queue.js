const { positiveInteger } = require('../config/limits');
const metrics = require('./outbound-metrics');
const { shutdownSignal, withOutboundSignal } = require('./outbound-lifecycle');

class RequestQueue {
  constructor(
    maxConcurrent = 10,
    { maxPending = 200, timeoutMs = 60000 } = {}
  ) {
    this.maxConcurrent = positiveInteger(
      maxConcurrent,
      10,
      'queue concurrency'
    );
    this.maxPending = positiveInteger(maxPending, 200, 'queue capacity');
    this.timeoutMs = positiveInteger(timeoutMs, 60000, 'queue deadline');
    this.running = 0;
    this.queue = [];
  }

  /** @param {Function} fn @param {{signal?: AbortSignal}} [options] */
  add(fn, { signal: parent } = {}) {
    if (this.queue.length >= this.maxPending) {
      metrics.events.inc({ kind: 'saturated' });
      return Promise.reject(
        Object.assign(new Error('Request queue is full'), {
          code: 'QUEUE_FULL',
          status: 503,
        })
      );
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      shutdownSignal,
      ...(parent ? [parent] : []),
    ]);
    return new Promise((resolve, reject) => {
      const item = { fn, resolve, reject, signal, cleanup: () => {} };
      const abort = () => {
        const index = this.queue.indexOf(item);
        if (index >= 0) {
          this.queue.splice(index, 1);
          metrics.waiting.dec();
        }
        metrics.events.inc({
          kind:
            signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled',
        });
        item.cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(
        () =>
          controller.abort(
            Object.assign(new Error('Queue deadline exceeded'), {
              name: 'TimeoutError',
              status: 504,
            })
          ),
        this.timeoutMs
      );
      item.cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      this.queue.push(item);
      metrics.waiting.inc();
      this.process();
    });
  }

  process() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const item = this.queue.shift();
      metrics.waiting.dec();
      metrics.active.inc();
      this.running++;
      // Do not free a running slot on timeout until its underlying work settles.
      // Otherwise an abort-ignoring task could exceed the concurrency bound.
      Promise.resolve()
        .then(() => {
          item.signal.throwIfAborted();
          return withOutboundSignal(item.signal, () => item.fn(item.signal));
        })
        .finally(() => {
          item.cleanup();
          this.running--;
          metrics.active.dec();
          this.process();
        })
        .then(item.resolve, (error) => {
          metrics.events.inc({ kind: 'failed' });
          item.reject(error);
        });
    }
  }
  // Enrichment is best effort after the album write commits. Admission failure
  // must be observed without turning an intentionally detached job into an
  // unhandled rejection that terminates the application.
  addBackground(fn, { logger, kind, albumId }) {
    return this.add(fn).catch((error) => {
      logger.warn('Background enrichment was not completed', {
        kind,
        albumId,
        code: error.code,
        error: error.message,
      });
    });
  }
  get length() {
    return this.queue.length;
  }
  get runningCount() {
    return this.running;
  }
}
module.exports = { RequestQueue };
