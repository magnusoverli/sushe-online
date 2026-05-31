/**
 * Spotify availability source.
 *
 * Uses Spotify's client-credentials flow, when app credentials are configured,
 * to verify that an album exists in Spotify's catalog. This fills gaps where
 * Odesli or MusicBrainz have partial cross-platform links but Spotify search can
 * still confidently identify the same album.
 */

const defaultLogger = require('../../utils/logger');
const {
  generateQueryForms,
  nameSimilarity,
  selectBestCandidate,
} = require('../../utils/entity-matching');

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search';
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const SPOTIFY_MARKET = 'US';

function bestArtistName(candidate, targetArtist) {
  const artists = Array.isArray(candidate?.artists) ? candidate.artists : [];
  let bestName = artists[0]?.name || '';
  let bestScore = 0;

  for (const artist of artists) {
    const name = artist?.name || '';
    const score = nameSimilarity(targetArtist, name);
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  return bestName;
}

function buildSearchQueries(artist, album, upc) {
  const albumForms = generateQueryForms(album, { stripEditions: true }).slice(
    0,
    3
  );
  const artistForms = generateQueryForms(artist).slice(0, 2);
  const queries = new Set();

  if (upc) {
    queries.add(`upc:${upc}`);
  }

  for (const albumForm of albumForms) {
    for (const artistForm of artistForms) {
      queries.add(`album:${albumForm} artist:${artistForm}`);
    }
    queries.add(`album:${albumForm}`);
  }

  if (albumForms[0] && artistForms[0]) {
    queries.add(`${albumForms[0]} ${artistForms[0]}`);
  }

  return [...queries];
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    if (!candidate?.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    deduped.push(candidate);
  }
  return deduped;
}

function createSpotifySource(deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const logger = deps.logger || defaultLogger;
  const env = deps.env || process.env;
  const clientId = deps.clientId || env.SPOTIFY_CLIENT_ID;
  const clientSecret = deps.clientSecret || env.SPOTIFY_CLIENT_SECRET;
  const market = deps.market || SPOTIFY_MARKET;
  let tokenCache = null;

  async function getAccessToken() {
    if (!clientId || !clientSecret) return null;
    if (tokenCache && tokenCache.expiresAt > Date.now()) {
      return tokenCache.accessToken;
    }

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64'
      );
      const resp = await fetchFn(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
      });
      if (!resp.ok) {
        logger.debug?.('Spotify client-credentials auth failed', {
          status: resp.status,
        });
        return null;
      }

      const data = await resp.json();
      if (!data?.access_token) return null;
      tokenCache = {
        accessToken: data.access_token,
        expiresAt:
          Date.now() +
          Math.max(
            0,
            (Number(data.expires_in) || 3600) * 1000 - TOKEN_EXPIRY_BUFFER_MS
          ),
      };
      return tokenCache.accessToken;
    } catch (err) {
      logger.debug?.('Spotify client-credentials auth failed', {
        error: err.message,
      });
      return null;
    }
  }

  async function searchAlbums(query, accessToken) {
    const params = new URLSearchParams({
      q: query,
      type: 'album',
      market,
      limit: '10',
    });
    const resp = await fetchFn(`${SPOTIFY_SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      logger.debug?.('Spotify album availability search failed', {
        status: resp.status,
      });
      return [];
    }

    const data = await resp.json();
    return data?.albums?.items || [];
  }

  async function getLinks(album = {}) {
    const artist = String(album.artist || '').trim();
    const albumName = String(album.album || '').trim();
    const upc = String(album.upc || '').trim();
    if (!artist || !albumName) return { links: [] };

    const accessToken = await getAccessToken();
    if (!accessToken) return { links: [] };

    try {
      const searchResults = await Promise.all(
        buildSearchQueries(artist, albumName, upc).map((query) =>
          searchAlbums(query, accessToken)
        )
      );
      const candidates = dedupeCandidates(searchResults.flat());
      const prepared = candidates.map((candidate) => ({
        ...candidate,
        matchingArtist: bestArtistName(candidate, artist),
      }));
      const { best, isConfident } = selectBestCandidate({
        target: { artist, album: albumName },
        candidates: prepared,
        getArtist: (candidate) => candidate.matchingArtist,
        getAlbum: (candidate) => candidate.name,
      });

      if (!isConfident || !best?.candidate?.id) return { links: [] };

      const match = best.candidate;
      return {
        links: [
          {
            service: 'spotify',
            url:
              match.external_urls?.spotify ||
              `https://open.spotify.com/album/${match.id}`,
            confidence: best.combined,
            externalAlbumId: match.id,
            externalArtist: match.matchingArtist,
            externalAlbum: match.name,
          },
        ],
      };
    } catch (err) {
      logger.debug?.('Spotify availability lookup failed', {
        artist,
        album: albumName,
        error: err.message,
      });
      return { links: [] };
    }
  }

  return { getLinks };
}

module.exports = { createSpotifySource };
