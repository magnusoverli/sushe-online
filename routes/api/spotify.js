/**
 * Spotify API Routes
 *
 * Handles Spotify integration:
 * - Album/track search
 * - Playback control
 * - Device management
 * - Token management
 */

/**
 * Register Spotify routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    users,
    logger,
    fetch,
    ensureValidSpotifyToken,
    requireSpotifyAuth,
  } = deps;

  // Helper to handle Spotify player API errors (Premium-required endpoints)
  function handleSpotifyPlayerError(resp, errorData, res, action) {
    // 403 = Premium required for playback control
    if (resp.status === 403) {
      logger.debug('Spotify Premium required', { action });
      return res.status(403).json({
        error: 'Spotify Premium required for playback control',
        code: 'PREMIUM_REQUIRED',
        service: 'spotify',
      });
    }

    // 401 = Token invalid/expired
    if (resp.status === 401) {
      return res.status(401).json({
        error: 'Spotify authentication expired',
        code: 'TOKEN_EXPIRED',
        service: 'spotify',
      });
    }

    // 404 = No active device
    if (resp.status === 404) {
      return res.status(404).json({
        error: 'No active Spotify device found',
        code: 'NO_DEVICE',
        service: 'spotify',
      });
    }

    // Other errors
    const message =
      errorData?.error?.message || `Spotify API error ${resp.status}`;
    logger.error(`Spotify ${action} error:`, resp.status, message);
    return res
      .status(resp.status >= 400 && resp.status < 500 ? resp.status : 502)
      .json({
        error: message,
        code: 'SPOTIFY_ERROR',
        service: 'spotify',
      });
  }

  // Search Spotify for an album and return the ID
  app.get('/api/spotify/album', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify auth check failed', { error: tokenResult.error });
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const spotifyAuth = tokenResult.spotifyAuth;
    const { artist, album } = req.query;
    if (!artist || !album) {
      return res.status(400).json({ error: 'artist and album are required' });
    }
    logger.info('Spotify album search', { artist, album });

    try {
      const query = `album:${album} artist:${artist}`;
      const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=1`;
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${spotifyAuth.access_token}`,
        },
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        const errorMsg =
          errorData?.error?.message || `Spotify API error ${resp.status}`;
        logger.error('Spotify search API error:', {
          status: resp.status,
          statusText: resp.statusText,
          error: errorMsg,
          artist,
          album,
        });

        if (resp.status === 401) {
          return res.status(401).json({
            error: 'Spotify authentication expired',
            code: 'TOKEN_EXPIRED',
            service: 'spotify',
          });
        }
        return res
          .status(resp.status >= 400 && resp.status < 500 ? resp.status : 502)
          .json({
            error: errorMsg,
            code: 'SPOTIFY_ERROR',
            service: 'spotify',
          });
      }
      const data = await resp.json();
      if (!data.albums || !data.albums.items.length) {
        logger.info('Album not found on Spotify', { artist, album });
        return res.status(404).json({ error: 'Album not found' });
      }
      const albumId = data.albums.items[0].id;
      logger.info('Spotify search result', { albumId, artist, album });
      res.json({ id: albumId });
    } catch (err) {
      logger.error('Spotify search error:', {
        error: err.message,
        stack: err.stack,
        artist,
        album,
      });
      res.status(500).json({ error: 'Failed to search Spotify' });
    }
  });

  // Get Spotify access token for Web Playback SDK
  app.get(
    '/api/spotify/token',
    ensureAuthAPI,
    requireSpotifyAuth,
    async (req, res) => {
      res.json({ access_token: req.spotifyAuth.access_token });
    }
  );

  // Get available Spotify Connect devices
  app.get(
    '/api/spotify/devices',
    ensureAuthAPI,
    requireSpotifyAuth,
    async (req, res) => {
      const spotifyAuth = req.spotifyAuth;

      try {
        const resp = await fetch(
          'https://api.spotify.com/v1/me/player/devices',
          {
            headers: {
              Authorization: `Bearer ${spotifyAuth.access_token}`,
            },
          }
        );

        if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}));
          return handleSpotifyPlayerError(resp, errorData, res, 'devices');
        }

        const data = await resp.json();

        logger.info('Spotify API returned devices (raw):', {
          count: data.devices?.length || 0,
          devices: (data.devices || []).map((d) => ({
            name: d.name,
            id: d.id ? `${d.id.substring(0, 8)}...` : null,
            type: d.type,
            is_restricted: d.is_restricted,
            is_active: d.is_active,
          })),
        });

        // Filter out restricted devices
        const usableDevices = (data.devices || []).filter(
          (d) => !d.is_restricted && d.id
        );

        const filteredOut = (data.devices || []).filter(
          (d) => d.is_restricted || !d.id
        );
        if (filteredOut.length > 0) {
          logger.info('Devices filtered out:', {
            devices: filteredOut.map((d) => ({
              name: d.name,
              reason: !d.id ? 'no device ID' : 'is_restricted',
            })),
          });
        }

        logger.info(
          'Spotify devices found:',
          usableDevices.map((d) => d.name)
        );
        res.json({ devices: usableDevices });
      } catch (err) {
        logger.error('Spotify devices error', { error: err.message });
        res.status(500).json({ error: 'Failed to get Spotify devices' });
      }
    }
  );

  // Play an album on a specific Spotify Connect device
  app.put(
    '/api/spotify/play',
    ensureAuthAPI,
    requireSpotifyAuth,
    async (req, res) => {
      const spotifyAuth = req.spotifyAuth;
      const { albumId, deviceId } = req.body;

      if (!albumId) {
        return res.status(400).json({ error: 'albumId is required' });
      }

      try {
        const url = deviceId
          ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
          : 'https://api.spotify.com/v1/me/player/play';

        const resp = await fetch(url, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${spotifyAuth.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            context_uri: `spotify:album:${albumId}`,
          }),
        });

        if (resp.status === 204 || resp.status === 202) {
          logger.info(
            'Spotify playback started on device:',
            deviceId || 'active'
          );
          return res.json({ success: true });
        }

        if (resp.status === 404) {
          return res.status(404).json({
            error:
              'No active device found. Please open Spotify on a device first.',
            code: 'NO_DEVICE',
            service: 'spotify',
          });
        }

        if (resp.status === 403) {
          return res.status(403).json({
            error: 'Spotify Premium is required for playback control.',
            code: 'PREMIUM_REQUIRED',
            service: 'spotify',
          });
        }

        const errorData = await resp.json().catch(() => ({}));
        return handleSpotifyPlayerError(resp, errorData, res, 'play');
      } catch (err) {
        logger.error('Spotify play error', { error: err.message });
        res.status(500).json({ error: 'Failed to start playback' });
      }
    }
  );

  // Get current playback state
  app.get(
    '/api/spotify/playback',
    ensureAuthAPI,
    requireSpotifyAuth,
    async (req, res) => {
      try {
        const resp = await fetch('https://api.spotify.com/v1/me/player', {
          headers: {
            Authorization: `Bearer ${req.spotifyAuth.access_token}`,
          },
        });

        if (resp.status === 204) {
          return res.json({ is_playing: false, device: null, item: null });
        }

        if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}));
          return handleSpotifyPlayerError(
            resp,
            errorData,
            res,
            'playback state'
          );
        }

        const data = await resp.json();
        res.json(data);
      } catch (err) {
        logger.error('Spotify playback state error', { error: err.message });
        res.status(500).json({ error: 'Failed to get playback state' });
      }
    }
  );

  // Pause playback
  app.put(
    '/api/spotify/pause',
    ensureAuthAPI,
    requireSpotifyAuth,
    async (req, res) => {
      try {
        const resp = await fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${req.spotifyAuth.access_token}`,
          },
        });

        if (resp.ok || resp.status === 204) {
          return res.json({ success: true });
        }

        const errorData = await resp.json().catch(() => ({}));
        return handleSpotifyPlayerError(resp, errorData, res, 'pause');
      } catch (err) {
        logger.error('Spotify pause error', { error: err.message });
        res.status(500).json({ error: 'Failed to pause playback' });
      }
    }
  );

  // Resume playback
  app.put('/api/spotify/resume', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/play', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
        },
      });

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, 'resume');
    } catch (err) {
      logger.error('Spotify resume error', { error: err.message });
      res.status(500).json({ error: 'Failed to resume playback' });
    }
  });

  // Skip to previous track
  app.post('/api/spotify/previous', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch(
        'https://api.spotify.com/v1/me/player/previous',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          },
        }
      );

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, 'previous');
    } catch (err) {
      logger.error('Spotify previous track error', { error: err.message });
      res.status(500).json({ error: 'Failed to skip to previous' });
    }
  });

  // Skip to next track
  app.post('/api/spotify/next', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
        },
      });

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, 'next');
    } catch (err) {
      logger.error('Spotify next track error', { error: err.message });
      res.status(500).json({ error: 'Failed to skip to next' });
    }
  });

  // Seek to position
  app.put('/api/spotify/seek', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const { position_ms } = req.body;
    if (position_ms === undefined || isNaN(parseInt(position_ms))) {
      return res.status(400).json({ error: 'position_ms is required' });
    }

    try {
      const resp = await fetch(
        `https://api.spotify.com/v1/me/player/seek?position_ms=${parseInt(position_ms)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          },
        }
      );

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, 'seek');
    } catch (err) {
      logger.error('Spotify seek error', { error: err.message });
      res.status(500).json({ error: 'Failed to seek' });
    }
  });

  // Set volume
  app.put('/api/spotify/volume', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const { volume_percent } = req.body;
    if (volume_percent === undefined || isNaN(parseInt(volume_percent))) {
      return res.status(400).json({ error: 'volume_percent is required' });
    }

    const vol = Math.max(0, Math.min(100, parseInt(volume_percent)));

    try {
      const resp = await fetch(
        `https://api.spotify.com/v1/me/player/volume?volume_percent=${vol}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          },
        }
      );

      if (resp.ok || resp.status === 204) {
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, 'volume');
    } catch (err) {
      logger.error('Spotify volume error', { error: err.message });
      res.status(500).json({ error: 'Failed to set volume' });
    }
  });

  // Transfer playback to a device
  app.put('/api/spotify/transfer', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const { device_id, play } = req.body;
    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenResult.spotifyAuth.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_ids: [device_id],
          play: play === true,
        }),
      });

      if (resp.ok || resp.status === 204) {
        logger.info('Spotify playback transferred', { deviceId: device_id });
        return res.json({ success: true });
      }

      const errorData = await resp.json().catch(() => ({}));
      return handleSpotifyPlayerError(resp, errorData, res, 'transfer');
    } catch (err) {
      logger.error('Spotify transfer error', { error: err.message });
      res.status(500).json({ error: 'Failed to transfer playback' });
    }
  });

  // Search Spotify for a track and return the ID
  app.get('/api/spotify/track', ensureAuthAPI, async (req, res) => {
    const tokenResult = await ensureValidSpotifyToken(req.user, users);
    if (!tokenResult.success) {
      logger.warn('Spotify auth check failed', { error: tokenResult.error });
      return res.status(401).json({
        error: tokenResult.message,
        code: tokenResult.error,
        service: 'spotify',
      });
    }

    const spotifyAuth = tokenResult.spotifyAuth;
    const { artist, album, track } = req.query;
    if (!artist || !album || !track) {
      return res
        .status(400)
        .json({ error: 'artist, album, and track are required' });
    }
    logger.info('Spotify track search:', {
      artist,
      album,
      track,
      user_scopes: spotifyAuth.scope,
      scope_count: spotifyAuth.scope?.split(' ').length || 0,
    });

    const headers = {
      Authorization: `Bearer ${spotifyAuth.access_token}`,
    };

    try {
      // First, find the album
      const albumQuery = `album:${album} artist:${artist}`;
      const albumResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(albumQuery)}&type=album&limit=1`,
        { headers }
      );
      if (!albumResp.ok) {
        const errorText = await albumResp.text();
        logger.error('Spotify album search failed:', {
          status: albumResp.status,
          statusText: albumResp.statusText,
          error: errorText,
          query: albumQuery,
        });

        if (albumResp.status === 403) {
          return res.status(403).json({
            error:
              'Spotify access denied. You may need to reconnect your Spotify account.',
            code: 'SPOTIFY_FORBIDDEN',
            service: 'spotify',
            action: 'reauth',
          });
        }

        if (albumResp.status === 401) {
          return res.status(401).json({
            error: 'Spotify authentication expired',
            code: 'TOKEN_EXPIRED',
            service: 'spotify',
          });
        }

        if (albumResp.status === 429) {
          return res.status(429).json({
            error: 'Spotify rate limit exceeded. Please try again later.',
            code: 'RATE_LIMITED',
            service: 'spotify',
          });
        }

        return res.status(502).json({
          error: `Spotify API error: ${albumResp.statusText}`,
          code: 'SPOTIFY_API_ERROR',
          service: 'spotify',
        });
      }
      const albumData = await albumResp.json();
      if (!albumData.albums || !albumData.albums.items.length) {
        logger.info('Album not found on Spotify', { artist, album });
        return res.status(404).json({ error: 'Album not found' });
      }
      const spotifyAlbumId = albumData.albums.items[0].id;

      // Get album tracks
      const tracksResp = await fetch(
        `https://api.spotify.com/v1/albums/${spotifyAlbumId}/tracks?limit=50`,
        { headers }
      );
      if (!tracksResp.ok) {
        return res.status(502).json({
          error: `Spotify API error: ${tracksResp.statusText}`,
          code: 'SPOTIFY_API_ERROR',
          service: 'spotify',
        });
      }
      const tracksData = await tracksResp.json();
      const tracks = tracksData.items;

      if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        return res.status(404).json({ error: 'Album has no tracks' });
      }

      // Try to match by track number first
      const trackNum = parseInt(track);
      if (!isNaN(trackNum) && trackNum > 0 && trackNum <= tracks.length) {
        const matchedTrack = tracks[trackNum - 1];
        logger.info('Spotify track matched by number:', {
          trackId: matchedTrack.id,
          trackName: matchedTrack.name,
        });
        return res.json({ id: matchedTrack.id });
      }

      // Extract track name from format like "3. Track Name"
      const trackNameMatch = track.match(/^\d+[.\s-]*\s*(.+)$/);
      const searchName = trackNameMatch ? trackNameMatch[1] : track;

      // Try to match by track name
      const matchingTrack = tracks.find(
        (t) =>
          t.name.toLowerCase() === searchName.toLowerCase() ||
          t.name.toLowerCase().includes(searchName.toLowerCase()) ||
          searchName.toLowerCase().includes(t.name.toLowerCase())
      );
      if (matchingTrack) {
        logger.info('Spotify track matched by name:', {
          trackId: matchingTrack.id,
          trackName: matchingTrack.name,
        });
        return res.json({ id: matchingTrack.id });
      }

      // Fallback: general track search
      const fallbackQuery = `track:${searchName} album:${album} artist:${artist}`;
      const fallbackResp = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(fallbackQuery)}&type=track&limit=1`,
        { headers }
      );
      if (fallbackResp.ok) {
        const fallbackData = await fallbackResp.json();
        if (fallbackData.tracks.items.length > 0) {
          logger.info('Spotify track matched by fallback search:', {
            trackId: fallbackData.tracks.items[0].id,
            trackName: fallbackData.tracks.items[0].name,
          });
          return res.json({ id: fallbackData.tracks.items[0].id });
        }
      }

      logger.info('Track not found on Spotify:', { artist, album, track });
      return res.status(404).json({ error: 'Track not found' });
    } catch (err) {
      logger.error('Spotify track search error:', {
        error: err.message,
        stack: err.stack,
        artist,
        album,
        track,
      });
      res.status(500).json({ error: 'Failed to search Spotify' });
    }
  });
};
