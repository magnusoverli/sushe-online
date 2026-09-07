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
const { validateUnfurlTarget } = require('../../utils/unfurl-url');
const {
  createPublicProviderRequests,
} = require('../../services/public-provider-requests');
const {
  createTrackResolutionService,
} = require('../../services/track-resolution-service');

const DISCOGRAPHY_CACHE_POLICY = {
  ttlMs: 10 * 60 * 1000,
  staleTtlMs: 24 * 60 * 60 * 1000,
};

function discographyCachePolicy(url) {
  const { pathname, searchParams: params } = new URL(url);
  if (pathname !== '/ws/2/release-group' || params.get('fmt') !== 'json')
    return;
  const allowed = ['query', 'artist', 'type', 'inc', 'fmt', 'limit', 'offset'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return;
  }
  if (params.has('limit') && !/^(?:[1-9]\d?|100)$/.test(params.get('limit')))
    return;
  if (params.has('offset') && !/^\d+$/.test(params.get('offset'))) return;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (params.has('query')) {
    // Deliberately recognize only the indexed discography query, not arbitrary Lucene.
    if (params.has('artist') || params.has('type') || params.has('inc')) return;
    if (
      !new RegExp(
        `^arid:${uuid} AND \\(primarytype:album OR primarytype:ep\\)$`,
        'i'
      ).test(params.get('query'))
    )
      return;
  } else {
    if (!new RegExp(`^${uuid}$`, 'i').test(params.get('artist') || '')) return;
    if (
      params.has('type') &&
      !/^(album|ep|album\|ep)$/i.test(params.get('type'))
    )
      return;
    if (params.has('inc') && params.get('inc') !== 'artist-credits') return;
  }
  return DISCOGRAPHY_CACHE_POLICY;
}

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
  const providerRequests = createPublicProviderRequests(
    deps.providerRequestOptions
  );

  async function publicJson(req, res, url, load, policy) {
    try {
      const data = await providerRequests.get(req, res, url, load, policy);
      if (!res.destroyed) res.json(data);
    } catch (err) {
      if (res.destroyed || req.aborted) return;
      if (err.name === 'TimeoutError') {
        res.status(504).json({ error: 'Provider request timed out' });
        return;
      }
      throw err;
    }
  }

  /**
   * Report a failure that came from the upstream service with that service's
   * own status, instead of the flat 500 every thrown error would otherwise
   * produce. A 503 from MusicBrainz is not the same event as a defect in this
   * server, and the client cannot tell them apart once both are 500.
   *
   * Only 4xx/5xx are passed through; anything else — including an error with no
   * usable status — is re-thrown so asyncHandler logs it and answers 500. This
   * deliberately stays local to the proxy routes: asyncHandler is shared by
   * every route in the app, and several unrelated modules put a `status` on
   * their errors, so honouring it globally would silently change status codes
   * far outside this file.
   *
   * @param {(req: any, res: any) => Promise<void>} fn - The proxy handler.
   * @param {string} serviceName - Upstream service name, for the log line.
   * @returns {(req: any, res: any) => Promise<void>}
   */
  function withUpstreamStatus(fn, serviceName) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        const status = Number(err?.status);
        const isUpstreamStatus =
          Number.isInteger(status) && status >= 400 && status <= 599;

        // These are collected at the throw site and are the only record of why
        // a response was unusable, so log them whether or not the status is one
        // we can hand back. asyncHandler logs neither.
        if (isUpstreamStatus || err?.contentType || err?.bodyPreview) {
          logger.warn(`Upstream ${serviceName} request failed`, {
            status: Number.isInteger(status) ? status : undefined,
            error: err.message,
            contentType: err.contentType,
            bodyPreview: err.bodyPreview,
            userId: req.user?._id,
          });
        }

        // A malformed body arrives with the upstream's own 200, which says
        // nothing useful to a client — let those fall through to a 500.
        if (!isUpstreamStatus) {
          throw err;
        }

        if (!res.headersSent) {
          res.status(status).json({
            error: `${serviceName} request failed`,
            upstreamStatus: status,
          });
        }
      }
    };
  }

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
    asyncHandler(async (req, res) => {
      const { q } = req.query;
      if (typeof q !== 'string' || !q.trim()) {
        return res.status(400).json({ error: 'Query parameter q is required' });
      }

      const url = `https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=30`;
      await publicJson(req, res, url, async (signal) => {
        const response = await fetch(url, { signal });

        if (!response.ok) {
          throw new Error(
            `Deezer API responded with status ${response.status}`
          );
        }

        const data = await response.json();
        return data;
      });
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
    asyncHandler(
      withUpstreamStatus(async (req, res) => {
        const { endpoint, priority } = req.query;
        if (
          typeof endpoint !== 'string' ||
          !endpoint.trim() ||
          Array.from(endpoint).some(
            (char) => char < ' ' || char === '\u007f'
          ) ||
          endpoint.startsWith('/') ||
          endpoint.includes('#') ||
          endpoint.includes('\\') ||
          endpoint
            .split('?')[0]
            .split('/')
            .some((part) => /^(\.|%2e){1,2}$/i.test(part))
        ) {
          return res
            .status(400)
            .json({ error: 'Query parameter endpoint is required' });
        }

        // Determine request priority
        // high: user-initiated searches, album lists
        // normal: artist metadata for display
        // low: background image fetching
        const requestPriority = ['high', 'normal', 'low'].includes(priority)
          ? priority
          : 'normal';

        // Coalesced callers retain the first caller's scheduling priority;
        // mbFetch currently exposes no queued-request promotion handle.
        // Use the MusicBrainz rate-limited fetch function with priority
        const url = `https://musicbrainz.org/ws/2/${endpoint}`;
        if (!new URL(url).pathname.startsWith('/ws/2/')) {
          return res
            .status(400)
            .json({ error: 'Invalid MusicBrainz endpoint' });
        }
        const policy = discographyCachePolicy(url);
        await publicJson(
          req,
          res,
          url,
          async (signal, { background }) => {
            const response = await mbFetch(
              url,
              {
                signal,
                headers: {
                  'User-Agent': `SuSheOnline/1.0 ( ${process.env.BASE_URL || 'https://github.com/yourusername/sushe-online'} )`,
                  Accept: 'application/json',
                },
              },
              background ? 'low' : requestPriority
            );

            if (!response.ok) {
              const error = /** @type {Error & { status?: number }} */ (
                new Error(
                  `MusicBrainz API responded with status ${response.status}`
                )
              );
              error.status = response.status;
              throw error;
            }

            // Validate Content-Type before parsing
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
              const error =
                /** @type {Error & { status?: number, contentType?: string }} */ (
                  new Error(
                    `Unexpected Content-Type: ${contentType}. Expected application/json`
                  )
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

              const jsonError =
                /** @type {Error & { status?: number, contentType?: string, bodyPreview?: string }} */ (
                  new Error(
                    `Failed to parse JSON response: ${parseError.message}`
                  )
                );
              jsonError.name = parseError.name || 'SyntaxError';
              jsonError.status = response.status;
              jsonError.contentType = contentType;
              jsonError.bodyPreview = bodyPreview;
              throw jsonError;
            }

            if (
              policy &&
              (!data ||
                !Array.isArray(data['release-groups']) ||
                'error' in data ||
                'errors' in data ||
                'errorMessage' in data)
            ) {
              throw Object.assign(
                new Error('Invalid MusicBrainz discography response'),
                { status: 502 }
              );
            }

            return data;
          },
          policy
        );
      }, 'MusicBrainz'),
      'fetching from MusicBrainz'
    )
  );

  // Proxy for Wikidata API to avoid CORS issues
  app.get(
    '/api/proxy/wikidata',
    ensureAuthAPI,
    asyncHandler(async (req, res) => {
      const { entity, property } = req.query;
      if (
        typeof entity !== 'string' ||
        !/^Q\d+$/.test(entity) ||
        typeof property !== 'string' ||
        !/^P\d+$/.test(property)
      ) {
        return res.status(400).json({
          error: 'Query parameters entity and property are required',
        });
      }

      const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(entity)}&property=${encodeURIComponent(property)}&format=json`;
      await publicJson(req, res, url, async (signal) => {
        const response = await fetch(url, {
          signal,
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
        return data;
      });
    }, 'fetching from Wikidata')
  );

  // Proxy for iTunes Search API (album artwork)
  // Public API, no key required, ~20 req/min rate limit.
  // Uses itunesProxyQueue to limit concurrent outbound requests and avoid 403/5xx.
  app.get(
    '/api/proxy/itunes',
    ensureAuthAPI,
    asyncHandler(
      withUpstreamStatus(async (req, res) => {
        const { term, limit = 10 } = req.query;
        if (typeof term !== 'string' || !term.trim()) {
          return res.status(400).json({
            error: 'Query parameter term is required',
          });
        }

        if (
          !['string', 'number'].includes(typeof limit) ||
          !/^\d+$/.test(String(limit)) ||
          !Number.isInteger(Number(limit)) ||
          Number(limit) < 1 ||
          Number(limit) > 200
        ) {
          return res
            .status(400)
            .json({ error: 'Limit must be an integer between 1 and 200' });
        }
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&country=us&limit=${Number(limit)}`;
        await publicJson(req, res, url, async (signal) => {
          const response = await itunesProxyQueue.add(
            async () => {
              signal.throwIfAborted();
              return fetch(url, {
                signal,
                headers: {
                  'User-Agent': 'SuSheOnline/1.0',
                  Accept: 'application/json',
                },
              });
            },
            { signal }
          );

          if (!response.ok) {
            const err = /** @type {Error & { status?: number }} */ (
              new Error(`iTunes API responded with status ${response.status}`)
            );
            err.status = response.status;
            throw err;
          }

          const data = await response.json();
          return data;
        });
      }, 'iTunes'),
      'fetching from iTunes'
    )
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
          .jpeg({ quality: 85, mozjpeg: true }) // Visually lossless at a fraction of the size
          .toBuffer();

        const base64 = resizedBuffer.toString('base64');

        return {
          data: base64,
          contentType: 'image/jpeg', // Always JPEG after processing
        };
      });

      res.set('Cache-Control', 'private, max-age=3600');
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
      const validation = validateUnfurlTarget(url);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const response = await fetch(validation.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (SuSheBot)' },
      });

      if (!response.ok) {
        return res.status(502).json({ error: 'Failed to fetch target URL' });
      }

      const contentType = response.headers.get('content-type') || '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        return res.status(415).json({ error: 'URL must return HTML content' });
      }

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
