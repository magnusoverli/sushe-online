const PAGE_SIZE = 100;

export function createArtistDiscography(
  fetchPage,
  { ttlMs = 10 * 60 * 1000, maxPages = 50, now = Date.now } = {}
) {
  const cache = new Map();

  return async (artistId, signal, offset = 0) => {
    if (
      !/^[a-z0-9-]+$/i.test(artistId) ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new Error('Invalid artist discography request');
    }
    signal?.throwIfAborted();
    const key = `${artistId}:${offset}`;
    let entry = cache.get(key);
    if (entry && entry.expires <= now()) {
      cache.delete(key);
      entry = null;
    }
    if (!entry) {
      // Use the search index rather than the slower relational artist browse.
      // arid keeps identity exact; results still contain canonical release-group IDs.
      const query = `arid:${artistId} AND (primarytype:album OR primarytype:ep)`;
      const endpoint = `release-group?query=${encodeURIComponent(query)}&fmt=json&limit=${PAGE_SIZE}&offset=${offset}`;
      const data = await fetchPage(endpoint, 'high', signal);
      signal?.throwIfAborted();
      if (
        !data ||
        data.error ||
        data.errors ||
        !Array.isArray(data['release-groups'])
      ) {
        throw new Error('Invalid MusicBrainz album response');
      }
      const groups = data['release-groups'];
      const count = Number(data.count ?? offset + groups.length);
      entry = {
        groups,
        nextOffset:
          groups.length && offset + groups.length < count
            ? offset + groups.length
            : null,
        // A stale server response is useful now, but the next visit should see
        // its background refresh rather than another full client-cache TTL.
        expires: now() + (data._providerCache === 'STALE' ? 0 : ttlMs),
      };
    }
    // LRU, bounded by pages rather than artists with unbounded discographies.
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxPages) cache.delete(cache.keys().next().value);
    return { groups: entry.groups, nextOffset: entry.nextOffset };
  };
}
