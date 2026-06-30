/**
 * Album-search execution core (view-agnostic).
 *
 * Owns the debounce + AbortController + sequence guard + request building that
 * the desktop header search and the mobile search overlay share, so the two
 * stay in lockstep. Rendering is delegated entirely to the caller via the
 * onResults / onError / onCleared callbacks — this module touches no DOM.
 */

export const DEBOUNCE_MS = 220;
export const MIN_CHARS = 2;
export const RESULT_LIMIT = 25;

/**
 * @param {Object} deps
 * @param {(url: string, options?: Object) => Promise<any>} deps.apiCall
 * @param {() => string[]} [deps.getFields]  Optional field groups to search.
 * @param {(data: any, query: string) => void} [deps.onResults]
 * @param {(error: any, query: string) => void} [deps.onError]
 * @param {() => void} [deps.onCleared]  Query fell below the minimum length.
 * @param {Object} [deps.logger]
 */
export function createSearchRunner(deps = {}) {
  const {
    apiCall,
    getFields = () => [],
    onResults = () => {},
    onError = () => {},
    onCleared = () => {},
    logger = console,
    debounceMs = DEBOUNCE_MS,
    minChars = MIN_CHARS,
    limit = RESULT_LIMIT,
  } = deps;

  let debounceTimer = null;
  let abortController = null;
  let requestSeq = 0;
  let lastQuery = '';

  function cancelInflight() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  /** Run a search immediately (no debounce). */
  async function run(query) {
    lastQuery = query;
    cancelInflight();
    abortController = new AbortController();
    const seq = ++requestSeq;

    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const fields = getFields();
    if (fields.length > 0) params.set('fields', fields.join(','));

    try {
      const data = await apiCall(`/api/search/albums?${params.toString()}`, {
        signal: abortController.signal,
      });
      if (seq !== requestSeq) return; // a newer search superseded this one
      onResults(data, query);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (seq !== requestSeq) return;
      logger.warn('Album search failed:', error);
      onError(error, query);
    }
  }

  /** Debounced entry point for raw input values. */
  function schedule(value) {
    clearTimeout(debounceTimer);
    const query = String(value || '').trim();
    if (query.length < minChars) {
      lastQuery = '';
      cancelInflight();
      onCleared();
      return;
    }
    debounceTimer = setTimeout(() => run(query), debounceMs);
  }

  /** Re-run the last query (e.g. after the field selection changed). */
  function rerun() {
    if (lastQuery.length >= minChars) run(lastQuery);
  }

  /** Cancel everything and forget the last query. */
  function reset() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    cancelInflight();
    lastQuery = '';
  }

  return {
    schedule,
    run,
    rerun,
    reset,
    cancel: cancelInflight,
    getLastQuery: () => lastQuery,
    minChars,
  };
}
