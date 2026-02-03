/**
 * Proxy API Routes
 *
 * Handles proxy endpoints for external APIs to avoid CORS issues:
 * - Deezer (album search, artist search, artist albums)
 * - MusicBrainz (with rate limiting)
 * - Wikidata
 * - iTunes
 * - Image proxy (for cover art)
 * - URL unfurl
 * - MusicBrainz tracks
 */

const { normalizeForExternalApi } = require('../../utils/normalization');

/**
 * Register proxy routes
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies
 */
module.exports = (app, deps) => {
  const {
    ensureAuthAPI,
    logger,
    fetch,
    sharp,
    mbFetch,
    imageProxyQueue,
    itunesProxyQueue,
    cacheConfigs,
  } = deps;

  // Proxy for Deezer API to avoid CORS issues
  app.get(
    '/api/proxy/deezer',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { q } = req.query;
        if (!q) {
          return res
            .status(400)
            .json({ error: 'Query parameter q is required' });
        }

        const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Deezer proxy error', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch from Deezer' });
      }
    }
  );

  // Deezer artist search proxy for direct artist image fetching
  app.get(
    '/api/proxy/deezer/artist',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { q } = req.query;
        if (!q) {
          return res
            .status(400)
            .json({ error: 'Query parameter q is required' });
        }

        const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=30`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Deezer artist proxy error', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch artist from Deezer' });
      }
    }
  );

  // Deezer artist albums proxy - get all albums for an artist
  app.get(
    '/api/proxy/deezer/artist/:artistId/albums',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { artistId } = req.params;
        if (!artistId) {
          return res.status(400).json({ error: 'Artist ID is required' });
        }

        const url = `https://api.deezer.com/artist/${artistId}/albums?limit=100`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Deezer artist albums proxy error', {
          error: error.message,
        });
        res
          .status(500)
          .json({ error: 'Failed to fetch artist albums from Deezer' });
      }
    }
  );

  // Proxy for MusicBrainz API to avoid CORS issues and handle rate limiting
  app.get(
    '/api/proxy/musicbrainz',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      const startTime = Date.now();
      let response = null;

      try {
        const { endpoint, priority } = req.query;
        if (!endpoint) {
          return res
            .status(400)
            .json({ error: 'Query parameter endpoint is required' });
        }

        // Determine request priority
        // high: user-initiated searches, album lists
        // normal: artist metadata for display
        // low: background image fetching
        const requestPriority = priority || 'normal';

        // Use the MusicBrainz rate-limited fetch function with priority
        const url = `https://musicbrainz.org/ws/2/${endpoint}`;
        response = await mbFetch(
          url,
          {
            headers: {
              'User-Agent': `SuSheOnline/1.0 ( ${process.env.BASE_URL || 'https://github.com/yourusername/sushe-online'} )`,
              Accept: 'application/json',
            },
          },
          requestPriority
        );

        if (!response.ok) {
          const error = new Error(
            `MusicBrainz API responded with status ${response.status}`
          );
          error.status = response.status;
          throw error;
        }

        // Validate Content-Type before parsing
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const error = new Error(
            `Unexpected Content-Type: ${contentType}. Expected application/json`
          );
          error.status = response.status;
          error.contentType = contentType;
          throw error;
        }

        // Parse JSON with error handling
        let data;
        try {
          data = await response.json();
        } catch (parseError) {
          // Try to get response body for debugging
          let bodyPreview = '';
          try {
            const text = await response.text();
            bodyPreview = text.substring(0, 200);
          } catch (_textError) {
            // Ignore if we can't read body
          }

          const jsonError = new Error(
            `Failed to parse JSON response: ${parseError.message}`
          );
          jsonError.name = parseError.name || 'SyntaxError';
          jsonError.status = response.status;
          jsonError.contentType = contentType;
          jsonError.bodyPreview = bodyPreview;
          throw jsonError;
        }

        res.json(data);
      } catch (error) {
        const duration = Date.now() - startTime;
        const constructedUrl = req.query.endpoint
          ? `https://musicbrainz.org/ws/2/${req.query.endpoint}`
          : 'unknown';

        // Build enhanced error log
        const errorLog = {
          message: error.message || 'Unknown error',
          name: error.name,
          type: error.type,
          code: error.code, // ECONNRESET, ETIMEDOUT, etc.
          status: error.status || response?.status,
          duration_ms: duration,
          endpoint: req.query.endpoint,
          url: constructedUrl,
          retries:
            error.retries !== undefined ? error.retries : response?._retries,
        };

        // Add Content-Type and body preview for JSON parsing errors
        if (error.contentType) {
          errorLog.contentType = error.contentType;
        }
        if (error.bodyPreview) {
          errorLog.bodyPreview = error.bodyPreview;
        }

        // Include stack trace for debugging
        if (error.stack) {
          errorLog.stack = error.stack;
        }

        logger.error('MusicBrainz proxy error:', errorLog);

        // Return appropriate status code
        const statusCode =
          error.status && error.status >= 400 && error.status < 600
            ? error.status
            : 500;

        res.status(statusCode).json({
          error: 'Failed to fetch from MusicBrainz API',
          ...(process.env.NODE_ENV === 'development' && {
            details: error.message,
          }),
        });
      }
    }
  );

  // Proxy for Wikidata API to avoid CORS issues
  app.get(
    '/api/proxy/wikidata',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { entity, property } = req.query;
        if (!entity || !property) {
          return res.status(400).json({
            error: 'Query parameters entity and property are required',
          });
        }

        const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(entity)}&property=${encodeURIComponent(property)}&format=json`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(
            `Wikidata API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        logger.error('Wikidata proxy error', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch from Wikidata API' });
      }
    }
  );

  // Proxy for iTunes Search API (album artwork)
  // Public API, no key required, ~20 req/min rate limit.
  // Uses itunesProxyQueue to limit concurrent outbound requests and avoid 403/5xx.
  app.get(
    '/api/proxy/itunes',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { term, limit = 10 } = req.query;
        if (!term) {
          return res.status(400).json({
            error: 'Query parameter term is required',
          });
        }

        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&country=us&limit=${limit}`;
        const response = await itunesProxyQueue.add(async () => {
          return fetch(url, {
            headers: {
              'User-Agent': 'SuSheOnline/1.0',
              Accept: 'application/json',
            },
          });
        });

        if (!response.ok) {
          const err = new Error(
            `iTunes API responded with status ${response.status}`
          );
          err.status = response.status;
          throw err;
        }

        const data = await response.json();
        res.json(data);
      } catch (error) {
        const status =
          error.status || (error.response && error.response.status);
        const isRateLimit = status === 403 || status === 429;
        logger.error('iTunes proxy error', {
          error: error.message,
          status,
          term: req.query.term,
        });
        res
          .status(isRateLimit ? 429 : 500)
          .json({ error: 'Failed to fetch from iTunes API' });
      }
    }
  );

  // Image proxy endpoint for fetching external cover art
  app.get(
    '/api/proxy/image',
    ensureAuthAPI,
    cacheConfigs.images,
    async (req, res) => {
      try {
        const { url } = req.query;
        if (!url) {
          return res.status(400).json({ error: 'URL parameter is required' });
        }

        // Validate URL to prevent SSRF attacks
        const allowedHosts = [
          'is1-ssl.mzstatic.com',
          'is2-ssl.mzstatic.com',
          'is3-ssl.mzstatic.com',
          'is4-ssl.mzstatic.com',
          'is5-ssl.mzstatic.com',
          'e-cdns-images.dzcdn.net',
          'cdn-images.dzcdn.net',
          'coverartarchive.org',
          'archive.org',
          'commons.wikimedia.org',
          'upload.wikimedia.org',
        ];

        const urlObj = new URL(url);
        const isAllowed = allowedHosts.some(
          (host) =>
            urlObj.hostname === host || urlObj.hostname.endsWith('.' + host)
        );

        if (!isAllowed) {
          return res.status(403).json({ error: 'URL host not allowed' });
        }

        // Use request queue to limit concurrent image fetches
        const result = await imageProxyQueue.add(async () => {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)',
            },
          });

          if (!response.ok) {
            throw new Error(
              `Image fetch responded with status ${response.status}`
            );
          }

          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.startsWith('image/')) {
            throw new Error('Response is not an image');
          }

          const buffer = await response.arrayBuffer();

          // Resize image to 512x512 pixels using sharp
          // Use 'inside' fit to maintain aspect ratio without cropping
          // Convert to JPEG for consistent format and smaller file size
          const resizedBuffer = await sharp(Buffer.from(buffer))
            .resize(512, 512, {
              fit: 'inside', // Maintain aspect ratio
              withoutEnlargement: true, // Don't upscale small images
            })
            .jpeg({ quality: 100 }) // Convert to JPEG with maximum quality
            .toBuffer();

          const base64 = resizedBuffer.toString('base64');

          return {
            data: base64,
            contentType: 'image/jpeg', // Always JPEG after processing
          };
        });

        res.json(result);
      } catch (error) {
        logger.error('Image proxy error', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch image' });
      }
    }
  );

  // Fetch metadata for link previews
  app.get(
    '/api/unfurl',
    ensureAuthAPI,
    cacheConfigs.public,
    async (req, res) => {
      try {
        const { url } = req.query;
        if (!url) {
          return res.status(400).json({ error: 'url query is required' });
        }

        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (SuSheBot)' },
        });
        const html = await response.text();

        const getMeta = (name) => {
          const metaTag =
            new RegExp(
              `<meta[^>]+property=["']og:${name}["'][^>]+content=["']([^"']+)["']`,
              'i'
            ).exec(html) ||
            new RegExp(
              `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
              'i'
            ).exec(html);
          return metaTag ? metaTag[1] : '';
        };

        const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);

        res.json({
          title: getMeta('title') || (titleTag ? titleTag[1] : ''),
          description: getMeta('description'),
          image: getMeta('image'),
        });
      } catch (err) {
        logger.error('Unfurl error', { error: err.message });
        res.status(500).json({ error: 'Failed to unfurl' });
      }
    }
  );

  // Fetch track list for a release group from MusicBrainz
  app.get(
    '/api/musicbrainz/tracks',
    ensureAuthAPI,
    cacheConfigs.static,
    async (req, res) => {
      const { id, artist, album } = req.query;
      if (!id && (!artist || !album)) {
        return res
          .status(400)
          .json({ error: 'id or artist/album query required' });
      }

      const headers = { 'User-Agent': 'SuSheBot/1.0 (kvlt.example.com)' };

      try {
        let releaseGroupId = id;
        let directReleaseId = null;

        // Use centralized normalization for better external API matching
        // Strips diacritics (e.g., "Exxûl" → "Exxul") and normalizes special chars
        const sanitize = (str = '') =>
          normalizeForExternalApi(str)
            .replace(/[()[\]{}]/g, '')
            .replace(/[.,!?]/g, '');

        const artistClean = sanitize(artist);
        const albumClean = sanitize(album);

        const fetchItunesTracks = async () => {
          try {
            // artistClean and albumClean are already normalized
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
        };

        const fetchDeezerTracks = async () => {
          try {
            // artistClean and albumClean are already normalized
            const q = `${artistClean} ${albumClean}`;
            const searchResp = await fetch(
              `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`
            );
            if (!searchResp.ok) return null;
            const data = await searchResp.json();
            const albumId = data.data && data.data[0] && data.data[0].id;
            if (!albumId) return null;
            const albumResp = await fetch(
              `https://api.deezer.com/album/${albumId}`
            );
            if (!albumResp.ok) return null;
            const albumData = await albumResp.json();
            const tracks = (albumData.tracks?.data || []).map((t) => ({
              name: t.title,
              length: t.duration ? t.duration * 1000 : null,
            }));
            return tracks.length
              ? { tracks, releaseId: `deezer:${albumId}` }
              : null;
          } catch (err) {
            logger.error('Deezer fallback error', { error: err.message });
            return null;
          }
        };

        const runFallbacks = async () => {
          // Race both services and return first successful result
          try {
            return await Promise.any([
              fetchItunesTracks(),
              fetchDeezerTracks(),
            ]);
          } catch (_err) {
            // All fallbacks failed
            return null;
          }
        };

        const looksLikeMBID = (val) =>
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
            val || ''
          );

        if (!looksLikeMBID(releaseGroupId)) {
          if (!artist || !album) {
            return res
              .status(400)
              .json({ error: 'artist and album are required' });
          }

          const searchReleaseGroups = async (query) => {
            const url =
              `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}` +
              `&type=album|ep&fmt=json&limit=10`;
            const resp = await mbFetch(url, { headers });
            if (!resp.ok) {
              throw new Error(`MusicBrainz search responded ${resp.status}`);
            }
            const data = await resp.json();
            return data['release-groups'] || [];
          };

          let groups = await searchReleaseGroups(
            `release:${albumClean} AND artist:${artistClean}`
          );
          if (
            !groups.length &&
            (albumClean !== album || artistClean !== artist)
          ) {
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
            // Prefer Album over Single/EP - Singles often have fewer tracks
            // Priority: Album > EP > Single > other
            const typeOrder = { Album: 0, EP: 1, Single: 2 };
            const sortedGroups = [...groups].sort((a, b) => {
              const aType = a['primary-type'] || 'Other';
              const bType = b['primary-type'] || 'Other';
              const aOrder = typeOrder[aType] ?? 3;
              const bOrder = typeOrder[bType] ?? 3;
              return aOrder - bOrder;
            });
            releaseGroupId = sortedGroups[0].id;
          }

          if (!releaseGroupId && !directReleaseId) {
            const fb = await runFallbacks();
            if (fb) return res.json(fb);
            return res.status(404).json({ error: 'Release group not found' });
          }
        }

        let releasesData;
        if (directReleaseId) {
          const mbUrl =
            `https://musicbrainz.org/ws/2/release/${directReleaseId}` +
            `?inc=recordings&fmt=json`;
          const resp = await mbFetch(mbUrl, { headers });
          if (!resp.ok) {
            throw new Error(`MusicBrainz responded ${resp.status}`);
          }
          const data = await resp.json();
          releasesData = [data];
        } else {
          const mbUrl =
            `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}` +
            `&inc=recordings&fmt=json&limit=100`;
          const resp = await mbFetch(mbUrl, { headers });
          if (!resp.ok) {
            throw new Error(`MusicBrainz responded ${resp.status}`);
          }
          const data = await resp.json();
          if (!data.releases || !data.releases.length) {
            const fb = await runFallbacks();
            if (fb) return res.json(fb);
            return res.status(404).json({ error: 'No releases found' });
          }
          releasesData = data.releases;
        }

        const EU = new Set([
          'AT',
          'BE',
          'BG',
          'HR',
          'CY',
          'CZ',
          'DK',
          'EE',
          'FI',
          'FR',
          'DE',
          'GR',
          'HU',
          'IE',
          'IT',
          'LV',
          'LT',
          'LU',
          'MT',
          'NL',
          'PL',
          'PT',
          'RO',
          'SK',
          'SI',
          'ES',
          'SE',
          'GB',
          'XE',
        ]);

        const score = (rel) => {
          if (rel.status !== 'Official' || rel.status === 'Pseudo-Release')
            return -1;
          let s = 0;
          if (EU.has(rel.country)) s += 20;
          if (rel.country === 'XW') s += 10;
          if (
            (rel.media || []).some((m) => (m.format || '').includes('Digital'))
          )
            s += 15;
          const date = new Date(rel.date || '1900-01-01');
          if (!isNaN(date)) s += date.getTime() / 1e10; // minor weight
          return s;
        };

        const best = releasesData
          .map((r) => ({ ...r, _score: score(r) }))
          .filter((r) => r._score >= 0)
          .sort((a, b) => b._score - a._score)[0];

        if (!best || !best.media) {
          const fb = await runFallbacks();
          if (fb) return res.json(fb);
          return res.status(404).json({ error: 'No suitable release found' });
        }

        const tracks = [];
        for (const medium of best.media) {
          if (Array.isArray(medium.tracks)) {
            medium.tracks.forEach((t) => {
              const title = t.title || (t.recording && t.recording.title) || '';
              // Extract length: prefer track-specific length, fallback to recording length (median)
              const length =
                t.length || (t.recording && t.recording.length) || null;
              tracks.push({ name: title, length });
            });
          }
        }

        if (!tracks.length) {
          const fb = await runFallbacks();
          if (fb) return res.json(fb);
          return res.status(404).json({ error: 'No tracks available' });
        }

        res.json({ tracks, releaseId: best.id });
      } catch (err) {
        logger.error('MusicBrainz tracks error', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch tracks' });
      }
    }
  );
};
