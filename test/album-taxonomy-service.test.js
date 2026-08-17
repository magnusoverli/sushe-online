const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

const { TransactionAbort } = require('../db/transaction');
const {
  createAlbumTaxonomyService,
} = require('../services/album-taxonomy-service');
const { createMockLogger } = require('./helpers');

function rymSnapshot(overrides = {}) {
  return {
    primaryGenres: ['Rock'],
    secondaryGenres: ['Ambient'],
    descriptors: ['Atmospheric'],
    sourceUrl: 'https://rateyourmusic.com/release/album/artist/album/',
    extractorVersion: 'test/1',
    complete: true,
    ...overrides,
  };
}

function createHarness(taxonomy) {
  const client = {
    query: mock.fn(async (sql, params) => {
      if (sql.includes('SELECT album_taxonomy')) {
        return { rows: [{ album_taxonomy: taxonomy }], rowCount: 1 };
      }
      if (sql.includes('UPDATE albums')) {
        return {
          rows: [
            {
              album_id: params[3],
              album_taxonomy: JSON.parse(params[0]),
              genre_1: params[1],
              genre_2: params[2],
              taxonomy_updated_at: '2026-08-17T12:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  const db = {
    withTransaction: mock.fn(async (callback) => callback(client)),
  };
  const logger = createMockLogger();
  return {
    client,
    db,
    logger,
    service: createAlbumTaxonomyService({ db, logger }),
  };
}

describe('album-taxonomy-service', () => {
  it('treats an omitted old-client snapshot as a no-op', async () => {
    const harness = createHarness({ schema_version: 1, manual_overrides: {} });

    const result = await harness.service.applyRymSnapshot('album-1', undefined);

    assert.strictEqual(result, null);
    assert.strictEqual(harness.db.withTransaction.mock.calls.length, 0);
    assert.strictEqual(harness.client.query.mock.calls.length, 0);
  });

  it('locks, replaces RYM, reconciles matching legacy values, and preserves mismatches', async () => {
    const harness = createHarness({
      schema_version: 1,
      manual_overrides: {
        genre_1: { value: ' rock ', source: 'legacy_backfill' },
        genre_2: { value: 'Legacy Genre', source: 'legacy_backfill' },
      },
      rym: { primary_genres: ['Old Source'] },
    });

    const result = await harness.service.applyRymSnapshot(
      'album-1',
      rymSnapshot()
    );

    assert.strictEqual(harness.db.withTransaction.mock.calls.length, 1);
    assert.strictEqual(harness.client.query.mock.calls.length, 2);
    assert.match(harness.client.query.mock.calls[0].arguments[0], /FOR UPDATE/);

    const updateCall = harness.client.query.mock.calls[1];
    const stored = JSON.parse(updateCall.arguments[1][0]);
    assert.deepStrictEqual(stored.rym.primary_genres, ['Rock']);
    assert.strictEqual(stored.manual_overrides.genre_1, undefined);
    assert.deepStrictEqual(stored.manual_overrides.genre_2, {
      value: 'Legacy Genre',
      source: 'legacy_backfill',
    });
    assert.strictEqual(updateCall.arguments[1][1], 'Rock');
    assert.strictEqual(updateCall.arguments[1][2], 'Legacy Genre');
    assert.strictEqual(result.genre_1, 'Rock');
    assert.strictEqual(result.genre_2, 'Legacy Genre');
  });

  it('uses a supplied transaction client without starting another transaction', async () => {
    const harness = createHarness({ schema_version: 1, manual_overrides: {} });

    await harness.service.applyRymSnapshot('album-1', rymSnapshot(), {
      client: harness.client,
    });

    assert.strictEqual(harness.db.withTransaction.mock.calls.length, 0);
    assert.strictEqual(harness.client.query.mock.calls.length, 2);
  });

  it('preserves optional RYM fields when omitted and clears explicit empty arrays', async () => {
    const storedTaxonomy = {
      schema_version: 1,
      manual_overrides: {},
      rym: {
        primary_genres: ['Old'],
        secondary_genres: [],
        descriptors: [],
        languages: ['English'],
        scenes: ['Canterbury Scene'],
        movements: ['New Wave'],
      },
    };
    const preserving = createHarness(storedTaxonomy);
    await preserving.service.applyRymSnapshot('album-1', rymSnapshot());
    const preserved = JSON.parse(
      preserving.client.query.mock.calls[1].arguments[1][0]
    ).rym;

    assert.deepStrictEqual(preserved.languages, ['English']);
    assert.deepStrictEqual(preserved.scenes, ['Canterbury Scene']);
    assert.deepStrictEqual(preserved.movements, ['New Wave']);

    const clearing = createHarness(storedTaxonomy);
    await clearing.service.applyRymSnapshot(
      'album-1',
      rymSnapshot({ languages: [], scenes: [], movements: [] })
    );
    const cleared = JSON.parse(
      clearing.client.query.mock.calls[1].arguments[1][0]
    ).rym;
    assert.deepStrictEqual(cleared.languages, []);
    assert.deepStrictEqual(cleared.scenes, []);
    assert.deepStrictEqual(cleared.movements, []);
  });

  it('sets normalized manual values with attribution but omits attribution from results', async () => {
    const harness = createHarness({
      schema_version: 1,
      manual_overrides: {},
      rym: {
        primary_genres: ['Rock'],
        secondary_genres: ['Ambient'],
        descriptors: [],
        source_url: 'https://rateyourmusic.com/release/album/artist/album/',
        extractor_version: 'test/1',
        complete: true,
      },
    });

    const result = await harness.service.applyManualGenreOverrides(
      'album-1',
      { genre_1: '  Dream\tPop ' },
      { updatedBy: 'user-private-id' }
    );

    const updateParams = harness.client.query.mock.calls[1].arguments[1];
    const stored = JSON.parse(updateParams[0]);
    assert.strictEqual(stored.manual_overrides.genre_1.value, 'Dream Pop');
    assert.strictEqual(stored.manual_overrides.genre_1.source, 'manual');
    assert.strictEqual(
      stored.manual_overrides.genre_1.updated_by,
      'user-private-id'
    );
    assert.ok(stored.manual_overrides.genre_1.updated_at);
    assert.strictEqual(updateParams[1], 'Dream Pop');
    assert.strictEqual(updateParams[2], 'Ambient');
    assert.strictEqual(
      result.album_taxonomy.manual_overrides.genre_1.value,
      'Dream Pop'
    );
    assert.strictEqual(
      result.album_taxonomy.manual_overrides.genre_1.source,
      'manual'
    );
    assert.ok(result.album_taxonomy.manual_overrides.genre_1.updated_at);
    assert.strictEqual(
      JSON.stringify(result.album_taxonomy).includes('updated_by'),
      false
    );
  });

  it('stores an explicit blank override with null', async () => {
    const harness = createHarness({
      schema_version: 1,
      manual_overrides: {
        genre_1: { value: 'Manual Rock', source: 'manual', updated_by: 'user' },
        genre_2: {
          value: 'Manual Ambient',
          source: 'manual',
          updated_by: 'user',
        },
      },
      rym: {
        primary_genres: ['Rock'],
        secondary_genres: ['Ambient'],
      },
    });

    await harness.service.applyManualGenreOverrides('album-1', {
      genre_1: null,
    });

    const params = harness.client.query.mock.calls[1].arguments[1];
    const stored = JSON.parse(params[0]);
    assert.strictEqual(stored.manual_overrides.genre_1.value, null);
    assert.strictEqual(stored.manual_overrides.genre_2.value, 'Manual Ambient');
    assert.strictEqual(params[1], '');
    assert.strictEqual(params[2], 'Manual Ambient');
  });

  it('resets all manual overrides through the explicit reset method', async () => {
    const harness = createHarness({
      schema_version: 1,
      manual_overrides: {
        genre_1: { value: 'Manual Rock', source: 'manual' },
        genre_2: { value: 'Manual Ambient', source: 'manual' },
      },
      rym: {
        primary_genres: ['Rock', 'Post-Rock'],
        secondary_genres: [],
      },
    });

    await harness.service.resetManualGenreOverrides('album-1');

    const params = harness.client.query.mock.calls[1].arguments[1];
    const stored = JSON.parse(params[0]);
    assert.deepStrictEqual(stored.manual_overrides, {});
    assert.strictEqual(params[1], 'Rock');
    assert.strictEqual(params[2], 'Post-Rock');
  });

  it('returns a 404 transaction abort when the locked album does not exist', async () => {
    const client = {
      query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    };
    const db = {
      withTransaction: mock.fn(async (callback) => callback(client)),
    };
    const service = createAlbumTaxonomyService({
      db,
      logger: createMockLogger(),
    });

    await assert.rejects(
      () => service.applyRymSnapshot('missing', rymSnapshot()),
      (error) => {
        assert.ok(error instanceof TransactionAbort);
        assert.strictEqual(error.statusCode, 404);
        assert.strictEqual(error.body.error, 'Album not found');
        return true;
      }
    );
    assert.strictEqual(client.query.mock.calls.length, 1);
  });

  it('validates snapshots before opening a transaction', async () => {
    const harness = createHarness({ schema_version: 1, manual_overrides: {} });

    await assert.rejects(
      () =>
        harness.service.applyRymSnapshot(
          'album-1',
          rymSnapshot({ complete: false })
        ),
      /must be complete/
    );
    assert.strictEqual(harness.db.withTransaction.mock.calls.length, 0);
  });
});
