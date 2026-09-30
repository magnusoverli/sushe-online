const { normalizeForComparison } = require('../../utils/fuzzy-match');

/** @typedef {{artist?: string, album?: string}} Candidate */
/** @param {Candidate} album */
function getBlockingKeys(album) {
  const artist = normalizeForComparison(album.artist || '');
  const title = normalizeForComparison(album.album || '');
  const artistToken = artist.split(' ').filter(Boolean)[0] || '';
  const titleToken = title.split(' ').filter(Boolean)[0] || '';
  const keys = new Set();
  if (artist) keys.add(`artist1:${artist[0]}`);
  if (title) keys.add(`album1:${title[0]}`);
  if (artist && title) keys.add(`pair1:${artist[0]}|${title[0]}`);
  if (artistToken) keys.add(`artist3:${artistToken.slice(0, 3)}`);
  if (titleToken) keys.add(`album3:${titleToken.slice(0, 3)}`);
  if (artistToken && titleToken)
    keys.add(`pair3:${artistToken.slice(0, 3)}|${titleToken.slice(0, 3)}`);
  return [...keys];
}

/** @param {Candidate[]} albums @returns {Map<string, number[]>} */
function buildBlockingBuckets(albums) {
  const buckets = new Map();
  albums.forEach((album, index) => {
    for (const key of getBlockingKeys(album)) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    }
  });
  return buckets;
}

/** @param {number} index @param {Candidate} album
 * @param {Map<string, number[]>} buckets @param {number} totalAlbums */
function getCandidateIndexes(index, album, buckets, totalAlbums) {
  const candidates = new Set();
  for (const key of getBlockingKeys(album)) {
    for (const candidate of buckets.get(key) || [])
      if (candidate > index) candidates.add(candidate);
  }
  if (!candidates.size) {
    const FALLBACK_WINDOW = 200;
    for (
      let i = index + 1;
      i < Math.min(totalAlbums, index + FALLBACK_WINDOW + 1);
      i++
    )
      candidates.add(i);
  }
  return [...candidates].sort((a, b) => a - b);
}

module.exports = { buildBlockingBuckets, getCandidateIndexes };
