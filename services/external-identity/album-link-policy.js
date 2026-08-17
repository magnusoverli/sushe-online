const MAX_LINK_LENGTH = 2048;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const SOUNDCLOUD_RESERVED_SEGMENTS = new Set([
  'albums',
  'discover',
  'likes',
  'reposts',
  'search',
  'sets',
  'tracks',
  'you',
]);

const LINK_RANKS = Object.freeze({
  RYM_HINT: 10,
  ITEM: 100,
  COLLECTION: 200,
  ALBUM: 200,
});

function hostMatches(host, allowedHost) {
  return host === allowedHost || host.endsWith(`.${allowedHost}`);
}

function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function safeUrl(rawUrl) {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_LINK_LENGTH ||
    hasControlCharacters(rawUrl) ||
    ENCODED_PATH_SEPARATOR.test(rawUrl) ||
    rawUrl.includes('\\')
  ) {
    return null;
  }

  try {
    if (hasControlCharacters(decodeURIComponent(rawUrl))) return null;
    const authorityEnd = rawUrl.indexOf('://') + 3;
    const pathStart = rawUrl.indexOf('/', authorityEnd);
    const pathAndQuery = pathStart === -1 ? '' : rawUrl.slice(pathStart);
    const rawPath = pathAndQuery.split(/[?#]/, 1)[0];
    if (
      rawPath
        .split('/')
        .some((segment) =>
          ['.', '..'].includes(segment.toLowerCase().replaceAll('%2e', '.'))
        )
    ) {
      return null;
    }

    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function result(service, externalAlbumId, externalUrl, linkType, rank) {
  return { service, externalAlbumId, externalUrl, linkType, rank };
}

function parseRateYourMusic(parsed) {
  if (!hostMatches(parsed.hostname, 'rateyourmusic.com')) return null;
  const match = parsed.pathname.match(
    /^\/release\/(album)\/([^/]+)\/([^/]+)\/?$/i
  );
  if (!match) return null;
  const pathname = `/release/${match[1].toLowerCase()}/${match[2]}/${match[3]}/`;
  return result(
    'rateyourmusic',
    null,
    `https://rateyourmusic.com${pathname}`,
    'release',
    LINK_RANKS.RYM_HINT
  );
}

function parseSpotify(parsed) {
  if (!hostMatches(parsed.hostname, 'spotify.com')) return null;
  const match = parsed.pathname.match(/^\/album\/([A-Za-z0-9]{22})\/?$/);
  if (!match) return null;
  return result(
    'spotify',
    match[1],
    `https://open.spotify.com/album/${match[1]}`,
    'album',
    LINK_RANKS.ALBUM
  );
}

function parseApple(parsed) {
  const isAppleMusic = hostMatches(parsed.hostname, 'music.apple.com');
  const isItunes = hostMatches(parsed.hostname, 'itunes.apple.com');
  if (!isAppleMusic && !isItunes) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const albumIndex = segments[0]?.toLowerCase() === 'album' ? 0 : 1;
  const hasStorefront = albumIndex === 1 && /^[a-z]{2}$/i.test(segments[0]);
  const albumSegments = segments.slice(albumIndex + 1);
  if (
    (!hasStorefront && albumIndex === 1) ||
    segments[albumIndex]?.toLowerCase() !== 'album' ||
    albumSegments.length < 1 ||
    albumSegments.length > 2
  ) {
    return null;
  }
  const idPart = albumSegments.at(-1);
  const externalAlbumId = isAppleMusic
    ? idPart?.replace(/^id/i, '')
    : idPart?.match(/^id(\d+)$/i)?.[1];
  if (!externalAlbumId || !/^\d+$/.test(externalAlbumId)) return null;
  return result(
    'itunes',
    externalAlbumId,
    `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`,
    'album',
    LINK_RANKS.ALBUM
  );
}

function parseQobuz(parsed) {
  if (!hostMatches(parsed.hostname, 'qobuz.com')) return null;
  const match =
    parsed.pathname.match(/^\/album\/([A-Za-z0-9]+)\/?$/) ||
    parsed.pathname.match(
      /^\/[a-z]{2}-[a-z]{2}\/album\/[^/]+\/([A-Za-z0-9]+)\/?$/i
    );
  if (!match) return null;
  return result(
    'qobuz',
    match[1],
    `https://play.qobuz.com/album/${match[1]}`,
    'album',
    LINK_RANKS.ALBUM
  );
}

function parseTidal(parsed) {
  if (!hostMatches(parsed.hostname, 'tidal.com')) return null;
  const match = parsed.pathname.match(/^\/(?:browse\/)?album\/(\d+)\/?$/);
  if (!match) return null;
  return result(
    'tidal',
    match[1],
    `https://tidal.com/browse/album/${match[1]}`,
    'album',
    LINK_RANKS.ALBUM
  );
}

function parseBandcamp(parsed) {
  if (!hostMatches(parsed.hostname, 'bandcamp.com')) return null;
  const match = parsed.pathname.match(/^\/album\/([^/]+)\/?$/);
  if (!match || parsed.hostname === 'bandcamp.com') return null;
  return result(
    'bandcamp',
    `${parsed.hostname.slice(0, -'.bandcamp.com'.length)}/${match[1]}`,
    `https://${parsed.hostname}/album/${match[1]}`,
    'album',
    LINK_RANKS.ALBUM
  );
}

function parseSoundCloud(parsed) {
  if (!hostMatches(parsed.hostname, 'soundcloud.com')) return null;
  const setMatch = parsed.pathname.match(/^\/([^/]+)\/sets\/([^/]+)\/?$/i);
  if (setMatch) {
    const id = `${setMatch[1]}/sets/${setMatch[2]}`;
    return result(
      'soundcloud',
      id,
      `https://soundcloud.com/${id}`,
      'set',
      LINK_RANKS.COLLECTION
    );
  }

  const trackMatch = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (
    !trackMatch ||
    SOUNDCLOUD_RESERVED_SEGMENTS.has(trackMatch[1].toLowerCase()) ||
    SOUNDCLOUD_RESERVED_SEGMENTS.has(trackMatch[2].toLowerCase())
  ) {
    return null;
  }
  const id = `${trackMatch[1]}/${trackMatch[2]}`;
  return result(
    'soundcloud',
    id,
    `https://soundcloud.com/${id}`,
    'track',
    LINK_RANKS.ITEM
  );
}

function parseYouTube(parsed) {
  const isShortHost = hostMatches(parsed.hostname, 'youtu.be');
  if (!isShortHost && !hostMatches(parsed.hostname, 'youtube.com')) return null;

  const playlistId = parsed.searchParams.get('list');
  if (
    playlistId &&
    /^[A-Za-z0-9_-]{10,128}$/.test(playlistId) &&
    (/^\/playlist\/?$/.test(parsed.pathname) ||
      /^\/watch\/?$/.test(parsed.pathname))
  ) {
    return result(
      'youtube',
      playlistId,
      `https://www.youtube.com/playlist?list=${playlistId}`,
      'playlist',
      LINK_RANKS.COLLECTION
    );
  }

  const videoId = isShortHost
    ? parsed.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1]
    : /^\/watch\/?$/.test(parsed.pathname)
      ? parsed.searchParams.get('v')
      : parsed.pathname.match(
          /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/
        )?.[1];
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return result(
    'youtube',
    videoId,
    `https://www.youtube.com/watch?v=${videoId}`,
    'video',
    LINK_RANKS.ITEM
  );
}

const PARSERS = [
  parseRateYourMusic,
  parseSpotify,
  parseApple,
  parseQobuz,
  parseTidal,
  parseBandcamp,
  parseSoundCloud,
  parseYouTube,
];

function parseAlbumLink(rawUrl, expectedService = null) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return null;

  for (const parse of PARSERS) {
    const link = parse(parsed);
    if (link && (!expectedService || link.service === expectedService)) {
      return link;
    }
  }
  return null;
}

module.exports = {
  LINK_RANKS,
  MAX_LINK_LENGTH,
  hostMatches,
  parseAlbumLink,
};
