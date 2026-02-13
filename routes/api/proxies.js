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

const { createAsyncHandler } = require('../../middleware/async-handler');
const { SUSHE_USER_AGENT } = require('../../utils/musicbrainz-helpers');
const {
  createTrackResolutionService,
} = require('../../services/track-resolution-service');

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

  const asyncHandler = createAsyncHandler(logger);
  const trackService = createTrackResolutionService({ fetch, mbFetch, logger });

  // Proxy for Deezer API to avoid CORS issues
  app.get(
    '/api/proxy/deezer',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: 'Query parameter q is required' });
      }

      const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=5`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Deezer API responded with status ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    }, 'fetching from Deezer')
  );

  // Deezer artist search proxy for direct artist image fetching
  app.get(
    '/api/proxy/deezer/artist',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
      const { q } = req.query;
      if (!q) {
        return res.status(400).json({ error: 'Query parameter q is required' });
      }

      const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=30`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Deezer API responded with status ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    }, 'fetching artist from Deezer')
  );

  // Deezer artist albums proxy - get all albums for an artist
  app.get(
    '/api/proxy/deezer/artist/:artistId/albums',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
      const { artistId } = req.params;
      if (!artistId) {
        return res.status(400).json({ error: 'Artist ID is required' });
      }

      const url = `https://api.deezer.com/artist/${artistId}/albums?limit=100`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Deezer API responded with status ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    }, 'fetching artist albums from Deezer')
  );

  // Proxy for MusicBrainz API to avoid CORS issues and handle rate limiting
  app.get(
    '/api/proxy/musicbrainz',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
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
      const response = await mbFetch(
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
    }, 'fetching from MusicBrainz')
  );

  // Proxy for Wikidata API to avoid CORS issues
  app.get(
    '/api/proxy/wikidata',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
      const { entity, property } = req.query;
      if (!entity || !property) {
        return res.status(400).json({
          error: 'Query parameters entity and property are required',
        });
      }

      const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(entity)}&property=${encodeURIComponent(property)}&format=json`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': SUSHE_USER_AGENT,
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
    }, 'fetching from Wikidata')
  );

  // Proxy for iTunes Search API (album artwork)
  // Public API, no key required, ~20 req/min rate limit.
  // Uses itunesProxyQueue to limit concurrent outbound requests and avoid 403/5xx.
  app.get(
    '/api/proxy/itunes',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
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
    }, 'fetching from iTunes')
  );

  // Image proxy endpoint for fetching external cover art
  app.get(
    '/api/proxy/image',
    ensureAuthAPI,
    cacheConfigs.images,
    asyncHandler(async (req, res) => {
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
            'User-Agent': SUSHE_USER_AGENT,
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
    }, 'proxying image')
  );

  // Fetch metadata for link previews
  app.get(
    '/api/unfurl',
    ensureAuthAPI,
    cacheConfigs.public,
    asyncHandler(async (req, res) => {
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
    }, 'unfurling URL')
  );

  // Fetch track list for a release group from MusicBrainz
  app.get(
    '/api/musicbrainz/tracks',
    ensureAuthAPI,
    cacheConfigs.static,
    asyncHandler(async (req, res) => {
      const { id, artist, album } = req.query;

      const result = await trackService.resolveTracks({ id, artist, album });

      if (result.error) {
        return res
          .status(result.error.status)
          .json({ error: result.error.message });
      }

      res.json({ tracks: result.tracks, releaseId: result.releaseId });
    }, 'fetching MusicBrainz tracks')
  );
};
