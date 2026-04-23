/**
 * Spotify Service
 *
 * Business logic for Spotify API interactions:
 * - Album search with normalization
 * - Track search with multi-step matching (number → name → fallback)
 * - Device listing and filtering
 * - Play with background playcount refresh scheduling
 *
 * Uses dependency injection via createSpotifyService(deps) factory.
 *
 * @module services/spotify-service
 */

const {
  normalizeForExternalApi,
  normalizeArtistName,
  stringSimilarity,
} = require('../utils/normalization');
const {
  matchTrackByNumber,
  extractTrackName,
  matchTrackByName,
} = require('../utils/track-matching');

const MIN_ALBUM_MATCH_SCORE = 0.62;
const MIN_COMBINED_MATCH_SCORE = 0.72;

function getReleaseYear(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).match(/^(\d{4})/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function parseSearchAlbumArgs(searchOptions, accessToken) {
  if (typeof searchOptions === 'string' && !accessToken) {
    return {
      options: {},
      token: searchOptions,
    };
  }

  return {
    options: searchOptions || {},
    token: accessToken,
  };
}

async function spotifyAlbumSearch(fetch, query, accessToken, limit = 10) {
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    const errorMsg =
      errorData?.error?.message || `Spotify API error ${resp.status}`;
    return { error: { status: resp.status, message: errorMsg } };
  }

  const data = await resp.json();
  return { items: data?.albums?.items || [] };
}

function scoreSpotifyAlbumCandidate(candidate, artist, album, releaseDate) {
  const candidateArtists = Array.isArray(candidate?.artists)
    ? candidate.artists
    : [];

  let bestArtistScore = 0;
  let bestArtistName = artist;

  for (const artistEntry of candidateArtists) {
    const candidateArtistName = artistEntry?.name || '';
    const score = stringSimilarity(artist, candidateArtistName);
    if (score > bestArtistScore) {
      bestArtistScore = score;
      bestArtistName = candidateArtistName;
    }
  }

  const albumScore = stringSimilarity(album, candidate?.name || '');
  const requestedYear = getReleaseYear(releaseDate);
  const candidateYear = getReleaseYear(candidate?.release_date);
  const yearBonus =
    requestedYear && candidateYear && requestedYear === candidateYear
      ? 0.05
      : 0;

  return {
    albumScore,
    artistScore: bestArtistScore,
    bestArtistName,
    combinedScore: albumScore * 0.7 + bestArtistScore * 0.3 + yearBonus,
  };
}

function dedupeAlbumCandidates(candidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    if (!candidate?.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    deduped.push(candidate);
  }

  return deduped;
}

async function getCachedSpotifyAlbumMapping(
  externalIdentityService,
  logger,
  albumId,
  artist,
  album
) {
  if (!externalIdentityService || !albumId) return null;

  try {
    const cachedMapping = await externalIdentityService.getAlbumServiceMapping(
      'spotify',
      albumId
    );

    if (!cachedMapping?.external_album_id) return null;

    return {
      id: cachedMapping.external_album_id,
      resolvedArtist: cachedMapping.external_artist || artist,
      resolvedAlbum: cachedMapping.external_album || album,
      confidence: cachedMapping.confidence || 1,
      strategy: 'cached_mapping',
    };
  } catch (err) {
    logger.warn('Failed to read Spotify album mapping cache', {
      albumId,
      error: err.message,
    });
    return null;
  }
}

async function getSpotifyArtistCandidates(
  externalIdentityService,
  logger,
  artist
) {
  const candidates = [artist];
  if (!externalIdentityService || !artist) return candidates;

  try {
    const aliases = await externalIdentityService.getArtistAliasCandidates(
      'spotify',
      artist,
      {
        includeCrossService: true,
      }
    );
    candidates.push(...aliases);
  } catch (err) {
    logger.warn('Failed to read artist aliases for Spotify', {
      artist,
      error: err.message,
    });
  }

  return [...new Set(candidates.filter(Boolean))];
}

function buildSpotifyAlbumQueries(artistCandidates, artist, album) {
  const normalizedAlbum = normalizeForExternalApi(album);
  const queries = new Set();

  for (const candidateArtist of artistCandidates) {
    const normalizedArtist = normalizeForExternalApi(candidateArtist);
    queries.add(`album:${normalizedAlbum} artist:${normalizedArtist}`);
  }

  queries.add(`album:${normalizedAlbum}`);
  queries.add(`${normalizedAlbum} ${normalizeForExternalApi(artist)}`);

  return [...queries];
}

function pickBestSpotifyAlbumCandidate(candidates, artist, album, releaseDate) {
  const scored = candidates
    .map((candidate) => {
      const score = scoreSpotifyAlbumCandidate(
        candidate,
        artist,
        album,
        releaseDate
      );
      return {
        candidate,
        ...score,
      };
    })
    .sort((a, b) => b.combinedScore - a.combinedScore);

  const best = scored[0];
  const isConfidentMatch =
    (best.albumScore >= MIN_ALBUM_MATCH_SCORE &&
      best.combinedScore >= MIN_COMBINED_MATCH_SCORE) ||
    (best.albumScore >= 0.9 && best.artistScore >= 0.35);

  return {
    best,
    isConfidentMatch,
  };
}

async function persistSpotifyResolution({
  externalIdentityService,
  logger,
  artist,
  album,
  albumId,
  best,
  resolved,
}) {
  if (!externalIdentityService) return;

  try {
    if (albumId) {
      await externalIdentityService.upsertAlbumServiceMapping({
        albumId,
        service: 'spotify',
        externalAlbumId: resolved.id,
        externalArtist: resolved.resolvedArtist,
        externalAlbum: resolved.resolvedAlbum,
        confidence: resolved.confidence,
        strategy: resolved.strategy,
      });
    }

    const canonicalArtistKey = normalizeArtistName(artist);
    const resolvedArtistKey = normalizeArtistName(resolved.resolvedArtist);
    if (
      canonicalArtistKey &&
      resolvedArtistKey &&
      canonicalArtistKey !== resolvedArtistKey
    ) {
      await externalIdentityService.upsertArtistAlias({
        service: 'spotify',
        canonicalArtist: artist,
        serviceArtist: resolved.resolvedArtist,
        confidence: best.artistScore,
        sourceAlbumId: albumId || null,
      });
    }
  } catch (err) {
    logger.warn('Failed to persist Spotify mapping metadata', {
      artist,
      album,
      albumId: albumId || null,
      error: err.message,
    });
  }
}

async function resolveSpotifyAlbum(serviceDeps, searchParams, accessToken) {
  const { logger, fetch, externalIdentityService } = serviceDeps;
  const { artist, album, albumId, releaseDate } = searchParams;

  if (!artist || !album) {
    return {
      error: { status: 400, message: 'artist and album are required' },
    };
  }

  if (!accessToken) {
    return {
      error: { status: 401, message: 'Spotify access token missing' },
    };
  }

  const cachedMapping = await getCachedSpotifyAlbumMapping(
    externalIdentityService,
    logger,
    albumId,
    artist,
    album
  );
  if (cachedMapping) {
    return cachedMapping;
  }

  const artistCandidates = await getSpotifyArtistCandidates(
    externalIdentityService,
    logger,
    artist
  );
  const queries = buildSpotifyAlbumQueries(artistCandidates, artist, album);

  const searchResults = await Promise.all(
    queries.map((query) => spotifyAlbumSearch(fetch, query, accessToken, 10))
  );

  const firstError = searchResults.find((result) => result.error)?.error;
  const candidates = dedupeAlbumCandidates(
    searchResults.flatMap((result) => result.items || [])
  );

  if (!candidates.length) {
    if (firstError) return { error: firstError };
    return { error: { status: 404, message: 'Album not found' } };
  }

  const { best, isConfidentMatch } = pickBestSpotifyAlbumCandidate(
    candidates,
    artist,
    album,
    releaseDate
  );

  if (!isConfidentMatch) {
    logger.info('Spotify album candidate rejected as ambiguous', {
      artist,
      album,
      topCandidate: {
        id: best?.candidate?.id,
        name: best?.candidate?.name,
        artist: best?.bestArtistName,
        albumScore: best?.albumScore,
        artistScore: best?.artistScore,
        combinedScore: best?.combinedScore,
      },
    });
    return { error: { status: 404, message: 'Album not found' } };
  }

  const resolved = {
    id: best.candidate.id,
    resolvedArtist: best.bestArtistName || artist,
    resolvedAlbum: best.candidate.name || album,
    confidence: best.combinedScore,
    strategy: 'scored_search',
  };

  await persistSpotifyResolution({
    externalIdentityService,
    logger,
    artist,
    album,
    albumId,
    best,
    resolved,
  });

  logger.info('Spotify album resolved', {
    artist,
    album,
    spotifyAlbumId: resolved.id,
    resolvedArtist: resolved.resolvedArtist,
    resolvedAlbum: resolved.resolvedAlbum,
    confidence: Number(
      resolved.confidence?.toFixed?.(4) || resolved.confidence
    ),
    strategy: resolved.strategy,
  });

  return resolved;
}

async function searchAlbumWithDeps(
  serviceDeps,
  artist,
  album,
  searchOptions,
  accessToken
) {
  const { options, token } = parseSearchAlbumArgs(searchOptions, accessToken);

  const resolved = await resolveSpotifyAlbum(
    serviceDeps,
    {
      artist,
      album,
      albumId: options.albumId,
      releaseDate: options.releaseDate,
    },
    token
  );

  if (resolved.error) {
    return { error: resolved.error };
  }

  return { id: resolved.id };
}

async function searchTrackWithDeps(
  serviceDeps,
  artist,
  album,
  track,
  searchOptions,
  accessToken
) {
  const { fetch, logger } = serviceDeps;
  const { options, token } = parseSearchAlbumArgs(searchOptions, accessToken);

  const headers = { Authorization: `Bearer ${token}` };
  const albumResult = await resolveSpotifyAlbum(
    serviceDeps,
    {
      artist,
      album,
      albumId: options.albumId,
      releaseDate: options.releaseDate,
    },
    token
  );

  if (albumResult.error) {
    return { error: albumResult.error };
  }

  const spotifyAlbumId = albumResult.id;
  const normalizedArtist = normalizeForExternalApi(
    albumResult.resolvedArtist || artist
  );
  const normalizedAlbum = normalizeForExternalApi(
    albumResult.resolvedAlbum || album
  );

  const tracksResp = await fetch(
    `https://api.spotify.com/v1/albums/${spotifyAlbumId}/tracks?limit=50`,
    { headers }
  );
  if (!tracksResp.ok) {
    return {
      error: {
        status: 502,
        message: `Spotify API error: ${tracksResp.statusText}`,
      },
    };
  }
  const tracksData = await tracksResp.json();
  const tracks = tracksData.items;

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return { error: { status: 404, message: 'Album has no tracks' } };
  }

  const numberMatch = matchTrackByNumber(tracks, track);
  if (numberMatch) {
    logger.info('Spotify track matched by number:', {
      trackId: numberMatch.id,
      trackName: numberMatch.name,
    });
    return { id: numberMatch.id, name: numberMatch.name };
  }

  const searchName = extractTrackName(track);
  const matchingTrack = matchTrackByName(tracks, searchName);
  if (matchingTrack) {
    logger.info('Spotify track matched by name:', {
      trackId: matchingTrack.id,
      trackName: matchingTrack.name,
    });
    return { id: matchingTrack.id, name: matchingTrack.name };
  }

  const normalizedTrack = normalizeForExternalApi(searchName);
  const fallbackQuery = `track:${normalizedTrack} album:${normalizedAlbum} artist:${normalizedArtist}`;
  const fallbackResp = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(fallbackQuery)}&type=track&limit=1`,
    { headers }
  );
  if (fallbackResp.ok) {
    const fallbackData = await fallbackResp.json();
    if (fallbackData.tracks.items.length > 0) {
      const found = fallbackData.tracks.items[0];
      logger.info('Spotify track matched by fallback search:', {
        trackId: found.id,
        trackName: found.name,
      });
      return { id: found.id, name: found.name };
    }
  }

  logger.info('Track not found on Spotify:', { artist, album, track });
  return { error: { status: 404, message: 'Track not found' } };
}

async function getSpotifyDevices(fetch, logger, accessToken) {
  const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    return { error: { status: resp.status, errorData } };
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

  return { devices: usableDevices };
}

function scheduleSpotifyPlaycountRefresh(logger, params) {
  const {
    spotifyAlbumId,
    userId,
    lastfmUsername,
    db,
    refreshPlaycountsInBackground,
  } = params;
  const PLAY_REFRESH_DELAY_MS = 60000;

  db.raw(`SELECT album_id, artist, album FROM albums WHERE spotify_id = $1`, [
    spotifyAlbumId,
  ])
    .then((result) => {
      if (result.rows.length > 0) {
        const albumRow = result.rows[0];
        logger.debug('Scheduling playcount refresh after play', {
          artist: albumRow.artist,
          album: albumRow.album,
          delayMs: PLAY_REFRESH_DELAY_MS,
        });

        setTimeout(() => {
          refreshPlaycountsInBackground(
            userId,
            lastfmUsername,
            [
              {
                itemId: albumRow.album_id,
                artist: albumRow.artist,
                album: albumRow.album,
                albumId: albumRow.album_id,
              },
            ],
            db,
            logger
          ).catch((err) => {
            logger.warn('Playcount refresh after play failed', {
              error: err.message,
            });
          });
        }, PLAY_REFRESH_DELAY_MS);
      }
    })
    .catch((err) => {
      logger.warn('Failed to look up album for playcount refresh', {
        spotifyAlbumId,
        error: err.message,
      });
    });
}

/**
 * @param {Object} deps
 * @param {Object} deps.fetch - Fetch implementation
 * @param {Object} [deps.logger] - Logger instance
 * @returns {Object} Spotify service methods
 */
function createSpotifyService(deps = {}) {
  const fetch = deps.fetch || globalThis.fetch;
  const logger = deps.logger || require('../utils/logger');
  const externalIdentityService = deps.externalIdentityService || null;
  const serviceDeps = {
    fetch,
    logger,
    externalIdentityService,
  };

  async function searchAlbum(artist, album, searchOptions, accessToken) {
    return searchAlbumWithDeps(
      serviceDeps,
      artist,
      album,
      searchOptions,
      accessToken
    );
  }

  async function searchTrack(artist, album, track, searchOptions, accessToken) {
    return searchTrackWithDeps(
      serviceDeps,
      artist,
      album,
      track,
      searchOptions,
      accessToken
    );
  }

  async function getDevices(accessToken) {
    return getSpotifyDevices(fetch, logger, accessToken);
  }

  function schedulePlaycountRefresh(params) {
    scheduleSpotifyPlaycountRefresh(logger, params);
  }

  return {
    searchAlbum,
    searchTrack,
    getDevices,
    schedulePlaycountRefresh,
  };
}

module.exports = { createSpotifyService };
