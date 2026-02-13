/**
 * Track Resolution Service
 *
 * Resolves track lists for albums using MusicBrainz as primary source
 * with iTunes and Deezer as fallbacks.
 *
 * Uses dependency injection via createTrackResolutionService(deps) factory.
 *
 * @module services/track-resolution-service
 */

const { normalizeForExternalApi } = require('../utils/normalization');
const {
  SUSHE_USER_AGENT,
  selectBestRelease,
  extractTracksFromMedia,
} = require('../utils/musicbrainz-helpers');

const MBID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * @param {string} val
 * @returns {boolean}
 */
function looksLikeMBID(val) {
  return MBID_REGEX.test(val || '');
}

/**
 * Sanitize a string for external API search queries.
 * Strips diacritics, removes brackets and punctuation.
 *
 * @param {string} str
 * @returns {string}
 */
function sanitizeForSearch(str = '') {
  return normalizeForExternalApi(str)
    .replace(/[()[\]{}]/g, '')
    .replace(/[.,!?]/g, '');
}

/**
 * @param {Object} deps
 * @param {Function} deps.fetch - Fetch implementation
 * @param {Function} deps.mbFetch - MusicBrainz rate-limited fetch
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} Track resolution service methods
 */
function createTrackResolutionService(deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const mbFetch = deps.mbFetch;
  const logger = deps.logger || require('../utils/logger');

  const headers = { 'User-Agent': SUSHE_USER_AGENT };

  /**
   * Fetch track list from iTunes as fallback.
   * @param {string} artistClean - Sanitized artist name
   * @param {string} albumClean - Sanitized album name
   * @returns {Promise<{ tracks: Array, releaseId: string } | null>}
   */
  async function fetchItunesTracks(artistClean, albumClean) {
    try {
      const term = `${artistClean} ${albumClean}`;
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=5`;
      const resp = await fetch(searchUrl);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data.results || !data.results.length) return null;
      const best = data.results[0];
      if (!best.collectionId) return null;
      const lookup = await fetch(
        `https://itunes.apple.com/lookup?id=${best.collectionId}&entity=song`
      );
      if (!lookup.ok) return null;
      const lookupData = await lookup.json();
      const tracks = (lookupData.results || [])
        .filter((r) => r.wrapperType === 'track')
        .map((r) => ({
          name: r.trackName,
          length: r.trackTimeMillis || null,
        }));
      return tracks.length
        ? { tracks, releaseId: `itunes:${best.collectionId}` }
        : null;
    } catch (err) {
      logger.error('iTunes fallback error', { error: err.message });
      return null;
    }
  }

  /**
   * Fetch track list from Deezer as fallback.
   * @param {string} artistClean - Sanitized artist name
   * @param {string} albumClean - Sanitized album name
   * @returns {Promise<{ tracks: Array, releaseId: string } | null>}
   */
  async function fetchDeezerTracks(artistClean, albumClean) {
    try {
      const q = `${artistClean} ${albumClean}`;
      const searchResp = await fetch(
        `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`
      );
      if (!searchResp.ok) return null;
      const data = await searchResp.json();
      const albumId = data.data && data.data[0] && data.data[0].id;
      if (!albumId) return null;
      const albumResp = await fetch(`https://api.deezer.com/album/${albumId}`);
      if (!albumResp.ok) return null;
      const albumData = await albumResp.json();
      const tracks = (albumData.tracks?.data || []).map((t) => ({
        name: t.title,
        length: t.duration ? t.duration * 1000 : null,
      }));
      return tracks.length ? { tracks, releaseId: `deezer:${albumId}` } : null;
    } catch (err) {
      logger.error('Deezer fallback error', { error: err.message });
      return null;
    }
  }

  /**
   * Run iTunes and Deezer fallbacks in parallel, returning first success.
   * @param {string} artistClean
   * @param {string} albumClean
   * @returns {Promise<{ tracks: Array, releaseId: string } | null>}
   */
  async function runFallbacks(artistClean, albumClean) {
    try {
      return await Promise.any([
        fetchItunesTracks(artistClean, albumClean),
        fetchDeezerTracks(artistClean, albumClean),
      ]);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Search MusicBrainz for release groups matching a query.
   * @param {string} query - MusicBrainz search query
   * @returns {Promise<Array>}
   */
  async function searchReleaseGroups(query) {
    const url =
      `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}` +
      `&type=album|ep&fmt=json&limit=10`;
    const resp = await mbFetch(url, { headers });
    if (!resp.ok) {
      throw new Error(`MusicBrainz search responded ${resp.status}`);
    }
    const data = await resp.json();
    return data['release-groups'] || [];
  }

  /**
   * Search MusicBrainz to find a release group or direct release ID
   * for a given artist/album combination.
   *
   * @param {string} artist - Original artist name
   * @param {string} album - Original album name
   * @param {string} artistClean - Sanitized artist name
   * @param {string} albumClean - Sanitized album name
   * @returns {Promise<{ releaseGroupId: string|null, directReleaseId: string|null }>}
   */
  async function findReleaseGroupId(artist, album, artistClean, albumClean) {
    let releaseGroupId = null;
    let directReleaseId = null;

    let groups = await searchReleaseGroups(
      `release:${albumClean} AND artist:${artistClean}`
    );
    if (!groups.length && (albumClean !== album || artistClean !== artist)) {
      groups = await searchReleaseGroups(
        `release:${album} AND artist:${artist}`
      );
    }

    if (!groups.length) {
      // Fallback: try release search instead of release-group
      const relUrl =
        `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(`${albumClean} ${artistClean}`)}` +
        `&fmt=json&limit=10`;
      const relResp = await mbFetch(relUrl, { headers });
      if (relResp.ok) {
        const relData = await relResp.json();
        const releases = relData.releases || [];
        if (releases.length) {
          releaseGroupId = releases[0]['release-group']?.id || null;
          directReleaseId = releases[0].id;
        }
      }
    } else {
      // Prefer Album over Single/EP
      const typeOrder = { Album: 0, EP: 1, Single: 2 };
      const sortedGroups = [...groups].sort((a, b) => {
        const aOrder = typeOrder[a['primary-type'] || 'Other'] ?? 3;
        const bOrder = typeOrder[b['primary-type'] || 'Other'] ?? 3;
        return aOrder - bOrder;
      });
      releaseGroupId = sortedGroups[0].id;
    }

    return { releaseGroupId, directReleaseId };
  }

  /**
   * Fetch MusicBrainz releases by direct release ID or release group ID.
   *
   * @param {string|null} directReleaseId
   * @param {string|null} releaseGroupId
   * @returns {Promise<Array|null>} Array of releases or null if none found
   */
  async function fetchReleasesData(directReleaseId, releaseGroupId) {
    if (directReleaseId) {
      const mbUrl =
        `https://musicbrainz.org/ws/2/release/${directReleaseId}` +
        `?inc=recordings&fmt=json`;
      const resp = await mbFetch(mbUrl, { headers });
      if (!resp.ok) {
        throw new Error(`MusicBrainz responded ${resp.status}`);
      }
      const data = await resp.json();
      return [data];
    }

    const mbUrl =
      `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}` +
      `&inc=recordings&fmt=json&limit=100`;
    const resp = await mbFetch(mbUrl, { headers });
    if (!resp.ok) {
      throw new Error(`MusicBrainz responded ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.releases || !data.releases.length) {
      return null;
    }
    return data.releases;
  }

  /**
   * Resolve a track list for an album.
   *
   * Strategy:
   * 1. If MBID provided, use it directly
   * 2. Otherwise search MusicBrainz by artist+album
   * 3. Fall back to release search if release-group search fails
   * 4. Fall back to iTunes/Deezer if MusicBrainz has no results
   *
   * @param {Object} params
   * @param {string} [params.id] - MusicBrainz release group ID
   * @param {string} [params.artist] - Artist name
   * @param {string} [params.album] - Album name
   * @returns {Promise<{ tracks: Array, releaseId: string } | { error: Object }>}
   */
  async function resolveTracks({ id, artist, album }) {
    if (!id && (!artist || !album)) {
      return {
        error: { status: 400, message: 'id or artist/album query required' },
      };
    }

    const artistClean = sanitizeForSearch(artist);
    const albumClean = sanitizeForSearch(album);

    let releaseGroupId = id;
    let directReleaseId = null;

    // If the ID is not a valid MBID, search for it
    if (!looksLikeMBID(releaseGroupId)) {
      if (!artist || !album) {
        return {
          error: { status: 400, message: 'artist and album are required' },
        };
      }

      const found = await findReleaseGroupId(
        artist,
        album,
        artistClean,
        albumClean
      );
      releaseGroupId = found.releaseGroupId;
      directReleaseId = found.directReleaseId;

      if (!releaseGroupId && !directReleaseId) {
        const fb = await runFallbacks(artistClean, albumClean);
        if (fb) return fb;
        return { error: { status: 404, message: 'Release group not found' } };
      }
    }

    // Fetch releases from MusicBrainz
    const releasesData = await fetchReleasesData(
      directReleaseId,
      releaseGroupId
    );
    if (!releasesData) {
      const fb = await runFallbacks(artistClean, albumClean);
      if (fb) return fb;
      return { error: { status: 404, message: 'No releases found' } };
    }

    const best = selectBestRelease(releasesData);

    if (!best || !best.media) {
      const fb = await runFallbacks(artistClean, albumClean);
      if (fb) return fb;
      return { error: { status: 404, message: 'No suitable release found' } };
    }

    const tracks = extractTracksFromMedia(best.media);

    if (!tracks.length) {
      const fb = await runFallbacks(artistClean, albumClean);
      if (fb) return fb;
      return { error: { status: 404, message: 'No tracks available' } };
    }

    return { tracks, releaseId: best.id };
  }

  return {
    resolveTracks,
    fetchItunesTracks,
    fetchDeezerTracks,
    runFallbacks,
    searchReleaseGroups,
  };
}

module.exports = {
  createTrackResolutionService,
  looksLikeMBID,
  sanitizeForSearch,
};
