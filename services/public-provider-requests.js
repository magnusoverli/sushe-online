// Only public provider JSON belongs here, never user-dependent responses.
function providerKey(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  // Stable sort preserves the order of repeated values and the case of names.
  parsed.searchParams.sort();
  return parsed.href;
}

function requestError(message, status, name) {
  return Object.assign(new Error(message), { status, name });
}

function createPublicProviderRequests({
  ttlMs = 10 * 60 * 1000,
  timeoutMs = 30000,
  operationTimeoutMs = 60000,
  maxEntries = 500,
  maxBytes = 16 * 1024 * 1024,
  maxInFlight = 200,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  let bytes = 0;

  function remove(key) {
    const entry = cache.get(key);
    if (entry) bytes -= entry.size;
    cache.delete(key);
  }

  function store(key, data, policy) {
    if (
      !data ||
      typeof data !== 'object' ||
      'error' in data ||
      'errors' in data ||
      'errorMessage' in data
    )
      return;
    const size = Buffer.byteLength(JSON.stringify(data));
    if (size > maxBytes || maxEntries <= 0) return;
    for (const [cachedKey, entry] of cache) {
      if (entry.staleUntil <= now()) remove(cachedKey);
    }
    remove(key);
    while (cache.size >= maxEntries || bytes + size > maxBytes) {
      remove(cache.keys().next().value);
    }
    const expires = now() + (policy.ttlMs ?? ttlMs);
    cache.set(key, {
      data: globalThis.structuredClone(data),
      size,
      expires,
      staleUntil: expires + (policy.staleTtlMs ?? 0),
    });
    bytes += size;
  }

  function start(key, load, policy, background = false) {
    if (pending.size >= maxInFlight)
      throw requestError('Provider busy', 503, 'Error');
    const controller = new AbortController();
    const entry = {
      controller,
      consumers: 0,
      background,
      settled: false,
      promise: null,
    };
    pending.set(key, entry);
    let rejectAbort;
    const aborted = new Promise((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(
          requestError('Provider deadline exceeded', 504, 'TimeoutError')
        ),
      operationTimeoutMs
    );
    entry.promise = Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal, { background });
      }),
      aborted,
    ])
      .then((data) => {
        controller.signal.throwIfAborted();
        if (entry.consumers || entry.background) store(key, data, policy);
        return data;
      })
      .catch((error) => {
        // Stop unread bodies too (e.g. rejected status or Content-Type).
        controller.abort(error);
        throw error;
      })
      .finally(() => {
        entry.settled = true;
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        if (pending.get(key) === entry) pending.delete(key);
      });
    return entry;
  }

  async function get(req, res, url, load, policy = {}) {
    if (req.aborted || res.destroyed)
      throw requestError('Client disconnected', undefined, 'AbortError');
    const key = providerKey(url);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) {
      cache.delete(key);
      cache.set(key, cached);
      res.setHeader?.('X-Provider-Cache', 'HIT');
      return globalThis.structuredClone(cached.data);
    }
    if (cached && policy.staleTtlMs > 0 && cached.staleUntil > now()) {
      cache.delete(key);
      cache.set(key, cached);
      // A refresh owns interest independently of the response that triggered it.
      // Saturation must not prevent serving an already available stale result.
      if (!pending.has(key) && pending.size < maxInFlight) {
        start(key, load, policy, true).promise.catch(() => {});
      }
      res.setHeader?.('X-Provider-Cache', 'STALE');
      return globalThis.structuredClone(cached.data);
    }
    remove(key);
    const existing = pending.get(key);
    const entry = existing || start(key, load, policy);
    res.setHeader?.('X-Provider-Cache', existing ? 'COALESCED' : 'MISS');
    entry.consumers++;
    let timer;
    let onClose;
    try {
      const data = await Promise.race([
        entry.promise,
        new Promise((_, reject) => {
          onClose = () =>
            reject(
              requestError('Client disconnected', undefined, 'AbortError')
            );
          req.once('aborted', onClose);
          // Incoming GET close is normal; outgoing response close is disconnect.
          res.once('close', onClose);
          timer = setTimeout(
            () =>
              reject(
                requestError('Provider request timed out', 504, 'TimeoutError')
              ),
            timeoutMs
          );
        }),
      ]);
      return globalThis.structuredClone(data);
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', onClose);
      res.removeListener('close', onClose);
      entry.consumers--;
      if (!entry.consumers && !entry.background && !entry.settled) {
        if (pending.get(key) === entry) pending.delete(key);
        entry.controller.abort(
          requestError('No interested clients', undefined, 'AbortError')
        );
      }
    }
  }

  return { get };
}

module.exports = { createPublicProviderRequests, providerKey };
