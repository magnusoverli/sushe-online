const { positiveInteger } = require('../config/limits');
const { callerSignal, shutdownSignal } = require('./outbound-lifecycle');
const { Response } = globalThis;

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function recordFailure(error) {
  const kind =
    error.name === 'TimeoutError'
      ? 'transport_timeout'
      : error.name === 'AbortError'
        ? 'transport_cancelled'
        : error.code === 'RESPONSE_TOO_LARGE'
          ? 'transport_oversized'
          : 'transport_failed';
  require('./outbound-metrics').events.inc({ kind });
}

/** Await a transport step even when an injected transport ignores abort. */
function withSignal(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

async function bufferResponse(response, maxBytes, signal) {
  const chunks = [];
  let size = 0;
  const append = (chunk) => {
    size += chunk.byteLength;
    if (size > maxBytes)
      throw Object.assign(new Error('Provider response exceeds size limit'), {
        code: 'RESPONSE_TOO_LARGE',
      });
    chunks.push(Buffer.from(chunk));
  };
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await withSignal(reader.read(), signal);
        if (done) break;
        append(value);
      }
    } catch (error) {
      reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else if (!('body' in response)) {
    // Small injected response adapters remain supported. Native fetch always
    // uses the streaming branch, which checks size before retaining each chunk.
    if (response.arrayBuffer)
      append(await withSignal(response.arrayBuffer(), signal));
    else if (response.text)
      append(Buffer.from(await withSignal(response.text(), signal)));
    else if (response.json)
      append(
        Buffer.from(JSON.stringify(await withSignal(response.json(), signal)))
      );
  }
  signal.throwIfAborted();
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('transfer-encoding');
  headers.set('content-length', String(size));
  const status = response.status || (response.ok === false ? 502 : 200);
  const buffered = new Response(
    [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
    { status, statusText: response.statusText, headers }
  );
  Object.defineProperty(buffered, 'url', { value: response.url || '' });
  return buffered;
}

// Fixed provider endpoints only. Arbitrary/user/provider-supplied URLs belong in
// public-request (DNS validation + IP pinning at EVERY redirect). No retries here:
// token rotations and writes must never be replayed on ambiguous failures.
/** @param {{fetch?: Function, timeoutMs?: number, maxBytes?: number, discardErrorBody?: boolean, streaming?: boolean}} [config] */
function createBoundedFetch({
  fetch: fetchFn = (url, options) => globalThis.fetch(url, options),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  discardErrorBody = false,
  streaming = false,
} = {}) {
  positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'outbound timeout');
  positiveInteger(maxBytes, DEFAULT_MAX_BYTES, 'outbound response limit');
  return async (url, options = {}) => {
    const controller = new AbortController();
    const context = ['GET', 'HEAD'].includes(
      (options.method || 'GET').toUpperCase()
    )
      ? callerSignal()
      : undefined;
    // Explicit signals own cancellation (e.g. coalesced requests with N callers).
    const parent = options.signal || context;
    const signal = AbortSignal.any([
      controller.signal,
      shutdownSignal,
      ...(parent ? [parent] : []),
    ]);
    const timer = setTimeout(
      () =>
        controller.abort(
          Object.assign(new Error('Provider deadline exceeded'), {
            name: 'TimeoutError',
            code: 'ETIMEDOUT',
          })
        ),
      timeoutMs
    );
    let response;
    let completed = false;
    let handedOff = false;
    try {
      signal.throwIfAborted();
      const pending = Promise.resolve(
        fetchFn(url, { ...options, redirect: 'manual', signal })
      );
      pending.then(
        (late) => {
          if (signal.aborted) late.body?.cancel?.().catch(() => {});
        },
        () => {}
      );
      response = await withSignal(pending, signal);
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304
      )
        throw new Error('Provider redirect rejected');
      if (discardErrorBody && !response.ok) {
        response.body?.cancel?.().catch(() => {});
        completed = true;
        return new Response(null, {
          status: response.status || 502,
          headers: response.headers,
        });
      }
      if (streaming && response.body && response.ok) {
        const result = require('./bounded-stream').boundedStreamResponse(
          response,
          maxBytes,
          signal,
          () => clearTimeout(timer)
        );
        handedOff = true;
        completed = true;
        return result;
      }
      const result = await bufferResponse(response, maxBytes, signal);
      completed = true;
      return result;
    } catch (error) {
      recordFailure(error);
      throw error;
    } finally {
      if (!handedOff) clearTimeout(timer);
      if (!completed) controller.abort();
      if (!handedOff && response?.body && !response.bodyUsed)
        response.body.cancel().catch(() => {});
    }
  };
}

module.exports = {
  createBoundedFetch,
  boundedFetch: createBoundedFetch(),
  bufferResponse,
  withSignal,
};
