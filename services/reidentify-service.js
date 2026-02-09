/**
 * Album Re-identification Service
 *
 * Business logic for MusicBrainz album search and re-identification:
 * - Search MusicBrainz for release group candidates
 * - Apply a selected release group: update album_id, tracks, and list_items
 *
 * Follows dependency injection pattern for testability.
 */

const defaultLogger = require('../utils/logger');
const { TransactionAbort } = require('../db/transaction');
const {
  SUSHE_USER_AGENT,
  selectBestRelease,
  extractTracksFromMedia,
} = require('../utils/musicbrainz-helpers');

/**
 * Create reidentify service with injected dependencies
 * @param {Object} deps
 * @param {Object} deps.pool - PostgreSQL pool
 * @param {Object} deps.logger - Logger instance
 * @param {Function} deps.fetchFn - Fetch function (for testability)
 */
function createReidentifyService(deps = {}) {
  const pool = deps.pool;
  const logger = deps.logger || defaultLogger;
  const fetchFn = deps.fetchFn || fetch;

  const MB_HEADERS = { 'User-Agent': SUSHE_USER_AGENT };

  /** Rate-limited fetch for MusicBrainz (1 req/sec) */
  async function mbFetchWithDelay(url) {
    const response = await fetchFn(url, { headers: MB_HEADERS });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return response;
  }

  /** Sanitize search terms for MusicBrainz */
  function sanitizeSearchTerm(str = '') {
    return str
      .trim()
      .replace(/[\u2018\u2019'"`]/g, '')
      .replace(/[()[\]{}]/g, '')
      .replace(/[.,!?]/g, '')
      .replace(/\s{2,}/g, ' ');
  }

  /** Extract track count from a list of releases */
  function getTrackCountFromReleases(releases) {
    let trackCount = null;
    for (const rel of releases) {
      if (!rel.media || rel.media.length === 0) continue;
      const totalTracks = rel.media.reduce(
        (sum, m) => sum + (m['track-count'] || 0),
        0
      );
      const isStandard = totalTracks >= 8 && totalTracks <= 20;
      if (totalTracks > 0 && (trackCount === null || isStandard)) {
        trackCount = totalTracks;
        if (isStandard) break;
      }
    }
    return trackCount;
  }

  /** Fetch cover art URL from Cover Art Archive */
  async function fetchCoverUrl(releaseGroupId) {
    try {
      const coverResp = await fetchFn(
        `https://coverartarchive.org/release-group/${releaseGroupId}`,
        { headers: MB_HEADERS, redirect: 'follow' }
      );
      if (coverResp.ok) {
        const coverData = await coverResp.json();
        const front = coverData.images?.find((img) => img.front);
        return front?.thumbnails?.small || front?.image || null;
      }
    } catch {
      // Cover art not available
    }
    return null;
  }

  /** Build a candidate object from a MusicBrainz release group */
  async function buildCandidate(group, fallbackArtist, currentAlbumId) {
    const releaseUrl =
      `https://musicbrainz.org/ws/2/release?release-group=${group.id}` +
      `&inc=media&fmt=json&limit=10`;

    const relResp = await mbFetchWithDelay(releaseUrl);
    let trackCount = null;

    if (relResp.ok) {
      const relData = await relResp.json();
      trackCount = getTrackCountFromReleases(relData.releases || []);
    }

    const coverUrl = await fetchCoverUrl(group.id);

    const artistName =
      group['artist-credit']?.[0]?.name ||
      group['artist-credit']?.[0]?.artist?.name ||
      fallbackArtist;

    return {
      id: group.id,
      title: group.title,
      artist: artistName,
      type: group['primary-type'] || 'Unknown',
      secondaryTypes: group['secondary-types'] || [],
      releaseDate: group['first-release-date'] || null,
      trackCount,
      coverUrl,
      isCurrent: group.id === currentAlbumId,
    };
  }

  /**
   * Search MusicBrainz for release group candidates.
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @param {string} currentAlbumId - Current album_id for marking
   * @returns {Promise<Object>} { candidates, currentAlbumId }
   * @throws {TransactionAbort} on validation failure or not found
   */
  async function searchCandidates(artist, album, currentAlbumId) {
    if (!artist || !album) {
      throw new TransactionAbort(400, {
        error: 'artist and album are required',
      });
    }

    const artistClean = sanitizeSearchTerm(artist);
    const albumClean = sanitizeSearchTerm(album);

    const searchUrl =
      `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(`release:${albumClean} AND artist:${artistClean}`)}` +
      `&fmt=json&limit=15`;

    const searchResp = await mbFetchWithDelay(searchUrl);
    if (!searchResp.ok) {
      throw new Error(`MusicBrainz search responded ${searchResp.status}`);
    }

    const searchData = await searchResp.json();
    const groups = searchData['release-groups'] || [];

    if (!groups.length) {
      throw new TransactionAbort(404, {
        error: 'No release groups found on MusicBrainz',
        searchTerms: { artist: artistClean, album: albumClean },
      });
    }

    const candidates = [];
    for (const group of groups.slice(0, 10)) {
      const candidate = await buildCandidate(group, artist, currentAlbumId);
      candidates.push(candidate);
    }

    // Sort: current first, then Album > EP > Single, then by date
    const typeOrder = { Album: 0, EP: 1, Single: 2 };
    candidates.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      const aOrder = typeOrder[a.type] ?? 3;
      const bOrder = typeOrder[b.type] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (b.releaseDate || '').localeCompare(a.releaseDate || '');
    });

    return { candidates, currentAlbumId };
  }

  /**
   * Apply a selected release group to an album.
   * Updates album_id, tracks, and cascades to list_items.
   * @param {Object} params
   * @param {string} params.currentAlbumId - Current album_id
   * @param {string} params.newAlbumId - New release group ID
   * @param {string} params.artist - Artist name (for DB lookup)
   * @param {string} params.album - Album name (for DB lookup)
   * @returns {Promise<Object>} Result with tracks, listItemsUpdated, etc.
   * @throws {TransactionAbort} on validation failure or not found
   */
  async function applyReidentification({
    currentAlbumId,
    newAlbumId,
    artist,
    album,
  }) {
    if (!currentAlbumId || !newAlbumId) {
      throw new TransactionAbort(400, {
        error: 'currentAlbumId and newAlbumId are required',
      });
    }

    // No change needed
    if (newAlbumId === currentAlbumId) {
      return {
        albumId: newAlbumId,
        changed: false,
        message: 'Album already has this release group',
      };
    }

    // Fetch releases for this release group to get tracks
    const releasesUrl =
      `https://musicbrainz.org/ws/2/release?release-group=${newAlbumId}` +
      `&inc=recordings&fmt=json&limit=100`;

    const relResp = await mbFetchWithDelay(releasesUrl);
    if (!relResp.ok) {
      throw new Error(`MusicBrainz releases responded ${relResp.status}`);
    }

    const relData = await relResp.json();
    const releases = relData.releases || [];

    if (!releases.length) {
      throw new TransactionAbort(404, {
        error: 'No releases found for release group',
        releaseGroupId: newAlbumId,
      });
    }

    const best = selectBestRelease(releases);

    if (!best || !best.media) {
      throw new TransactionAbort(404, {
        error: 'No suitable release found with tracks',
        releaseGroupId: newAlbumId,
      });
    }

    const tracks = extractTracksFromMedia(best.media);

    if (!tracks.length) {
      throw new TransactionAbort(404, {
        error: 'No tracks found in release',
        releaseGroupId: newAlbumId,
      });
    }

    // Update the albums table
    const updateResult = await pool.query(
      `UPDATE albums 
       SET album_id = $1, tracks = $2, updated_at = NOW() 
       WHERE LOWER(artist) = LOWER($3) AND LOWER(album) = LOWER($4)
       RETURNING id, artist, album, album_id`,
      [newAlbumId, JSON.stringify(tracks), artist, album]
    );

    if (updateResult.rowCount === 0) {
      throw new TransactionAbort(404, {
        error: 'Album not found in database',
        artist,
        album,
      });
    }

    // Cascade album_id change to list_items
    let listItemsUpdated = 0;
    if (currentAlbumId && currentAlbumId !== newAlbumId) {
      const listItemsResult = await pool.query(
        `UPDATE list_items 
         SET album_id = $1, updated_at = NOW() 
         WHERE album_id = $2`,
        [newAlbumId, currentAlbumId]
      );
      listItemsUpdated = listItemsResult.rowCount;
    }

    logger.info('Album re-identified successfully', {
      artist,
      album,
      oldAlbumId: currentAlbumId,
      newAlbumId,
      trackCount: tracks.length,
      listItemsUpdated,
    });

    return {
      albumId: newAlbumId,
      trackCount: tracks.length,
      tracks: tracks.map((t) => t.name),
      listItemsUpdated,
      changed: true,
      message: `Album updated with ${tracks.length} tracks${listItemsUpdated > 0 ? ` (${listItemsUpdated} list references updated)` : ''}`,
    };
  }

  return { searchCandidates, applyReidentification };
}

module.exports = { createReidentifyService };
