/**
 * Tidal API Routes
 *
 * Handles Tidal integration:
 * - Album search
 * - Track search
 */

/**
 * Register Tidal routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const { ensureAuthAPI, users, logger, fetch, ensureValidTidalToken } = deps;

  // Search Tidal for an album and return the ID
  app.get('/api/tidal/album', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidTidalToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Tidal auth check failed', { error: tokenResult.error });
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'tidal',
      });
    }

    const tidalAuth = tokenResult.tidalAuth;
    const { artist, album } = req.query;
    if (!artist || !album) {
      return res.status(400).json({ error: 'artist and album are required' });
    }
    logger.info('Tidal album search:', artist, '-', album);

    try {
      // Get user's country code for region-specific results
      let countryCode = req.user.tidalCountry || 'US';

      // If no country stored, try to get it from user profile
      if (!req.user.tidalCountry) {
        try {
          const profileResp = await fetch('https://openapi.tidal.com/v2/me', {
            headers: {
              Authorization: `Bearer ${tidalAuth.access_token}`,
              Accept: 'application/vnd.api+json',
            },
          });
          if (profileResp.ok) {
            const profileData = await profileResp.json();
            countryCode = profileData?.data?.attributes?.country || 'US';
            // Save for future requests
            users.update(
              { _id: req.user._id },
              { $set: { tidalCountry: countryCode, updatedAt: new Date() } },
              {},
              () => {}
            );
            req.user.tidalCountry = countryCode;
          } else {
            logger.warn('Tidal profile request failed:', profileResp.status);
            countryCode = 'US';
          }
        } catch (profileErr) {
          logger.error('Tidal profile fetch error:', profileErr);
          countryCode = 'US';
        }
      }

      const query = `${album} ${artist}`;
      const searchPath = encodeURIComponent(query).replace(/'/g, '%27');
      const params = new URLSearchParams({ countryCode });
      const url =
        `https://openapi.tidal.com/v2/searchResults/${searchPath}/relationships/albums?` +
        params.toString();
      logger.debug('Tidal search URL:', url);
      logger.debug(
        'Tidal client ID header:',
        (process.env.TIDAL_CLIENT_ID || '').slice(0, 6) + '...'
      );
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${tidalAuth.access_token}`,
          Accept: 'application/vnd.api+json',
          'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
        },
      });
      logger.debug('Tidal response status:', resp.status);
      if (!resp.ok) {
        const body = await resp.text().catch(() => '<body read failed>');
        logger.warn('Tidal API request failed:', resp.status, body);
        throw new Error(`Tidal API error ${resp.status}`);
      }
      const data = await resp.json();
      logger.debug('Tidal API response body:', JSON.stringify(data, null, 2));
      const albumId = data?.data?.[0]?.id;
      if (!albumId) {
        return res.status(404).json({ error: 'Album not found' });
      }
      logger.info('Tidal search result id:', albumId);
      res.json({ id: albumId });
    } catch (err) {
      logger.error('Tidal search error', { error: err.message });
      res.status(500).json({ error: 'Failed to search Tidal' });
    }
  });

  // Search Tidal for a track and return the ID
  app.get('/api/tidal/track', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidTidalToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Tidal auth check failed', { error: tokenResult.error });
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'tidal',
      });
    }

    const tidalAuth = tokenResult.tidalAuth;
    const { artist, album, track } = req.query;
    if (!artist || !album || !track) {
      return res
        .status(400)
        .json({ error: 'artist, album, and track are required' });
    }
    logger.info('Tidal track search:', artist, '-', album, '-', track);

    const headers = {
      Authorization: `Bearer ${tidalAuth.access_token}`,
      Accept: 'application/vnd.api+json',
      'X-Tidal-Token': process.env.TIDAL_CLIENT_ID || '',
    };

    try {
      const countryCode = req.user.tidalCountry || 'US';

      // First, find the album
      const albumQuery = `${album} ${artist}`;
      const searchPath = encodeURIComponent(albumQuery).replace(/'/g, '%27');
      const albumResp = await fetch(
        `https://openapi.tidal.com/v2/searchResults/${searchPath}/relationships/albums?countryCode=${countryCode}`,
        { headers }
      );
      if (!albumResp.ok) {
        throw new Error(`Tidal API error ${albumResp.status}`);
      }
      const albumData = await albumResp.json();
      const tidalAlbumId = albumData?.data?.[0]?.id;
      if (!tidalAlbumId) {
        return res.status(404).json({ error: 'Album not found' });
      }

      // Get album tracks
      const tracksResp = await fetch(
        `https://openapi.tidal.com/v2/albums/${tidalAlbumId}/relationships/items?countryCode=${countryCode}`,
        { headers }
      );
      if (!tracksResp.ok) {
        throw new Error(`Tidal API error ${tracksResp.status}`);
      }
      const tracksData = await tracksResp.json();
      const tracks = tracksData.data || [];

      // Try to match by track number first
      const trackNum = parseInt(track);
      if (!isNaN(trackNum) && trackNum > 0 && trackNum <= tracks.length) {
        const matchedTrack = tracks[trackNum - 1];
        logger.info('Tidal track matched by number', {
          trackId: matchedTrack.id,
        });
        return res.json({ id: matchedTrack.id });
      }

      // Extract track name from format like "3. Track Name"
      const trackNameMatch = track.match(/^\d+[.\s-]*\s*(.+)$/);
      const searchName = trackNameMatch ? trackNameMatch[1] : track;

      // For name matching, we need track details - fetch them
      const trackDetailsPromises = tracks.slice(0, 20).map(async (t) => {
        try {
          const detailResp = await fetch(
            `https://openapi.tidal.com/v2/tracks/${t.id}?countryCode=${countryCode}`,
            { headers }
          );
          if (detailResp.ok) {
            const detail = await detailResp.json();
            return { id: t.id, name: detail.data?.attributes?.title || '' };
          }
        } catch {
          // Ignore individual track fetch errors
        }
        return { id: t.id, name: '' };
      });

      const trackDetails = await Promise.all(trackDetailsPromises);
      const matchingTrack = trackDetails.find(
        (t) =>
          t.name &&
          (t.name.toLowerCase() === searchName.toLowerCase() ||
            t.name.toLowerCase().includes(searchName.toLowerCase()) ||
            searchName.toLowerCase().includes(t.name.toLowerCase()))
      );
      if (matchingTrack) {
        logger.info('Tidal track matched by name', {
          trackId: matchingTrack.id,
        });
        return res.json({ id: matchingTrack.id });
      }

      // Fallback: direct track search
      const trackSearchPath = encodeURIComponent(
        `${searchName} ${artist}`
      ).replace(/'/g, '%27');
      const fallbackResp = await fetch(
        `https://openapi.tidal.com/v2/searchResults/${trackSearchPath}/relationships/tracks?countryCode=${countryCode}&limit=1`,
        { headers }
      );
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        if (fallbackData.data && fallbackData.data.length > 0) {
          logger.info(
            'Tidal track matched by fallback search:',
            fallbackData.data[0].id
          );
          return res.json({ id: fallbackData.data[0].id });
        }
      }

      return res.status(404).json({ error: 'Track not found' });
    } catch (err) {
      logger.error('Tidal track search error', { error: err.message });
      res.status(500).json({ error: 'Failed to search Tidal' });
    }
  });
};
