/**
 * Admin Album Re-identification Routes
 * Handles MusicBrainz album search and re-identification
 */

const {
  SUSHE_USER_AGENT,
  selectBestRelease,
  extractTracksFromMedia,
} = require('../../utils/musicbrainz-helpers');

module.exports = (app, deps) => {
  const { ensureAuth, ensureAdmin } = deps;
  const logger = require('../../utils/logger');

  // Helper: Simple rate-limited fetch for MusicBrainz (1 req/sec)
  const mbFetchWithDelay = async (url, headers) => {
    const response = await fetch(url, { headers });
    // MusicBrainz rate limit: wait 1 second between requests
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return response;
  };

  // Helper: Sanitize search terms for MusicBrainz
  const sanitizeSearchTerm = (str = '') =>
    str
      .trim()
      .replace(/[\u2018\u2019'"`]/g, '')
      .replace(/[()[\]{}]/g, '')
      .replace(/[.,!?]/g, '')
      .replace(/\s{2,}/g, ' ');

  /**
   * Search for release group candidates on MusicBrainz
   * Returns a list of options for the user to choose from
   */
  app.post(
    '/api/admin/album/reidentify/search',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { artist, album, currentAlbumId } = req.body;

      if (!artist || !album) {
        return res.status(400).json({ error: 'artist and album are required' });
      }

      const headers = { 'User-Agent': SUSHE_USER_AGENT };

      try {
        logger.info('Admin searching for album candidates', {
          adminUsername: req.user.username,
          artist,
          album,
        });

        const artistClean = sanitizeSearchTerm(artist);
        const albumClean = sanitizeSearchTerm(album);

        // Search for release groups
        const searchUrl =
          `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(`release:${albumClean} AND artist:${artistClean}`)}` +
          `&fmt=json&limit=15`;

        const searchResp = await mbFetchWithDelay(searchUrl, headers);
        if (!searchResp.ok) {
          throw new Error(`MusicBrainz search responded ${searchResp.status}`);
        }

        const searchData = await searchResp.json();
        const groups = searchData['release-groups'] || [];

        if (!groups.length) {
          return res.status(404).json({
            error: 'No release groups found on MusicBrainz',
            searchTerms: { artist: artistClean, album: albumClean },
          });
        }

        // Helper to extract track count from releases
        const getTrackCountFromReleases = (releases) => {
          let trackCount = null;
          for (const rel of releases) {
            if (!rel.media || rel.media.length === 0) continue;
            // Sum track counts from all media (for multi-disc releases)
            const totalTracks = rel.media.reduce(
              (sum, m) => sum + (m['track-count'] || 0),
              0
            );
            // Prefer releases with reasonable track counts (8-20 typical for albums)
            // Skip box sets with 30+ tracks across many discs
            const isStandard = totalTracks >= 8 && totalTracks <= 20;
            if (totalTracks > 0 && (trackCount === null || isStandard)) {
              trackCount = totalTracks;
              if (isStandard) break; // Found a good standard release
            }
          }
          return trackCount;
        };

        // For each release group, get track count from releases
        const candidates = [];
        for (const group of groups.slice(0, 10)) {
          // Limit to 10 candidates
          // Include media to get track counts (track-count at release level is often null)
          const releaseUrl =
            `https://musicbrainz.org/ws/2/release?release-group=${group.id}` +
            `&inc=media&fmt=json&limit=10`;

          const relResp = await mbFetchWithDelay(releaseUrl, headers);
          let trackCount = null;

          if (relResp.ok) {
            const relData = await relResp.json();
            trackCount = getTrackCountFromReleases(relData.releases || []);
          }

          // Get cover art from Cover Art Archive
          let coverUrl = null;
          try {
            const coverResp = await fetch(
              `https://coverartarchive.org/release-group/${group.id}`,
              { headers, redirect: 'follow' }
            );
            if (coverResp.ok) {
              const coverData = await coverResp.json();
              const front = coverData.images?.find((img) => img.front);
              coverUrl = front?.thumbnails?.small || front?.image || null;
            }
          } catch {
            // Cover art not available, continue without it
          }

          const artistName =
            group['artist-credit']?.[0]?.name ||
            group['artist-credit']?.[0]?.artist?.name ||
            artist;

          candidates.push({
            id: group.id,
            title: group.title,
            artist: artistName,
            type: group['primary-type'] || 'Unknown',
            secondaryTypes: group['secondary-types'] || [],
            releaseDate: group['first-release-date'] || null,
            trackCount,
            coverUrl,
            isCurrent: group.id === currentAlbumId,
          });
        }

        // Sort: current first, then Album > EP > Single, then by date
        const typeOrder = { Album: 0, EP: 1, Single: 2 };
        candidates.sort((a, b) => {
          if (a.isCurrent && !b.isCurrent) return -1;
          if (!a.isCurrent && b.isCurrent) return 1;
          const aOrder = typeOrder[a.type] ?? 3;
          const bOrder = typeOrder[b.type] ?? 3;
          if (aOrder !== bOrder) return aOrder - bOrder;
          // Sort by date descending (newer first)
          return (b.releaseDate || '').localeCompare(a.releaseDate || '');
        });

        res.json({
          success: true,
          candidates,
          currentAlbumId,
        });
      } catch (error) {
        logger.error('Admin album search failed', {
          adminUsername: req.user.username,
          artist,
          album,
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );

  /**
   * Apply a selected release group to an album
   * Updates the album_id and fetches fresh track data
   */
  app.post(
    '/api/admin/album/reidentify',
    ensureAuth,
    ensureAdmin,
    async (req, res) => {
      const { currentAlbumId, newAlbumId, artist, album } = req.body;
      const { pool } = deps;

      if (!currentAlbumId || !newAlbumId) {
        return res
          .status(400)
          .json({ error: 'currentAlbumId and newAlbumId are required' });
      }

      const headers = { 'User-Agent': SUSHE_USER_AGENT };

      try {
        logger.info('Admin applying album re-identification', {
          adminUsername: req.user.username,
          adminId: req.user._id,
          artist,
          album,
          currentAlbumId,
          newAlbumId,
        });

        // If same as current, no change needed
        if (newAlbumId === currentAlbumId) {
          return res.json({
            success: true,
            message: 'Album already has this release group',
            albumId: newAlbumId,
            changed: false,
          });
        }

        // Fetch releases for this release group to get tracks
        const releasesUrl =
          `https://musicbrainz.org/ws/2/release?release-group=${newAlbumId}` +
          `&inc=recordings&fmt=json&limit=100`;

        const relResp = await mbFetchWithDelay(releasesUrl, headers);
        if (!relResp.ok) {
          throw new Error(`MusicBrainz releases responded ${relResp.status}`);
        }

        const relData = await relResp.json();
        const releases = relData.releases || [];

        if (!releases.length) {
          return res.status(404).json({
            error: 'No releases found for release group',
            releaseGroupId: newAlbumId,
          });
        }

        // Score releases to find best one (prefer EU/XW, Digital, Official)
        const best = selectBestRelease(releases);

        if (!best || !best.media) {
          return res.status(404).json({
            error: 'No suitable release found with tracks',
            releaseGroupId: newAlbumId,
          });
        }

        // Extract tracks
        const tracks = extractTracksFromMedia(best.media);

        if (!tracks.length) {
          return res.status(404).json({
            error: 'No tracks found in release',
            releaseGroupId: newAlbumId,
          });
        }

        // Update the albums table - match by artist+album name for reliability
        // (album_id might have already been changed by a previous operation)
        const updateResult = await pool.query(
          `UPDATE albums 
           SET album_id = $1, tracks = $2, updated_at = NOW() 
           WHERE LOWER(artist) = LOWER($3) AND LOWER(album) = LOWER($4)
           RETURNING id, artist, album, album_id`,
          [newAlbumId, JSON.stringify(tracks), artist, album]
        );

        if (updateResult.rowCount === 0) {
          return res.status(404).json({
            error: 'Album not found in database',
            artist,
            album,
          });
        }

        // Also update list_items that reference the old album_id
        // This is crucial - otherwise the JOIN between list_items and albums breaks
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

        logger.info('Admin re-identified album successfully', {
          adminUsername: req.user.username,
          artist,
          album,
          oldAlbumId: currentAlbumId,
          newAlbumId,
          trackCount: tracks.length,
          listItemsUpdated,
        });

        res.json({
          success: true,
          message: `Album updated with ${tracks.length} tracks${listItemsUpdated > 0 ? ` (${listItemsUpdated} list references updated)` : ''}`,
          albumId: newAlbumId,
          trackCount: tracks.length,
          tracks: tracks.map((t) => t.name),
          listItemsUpdated,
          changed: true,
        });
      } catch (error) {
        logger.error('Admin album re-identification failed', {
          adminUsername: req.user.username,
          artist,
          album,
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    }
  );
};
