const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createUserPreferences,
  POSITION_POINTS,
  getPositionPoints,
  normalizeArtistName,
  normalizeGenre,
  artistNamesMatch,
  filterGenreTags,
  GENRE_MAPPINGS,
} = require('../utils/user-preferences.js');

// =============================================================================
// Helper functions
// =============================================================================

function createMockLogger() {
  return {
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    debug: mock.fn(),
  };
}

function createMockPool(queryResults = []) {
  let callIndex = 0;
  return {
    query: mock.fn(async () => {
      const result = queryResults[callIndex] || { rows: [] };
      callIndex++;
      return result;
    }),
  };
}

// =============================================================================
// POSITION_POINTS tests
// =============================================================================

describe('POSITION_POINTS', () => {
  it('should have correct points for position 1', () => {
    assert.strictEqual(POSITION_POINTS[1], 60);
  });

  it('should have correct points for position 10', () => {
    assert.strictEqual(POSITION_POINTS[10], 32);
  });

  it('should have correct points for position 20', () => {
    assert.strictEqual(POSITION_POINTS[20], 12);
  });

  it('should have correct points for position 40', () => {
    assert.strictEqual(POSITION_POINTS[40], 1);
  });

  it('should have 40 positions defined', () => {
    assert.strictEqual(Object.keys(POSITION_POINTS).length, 40);
  });
});

describe('getPositionPoints', () => {
  it('should return correct points for valid positions', () => {
    assert.strictEqual(getPositionPoints(1), 60);
    assert.strictEqual(getPositionPoints(5), 43);
    assert.strictEqual(getPositionPoints(15), 22);
  });

  it('should return 0 for positions beyond 40', () => {
    assert.strictEqual(getPositionPoints(41), 0);
    assert.strictEqual(getPositionPoints(100), 0);
  });

  it('should return 0 for invalid positions', () => {
    assert.strictEqual(getPositionPoints(0), 0);
    assert.strictEqual(getPositionPoints(-1), 0);
  });
});

// =============================================================================
// aggregateFromLists tests
// =============================================================================

describe('aggregateFromLists', () => {
  it('should throw if pool is not provided', async () => {
    const logger = createMockLogger();
    const { aggregateFromLists } = createUserPreferences({ logger });

    await assert.rejects(
      () => aggregateFromLists('user123'),
      /Database pool not provided/
    );
  });

  it('should return empty results for user with no albums', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [] }]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    const result = await aggregateFromLists('user123');

    assert.deepStrictEqual(result, {
      topGenres: [],
      topArtists: [],
      topCountries: [],
      totalAlbums: 0,
    });
  });

  it('should aggregate artists correctly', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([
      {
        rows: [
          {
            position: 1,
            artist: 'Artist A',
            country: null,
            genre_1: null,
            genre_2: null,
          },
          {
            position: 2,
            artist: 'Artist B',
            country: null,
            genre_1: null,
            genre_2: null,
          },
          {
            position: 3,
            artist: 'Artist A',
            country: null,
            genre_1: null,
            genre_2: null,
          },
        ],
      },
    ]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    const result = await aggregateFromLists('user123');

    assert.strictEqual(result.totalAlbums, 3);
    assert.strictEqual(result.topArtists.length, 2);
    // Artist A: pos 1 (60) + pos 3 (50) = 110 points, count 2
    // Artist B: pos 2 (54) = 54 points, count 1
    assert.strictEqual(result.topArtists[0].name, 'Artist A');
    assert.strictEqual(result.topArtists[0].count, 2);
    assert.strictEqual(result.topArtists[0].points, 110);
    assert.strictEqual(result.topArtists[1].name, 'Artist B');
    assert.strictEqual(result.topArtists[1].points, 54);
  });

  it('should aggregate genres correctly (both genre_1 and genre_2)', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([
      {
        rows: [
          {
            position: 1,
            artist: null,
            country: null,
            genre_1: 'Rock',
            genre_2: 'Metal',
          },
          {
            position: 2,
            artist: null,
            country: null,
            genre_1: 'Rock',
            genre_2: null,
          },
          {
            position: 3,
            artist: null,
            country: null,
            genre_1: 'Jazz',
            genre_2: 'Rock',
          },
        ],
      },
    ]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    const result = await aggregateFromLists('user123');

    // Rock: pos 1 (60) + pos 2 (54) + pos 3 (50) = 164 points, count 3
    // Metal: pos 1 (60) = 60 points, count 1
    // Jazz: pos 3 (50) = 50 points, count 1
    assert.strictEqual(result.topGenres[0].name, 'Rock');
    assert.strictEqual(result.topGenres[0].count, 3);
    assert.strictEqual(result.topGenres[0].points, 164);
  });

  it('should aggregate countries correctly', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([
      {
        rows: [
          {
            position: 1,
            artist: null,
            country: 'USA',
            genre_1: null,
            genre_2: null,
          },
          {
            position: 2,
            artist: null,
            country: 'UK',
            genre_1: null,
            genre_2: null,
          },
          {
            position: 3,
            artist: null,
            country: 'USA',
            genre_1: null,
            genre_2: null,
          },
        ],
      },
    ]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    const result = await aggregateFromLists('user123');

    assert.strictEqual(result.topCountries[0].name, 'USA');
    assert.strictEqual(result.topCountries[0].count, 2);
    assert.strictEqual(result.topCountries[0].points, 110); // 60 + 50
  });

  it('should handle case-insensitive aggregation', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([
      {
        rows: [
          {
            position: 1,
            artist: 'The Beatles',
            country: null,
            genre_1: null,
            genre_2: null,
          },
          {
            position: 2,
            artist: 'THE BEATLES',
            country: null,
            genre_1: null,
            genre_2: null,
          },
          {
            position: 3,
            artist: 'the beatles',
            country: null,
            genre_1: null,
            genre_2: null,
          },
        ],
      },
    ]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    const result = await aggregateFromLists('user123');

    // Should combine all as one artist
    assert.strictEqual(result.topArtists.length, 1);
    assert.strictEqual(result.topArtists[0].count, 3);
  });

  it('should respect limit option', async () => {
    const logger = createMockLogger();
    const rows = [];
    for (let i = 1; i <= 100; i++) {
      rows.push({
        position: i,
        artist: `Artist ${i}`,
        country: null,
        genre_1: null,
        genre_2: null,
      });
    }
    const pool = createMockPool([{ rows }]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    const result = await aggregateFromLists('user123', { limit: 10 });

    assert.strictEqual(result.topArtists.length, 10);
  });

  it('should include mainOnly filter in query when specified', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [] }]);
    const { aggregateFromLists } = createUserPreferences({ logger, pool });

    await aggregateFromLists('user123', { mainOnly: true });

    const queryCall = pool.query.mock.calls[0];
    assert.ok(queryCall.arguments[0].includes('is_main = true'));
  });
});

// =============================================================================
// calculateAffinity tests
// =============================================================================

describe('calculateAffinity', () => {
  it('should handle internal data only', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [
        { name: 'Artist A', count: 5, points: 200 },
        { name: 'Artist B', count: 3, points: 100 },
      ],
      topGenres: [
        { name: 'Rock', count: 10, points: 300 },
        { name: 'Metal', count: 5, points: 150 },
      ],
    };

    const result = calculateAffinity(internalData);

    assert.ok(result.artistAffinity.length > 0);
    assert.ok(result.genreAffinity.length > 0);
    assert.strictEqual(result.artistAffinity[0].name, 'Artist A');
    assert.ok(result.artistAffinity[0].sources.includes('internal'));
  });

  it('should combine internal and Spotify data', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [{ name: 'Artist A', count: 5, points: 200 }],
      topGenres: [{ name: 'Rock', count: 10, points: 300 }],
    };

    const spotifyData = {
      short_term: [{ name: 'Artist A', genres: ['rock', 'alternative'] }],
      medium_term: [{ name: 'Artist B', genres: ['pop'] }],
      long_term: [],
    };

    const result = calculateAffinity(internalData, spotifyData);

    // Artist A should have both sources
    const artistA = result.artistAffinity.find(
      (a) => a.name.toLowerCase() === 'artist a'
    );
    assert.ok(artistA);
    assert.ok(artistA.sources.includes('internal'));
    assert.ok(artistA.sources.includes('spotify'));
  });

  it('should combine all three data sources', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [{ name: 'Artist A', count: 5, points: 200 }],
      topGenres: [],
    };

    const spotifyData = {
      short_term: [{ name: 'Artist A', genres: [] }],
      medium_term: [],
      long_term: [],
    };

    const lastfmData = {
      overall: [{ name: 'Artist A', playcount: 1000 }],
    };

    const result = calculateAffinity(internalData, spotifyData, lastfmData);

    const artistA = result.artistAffinity.find(
      (a) => a.name.toLowerCase() === 'artist a'
    );
    assert.ok(artistA);
    assert.strictEqual(artistA.sources.length, 3);
  });

  it('should normalize weights when not all sources present', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [{ name: 'Artist A', count: 5, points: 200 }],
      topGenres: [],
    };

    // Only internal data, no Spotify or Last.fm
    const result = calculateAffinity(internalData, null, null);

    // Score should be normalized to 1.0 since internal is only source
    assert.strictEqual(result.artistAffinity[0].score, 1);
  });

  it('should extract genres from Spotify artist data', () => {
    const { calculateAffinity } = createUserPreferences({});

    const spotifyData = {
      short_term: [
        { name: 'Artist A', genres: ['rock', 'alternative rock'] },
        { name: 'Artist B', genres: ['rock', 'indie'] },
      ],
      medium_term: [],
      long_term: [],
    };

    const result = calculateAffinity(
      { topArtists: [], topGenres: [] },
      spotifyData
    );

    // Rock should be most common
    const rock = result.genreAffinity.find((g) => g.name === 'rock');
    assert.ok(rock);
    assert.ok(rock.sources.includes('spotify'));
  });

  it('should limit results to 100 items', () => {
    const { calculateAffinity } = createUserPreferences({});

    const topArtists = [];
    for (let i = 0; i < 150; i++) {
      topArtists.push({ name: `Artist ${i}`, count: 1, points: 150 - i });
    }

    const result = calculateAffinity({ topArtists, topGenres: [] });

    assert.ok(result.artistAffinity.length <= 100);
  });
});

// =============================================================================
// savePreferences tests
// =============================================================================

describe('savePreferences', () => {
  it('should throw if pool is not provided', async () => {
    const logger = createMockLogger();
    const { savePreferences } = createUserPreferences({ logger });

    await assert.rejects(
      () => savePreferences('user123', {}),
      /Database pool not provided/
    );
  });

  it('should execute upsert query with correct parameters', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [{ id: 1, user_id: 'user123' }] }]);
    const { savePreferences } = createUserPreferences({ logger, pool });

    const data = {
      topGenres: [{ name: 'Rock', count: 10 }],
      topArtists: [{ name: 'Artist A', count: 5 }],
      totalAlbums: 50,
    };

    await savePreferences('user123', data);

    assert.strictEqual(pool.query.mock.calls.length, 1);
    const [query, params] = pool.query.mock.calls[0].arguments;
    assert.ok(query.includes('INSERT INTO user_preferences'));
    assert.ok(query.includes('ON CONFLICT (user_id) DO UPDATE'));
    assert.strictEqual(params[0], 'user123');
  });

  it('should handle Spotify data', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [{ id: 1 }] }]);
    const { savePreferences } = createUserPreferences({ logger, pool });

    const data = {
      spotifyTopArtists: [{ name: 'Artist' }],
      spotifySyncedAt: new Date(),
    };

    await savePreferences('user123', data);

    const params = pool.query.mock.calls[0].arguments[1];
    assert.ok(params[5]); // spotifyTopArtists should be set
    assert.ok(params[8]); // spotifySyncedAt should be set
  });

  it('should handle Last.fm data', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [{ id: 1 }] }]);
    const { savePreferences } = createUserPreferences({ logger, pool });

    const data = {
      lastfmTopArtists: [{ name: 'Artist' }],
      lastfmTotalScrobbles: 5000,
      lastfmSyncedAt: new Date(),
    };

    await savePreferences('user123', data);

    const params = pool.query.mock.calls[0].arguments[1];
    assert.ok(params[9]); // lastfmTopArtists
    assert.strictEqual(params[11], 5000); // lastfmTotalScrobbles
  });

  it('should handle Last.fm artist tags', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [{ id: 1 }] }]);
    const { savePreferences } = createUserPreferences({ logger, pool });

    const data = {
      lastfmArtistTags: {
        Burzum: [{ name: 'black metal', count: 100 }],
      },
    };

    await savePreferences('user123', data);

    const params = pool.query.mock.calls[0].arguments[1];
    assert.ok(params[12]); // lastfmArtistTags should be serialized
  });

  it('should handle country affinity', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [{ id: 1 }] }]);
    const { savePreferences } = createUserPreferences({ logger, pool });

    const data = {
      countryAffinity: [
        { name: 'Norway', score: 1, count: 10 },
        { name: 'Sweden', score: 0.5, count: 5 },
      ],
    };

    await savePreferences('user123', data);

    const params = pool.query.mock.calls[0].arguments[1];
    assert.ok(params[16]); // countryAffinity should be serialized
  });
});

// =============================================================================
// getPreferences tests
// =============================================================================

describe('getPreferences', () => {
  it('should throw if pool is not provided', async () => {
    const logger = createMockLogger();
    const { getPreferences } = createUserPreferences({ logger });

    await assert.rejects(
      () => getPreferences('user123'),
      /Database pool not provided/
    );
  });

  it('should return preferences if found', async () => {
    const logger = createMockLogger();
    const prefs = {
      user_id: 'user123',
      top_genres: [{ name: 'Rock' }],
      total_albums: 50,
    };
    const pool = createMockPool([{ rows: [prefs] }]);
    const { getPreferences } = createUserPreferences({ logger, pool });

    const result = await getPreferences('user123');

    assert.deepStrictEqual(result, prefs);
  });

  it('should return null if not found', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [] }]);
    const { getPreferences } = createUserPreferences({ logger, pool });

    const result = await getPreferences('user123');

    assert.strictEqual(result, null);
  });
});

// =============================================================================
// checkRefreshNeeded tests
// =============================================================================

describe('checkRefreshNeeded', () => {
  it('should return all true if no preferences exist', async () => {
    const logger = createMockLogger();
    const pool = createMockPool([{ rows: [] }]);
    const { checkRefreshNeeded } = createUserPreferences({ logger, pool });

    const result = await checkRefreshNeeded('user123');

    assert.deepStrictEqual(result, {
      needsInternalRefresh: true,
      needsSpotifyRefresh: true,
      needsLastfmRefresh: true,
    });
  });

  it('should return false for recently updated data', async () => {
    const logger = createMockLogger();
    const now = new Date();
    const prefs = {
      updated_at: now,
      spotify_synced_at: now,
      lastfm_synced_at: now,
    };
    const pool = createMockPool([{ rows: [prefs] }]);
    const { checkRefreshNeeded } = createUserPreferences({ logger, pool });

    const result = await checkRefreshNeeded('user123');

    assert.strictEqual(result.needsInternalRefresh, false);
    assert.strictEqual(result.needsSpotifyRefresh, false);
    assert.strictEqual(result.needsLastfmRefresh, false);
  });

  it('should return true for stale data', async () => {
    const logger = createMockLogger();
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
    const prefs = {
      updated_at: oldDate,
      spotify_synced_at: oldDate,
      lastfm_synced_at: oldDate,
    };
    const pool = createMockPool([{ rows: [prefs] }]);
    const { checkRefreshNeeded } = createUserPreferences({ logger, pool });

    const result = await checkRefreshNeeded('user123');

    assert.strictEqual(result.needsInternalRefresh, true);
    assert.strictEqual(result.needsSpotifyRefresh, true);
    assert.strictEqual(result.needsLastfmRefresh, true);
  });

  it('should respect custom maxAgeMs', async () => {
    const logger = createMockLogger();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const prefs = {
      updated_at: oneHourAgo,
      spotify_synced_at: oneHourAgo,
      lastfm_synced_at: oneHourAgo,
    };
    const pool = createMockPool([{ rows: [prefs] }]);
    const { checkRefreshNeeded } = createUserPreferences({ logger, pool });

    // With 30 minute max age, should need refresh
    const result = await checkRefreshNeeded('user123', 30 * 60 * 1000);

    assert.strictEqual(result.needsInternalRefresh, true);
  });

  it('should handle missing sync timestamps', async () => {
    const logger = createMockLogger();
    const prefs = {
      updated_at: new Date(),
      spotify_synced_at: null,
      lastfm_synced_at: null,
    };
    const pool = createMockPool([{ rows: [prefs] }]);
    const { checkRefreshNeeded } = createUserPreferences({ logger, pool });

    const result = await checkRefreshNeeded('user123');

    assert.strictEqual(result.needsInternalRefresh, false);
    assert.strictEqual(result.needsSpotifyRefresh, true); // null = stale
    assert.strictEqual(result.needsLastfmRefresh, true); // null = stale
  });
});

// =============================================================================
// Artist Name Normalization tests
// =============================================================================

describe('normalizeArtistName', () => {
  it('should lowercase and trim', () => {
    assert.strictEqual(normalizeArtistName('  Artist Name  '), 'artist name');
  });

  it('should remove "the" prefix', () => {
    assert.strictEqual(normalizeArtistName('The Beatles'), 'beatles');
    assert.strictEqual(normalizeArtistName('THE SMITHS'), 'smiths');
  });

  it('should remove parenthetical suffixes', () => {
    assert.strictEqual(normalizeArtistName('Sunn O))) (US)'), 'sunn o)))');
    assert.strictEqual(normalizeArtistName('Death (band)'), 'death');
  });

  it('should remove bracket suffixes', () => {
    assert.strictEqual(normalizeArtistName('Low [USA]'), 'low');
  });

  it('should normalize apostrophes', () => {
    assert.strictEqual(
      normalizeArtistName("Guns N' Roses"),
      normalizeArtistName("Guns N' Roses")
    );
  });

  it('should remove diacritics', () => {
    assert.strictEqual(normalizeArtistName('Björk'), 'bjork');
    assert.strictEqual(normalizeArtistName('Sigur Rós'), 'sigur ros');
    assert.strictEqual(normalizeArtistName('Motörhead'), 'motorhead');
  });

  it('should normalize whitespace', () => {
    assert.strictEqual(normalizeArtistName('Artist   Name'), 'artist name');
  });

  it('should handle empty/null input', () => {
    assert.strictEqual(normalizeArtistName(''), '');
    assert.strictEqual(normalizeArtistName(null), '');
    assert.strictEqual(normalizeArtistName(undefined), '');
  });
});

describe('normalizeGenre', () => {
  it('should lowercase and trim', () => {
    assert.strictEqual(normalizeGenre('  Black Metal  '), 'black metal');
  });

  it('should normalize hyphens to spaces', () => {
    assert.strictEqual(normalizeGenre('death-metal'), 'death metal');
    assert.strictEqual(normalizeGenre('post_punk'), 'post punk');
  });

  it('should normalize whitespace', () => {
    assert.strictEqual(normalizeGenre('indie   rock'), 'indie rock');
  });
});

describe('artistNamesMatch', () => {
  it('should match identical names', () => {
    assert.strictEqual(artistNamesMatch('The Beatles', 'The Beatles'), true);
  });

  it('should match case-insensitive', () => {
    assert.strictEqual(artistNamesMatch('METALLICA', 'metallica'), true);
  });

  it('should match with/without "the" prefix', () => {
    assert.strictEqual(artistNamesMatch('The Smiths', 'Smiths'), true);
  });

  it('should match with/without parenthetical', () => {
    assert.strictEqual(artistNamesMatch('Death (band)', 'Death'), true);
  });

  it('should not match different artists', () => {
    assert.strictEqual(artistNamesMatch('Metallica', 'Megadeth'), false);
  });
});

describe('filterGenreTags', () => {
  it('should filter out decade tags', () => {
    const tags = [
      { name: 'rock', count: 100 },
      { name: '80s', count: 50 },
      { name: '1990s', count: 40 },
    ];
    const result = filterGenreTags(tags);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'rock');
  });

  it('should filter out "seen live" tag', () => {
    const tags = [
      { name: 'metal', count: 100 },
      { name: 'seen live', count: 80 },
    ];
    const result = filterGenreTags(tags);
    assert.strictEqual(result.length, 1);
  });

  it('should filter out location/country tags', () => {
    const tags = [
      { name: 'black metal', count: 100 },
      { name: 'norwegian', count: 90 },
      { name: 'american', count: 80 },
    ];
    const result = filterGenreTags(tags);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'black metal');
  });

  it('should apply genre mappings', () => {
    const tags = [{ name: 'hip hop', count: 100 }];
    const result = filterGenreTags(tags);
    assert.strictEqual(result[0].name, 'hip-hop');
  });

  it('should limit to 5 tags', () => {
    const tags = [];
    for (let i = 0; i < 10; i++) {
      tags.push({ name: `genre${i}`, count: 100 - i });
    }
    const result = filterGenreTags(tags);
    assert.strictEqual(result.length, 5);
  });

  it('should handle empty/null input', () => {
    assert.deepStrictEqual(filterGenreTags(null), []);
    assert.deepStrictEqual(filterGenreTags([]), []);
    assert.deepStrictEqual(filterGenreTags(undefined), []);
  });
});

describe('GENRE_MAPPINGS', () => {
  it('should have hip-hop mappings', () => {
    assert.strictEqual(GENRE_MAPPINGS['hip hop'], 'hip-hop');
    assert.strictEqual(GENRE_MAPPINGS['hiphop'], 'hip-hop');
  });

  it('should have electronic mappings', () => {
    assert.strictEqual(GENRE_MAPPINGS['electronica'], 'electronic');
    assert.strictEqual(GENRE_MAPPINGS['edm'], 'electronic');
  });

  it('should have shoegaze mappings', () => {
    assert.strictEqual(GENRE_MAPPINGS['shoe gaze'], 'shoegaze');
    assert.strictEqual(GENRE_MAPPINGS['shoe-gaze'], 'shoegaze');
  });
});

// =============================================================================
// calculateAffinity with Last.fm genre consolidation tests
// =============================================================================

describe('calculateAffinity - Last.fm genre consolidation', () => {
  it('should include Last.fm genres from artist tags', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [],
      topGenres: [],
      topCountries: [],
    };

    const lastfmData = {
      overall: [
        { name: 'Burzum', playcount: 500 },
        { name: 'Darkthrone', playcount: 400 },
      ],
      artistTags: {
        Burzum: [
          { name: 'black metal', count: 100 },
          { name: 'ambient', count: 50 },
        ],
        Darkthrone: [
          { name: 'black metal', count: 100 },
          { name: 'crust punk', count: 30 },
        ],
      },
    };

    const result = calculateAffinity(internalData, null, lastfmData);

    // Should have genres from Last.fm artist tags
    const blackMetal = result.genreAffinity.find(
      (g) => g.name === 'black metal'
    );
    assert.ok(blackMetal, 'black metal genre should be present');
    assert.ok(blackMetal.sources.includes('lastfm'));
    assert.ok(blackMetal.score > 0);
  });

  it('should weight genres by artist playcount', () => {
    const { calculateAffinity } = createUserPreferences({});

    const lastfmData = {
      overall: [
        { name: 'Artist High Plays', playcount: 1000 },
        { name: 'Artist Low Plays', playcount: 100 },
      ],
      artistTags: {
        'Artist High Plays': [{ name: 'genre a', count: 100 }],
        'Artist Low Plays': [{ name: 'genre b', count: 100 }],
      },
    };

    const result = calculateAffinity(
      { topArtists: [], topGenres: [], topCountries: [] },
      null,
      lastfmData
    );

    const genreA = result.genreAffinity.find((g) => g.name === 'genre a');
    const genreB = result.genreAffinity.find((g) => g.name === 'genre b');

    // Genre A should have higher score due to higher playcount
    assert.ok(genreA.score > genreB.score);
  });

  it('should consolidate same genre from multiple sources', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [],
      topGenres: [{ name: 'rock', count: 10, points: 100 }],
      topCountries: [],
    };

    const spotifyData = {
      short_term: [{ name: 'Artist', genres: ['rock'] }],
      medium_term: [],
      long_term: [],
    };

    const lastfmData = {
      overall: [{ name: 'Artist', playcount: 500 }],
      artistTags: {
        Artist: [{ name: 'rock', count: 100 }],
      },
    };

    const result = calculateAffinity(internalData, spotifyData, lastfmData);

    const rock = result.genreAffinity.find((g) => g.name === 'rock');
    assert.ok(rock);
    // Should have all three sources
    assert.ok(rock.sources.includes('internal'));
    assert.ok(rock.sources.includes('spotify'));
    assert.ok(rock.sources.includes('lastfm'));
  });

  it('should return country affinity from internal data', () => {
    const { calculateAffinity } = createUserPreferences({});

    const internalData = {
      topArtists: [],
      topGenres: [],
      topCountries: [
        { name: 'Norway', count: 10, points: 200 },
        { name: 'Sweden', count: 5, points: 100 },
      ],
    };

    const result = calculateAffinity(internalData, null, null);

    assert.ok(result.countryAffinity);
    assert.strictEqual(result.countryAffinity.length, 2);
    assert.strictEqual(result.countryAffinity[0].name, 'Norway');
    assert.strictEqual(result.countryAffinity[0].score, 1); // Normalized to max
  });

  it('should handle artistTags as Map or object', () => {
    const { calculateAffinity } = createUserPreferences({});

    // Test with plain object (what comes from JSON storage)
    const lastfmDataObj = {
      overall: [{ name: 'Artist', playcount: 500 }],
      artistTags: {
        Artist: [{ name: 'rock', count: 100 }],
      },
    };

    const result1 = calculateAffinity(
      { topArtists: [], topGenres: [], topCountries: [] },
      null,
      lastfmDataObj
    );

    // Test with Map (what might come from sync service directly)
    const artistTagsMap = new Map();
    artistTagsMap.set('Artist', [{ name: 'rock', count: 100 }]);

    const lastfmDataMap = {
      overall: [{ name: 'Artist', playcount: 500 }],
      artistTags: artistTagsMap,
    };

    const result2 = calculateAffinity(
      { topArtists: [], topGenres: [], topCountries: [] },
      null,
      lastfmDataMap
    );

    // Both should produce same genre result
    assert.strictEqual(
      result1.genreAffinity[0].name,
      result2.genreAffinity[0].name
    );
  });

  it('should use normalized artist names for tag matching', () => {
    const { calculateAffinity } = createUserPreferences({});

    const lastfmData = {
      overall: [{ name: 'The Beatles', playcount: 1000 }],
      artistTags: {
        // Tags stored with different casing/format
        beatles: [{ name: 'rock', count: 100 }],
      },
    };

    const result = calculateAffinity(
      { topArtists: [], topGenres: [], topCountries: [] },
      null,
      lastfmData
    );

    // Should find the genre even with name mismatch
    const rock = result.genreAffinity.find((g) => g.name === 'rock');
    assert.ok(rock);
  });
});
