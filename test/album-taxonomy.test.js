const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  MAX_DESCRIPTORS,
  MAX_EXTRACTOR_VERSION_LENGTH,
  MAX_LANGUAGES,
  MAX_MOVEMENTS,
  MAX_PRIMARY_GENRES,
  MAX_SECONDARY_GENRES,
  MAX_SCENES,
  MAX_SOURCE_URL_LENGTH,
  MAX_TERM_LENGTH,
  deriveGenreProjection,
  normalizeRymSnapshot,
  projectTaxonomyForRead,
} = require('../utils/album-taxonomy');

function validSnapshot(overrides = {}) {
  return {
    primaryGenres: ['Post-Rock'],
    secondaryGenres: ['Ambient'],
    descriptors: ['Atmospheric'],
    sourceUrl: 'https://rateyourmusic.com/release/album/artist/example-album/',
    extractorVersion: 'rym-extension/1.0.0',
    complete: true,
    ...overrides,
  };
}

describe('album-taxonomy utility', () => {
  it('normalizes a complete snapshot into the stored snake_case shape', () => {
    const snapshot = normalizeRymSnapshot(
      validSnapshot({
        primaryGenres: ['  Post\tRock  ', 'post rock', 'Cafe\u0301', '\u0000'],
        secondaryGenres: [' Dream\nPop ', 'DREAM POP'],
        descriptors: [' Warm  ', 'warm', 'Nocturnal'],
        languages: [' English ', 'english'],
        scenes: ['Canterbury Scene'],
        movements: ['Rock Against Communism'],
        extractorVersion: ' extractor\n2 ',
      })
    );

    assert.deepStrictEqual(
      {
        ...snapshot,
        captured_at: undefined,
        received_at: undefined,
      },
      {
        primary_genres: ['Post Rock', 'Café'],
        secondary_genres: ['Dream Pop'],
        descriptors: ['Warm', 'Nocturnal'],
        languages: ['English'],
        scenes: ['Canterbury Scene'],
        movements: ['Rock Against Communism'],
        source_url:
          'https://rateyourmusic.com/release/album/artist/example-album/',
        extractor_version: 'extractor 2',
        captured_at: undefined,
        received_at: undefined,
        complete: true,
      }
    );
    assert.strictEqual(snapshot.captured_at, null);
    assert.ok(snapshot.received_at);
  });

  it('accepts an already snake_case snapshot', () => {
    const normalized = normalizeRymSnapshot({
      primary_genres: [],
      secondary_genres: ['Drone'],
      descriptors: [],
      source_url: 'https://www.rateyourmusic.com/release/album/artist/example/',
      extractor_version: '2',
      complete: true,
    });

    assert.deepStrictEqual(normalized.primary_genres, []);
    assert.deepStrictEqual(normalized.secondary_genres, ['Drone']);
    assert.strictEqual(Object.hasOwn(normalized, 'languages'), false);
  });

  it('distinguishes omitted optional taxonomy from an explicit empty array', () => {
    const omitted = normalizeRymSnapshot(validSnapshot());
    const explicit = normalizeRymSnapshot(
      validSnapshot({ languages: [], scenes: [], movements: [] })
    );

    assert.strictEqual(Object.hasOwn(omitted, 'languages'), false);
    assert.deepStrictEqual(explicit.languages, []);
    assert.deepStrictEqual(explicit.scenes, []);
    assert.deepStrictEqual(explicit.movements, []);
  });

  it('derives scalar genre projections in established priority order', () => {
    assert.deepStrictEqual(
      deriveGenreProjection({
        primary_genres: ['Rock', 'Shoegaze', 'Noise Pop'],
        secondary_genres: ['Dream Pop'],
      }),
      { genre_1: 'Rock', genre_2: 'Shoegaze' }
    );
    assert.deepStrictEqual(
      deriveGenreProjection({
        primary_genres: ['Rock'],
        secondary_genres: ['Dream Pop'],
      }),
      { genre_1: 'Rock', genre_2: 'Dream Pop' }
    );
    assert.deepStrictEqual(
      deriveGenreProjection({
        primary_genres: [],
        secondary_genres: ['Ambient', 'Drone'],
      }),
      { genre_1: 'Ambient', genre_2: 'Drone' }
    );
    assert.deepStrictEqual(deriveGenreProjection(null), {
      genre_1: '',
      genre_2: '',
    });
  });

  it('requires complete snapshots and all taxonomy arrays', () => {
    assert.throws(
      () => normalizeRymSnapshot(validSnapshot({ complete: false })),
      /must be complete/
    );
    assert.throws(() => {
      const snapshot = validSnapshot();
      delete snapshot.primaryGenres;
      normalizeRymSnapshot(snapshot);
    }, /primaryGenres is required/);
    assert.throws(
      () => normalizeRymSnapshot(validSnapshot({ descriptors: 'Warm' })),
      /descriptors is required and must be an array/
    );
  });

  it('enforces array, term, and extractor version limits', () => {
    assert.throws(
      () =>
        normalizeRymSnapshot(
          validSnapshot({
            primaryGenres: Array(MAX_PRIMARY_GENRES + 1).fill('Rock'),
          })
        ),
      /primaryGenres must have at most 32 items/
    );
    assert.throws(
      () =>
        normalizeRymSnapshot(
          validSnapshot({
            secondaryGenres: Array(MAX_SECONDARY_GENRES + 1).fill('Ambient'),
          })
        ),
      /secondaryGenres must have at most 32 items/
    );
    assert.throws(
      () =>
        normalizeRymSnapshot(
          validSnapshot({ descriptors: Array(MAX_DESCRIPTORS + 1).fill('x') })
        ),
      /descriptors must have at most 128 items/
    );
    for (const [field, limit] of [
      ['languages', MAX_LANGUAGES],
      ['scenes', MAX_SCENES],
      ['movements', MAX_MOVEMENTS],
    ]) {
      assert.throws(
        () =>
          normalizeRymSnapshot(
            validSnapshot({ [field]: Array(limit + 1).fill('x') })
          ),
        new RegExp(`${field} must have at most 32 items`)
      );
    }
    assert.throws(
      () =>
        normalizeRymSnapshot(
          validSnapshot({ primaryGenres: ['x'.repeat(MAX_TERM_LENGTH + 1)] })
        ),
      /must be at most 128 characters/
    );
    assert.throws(
      () => normalizeRymSnapshot(validSnapshot({ primaryGenres: [42] })),
      /primaryGenres\[0\] must be a string/
    );
    assert.throws(
      () =>
        normalizeRymSnapshot(
          validSnapshot({
            extractorVersion: 'v'.repeat(MAX_EXTRACTOR_VERSION_LENGTH + 1),
          })
        ),
      /extractorVersion must be between 1 and 64 characters/
    );
  });

  it('requires an HTTPS RYM host on the dot boundary and an album path', () => {
    const subdomain = normalizeRymSnapshot(
      validSnapshot({
        sourceUrl:
          'https://charts.rateyourmusic.com/release/album/artist/example/',
      })
    );
    assert.strictEqual(
      subdomain.source_url,
      'https://rateyourmusic.com/release/album/artist/example/'
    );

    for (const sourceUrl of [
      'http://rateyourmusic.com/release/album/artist/example/',
      'https://rateyourmusic.com.evil.test/release/album/artist/example/',
      'https://notrateyourmusic.com/release/album/artist/example/',
      'https://rateyourmusic.com/artist/example/',
      'https://rateyourmusic.com/release/album/',
    ]) {
      assert.throws(
        () => normalizeRymSnapshot(validSnapshot({ sourceUrl })),
        /HTTPS Rate Your Music release\/album URL/
      );
    }

    assert.throws(
      () =>
        normalizeRymSnapshot(
          validSnapshot({
            sourceUrl: `https://rateyourmusic.com/release/album/${'x'.repeat(
              MAX_SOURCE_URL_LENGTH
            )}`,
          })
        ),
      /sourceUrl must be between 1 and 2048 characters/
    );
  });

  it('removes updated_by recursively without mutating stored taxonomy', () => {
    const taxonomy = {
      schema_version: 1,
      manual_overrides: {
        genre_1: {
          value: 'Rock',
          source: 'manual',
          updated_by: 'private-user-id',
        },
      },
      rym: { primary_genres: ['Rock'], updated_by: 'unexpected-private-id' },
    };

    const projected = projectTaxonomyForRead(taxonomy);
    assert.deepStrictEqual(projected, {
      schema_version: 1,
      manual_overrides: {
        genre_1: { value: 'Rock', source: 'manual' },
      },
      rym: { primary_genres: ['Rock'] },
    });
    assert.strictEqual(
      taxonomy.manual_overrides.genre_1.updated_by,
      'private-user-id'
    );
  });
});
