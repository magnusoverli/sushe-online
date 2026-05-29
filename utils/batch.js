/**
 * Batch iteration helper.
 *
 * Runs `items` through `fn` in fixed-size batches, awaiting each batch before
 * starting the next and pausing `delayMs` between batches (not after the last).
 * Used to respect external rate limits (e.g. Last.fm ~5 req/sec) while keeping
 * the batching/throttling logic in one place instead of copied per caller.
 */

/**
 * @template T, R
 * @param {T[]} items
 * @param {{ batchSize: number, delayMs: number }} opts
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>} results in the same order as `items`
 */
async function runInBatches(items, opts, fn) {
  const { batchSize, delayMs } = opts;
  const results = new Array(items.length);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, j) => fn(item, i + j))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }

    if (delayMs > 0 && i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

module.exports = { runInBatches };
