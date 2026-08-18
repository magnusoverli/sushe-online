/**
 * MusicBrainz url-rels availability source.
 *
 * url-rels (streaming / purchase links) live at the RELEASE level. The release
 * browse endpoint returns a group's releases and url-rels together, avoiding a
 * second rate-limited request in the common release-group path. Returns the
 * recognized direct links, release barcode, and a high-confidence streaming url.
 */

const defaultLogger = require('../../utils/logger');
const { SUSHE_USER_AGENT } = require('../../utils/musicbrainz-helpers');
const { isMusicbrainzId } = require('../native-name-service');
const { normalizeMusicbrainzUrl } = require('./platforms');

const MB_BASE = 'https://musicbrainz.org/ws/2';
const HEADERS = { 'User-Agent': SUSHE_USER_AGENT, Accept: 'application/json' };

function createMbUrlRelsSource(deps = {}) {
  const mbFetch = deps.mbFetch;
  const logger = deps.logger || defaultLogger;

  async function mbJson(url) {
    const resp = await mbFetch(url, { headers: HEADERS }, 'low');
    if (!resp.ok) {
      /** @type {Error & { status?: number }} */
      const err = new Error(`MusicBrainz responded ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  function selectRepresentativeRelease(releases) {
    return (
      releases.find((release) => release.status === 'Official') || releases[0]
    );
  }

  /**
   * @param {string} albumId - canonical album id (a MusicBrainz UUID)
   * @returns {Promise<{seedUrl: string|null, upc: string|null, links: Array<{service:string, url:string}>}>}
   */
  async function getDirectLinks(albumId) {
    if (!mbFetch || !isMusicbrainzId(albumId)) {
      return { seedUrl: null, upc: null, links: [] };
    }

    let browseResult = { releases: [] };
    try {
      browseResult = await mbJson(
        `${MB_BASE}/release?release-group=${albumId}&inc=url-rels&fmt=json&limit=100`
      );
    } catch (error) {
      if (![400, 404].includes(error.status)) throw error;
    }
    const release =
      selectRepresentativeRelease(browseResult.releases || []) ||
      (await mbJson(`${MB_BASE}/release/${albumId}?inc=url-rels&fmt=json`));
    const relations = release.relations || [];

    const links = [];
    const seen = new Set();
    for (const rel of relations) {
      const url = rel.url && rel.url.resource;
      if (!url) continue;
      const service = normalizeMusicbrainzUrl(url);
      if (!service || seen.has(service)) continue;
      seen.add(service);
      links.push({ service, url });
    }

    const streaming = relations.find(
      (r) => /stream/i.test(r.type || '') && r.url && r.url.resource
    );
    const seedUrl = (streaming && streaming.url.resource) || null;
    const upc = (release.barcode || '').trim() || null;

    logger.debug?.('MusicBrainz url-rels resolved', {
      albumId,
      links: links.length,
      upc,
    });
    return { seedUrl, upc, links };
  }

  return { getDirectLinks };
}

module.exports = { createMbUrlRelsSource };
