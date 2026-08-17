const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  RYM_HINT_RANK,
  VERIFIED_MAPPING_RANK,
  createAlbumServiceMappingsRepository,
} = require('../db/repositories/album-service-mappings-repository');

function rymRow(overrides = {}) {
  return {
    album_id: 'album-1',
    service: 'rateyourmusic',
    external_album_id: null,
    external_artist: null,
    external_album: null,
    external_url: 'https://rateyourmusic.com/release/album/artist/record/',
    confidence: 0.5,
    strategy: 'rym:url-hint',
    ...overrides,
  };
}

describe('album-service-mappings-repository', () => {
  it('requires a DbFacade or transaction client query adapter', () => {
    assert.throws(
      () => createAlbumServiceMappingsRepository(),
      /album-service-mappings-repository requires deps\.db/
    );
  });

  it('reads external_url through a transaction client adapter', async () => {
    const row = rymRow();
    const client = { query: mock.fn(async () => ({ rows: [row] })) };
    const repository = createAlbumServiceMappingsRepository({ db: client });

    const found = await repository.findByAlbumAndService(
      'album-1',
      'RATEYOURMUSIC'
    );

    assert.strictEqual(found.external_url, row.external_url);
    assert.match(client.query.mock.calls[0].arguments[0], /external_url/);
    assert.deepStrictEqual(client.query.mock.calls[0].arguments[1], [
      'album-1',
      'rateyourmusic',
    ]);
  });

  it('looks up RYM mappings by numeric id or canonical URL', async () => {
    const row = rymRow({ external_album_id: '12345' });
    const db = { raw: mock.fn(async () => ({ rows: [row] })) };
    const repository = createAlbumServiceMappingsRepository({ db });

    assert.strictEqual(
      await repository.findRateYourMusicByNumericId(' 12345 '),
      row
    );
    assert.strictEqual(
      await repository.findRateYourMusicByNumericId('12x'),
      null
    );
    assert.strictEqual(
      await repository.findRateYourMusicByUrl(row.external_url),
      row
    );
    assert.strictEqual(db.raw.mock.calls.length, 2);
    assert.deepStrictEqual(db.raw.mock.calls[0].arguments[1], [
      'rateyourmusic',
      '12345',
    ]);
  });

  it('uses the facade transaction client for coherent candidate writes', async () => {
    const inserted = rymRow({ external_album_id: '12345' });
    const client = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT')) return { rows: [] };
        if (sql.includes('INSERT')) return { rows: [inserted] };
        return { rows: [] };
      }),
    };
    const db = {
      raw: mock.fn(async () => {
        throw new Error('facade raw should not be used inside transaction');
      }),
      withTransaction: mock.fn(async (callback) => callback(client)),
    };
    const repository = createAlbumServiceMappingsRepository({ db });

    const result = await repository.upsertCandidate({
      albumId: 'album-1',
      service: 'rateyourmusic',
      externalAlbumId: '12345',
      externalUrl: inserted.external_url,
      verified: true,
      strategy: 'rym:verified',
    });

    assert.strictEqual(result, inserted);
    assert.strictEqual(db.withTransaction.mock.calls.length, 1);
    assert.strictEqual(db.raw.mock.calls.length, 0);
    assert.match(client.query.mock.calls[0].arguments[0], /FOR UPDATE/);
    assert.match(
      client.query.mock.calls[1].arguments[0],
      /ON CONFLICT DO NOTHING/
    );
  });

  it('does not let a low-rank RYM URL hint overwrite a numeric mapping', async () => {
    const verified = rymRow({
      external_album_id: '12345',
      external_url: 'https://rateyourmusic.com/release/album/right/record/',
      strategy: 'rym:verified',
    });
    const client = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT')) return { rows: [verified] };
        throw new Error('a low-rank hint must not write');
      }),
    };
    const repository = createAlbumServiceMappingsRepository({ db: client });

    const result = await repository.upsertCandidate({
      albumId: 'album-1',
      service: 'rateyourmusic',
      externalUrl: 'https://rateyourmusic.com/release/album/wrong/record/',
      rank: RYM_HINT_RANK,
      strategy: 'rym:url-hint',
    });

    assert.strictEqual(result, verified);
    assert.strictEqual(client.query.mock.calls.length, 1);
  });

  it('allows a verified numeric candidate to replace a URL-only hint', async () => {
    const hint = rymRow();
    const verified = rymRow({
      external_album_id: '12345',
      strategy: 'rym:verified',
    });
    const client = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT')) return { rows: [hint] };
        if (sql.includes('UPDATE')) return { rows: [verified] };
        return { rows: [] };
      }),
    };
    const repository = createAlbumServiceMappingsRepository({ db: client });

    const result = await repository.upsertCandidate({
      albumId: 'album-1',
      service: 'rateyourmusic',
      externalAlbumId: '12345',
      verified: true,
      rank: VERIFIED_MAPPING_RANK,
      strategy: 'rym:verified',
    });

    assert.strictEqual(result, verified);
    const updateCall = client.query.mock.calls.find((call) =>
      call.arguments[0].includes('UPDATE')
    );
    assert.ok(updateCall);
    assert.strictEqual(updateCall.arguments[1][2], '12345');
    assert.ok(
      client.query.mock.calls.some((call) =>
        call.arguments[0].includes('SAVEPOINT album_mapping_candidate_update')
      )
    );
  });

  it('fails closed on a malformed supplied RYM numeric id', async () => {
    const client = { query: mock.fn(async () => ({ rows: [] })) };
    const repository = createAlbumServiceMappingsRepository({ db: client });

    for (const externalAlbumId of ['12x', '0', '00123']) {
      const result = await repository.upsertCandidate({
        albumId: 'album-1',
        service: 'rateyourmusic',
        externalAlbumId,
        externalUrl: 'https://rateyourmusic.com/release/album/artist/record/',
      });
      assert.strictEqual(result, null);
    }
    assert.strictEqual(client.query.mock.calls.length, 0);
  });

  it('rolls back to its savepoint before re-reading an update conflict', async () => {
    const hint = rymRow();
    const winner = rymRow({
      album_id: 'album-other',
      external_album_id: '12345',
      strategy: 'rym:verified',
    });
    let selectCount = 0;
    const client = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT')) {
          selectCount += 1;
          return { rows: selectCount === 1 ? [hint] : [winner] };
        }
        if (sql.includes('UPDATE')) {
          const error = new Error('unique conflict');
          error.code = '23505';
          throw error;
        }
        return { rows: [] };
      }),
    };
    const repository = createAlbumServiceMappingsRepository({ db: client });

    const result = await repository.upsertCandidate({
      albumId: 'album-1',
      service: 'rateyourmusic',
      externalAlbumId: '12345',
      verified: true,
    });

    assert.strictEqual(result, winner);
    const sql = client.query.mock.calls.map((call) => call.arguments[0]);
    assert.ok(
      sql.some((statement) =>
        statement.includes(
          'ROLLBACK TO SAVEPOINT album_mapping_candidate_update'
        )
      )
    );
  });

  it('re-reads the winner after a conflict-safe insert loses a race', async () => {
    const winner = rymRow({ album_id: 'album-other' });
    let selectCount = 0;
    const client = {
      query: mock.fn(async (sql) => {
        if (sql.includes('SELECT')) {
          selectCount += 1;
          return { rows: selectCount === 1 ? [] : [winner] };
        }
        if (sql.includes('INSERT')) return { rows: [] };
        return { rows: [] };
      }),
    };
    const repository = createAlbumServiceMappingsRepository({ db: client });

    const result = await repository.upsertCandidate({
      albumId: 'album-1',
      service: 'rateyourmusic',
      externalUrl: winner.external_url,
      rank: RYM_HINT_RANK,
    });

    assert.strictEqual(result, winner);
    assert.strictEqual(selectCount, 2);
  });
});
