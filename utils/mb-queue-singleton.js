/**
 * Process-wide MusicBrainz request queue.
 *
 * MusicBrainz allows ~1 request per second per IP and responds 503 to
 * anything faster, so every MusicBrainz call in this process must go through
 * ONE rate-limited queue. Interactive callers (album search, track
 * resolution) use 'high'/'normal' priority; background work (availability,
 * native names, artist countries, image refetch) must pass 'low' so it never
 * delays user-facing requests.
 */

const { MusicBrainzQueue, createMbFetch } = require('./request-queue');

let queue = null;
let queuedFetch = null;

/**
 * Lazily construct the shared queue (one instance per process).
 * @returns {MusicBrainzQueue}
 */
function getMbQueue() {
  if (!queue) {
    queue = new MusicBrainzQueue({ fetch: globalThis.fetch });
    queuedFetch = createMbFetch(queue);
  }
  return queue;
}

/**
 * Rate-limited fetch through the shared queue.
 * @param {string} url - Full URL to fetch
 * @param {Object} [options] - Fetch options
 * @param {string} [priority] - 'high', 'normal', or 'low'
 * @returns {Promise<Response>}
 */
function mbFetch(url, options, priority = 'normal') {
  getMbQueue();
  return queuedFetch(url, options, priority);
}

module.exports = { getMbQueue, mbFetch };
