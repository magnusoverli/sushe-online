/**
 * MusicBrainz url-rels availability source.
 *
 * url-rels (streaming / purchase links) live at the RELEASE level, so a
 * release-group id is first resolved to a representative release. Returns the
 * recognized direct links, the release barcode (UPC) for exact catalog lookups,
 * plus a high-confidence streaming url that doubles as an Odesli seed. Reuses the
 * injected, rate-limited `mbFetch` (shared MB queue).
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
      const err = new Error(`MusicBrainz responded ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  async function resolveReleaseId(albumId) {
    try {
      const rg = await mbJson(
        `${MB_BASE}/release-group/${albumId}?inc=releases&fmt=json`
      );
      const releases = rg.releases || [];
      if (releases.length) {
        const official = releases.find((r) => r.status === 'Official');
        return (official || releases[0]).id;
      }
    } catch (err) {
      // A 404 means the id is not a release-group — treat it as a release id.
      if (err.status && err.status !== 404) throw err;
    }
    return albumId;
  }

  /**
   * @param {string} albumId - canonical album id (a MusicBrainz UUID)
   * @returns {Promise<{seedUrl: string|null, upc: string|null, links: Array<{service:string, url:string}>}>}
   */
  async function getDirectLinks(albumId) {
    if (!mbFetch || !isMusicbrainzId(albumId)) {
      return { seedUrl: null, upc: null, links: [] };
    }

    const releaseId = await resolveReleaseId(albumId);
    const release = await mbJson(
      `${MB_BASE}/release/${releaseId}?inc=url-rels&fmt=json`
    );
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
