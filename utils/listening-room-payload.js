const { findTrackIndex, trackTitle } = require('./track-reference.mjs');
const { AVAILABILITY_SERVICES } = require('../services/availability/platforms');

const MAX_SONGS = 500;
const MAX_TEXT_LENGTH = 500;
const MAX_LINKS = 10;
const MAX_RESPONSE_BYTES = 512 * 1024;

function text(value, fallback) {
  return Array.from(String(value || fallback))
    .slice(0, MAX_TEXT_LENGTH)
    .join('');
}

function albumLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .filter((link) => {
      if (
        !AVAILABILITY_SERVICES.includes(link?.service) ||
        typeof link.url !== 'string'
      )
        return false;
      try {
        return new URL(link.url).protocol === 'https:';
      } catch {
        return false;
      }
    })
    .slice(0, MAX_LINKS)
    .map(({ service, url }) => ({ service, url }));
}

function pickedSong(item, rank) {
  const pick = item.primary_track || item.secondary_track;
  if (!pick) return null;
  const tracks = Array.isArray(item.tracks) ? item.tracks : [];
  const index = findTrackIndex(pick, tracks);
  // Bare numeric references use the same positional rules as #N references.
  if (index < 0 && /^#?\d+$/.test(pick)) return null;
  const title = index < 0 ? pick : trackTitle(tracks[index]);
  if (!title) return null;
  const length =
    index < 0 || typeof tracks[index] !== 'object'
      ? null
      : tracks[index]?.length;
  return {
    rank,
    artist: text(item.artist, 'Unknown Artist'),
    album: text(item.album, 'Unknown Album'),
    title: text(title, ''),
    trackNumber: index < 0 ? null : index + 1,
    duration:
      typeof length === 'number' && Number.isFinite(length) && length >= 0
        ? Math.round(length / 1000)
        : null,
    albumLinks: albumLinks(item.availability_links),
  };
}

// Only allowlisted fields leave this boundary; list metadata and item rows can
// contain private comments, identities and artwork that must never be exposed.
function buildListeningRoomPayload({ list, items }, expiresAt) {
  const payload = {
    format: 'sushe-listening-room',
    version: 1,
    list: {
      name: text(list.name, 'Untitled list'),
      year: Number.isInteger(list.year) ? list.year : null,
    },
    expiresAt: new Date(expiresAt).toISOString(),
    leftOut: { noPick: 0, disqualified: 0 },
    songs: [],
  };
  // Fetchers return display order; count every album, including excluded ones.
  items.forEach((item, index) => {
    if (item.is_disqualified === true) {
      payload.leftOut.disqualified++;
      return;
    }
    const song = pickedSong(item, index + 1);
    if (!song) payload.leftOut.noPick++;
    else if (payload.songs.length < MAX_SONGS) payload.songs.push(song);
  });
  // Preserve a prefix by rank even for unusually long multi-byte titles/URLs.
  // A byte limit (not JS string length) matches Listening Room's wire limit.
  let bytes = Buffer.byteLength(
    JSON.stringify({ ...payload, songs: [] }),
    'utf8'
  );
  let count = 0;
  for (const song of payload.songs) {
    const songBytes =
      Buffer.byteLength(JSON.stringify(song), 'utf8') + (count ? 1 : 0);
    if (bytes + songBytes >= MAX_RESPONSE_BYTES) break;
    bytes += songBytes;
    count++;
  }
  payload.songs.length = count;
  return payload;
}

module.exports = { buildListeningRoomPayload };
