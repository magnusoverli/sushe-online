# API Performance Analysis - External API Calls

## Critical Performance Issues

### 🔴 CRITICAL: Sequential Track Searches in Playlist Operations

**Location**: `routes/api.js:1618-1658` (Spotify), `routes/api.js:1841-1881` (Tidal)

**Problem**:

```javascript
for (const item of items) {
  const trackUri = await findSpotifyTrack(item, auth); // Sequential API calls!
  // Each call involves 2-3 API requests
}
```

**Impact**:

- For a 30-album playlist: **60-90 sequential API calls**
- With 200ms per call: **12-18 seconds minimum**
- With rate limiting: **potentially 30+ seconds**

**Why It's Slow**:

1. Each `findSpotifyTrack()` makes 2-3 API calls:
   - Album search: `GET /v1/search?type=album`
   - Album tracks: `GET /v1/albums/{id}/tracks`
   - Fallback track search: `GET /v1/search?type=track`
2. All executed sequentially in a loop
3. Network latency multiplied by number of tracks

**Solution**: Batch/parallel processing

```javascript
// Parallel approach
const trackPromises = items.map((item) => findSpotifyTrack(item, auth));
const trackUris = await Promise.allSettled(trackPromises);

// With rate limiting (10 concurrent)
const batchSize = 10;
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  const results = await Promise.allSettled(
    batch.map((item) => findSpotifyTrack(item, auth))
  );
  trackUris.push(...results);
}
```

**Estimated Improvement**:

- Current: 12-18 seconds for 30 tracks
- Optimized: 2-3 seconds (5-6x faster)

---

### 🟡 MEDIUM: Nested API Calls in Track Search

**Location**: `routes/api.js:1702-1741` (Spotify), `routes/api.js:1940-1990` (Tidal)

**Problem**:

```javascript
async function findSpotifyTrack(item, auth) {
  // Call 1: Search for album
  const albumResp = await fetch('...search?type=album...');

  if (albumResp.ok) {
    // Call 2: Get album tracks
    const tracksResp = await fetch('...albums/{id}/tracks...');

    if (!match) {
      // Call 3: Fallback track search
      const searchResp = await fetch('...search?type=track...');
    }
  }
}
```

**Why It's Slow**:

- Waterfall of requests (each waits for previous)
- No caching between similar searches
- Same album searched multiple times if multiple tracks selected

**Solution**:

1. Cache album lookups within batch
2. Search for tracks directly if track name provided
3. Combine album + track search in parallel

```javascript
// Cache album data
const albumCache = new Map();

async function findSpotifyTrack(item, auth, cache) {
  const cacheKey = `${item.artist}::${item.album}`;

  let albumData = cache.get(cacheKey);
  if (!albumData) {
    albumData = await searchSpotifyAlbum(item, auth);
    cache.set(cacheKey, albumData);
  }

  // Rest of logic using cached data
}
```

**Estimated Improvement**: 30-40% reduction in API calls

---

### 🟢 LOW: MusicBrainz Rate Limiting Too Conservative

**Location**: `routes/api.js:6-13`

**Current Implementation**:

```javascript
function mbFetch(url, options) {
  const result = mbQueue.then(() => fetch(url, options));
  mbQueue = result.then(
    () => wait(3000), // 3 second delay between ALL requests
    () => wait(3000)
  );
  return result;
}
```

**Problem**:

- MusicBrainz allows 1 request per second (not 1 per 3 seconds)
- Overly conservative rate limiting adds 2 extra seconds per call
- Global queue affects all users

**MusicBrainz Rate Limits**:

- Official limit: 1 request/second for anonymous
- 50 requests/second for registered applications (with API key)

**Solution**:

```javascript
// Use 1 second delay instead of 3
mbQueue = result.then(
  () => wait(1000), // Official rate limit
  () => wait(1000)
);

// OR: Register for API key and use burst mode
// https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
```

**Estimated Improvement**: 2x faster MusicBrainz operations

---

## Minor Optimizations

### 1. iTunes/Deezer Fallback Pattern

**Location**: `routes/api.js:1004-1007`

**Current**:

```javascript
const runFallbacks = async () => {
  const itunes = await fetchItunesTracks(); // Wait even if it fails
  if (itunes) return itunes;
  return await fetchDeezerTracks(); // Only tried after iTunes completes
};
```

**Optimization**:

```javascript
// Race both, return first success
const runFallbacks = async () => {
  return Promise.any([fetchItunesTracks(), fetchDeezerTracks()]);
};
```

**Impact**: Moderate - saves 1-2 seconds on fallback scenarios

---

### 2. Duplicate Spotify Album Searches

**Location**: `routes/api.js:1702-1710`

**Problem**: Same album searched multiple times when playlist has multiple tracks from same album

**Solution**: Implement request-scoped cache (see solution above)

---

### 3. No Connection Pooling/Keep-Alive

**Status**: Not explicitly configured

**Impact**: Each fetch creates new TCP connection

- TLS handshake: 100-300ms overhead per request
- Multiplied across dozens of API calls

**Solution**:

```javascript
// Use node-fetch with keep-alive agent
const https = require('https');
const agent = new https.Agent({ keepAlive: true });

fetch(url, { agent });
```

---

## Summary

### High Priority Fixes

1. **Parallelize playlist track searches** (routes/api.js:1618, 1841)
   - Expected: 5-6x speedup
   - Complexity: Medium
   - Breaking: No

2. **Cache album lookups within batch** (routes/api.js:1693)
   - Expected: 30-40% fewer API calls
   - Complexity: Low
   - Breaking: No

3. **Reduce MusicBrainz delay to 1s** (routes/api.js:9)
   - Expected: 2x speedup
   - Complexity: Low
   - Breaking: No

### Medium Priority

4. **Race iTunes/Deezer fallbacks** (routes/api.js:1004)
   - Expected: 1-2s faster on fallbacks
   - Complexity: Low

5. **Add HTTP keep-alive**
   - Expected: 10-20% overall speedup
   - Complexity: Low

### Estimated Total Improvement

For a typical 30-track playlist send:

- **Current**: ~15-25 seconds
- **After optimization**: ~3-5 seconds
- **Speedup**: 5-8x faster

---

## Testing Recommendations

1. Load test with varying playlist sizes (5, 20, 50 tracks)
2. Monitor Spotify/Tidal rate limit responses
3. Test error scenarios (API timeouts, rate limits)
4. Verify cache invalidation works correctly
5. Check memory usage with large batches
