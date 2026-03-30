const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createExternalIdentityService,
} = require('../services/external-identity-service');
const { createMockLogger } = require('./helpers');

function createMockPoolWithQuery(handler) {
  return {
    query: mock.fn(handler),
  };
}

describe('external-identity-service', () => {
  it('throws when pool is missing', () => {
    assert.throws(
      () => createExternalIdentityService({ logger: createMockLogger() }),
      /Database pool is required/
    );
  });

  it('returns cached album mapping and updates last_used_at', async () => {
    const pool = createMockPoolWithQuery(async (sql) => {
      if (sql.includes('SELECT external_album_id')) {
        return {
          rows: [
            {
              external_album_id: 'sp123',
              external_artist: 'Exxul',
              external_album: 'Meteahna Timpurilor',
              confidence: 0.91,
              strategy: 'scored_search',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });
    const result = await service.getAlbumServiceMapping('spotify', 'album-1');

    assert.strictEqual(result.external_album_id, 'sp123');
    assert.strictEqual(pool.query.mock.calls.length, 2);
    assert.ok(
      pool.query.mock.calls[1].arguments[0].includes(
        'UPDATE album_service_mappings'
      )
    );
  });

  it('skips album mapping upsert for unsupported services', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });

    await service.upsertAlbumServiceMapping({
      albumId: 'album-1',
      service: 'apple-music',
      externalAlbumId: 'abc',
    });

    assert.strictEqual(pool.query.mock.calls.length, 0);
  });

  it('sanitizes persisted album mapping text fields', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });

    await service.upsertAlbumServiceMapping({
      albumId: 'album-2',
      service: 'spotify',
      externalAlbumId: 'sp2',
      externalArtist: '  ...and Oceans  ',
      externalAlbum: '  Cypher  ',
      confidence: 0.84,
      strategy: 'scored_search',
    });

    const queryArgs = pool.query.mock.calls[0].arguments[1];
    assert.strictEqual(queryArgs[3], '...and Oceans');
    assert.strictEqual(queryArgs[4], 'Cypher');
  });

  it('returns artist alias and refreshes last_used_at', async () => {
    const pool = createMockPoolWithQuery(async (sql) => {
      if (sql.includes('SELECT service_artist')) {
        return { rows: [{ service_artist: 'Exxul' }] };
      }
      return { rows: [] };
    });

    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });
    const alias = await service.getArtistAlias(
      'spotify',
      'Eximperituserqethhzebib'
    );

    assert.strictEqual(alias, 'Exxul');
    assert.strictEqual(pool.query.mock.calls.length, 2);
  });

  it('dedupes alias candidates', async () => {
    const pool = createMockPoolWithQuery(async () => ({
      rows: [
        { service: 'lastfm', service_artist: 'Exxul' },
        { service: 'spotify', service_artist: 'Exxul' },
        { service: 'spotify', service_artist: 'Eximperitus' },
      ],
    }));

    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });

    const aliases = await service.getArtistAliasCandidates(
      'spotify',
      'Eximperituserqethhzebib',
      { includeCrossService: true }
    );

    assert.deepStrictEqual(aliases, ['Exxul', 'Eximperitus']);
  });

  it('ignores invalid artist alias upserts', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });

    await service.upsertArtistAlias({
      service: 'spotify',
      canonicalArtist: '',
      serviceArtist: 'Exxul',
    });

    assert.strictEqual(pool.query.mock.calls.length, 0);
  });

  it('normalizes canonical/service keys when upserting artist aliases', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      pool,
      logger: createMockLogger(),
    });

    await service.upsertArtistAlias({
      service: 'spotify',
      canonicalArtist: 'The Exxul',
      serviceArtist: 'Exxûl',
      sourceAlbumId: 'album-3',
      confidence: 0.95,
    });

    const args = pool.query.mock.calls[0].arguments[1];
    assert.strictEqual(args[0], 'exxul');
    assert.strictEqual(args[3], 'exxul');
    assert.strictEqual(args[6], 'album-3');
  });
});
