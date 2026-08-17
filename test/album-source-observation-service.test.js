const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const {
  PROVIDER_HINT_STRATEGY,
  normalizeSourceObservation,
  createAlbumSourceObservationService,
} = require('../services/album-source-observation-service');

function observation(overrides = {}) {
  return {
    schemaVersion: 1,
    source: 'rateyourmusic',
    identity: {
      albumId: 123,
      canonicalUrl: 'https://rateyourmusic.com/release/album/artist/record/',
      artist: 'Artist',
      title: 'Record',
    },
    primaryGenres: ['Rock'],
    secondaryGenres: ['Ambient'],
    descriptors: ['Atmospheric'],
    sourceUrl: 'https://rateyourmusic.com/release/album/artist/record/',
    extractorVersion: 'extension/1',
    complete: true,
    platformLinks: [
      {
        platform: 'spotify',
        url: 'https://open.spotify.com/album/0123456789012345678901',
      },
    ],
    ...overrides,
  };
}

describe('album-source-observation-service normalization', () => {
  it('normalizes the flat contract and one best link per service', () => {
    const normalized = normalizeSourceObservation(
      observation({
        platformLinks: [
          {
            platform: 'youtube',
            url: 'https://www.youtube.com/watch?v=abcdefghijk',
          },
          {
            platform: 'youtube',
            url: 'https://www.youtube.com/playlist?list=PLabcdefghij',
          },
        ],
      })
    );

    assert.strictEqual(normalized.identity.albumId, '123');
    assert.deepStrictEqual(normalized.snapshot.primary_genres, ['Rock']);
    assert.strictEqual(normalized.providerHints.length, 1);
    assert.strictEqual(normalized.providerHints[0].linkType, 'playlist');
  });

  it('accepts a future nested taxonomy object', () => {
    const normalized = normalizeSourceObservation(
      observation({
        primaryGenres: undefined,
        secondaryGenres: undefined,
        descriptors: undefined,
        extractorVersion: undefined,
        complete: undefined,
        taxonomy: {
          primaryGenres: ['Post-Rock'],
          secondaryGenres: [],
          descriptors: ['Cinematic'],
          languages: ['English'],
          scenes: ['Canterbury Scene'],
          movements: ['New Wave'],
          extractorVersion: 'extension/2',
          complete: true,
        },
      })
    );

    assert.deepStrictEqual(normalized.snapshot.primary_genres, ['Post-Rock']);
    assert.deepStrictEqual(normalized.snapshot.descriptors, ['Cinematic']);
    assert.deepStrictEqual(normalized.snapshot.languages, ['English']);
    assert.deepStrictEqual(normalized.snapshot.scenes, ['Canterbury Scene']);
    assert.deepStrictEqual(normalized.snapshot.movements, ['New Wave']);
  });

  it('drops invalid provider hints without discarding identity and taxonomy', () => {
    const normalized = normalizeSourceObservation(
      observation({
        platformLinks: [
          {
            platform: 'spotify',
            url: 'https://open.spotify.com/track/0123456789012345678901',
          },
          {
            platform: 'qobuz',
            url: 'https://www.qobuz.com/us-en/album/example/12345',
          },
        ],
      })
    );

    assert.strictEqual(normalized.identity.albumId, '123');
    assert.deepStrictEqual(normalized.snapshot.primary_genres, ['Rock']);
    assert.deepStrictEqual(
      normalized.providerHints.map((hint) => hint.service),
      ['qobuz']
    );
    assert.strictEqual(normalized.providerWarnings.length, 1);
  });

  it('rejects mismatched or non-RYM canonical URLs before writes', () => {
    assert.throws(
      () =>
        normalizeSourceObservation(
          observation({
            sourceUrl: 'https://rateyourmusic.com/release/album/other/record/',
          })
        ),
      /do not match/
    );
    assert.throws(
      () =>
        normalizeSourceObservation(
          observation({
            identity: {
              canonicalUrl: 'https://example.com/release/album/a/b/',
            },
          })
        ),
      /valid RYM release URL/
    );
  });
});

describe('album-source-observation-service ingestion', () => {
  function harness(mappingResult) {
    const writes = [];
    const repository = {
      upsertCandidate: mock.fn(async (candidate) => {
        writes.push(candidate);
        return (
          mappingResult || {
            album_id: candidate.albumId,
            external_album_id: candidate.externalAlbumId,
            external_url: candidate.externalUrl,
          }
        );
      }),
    };
    const taxonomy = {
      applyRymSnapshot: mock.fn(async () => ({ genre_1: 'Rock' })),
    };
    const client = {
      query: mock.fn(async (sql) =>
        String(sql).includes('SELECT artist, album')
          ? { rows: [{ artist: 'Artist', album: 'Record' }], rowCount: 1 }
          : { rows: [], rowCount: 0 }
      ),
    };
    const service = createAlbumSourceObservationService({
      albumTaxonomyService: taxonomy,
      repositoryFactory: () => repository,
    });
    return { client, repository, service, taxonomy, writes };
  }

  it('claims RYM first, then applies taxonomy and low-rank provider hints', async () => {
    const h = harness();
    const applied = await h.service.apply(h.client, 'album-1', observation(), {
      index: 4,
    });

    assert.strictEqual(applied.result.status, 'applied');
    assert.strictEqual(applied.result.index, 4);
    assert.strictEqual(h.taxonomy.applyRymSnapshot.mock.calls.length, 1);
    assert.strictEqual(h.writes[0].service, 'rateyourmusic');
    assert.strictEqual(h.writes[1].strategy, PROVIDER_HINT_STRATEGY);
    assert.strictEqual(h.writes[1].rank, 10);
    assert.ok(
      h.client.query.mock.calls.some((call) =>
        call.arguments[0].includes('SAVEPOINT')
      )
    );
    assert.match(h.client.query.mock.calls.at(-1).arguments[0], /RELEASE/);
  });

  it('skips the package when another album owns the RYM identity', async () => {
    const h = harness({
      album_id: 'album-other',
      external_album_id: '123',
      external_url: 'https://rateyourmusic.com/release/album/artist/record/',
    });
    const applied = await h.service.apply(h.client, 'album-1', observation());

    assert.strictEqual(applied.result.status, 'skipped');
    assert.strictEqual(applied.warnings[0].code, 'rym_identity_conflict');
    assert.strictEqual(h.taxonomy.applyRymSnapshot.mock.calls.length, 0);
    assert.strictEqual(h.repository.upsertCandidate.mock.calls.length, 1);
    assert.ok(
      h.client.query.mock.calls.some((call) =>
        call.arguments[0].includes('ROLLBACK TO SAVEPOINT')
      )
    );
  });

  it('returns an item warning for invalid enrichment without a savepoint', async () => {
    const h = harness();
    const applied = await h.service.apply(h.client, 'album-1', {
      schemaVersion: 2,
    });

    assert.strictEqual(applied.result.status, 'invalid');
    assert.strictEqual(applied.warnings[0].code, 'invalid_source_observation');
    assert.strictEqual(h.client.query.mock.calls.length, 0);
  });

  it('persists identity-only observations without applying taxonomy', async () => {
    const h = harness();
    const applied = await h.service.apply(
      h.client,
      'album-1',
      observation({
        complete: false,
        primaryGenres: undefined,
        secondaryGenres: undefined,
        descriptors: undefined,
        extractorVersion: undefined,
        identity: {
          numericId: '123',
          canonicalUrl:
            'https://rateyourmusic.com/release/album/artist/record/',
          artist: 'Artist',
          title: 'Record',
        },
      })
    );

    assert.strictEqual(applied.result.status, 'applied');
    assert.strictEqual(h.writes[0].externalAlbumId, '123');
    assert.strictEqual(h.taxonomy.applyRymSnapshot.mock.calls.length, 0);
  });
});
