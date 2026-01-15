/**
 * Tests for Album Canonical Deduplication Utilities
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  createAlbumCanonical,
  sanitizeForStorage,
  normalizeForLookup,
  generateInternalAlbumId,
  isBetterCoverImage,
  chooseBetterText,
  chooseBetterTracks,
} = require('../utils/album-canonical');

// ============================================
// HELPER FUNCTION TESTS
// ============================================

describe('normalizeForLookup', () => {
  it('should lowercase and trim strings', () => {
    assert.strictEqual(normalizeForLookup('  AARA  '), 'aara');
    assert.strictEqual(
      normalizeForLookup('Blood Incantation'),
      'blood incantation'
    );
  });

  it('should handle null/undefined/empty values', () => {
    assert.strictEqual(normalizeForLookup(null), '');
    assert.strictEqual(normalizeForLookup(undefined), '');
    assert.strictEqual(normalizeForLookup(''), '');
  });

  it('should convert numbers to string', () => {
    assert.strictEqual(normalizeForLookup(123), '123');
  });

  it('should convert ellipsis to three periods before lowercasing', () => {
    // Ellipsis (U+2026) should become three periods
    assert.strictEqual(normalizeForLookup('…and Oceans'), '...and oceans');
    assert.strictEqual(normalizeForLookup('...and Oceans'), '...and oceans');
    // Both should normalize identically
    assert.strictEqual(
      normalizeForLookup('…and Oceans'),
      normalizeForLookup('...and Oceans')
    );
  });
});

describe('sanitizeForStorage', () => {
  it('should convert ellipsis (U+2026) to three periods', () => {
    assert.strictEqual(sanitizeForStorage('…and Oceans'), '...and Oceans');
    // Preserves original casing (unlike normalizeForLookup)
    assert.strictEqual(sanitizeForStorage('Sigur…Rós'), 'Sigur...Rós');
  });

  it('should convert en-dash and em-dash to hyphen', () => {
    assert.strictEqual(sanitizeForStorage('Album – Title'), 'Album - Title'); // en-dash
    assert.strictEqual(sanitizeForStorage('Album — Title'), 'Album - Title'); // em-dash
  });

  it('should normalize smart quotes to straight quotes', () => {
    // Regular apostrophe stays the same
    assert.strictEqual(sanitizeForStorage("Rock 'n' Roll"), "Rock 'n' Roll");
    // Smart/curly quotes should be converted to straight quotes
    assert.strictEqual(
      sanitizeForStorage('Rock \u2018n\u2019 Roll'),
      "Rock 'n' Roll"
    );
    assert.strictEqual(sanitizeForStorage('\u201cAlbum\u201d'), '"Album"');
  });

  it('should normalize multiple spaces to single space', () => {
    assert.strictEqual(sanitizeForStorage('Artist   Name'), 'Artist Name');
  });

  it('should trim whitespace', () => {
    assert.strictEqual(sanitizeForStorage('  Artist Name  '), 'Artist Name');
  });

  it('should handle null/undefined/empty values', () => {
    assert.strictEqual(sanitizeForStorage(null), '');
    assert.strictEqual(sanitizeForStorage(undefined), '');
    assert.strictEqual(sanitizeForStorage(''), '');
  });

  it('should preserve valid characters', () => {
    // Diacritics should be preserved (for proper display)
    assert.strictEqual(sanitizeForStorage('Björk'), 'Björk');
    assert.strictEqual(sanitizeForStorage('Sigur Rós'), 'Sigur Rós');
    // Regular punctuation preserved
    assert.strictEqual(sanitizeForStorage("Guns N' Roses"), "Guns N' Roses");
  });
});

describe('generateInternalAlbumId', () => {
  it('should generate ID with internal- prefix', () => {
    const id = generateInternalAlbumId();
    assert.ok(id.startsWith('internal-'));
  });

  it('should generate unique IDs', () => {
    const id1 = generateInternalAlbumId();
    const id2 = generateInternalAlbumId();
    assert.notStrictEqual(id1, id2);
  });

  it('should generate valid UUID after prefix', () => {
    const id = generateInternalAlbumId();
    const uuid = id.replace('internal-', '');
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.ok(uuidRegex.test(uuid), `Generated UUID is not valid: ${uuid}`);
  });
});

describe('isBetterCoverImage', () => {
  it('should return false if new image is null', () => {
    const existing = Buffer.from('existing image data');
    assert.strictEqual(isBetterCoverImage(null, existing), false);
  });

  it('should return true if existing image is null', () => {
    const newImg = Buffer.from('new image data');
    assert.strictEqual(isBetterCoverImage(newImg, null), true);
  });

  it('should return true if new image is larger', () => {
    const existing = Buffer.from('small');
    const newImg = Buffer.from('larger image data');
    assert.strictEqual(isBetterCoverImage(newImg, existing), true);
  });

  it('should return false if existing image is larger', () => {
    const existing = Buffer.from('larger existing image data');
    const newImg = Buffer.from('small');
    assert.strictEqual(isBetterCoverImage(newImg, existing), false);
  });

  it('should return false if images are same size', () => {
    const existing = Buffer.from('same');
    const newImg = Buffer.from('size');
    assert.strictEqual(isBetterCoverImage(newImg, existing), false);
  });
});

describe('chooseBetterText', () => {
  it('should return empty string if both are empty', () => {
    assert.strictEqual(chooseBetterText('', ''), '');
    assert.strictEqual(chooseBetterText(null, undefined), '');
  });

  it('should return non-empty value when other is empty', () => {
    assert.strictEqual(chooseBetterText('', 'value'), 'value');
    assert.strictEqual(chooseBetterText('value', ''), 'value');
    assert.strictEqual(chooseBetterText(null, 'value'), 'value');
  });

  it('should prefer longer/more specific value', () => {
    // Full date vs year only
    assert.strictEqual(chooseBetterText('2024', '2024-03-15'), '2024-03-15');
    // Full country name vs abbreviation
    assert.strictEqual(
      chooseBetterText('US', 'United States'),
      'United States'
    );
    // More complete artist name
    assert.strictEqual(
      chooseBetterText('Aara', 'Aara (Switzerland)'),
      'Aara (Switzerland)'
    );
  });

  it('should keep existing if same length', () => {
    assert.strictEqual(chooseBetterText('ABCD', 'EFGH'), 'ABCD');
  });

  it('should trim whitespace before comparing', () => {
    assert.strictEqual(
      chooseBetterText('  short  ', 'longer value'),
      'longer value'
    );
  });
});

describe('chooseBetterTracks', () => {
  it('should return null if both are null/undefined', () => {
    assert.strictEqual(chooseBetterTracks(null, null), null);
    assert.strictEqual(chooseBetterTracks(undefined, null), null);
  });

  it('should return non-null array when other is null', () => {
    const tracks = [{ title: 'Track 1' }];
    assert.deepStrictEqual(chooseBetterTracks(null, tracks), tracks);
    assert.deepStrictEqual(chooseBetterTracks(tracks, null), tracks);
  });

  it('should prefer array with more tracks', () => {
    const short = [{ title: 'Track 1' }];
    const long = [
      { title: 'Track 1' },
      { title: 'Track 2' },
      { title: 'Track 3' },
    ];
    assert.deepStrictEqual(chooseBetterTracks(short, long), long);
    assert.deepStrictEqual(chooseBetterTracks(long, short), long);
  });

  it('should keep existing if same length', () => {
    const existing = [{ title: 'Existing Track' }];
    const newTracks = [{ title: 'New Track' }];
    assert.deepStrictEqual(chooseBetterTracks(existing, newTracks), existing);
  });

  it('should handle non-array values as null', () => {
    const tracks = [{ title: 'Track 1' }];
    assert.deepStrictEqual(chooseBetterTracks('not an array', tracks), tracks);
    assert.deepStrictEqual(chooseBetterTracks(tracks, 'not an array'), tracks);
  });
});

// ============================================
// FACTORY FUNCTION TESTS
// ============================================

describe('createAlbumCanonical', () => {
  it('should throw if pool is not provided', () => {
    assert.throws(
      () => createAlbumCanonical({}),
      /PostgreSQL pool is required/
    );
  });

  it('should create instance with valid pool', () => {
    const mockPool = { query: mock.fn() };
    const canonical = createAlbumCanonical({ pool: mockPool });

    assert.ok(canonical);
    assert.strictEqual(typeof canonical.findByNormalizedName, 'function');
    assert.strictEqual(typeof canonical.findByAlbumId, 'function');
    assert.strictEqual(typeof canonical.smartMergeMetadata, 'function');
    assert.strictEqual(typeof canonical.upsertCanonical, 'function');
  });
});

// ============================================
// FIND BY NORMALIZED NAME TESTS
// ============================================

describe('findByNormalizedName', () => {
  it('should return null for empty artist and album', async () => {
    const mockPool = { query: mock.fn() };
    const canonical = createAlbumCanonical({ pool: mockPool });

    const result = await canonical.findByNormalizedName('', '');

    assert.strictEqual(result, null);
    assert.strictEqual(mockPool.query.mock.calls.length, 0);
  });

  it('should find album by normalized name', async () => {
    const existingAlbum = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      release_date: '2024',
    };

    const mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [existingAlbum] })),
    };
    const canonical = createAlbumCanonical({ pool: mockPool });

    const result = await canonical.findByNormalizedName('  AARA  ', 'eiger');

    assert.deepStrictEqual(result, existingAlbum);
    assert.strictEqual(mockPool.query.mock.calls.length, 1);

    // Check that normalized values were passed
    const queryArgs = mockPool.query.mock.calls[0].arguments;
    assert.strictEqual(queryArgs[1][0], 'aara');
    assert.strictEqual(queryArgs[1][1], 'eiger');
  });

  it('should return null when no album found', async () => {
    const mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [] })),
    };
    const canonical = createAlbumCanonical({ pool: mockPool });

    const result = await canonical.findByNormalizedName(
      'New Artist',
      'New Album'
    );

    assert.strictEqual(result, null);
  });
});

// ============================================
// FIND BY ALBUM ID TESTS
// ============================================

describe('findByAlbumId', () => {
  it('should return null for empty/null album_id', async () => {
    const mockPool = { query: mock.fn() };
    const canonical = createAlbumCanonical({ pool: mockPool });

    assert.strictEqual(await canonical.findByAlbumId(null), null);
    assert.strictEqual(await canonical.findByAlbumId(''), null);
    assert.strictEqual(await canonical.findByAlbumId(undefined), null);
    assert.strictEqual(mockPool.query.mock.calls.length, 0);
  });

  it('should find album by album_id', async () => {
    const existingAlbum = {
      album_id: 'mb-9b8f70b0-1351-41a2-be5c-59a8445a4679',
      artist: 'Kêres',
      album: 'Skryer of the Lighthouse',
      release_date: '2024',
    };

    const mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [existingAlbum] })),
    };
    const canonical = createAlbumCanonical({ pool: mockPool });

    const result = await canonical.findByAlbumId(
      'mb-9b8f70b0-1351-41a2-be5c-59a8445a4679'
    );

    assert.deepStrictEqual(result, existingAlbum);
    assert.strictEqual(mockPool.query.mock.calls.length, 1);

    // Verify the album_id was passed correctly
    const queryArgs = mockPool.query.mock.calls[0].arguments;
    assert.strictEqual(
      queryArgs[1][0],
      'mb-9b8f70b0-1351-41a2-be5c-59a8445a4679'
    );
  });

  it('should return null when no album found by ID', async () => {
    const mockPool = {
      query: mock.fn(() => Promise.resolve({ rows: [] })),
    };
    const canonical = createAlbumCanonical({ pool: mockPool });

    const result = await canonical.findByAlbumId('nonexistent-id');

    assert.strictEqual(result, null);
  });
});

// ============================================
// SMART MERGE METADATA TESTS
// ============================================

describe('smartMergeMetadata', () => {
  let canonical;

  beforeEach(() => {
    const mockPool = { query: mock.fn() };
    canonical = createAlbumCanonical({ pool: mockPool });
  });

  it('should prefer external album_id over internal', () => {
    const existing = {
      album_id: 'internal-123',
      artist: 'Aara',
      album: 'Eiger',
    };
    const newData = { album_id: 'spotify-456', artist: 'Aara', album: 'Eiger' };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.strictEqual(merged.album_id, 'spotify-456');
  });

  it('should keep external album_id over new external', () => {
    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
    };
    const newData = {
      album_id: 'musicbrainz-456',
      artist: 'Aara',
      album: 'Eiger',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.strictEqual(merged.album_id, 'spotify-123');
  });

  it('should fill missing text fields from new data', () => {
    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      release_date: '',
      country: '',
      genre_1: '',
      genre_2: '',
    };
    const newData = {
      artist: 'Aara',
      album: 'Eiger',
      release_date: '2024-01-15',
      country: 'Switzerland',
      genre_1: 'Black Metal',
      genre_2: 'Atmospheric',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.strictEqual(merged.release_date, '2024-01-15');
    assert.strictEqual(merged.country, 'Switzerland');
    assert.strictEqual(merged.genre_1, 'Black Metal');
    assert.strictEqual(merged.genre_2, 'Atmospheric');
  });

  it('should prefer longer/more specific text values', () => {
    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      release_date: '2024',
      country: 'CH',
      genre_1: 'Metal',
      genre_2: '',
    };
    const newData = {
      artist: 'AARA',
      album: 'EIGER',
      release_date: '2024-01-15',
      country: 'Switzerland',
      genre_1: 'Black Metal',
      genre_2: 'Atmospheric',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    // Longer/more specific values preferred
    assert.strictEqual(merged.release_date, '2024-01-15'); // Full date > year
    assert.strictEqual(merged.country, 'Switzerland'); // Full name > abbreviation
    assert.strictEqual(merged.genre_1, 'Black Metal'); // More specific genre
    // Empty field filled
    assert.strictEqual(merged.genre_2, 'Atmospheric');
  });

  it('should prefer larger cover image', () => {
    const smallImage = Buffer.from('small');
    const largeImage = Buffer.from('this is a much larger image');

    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      cover_image: smallImage,
      cover_image_format: 'JPEG',
    };
    const newData = {
      cover_image: largeImage,
      cover_image_format: 'PNG',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.ok(merged.cover_image.equals(largeImage));
    assert.strictEqual(merged.cover_image_format, 'PNG');
  });

  it('should keep existing cover if larger', () => {
    const largeImage = Buffer.from('this is a much larger existing image');
    const smallImage = Buffer.from('small');

    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      cover_image: largeImage,
      cover_image_format: 'JPEG',
    };
    const newData = {
      cover_image: smallImage,
      cover_image_format: 'PNG',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.ok(merged.cover_image.equals(largeImage));
    assert.strictEqual(merged.cover_image_format, 'JPEG');
  });

  it('should handle base64 cover image in new data', () => {
    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      cover_image: null,
      cover_image_format: '',
    };
    const base64Image = Buffer.from('large image data').toString('base64');
    const newData = {
      cover_image: base64Image,
      cover_image_format: 'PNG',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.ok(Buffer.isBuffer(merged.cover_image));
    assert.strictEqual(merged.cover_image_format, 'PNG');
  });

  it('should preserve existing summary fields (never overwrite)', () => {
    const existing = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      summary: 'Existing summary from Last.fm',
      summary_fetched_at: new Date(),
      summary_source: 'lastfm',
    };
    const newData = {
      summary: 'New summary that should be ignored',
      summary_source: 'wikipedia',
    };

    const merged = canonical.smartMergeMetadata(existing, newData);

    assert.strictEqual(merged.summary, 'Existing summary from Last.fm');
    assert.strictEqual(merged.summary_source, 'lastfm');
  });
});

// ============================================
// UPSERT CANONICAL TESTS
// ============================================

describe('upsertCanonical', () => {
  it('should insert new album when no existing match', async () => {
    let insertedData = null;

    const mockPool = {
      query: mock.fn((sql, values) => {
        if (sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT')) {
          insertedData = values;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    const result = await canonical.upsertCanonical(
      {
        album_id: 'spotify-123',
        artist: 'Aara',
        album: 'Eiger',
        release_date: '2024',
      },
      new Date()
    );

    assert.strictEqual(result.wasInserted, true);
    assert.strictEqual(result.wasMerged, false);
    assert.strictEqual(result.albumId, 'spotify-123');
    assert.ok(insertedData);
    assert.strictEqual(insertedData[0], 'spotify-123'); // album_id
  });

  it('should generate internal ID for albums without external ID', async () => {
    let insertedData = null;

    const mockPool = {
      query: mock.fn((sql, values) => {
        if (sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT')) {
          insertedData = values;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    const result = await canonical.upsertCanonical(
      {
        // No album_id - manual entry
        artist: 'Manual Artist',
        album: 'Manual Album',
      },
      new Date()
    );

    assert.strictEqual(result.wasInserted, true);
    assert.ok(result.albumId.startsWith('internal-'));
    assert.ok(insertedData[0].startsWith('internal-'));
  });

  it('should merge with existing album when match found', async () => {
    let updateCalled = false;

    const existingAlbum = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      release_date: '2024',
      country: '',
      genre_1: '',
      genre_2: '',
      cover_image: null,
      cover_image_format: '',
      tracks: null,
      summary: null,
      summary_fetched_at: null,
      summary_source: null,
    };

    const mockPool = {
      query: mock.fn((sql) => {
        if (sql.includes('SELECT')) {
          return Promise.resolve({ rows: [existingAlbum] });
        }
        if (sql.includes('UPDATE')) {
          updateCalled = true;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    const result = await canonical.upsertCanonical(
      {
        album_id: 'musicbrainz-456', // Different ID
        artist: 'AARA', // Different casing
        album: 'eiger', // Different casing
        country: 'Switzerland', // New data
      },
      new Date()
    );

    assert.strictEqual(result.wasInserted, false);
    assert.strictEqual(result.wasMerged, true);
    assert.strictEqual(result.albumId, 'spotify-123'); // Keeps existing external ID
    assert.ok(updateCalled);
  });

  it('should indicate needsSummaryFetch for new albums', async () => {
    const mockPool = {
      query: mock.fn((sql) => {
        if (sql.includes('SELECT')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    const result = await canonical.upsertCanonical(
      { artist: 'New Artist', album: 'New Album' },
      new Date()
    );

    assert.strictEqual(result.needsSummaryFetch, true);
  });

  it('should indicate needsSummaryFetch false when existing has summary', async () => {
    const existingAlbum = {
      album_id: 'spotify-123',
      artist: 'Aara',
      album: 'Eiger',
      summary_fetched_at: new Date(),
    };

    const mockPool = {
      query: mock.fn((sql) => {
        if (sql.includes('SELECT')) {
          return Promise.resolve({ rows: [existingAlbum] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    const result = await canonical.upsertCanonical(
      { artist: 'Aara', album: 'Eiger' },
      new Date()
    );

    assert.strictEqual(result.needsSummaryFetch, false);
  });

  it('should find existing album by ID when name does not match exactly', async () => {
    // This test covers the bug fix: when an album exists with the same ID
    // but slightly different name spelling, we should merge instead of insert
    const existingAlbum = {
      album_id: 'mb-9b8f70b0-1351-41a2-be5c-59a8445a4679',
      artist: 'Kêres',
      album: 'Skryer of the Lighthouse',
      release_date: '2024',
      country: '',
      genre_1: 'Black Metal',
      genre_2: '',
      cover_image: null,
      cover_image_format: '',
      tracks: null,
      summary: null,
      summary_fetched_at: null,
      summary_source: null,
    };

    let updateCalled = false;
    let queryCount = 0;

    const mockPool = {
      query: mock.fn((sql) => {
        queryCount++;
        // First SELECT: findByNormalizedName - no match (different spelling)
        if (sql.includes('LOWER(TRIM') && queryCount === 1) {
          return Promise.resolve({ rows: [] });
        }
        // Second SELECT: findByAlbumId - match found
        if (sql.includes('WHERE album_id = $1')) {
          return Promise.resolve({ rows: [existingAlbum] });
        }
        // UPDATE: merge metadata
        if (sql.includes('UPDATE')) {
          updateCalled = true;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    // Adding album with same ID but slightly different name
    const result = await canonical.upsertCanonical(
      {
        album_id: 'mb-9b8f70b0-1351-41a2-be5c-59a8445a4679',
        artist: 'Keres', // Different: missing accent
        album: 'Skryer Of The Lighthouse', // Different: capitalization
        country: 'Italy',
      },
      new Date()
    );

    // Should merge, not insert
    assert.strictEqual(result.wasInserted, false);
    assert.strictEqual(result.wasMerged, true);
    assert.strictEqual(
      result.albumId,
      'mb-9b8f70b0-1351-41a2-be5c-59a8445a4679'
    );
    assert.ok(updateCalled, 'UPDATE should have been called for merge');
  });

  it('should insert new album when neither name nor ID matches', async () => {
    let insertCalled = false;
    let queryCount = 0;

    const mockPool = {
      query: mock.fn((sql) => {
        queryCount++;
        // First SELECT: findByNormalizedName - no match
        if (sql.includes('LOWER(TRIM') && queryCount === 1) {
          return Promise.resolve({ rows: [] });
        }
        // Second SELECT: findByAlbumId - no match
        if (sql.includes('WHERE album_id = $1')) {
          return Promise.resolve({ rows: [] });
        }
        // INSERT: new album
        if (sql.includes('INSERT')) {
          insertCalled = true;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };

    const canonical = createAlbumCanonical({
      pool: mockPool,
      logger: { debug: () => {} },
    });

    const result = await canonical.upsertCanonical(
      {
        album_id: 'new-unique-id',
        artist: 'New Artist',
        album: 'New Album',
      },
      new Date()
    );

    assert.strictEqual(result.wasInserted, true);
    assert.strictEqual(result.wasMerged, false);
    assert.strictEqual(result.albumId, 'new-unique-id');
    assert.ok(insertCalled, 'INSERT should have been called');
  });
});
