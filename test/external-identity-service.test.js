const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createExternalIdentityService,
} = require('../services/external-identity-service');
const { createMockLogger } = require('./helpers');

function createMockPoolWithQuery(handler) {
  const query = mock.fn(handler);
  // Expose both pg-pool `.query` (so test assertions on `.query.mock.calls`
  // keep working) and the canonical datastore `.raw` (so services that now
  // require `deps.db` accept the same mock).
  return { query, raw: query };
}

describe('external-identity-service', () => {
  it('throws when db is missing', () => {
    assert.throws(
      () => createExternalIdentityService({ logger: createMockLogger() }),
      /external-identity-service requires deps\.db/
    );
  });

  it('returns cached album mapping and updates last_used_at', async () => {
    const pool = createMockPoolWithQuery(async (sql) => {
      if (sql.includes('UPDATE album_service_mappings')) {
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
      db: pool,
      logger: createMockLogger(),
    });
    const result = await service.getAlbumServiceMapping('spotify', 'album-1');

    assert.strictEqual(result.external_album_id, 'sp123');
    assert.strictEqual(pool.query.mock.calls.length, 1);
    assert.ok(pool.query.mock.calls[0].arguments[0].includes('RETURNING'));
  });

  it('skips album mapping upsert for unsupported services', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      db: pool,
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
      db: pool,
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
      if (sql.includes('UPDATE artist_service_aliases')) {
        return { rows: [{ service_artist: 'Exxul' }] };
      }
      return { rows: [] };
    });

    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
    });
    const alias = await service.getArtistAlias(
      'spotify',
      'Eximperituserqethhzebib'
    );

    assert.strictEqual(alias, 'Exxul');
    assert.strictEqual(pool.query.mock.calls.length, 1);
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
      db: pool,
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
      db: pool,
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
      db: pool,
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
