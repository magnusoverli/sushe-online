import * as matching from '../../../utils/entity-matching.js';

// Exact canonical matching preserves non-Latin letters and rejects empty keys.
export function qualifiedArtistCandidates(
  name,
  candidates,
  getName,
  getIdentity = () => null
) {
  const key = matching.externalMatchKey(name);
  if (!key) return [];
  const exact = candidates.filter(
    (candidate) => matching.externalMatchKey(getName(candidate)) === key
  );
  // A name alone cannot disambiguate distinct provider artists with the same name.
  const identities = new Set(exact.map(getIdentity).filter(Boolean));
  return identities.size > 1 ? [] : exact.slice(0, 3);
}

export function verifyImageLoads(
  url,
  signal,
  timeoutMs = 3000,
  ImageClass = Image
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const img = new ImageClass();
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      img.onload = null;
      img.onerror = null;
      if (error) {
        img.src = '';
        reject(error);
      } else resolve(url);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Image timed out')),
      timeoutMs
    );
    signal?.addEventListener('abort', abort, { once: true });
    img.onload = () =>
      finish(
        img.naturalWidth > 1 && img.naturalHeight > 1
          ? null
          : new Error('Invalid image dimensions')
      );
    img.onerror = () => finish(new Error('Image failed to load'));
    img.src = url;
  });
}

export async function firstWorkingArtistImage(
  urls,
  signal,
  verify = verifyImageLoads
) {
  let failed = false;
  for (const url of new Set(urls.filter(Boolean))) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await verify(url, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      failed = true;
    }
  }
  if (failed) throw new Error('Artist images failed verification');
  return null;
}

export function createArtistImageLoader(
  providers,
  {
    concurrency = 3,
    timeoutMs = 10000,
    fastProviderTimeoutMs = Math.min(4000, timeoutMs * 0.4),
    positiveTtl = 30 * 60 * 1000,
    negativeTtl = 60 * 1000,
    maxEntries = 200,
    now = Date.now,
  } = {}
) {
  const cache = new Map();
  const queue = [];
  let running = 0;
  const keyFor = (name, id) => id || matching.externalMatchKey(name);
  const getCached = (key, excluded) => {
    const cached = cache.get(key);
    if (cached && cached.expires > now() && !excluded.has(cached.url))
      return cached;
    cache.delete(key);
    return null;
  };
  const drain = () => {
    while (running < concurrency && queue.length) queue.shift()();
  };

  async function lookup(name, id, signal, excluded) {
    const key = keyFor(name, id);
    const cached = getCached(key, excluded);
    if (cached) return cached.url;
    const controller = new AbortController();
    let temporaryFailure = false;
    let timer;
    let abort;
    const cancelled = new Promise((resolve) => {
      abort = () => {
        controller.abort();
        resolve(null);
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, timeoutMs);
    });
    const run = async (provider) => {
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      const providerController = new AbortController();
      let providerTimer;
      let cancelProvider;
      const stopped = new Promise((_resolve, reject) => {
        cancelProvider = () => {
          providerController.abort();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        controller.signal.addEventListener('abort', cancelProvider, {
          once: true,
        });
        // Reserve the rest of the total budget for low-priority MB/Wikidata.
        if (!provider.lastResort) {
          providerTimer = setTimeout(cancelProvider, fastProviderTimeoutMs);
        }
      });
      try {
        const url = await Promise.race([
          stopped,
          provider.search(name, id, providerController.signal, excluded),
        ]);
        if (url && !excluded.has(url)) return url;
      } catch (_error) {
        temporaryFailure = true;
      } finally {
        clearTimeout(providerTimer);
        controller.signal.removeEventListener('abort', cancelProvider);
        providerController.abort();
      }
      throw new Error('No image');
    };
    const work = async () => {
      try {
        return await Promise.any(
          providers.filter((p) => !p.lastResort).map(run)
        );
      } catch (_error) {
        for (const provider of providers.filter((p) => p.lastResort)) {
          if (controller.signal.aborted) break;
          try {
            return await run(provider);
          } catch (_miss) {
            /* Next provider. */
          }
        }
        return null;
      }
    };
    try {
      const url = await Promise.race([work(), cancelled]);
      if (
        !controller.signal.aborted &&
        (url || (!temporaryFailure && !excluded.size))
      ) {
        cache.set(key, {
          url,
          expires: now() + (url ? positiveTtl : negativeTtl),
        });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return signal?.aborted ? null : url;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }

  return {
    evict(name, id) {
      cache.delete(keyFor(name, id));
    },
    search(name, id, signal, excluded = new Set()) {
      const key = keyFor(name, id);
      if (signal?.aborted || !key) return Promise.resolve(null);
      const cached = getCached(key, excluded);
      if (cached) return Promise.resolve(cached.url);
      return new Promise((resolve, reject) => {
        const cancel = () => {
          const index = queue.indexOf(run);
          if (index >= 0) queue.splice(index, 1);
          resolve(null);
        };
        const run = () => {
          signal?.removeEventListener('abort', cancel);
          if (signal?.aborted) {
            resolve(null);
            return;
          }
          running++;
          lookup(name, id, signal, excluded)
            .then(resolve, reject)
            .finally(() => {
              running--;
              drain();
            });
        };
        signal?.addEventListener('abort', cancel, { once: true });
        queue.push(run);
        drain();
      });
    },
  };
}
