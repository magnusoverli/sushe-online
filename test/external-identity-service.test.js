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
      if (sql.includes('SELECT')) {
        return {
          rows: [
            {
              external_album_id: 'sp123',
              external_artist: 'Exxul',
              external_album: 'Meteahna Timpurilor',
              external_url: 'https://open.spotify.com/album/sp123',
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
    assert.strictEqual(
      result.external_url,
      'https://open.spotify.com/album/sp123'
    );
    assert.strictEqual(pool.query.mock.calls.length, 2);
    assert.match(pool.query.mock.calls[0].arguments[0], /external_url/);
    assert.match(
      pool.query.mock.calls[1].arguments[0],
      /last_used_at = NOW\(\)/
    );
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

    const insertCall = pool.query.mock.calls.find((call) =>
      call.arguments[0].includes('INSERT INTO album_service_mappings')
    );
    const queryArgs = insertCall.arguments[1];
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

  it('persists external_url and allows target availability services', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
    });

    await service.upsertAlbumServiceMapping({
      albumId: 'album-9',
      service: 'qobuz',
      externalAlbumId: 'qb9',
      externalUrl: 'https://play.qobuz.com/album/9',
      confidence: 0.95,
      strategy: 'availability:itunes',
    });

    const insertCall = pool.query.mock.calls.find((call) =>
      call.arguments[0].includes('INSERT INTO album_service_mappings')
    );
    assert.ok(insertCall);
    const args = insertCall.arguments[1];
    assert.ok(
      insertCall.arguments[0].includes('external_url'),
      'INSERT should include external_url column'
    );
    assert.strictEqual(args[5], 'https://play.qobuz.com/album/9');
  });

  it('preserves availability strategy while repository identity metadata is refreshed', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const albumServiceMappingsRepository = {
      findByAlbumAndService: mock.fn(async () => ({
        strategy: 'availability:musicbrainz',
      })),
      upsertCandidate: mock.fn(async () => ({})),
    };
    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
      albumServiceMappingsRepository,
    });

    await service.upsertAlbumServiceMapping({
      albumId: 'album-9',
      service: 'spotify',
      externalAlbumId: '1234567890123456789012',
      externalUrl: 'https://open.spotify.com/album/1234567890123456789012',
      strategy: 'scored_search',
    });

    const candidate =
      albumServiceMappingsRepository.upsertCandidate.mock.calls[0].arguments[0];
    assert.strictEqual(candidate.strategy, 'availability:musicbrainz');
    assert.strictEqual(candidate.rank, 200);
    assert.strictEqual(
      candidate.externalUrl,
      'https://open.spotify.com/album/1234567890123456789012'
    );
  });

  it('rejects malformed provider URLs instead of creating availability rows', async () => {
    const repository = {
      findByAlbumAndService: mock.fn(),
      upsertCandidate: mock.fn(),
    };
    const service = createExternalIdentityService({
      db: createMockPoolWithQuery(async () => ({ rows: [] })),
      logger: createMockLogger(),
      albumServiceMappingsRepository: repository,
    });

    const result = await service.upsertAlbumServiceMapping({
      albumId: 'album-9',
      service: 'spotify',
      externalUrl: 'https://open.spotify.com/track/0123456789012345678901',
      strategy: 'availability:musicbrainz',
    });

    assert.strictEqual(result, null);
    assert.strictEqual(repository.upsertCandidate.mock.calls.length, 0);
  });

  it('reads target availability rows for an album', async () => {
    const pool = createMockPoolWithQuery(async () => ({
      rows: [
        {
          service: 'qobuz',
          external_url: 'https://play.qobuz.com/album/1',
          strategy: 'availability:qobuz',
        },
        {
          service: 'tidal',
          external_url: 'https://tidal.com/browse/album/1',
          strategy: 'availability:odesli',
        },
      ],
    }));
    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
    });

    const rows = await service.getAlbumAvailability('album-9');

    assert.strictEqual(rows.length, 2);
    assert.ok(
      pool.query.mock.calls[0].arguments[0].includes('ORDER BY service')
    );
    assert.strictEqual(pool.query.mock.calls[0].arguments[1][0], 'album-9');
    assert.deepStrictEqual(pool.query.mock.calls[0].arguments[1][1], [
      'spotify',
      'itunes',
      'qobuz',
      'tidal',
      'bandcamp',
      'soundcloud',
      'youtube',
    ]);
  });

  it('shows valid links without exposing malformed availability rows', async () => {
    const pool = createMockPoolWithQuery(async () => ({
      rows: [
        {
          service: 'youtube',
          external_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          strategy: 'rym:link-hint',
        },
        {
          service: 'spotify',
          external_url: 'https://example.com/not-spotify',
          strategy: 'scored_search',
        },
        {
          service: 'qobuz',
          external_url: 'https://legacy.example/qobuz/1',
          strategy: 'availability:qobuz',
        },
      ],
    }));
    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
    });

    const rows = await service.getAlbumAvailability('album-9');

    assert.deepStrictEqual(
      rows.map((row) => row.service),
      ['youtube']
    );
    assert.match(pool.query.mock.calls[0].arguments[0], /external_url/);
    assert.doesNotMatch(
      pool.query.mock.calls[0].arguments[0],
      /strategy LIKE 'availability:%'/
    );
  });

  it('reads and marks album availability resolution state', async () => {
    const pool = createMockPoolWithQuery(async (sql) => {
      if (sql.includes('SELECT availability_checked_at')) {
        return {
          rows: [
            {
              availability_checked_at: '2026-08-17T00:00:00.000Z',
              availability_resolution_version: 2,
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

    assert.deepStrictEqual(
      await service.getAlbumAvailabilityResolutionState('album-9'),
      { checkedAt: '2026-08-17T00:00:00.000Z', version: 2 }
    );
    await service.markAlbumAvailabilityResolved('album-9', 2);

    assert.match(
      pool.query.mock.calls[1].arguments[0],
      /availability_resolution_version = GREATEST/
    );
    assert.deepStrictEqual(pool.query.mock.calls[1].arguments[1], [
      'album-9',
      2,
    ]);
  });

  it('bulk-reads availability with ANY($1)', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
    });

    await service.getAlbumAvailabilityBulk(['a', 'b']);

    assert.ok(pool.query.mock.calls[0].arguments[0].includes('ANY($1)'));
    assert.deepStrictEqual(pool.query.mock.calls[0].arguments[1][0], [
      'a',
      'b',
    ]);
  });

  it('returns empty without a network/db call for empty availability input', async () => {
    const pool = createMockPoolWithQuery(async () => ({ rows: [] }));
    const service = createExternalIdentityService({
      db: pool,
      logger: createMockLogger(),
    });

    assert.deepStrictEqual(await service.getAlbumAvailability(''), []);
    assert.deepStrictEqual(await service.getAlbumAvailabilityBulk([]), []);
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
