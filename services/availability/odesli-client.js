/**
 * Odesli (song.link) client — expands one seed link/id into deep links across
 * many platforms. Pure adapter: returns normalized links on success, throws on
 * a transient transport problem (network / 429 / 5xx) so the orchestrator can
 * decide whether to retry. No persistence, no rate-limiting (the queue paces it).
 */

const defaultLogger = require('../../utils/logger');
const { ODESLI_BASE_URL, ODESLI_USER_COUNTRY } = require('./platforms');

function createOdesliClient(deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;
  const baseUrl = deps.baseUrl || ODESLI_BASE_URL;

  /**
   * @param {{url?:string, platform?:string, type?:string, id?:string}} seed
   * @returns {Promise<Array<{platform:string, url:string}>>} Odesli platform links
   */
  async function fetchLinksBySeed(seed) {
    const params = new URLSearchParams({ userCountry: ODESLI_USER_COUNTRY });
    if (seed?.url) {
      params.set('url', seed.url);
    } else if (seed?.platform && seed?.id) {
      params.set('platform', seed.platform);
      params.set('type', seed.type || 'album');
      params.set('id', String(seed.id));
    } else {
      return []; // nothing to expand — not an error
    }

    const resp = await fetchFn(`${baseUrl}?${params.toString()}`);
    if (!resp.ok) {
      const err = new Error(`Odesli responded ${resp.status}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();
    const byPlatform = (data && data.linksByPlatform) || {};
    const links = [];
    for (const [platform, info] of Object.entries(byPlatform)) {
      if (info && info.url) links.push({ platform, url: info.url });
    }
    logger.debug?.('Odesli expanded seed', { count: links.length });
    return links;
  }

  return { fetchLinksBySeed };
}

module.exports = { createOdesliClient };
