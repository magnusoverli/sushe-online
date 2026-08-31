const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createHistoricalListImportService,
  HistoricalImportError,
} = require('../services/historical-list-import-service');
const { createMockLogger } = require('./helpers');

function validPayload(overrides = {}) {
  return {
    version: 1,
    list: { name: 'Best of 2018', year: 2018 },
    albums: [
      {
        position: 1,
        artist: 'Existing Artist',
        album: 'Existing Album',
        comments: 'First',
        album_id: 'source-system-id',
        release_date: '2010-05-01',
        country: 'Norway',
        genre_1: 'Imported Metal',
      },
      {
        position: 2,
        artist: 'New Artist',
        album: 'New Album',
        primary_track: 'Opening Track',
        is_disqualified: true,
        disqualification_reason: 'Released before the eligible year',
        genre_2: 'Experimental',
      },
    ],
    ...overrides,
  };
}

function createHarness(options = {}) {
  const listService = {
    createList: mock.fn(async () => ({ listId: 'created-list' })),
  };
  const invalidateListCaches = mock.fn();
  const triggerAggregateListRecompute = mock.fn();
  const raw = mock.fn(async (sql) => {
    if (sql.includes('FROM users')) {
      return {
        rows: [{ _id: 'user-1', username: 'alice', email: 'a@example.com' }],
      };
    }
    if (sql.includes('FROM albums')) {
      return {
        rows: options.albumRows || [
          {
            album_id: 'target-canonical-id',
            artist: 'Existing Artist',
            album: 'Existing Album',
            release_date: '2010',
            country: null,
            genre_1: 'Canonical Metal',
            genre_2: null,
          },
        ],
      };
    }
    if (sql.includes('FROM lists')) return { rows: options.listRows || [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createHistoricalListImportService({
    db: { raw },
    listService,
    invalidateListCaches,
    triggerAggregateListRecompute,
    logger: createMockLogger(),
  });
  const body = {
    imports: [
      {
        clientId: 'file-1',
        fileName: '2018.json',
        targetUserId: 'user-1',
        payload: validPayload(),
      },
    ],
  };
  return {
    service,
    body,
    raw,
    listService,
    invalidateListCaches,
    triggerAggregateListRecompute,
  };
}

describe('historical-list-import-service', () => {
  it('previews target canonical references without trusting source IDs', async () => {
    const { service, body } = createHarness();

    const preview = await service.preview(body);

    assert.strictEqual(preview.canCommit, true);
    assert.strictEqual(preview.imports[0].existingCanonicalCount, 1);
    assert.strictEqual(preview.imports[0].newCanonicalCount, 1);
    assert.ok(
      preview.imports[0].warnings.some((warning) =>
        /source album\/list item ID/.test(warning)
      )
    );
    assert.ok(
      preview.imports[0].warnings.some((warning) =>
        warning.includes('missing release date')
      )
    );
    assert.ok(
      preview.imports[0].warnings.some((warning) =>
        warning.includes('will be enriched')
      )
    );
    assert.ok(
      preview.imports[0].warnings.some((warning) =>
        warning.includes('metadata preserved')
      )
    );
    assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
  });

  it('commits through listService with target canonical IDs and local fields only', async () => {
    const {
      service,
      body,
      listService,
      invalidateListCaches,
      triggerAggregateListRecompute,
    } = createHarness();
    const preview = await service.preview(body);

    const result = await service.commit(
      { ...body, previewHash: preview.previewHash },
      { _id: 'admin-1' }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.imported, 1);
    const [targetUserId, createPayload] =
      listService.createList.mock.calls[0].arguments;
    assert.strictEqual(targetUserId, 'user-1');
    assert.strictEqual(createPayload.year, 2018);
    assert.strictEqual(createPayload.isMain, true);
    assert.deepStrictEqual(createPayload.albums[0], {
      artist: 'Existing Artist',
      album: 'Existing Album',
      comments: 'First',
      comments_2: null,
      primary_track: null,
      secondary_track: null,
      is_disqualified: false,
      disqualification_reason: null,
      country: 'Norway',
      album_id: 'target-canonical-id',
    });
    assert.strictEqual(createPayload.albums[1].album_id, undefined);
    assert.strictEqual(createPayload.albums[1].primary_track, 'Opening Track');
    assert.strictEqual(createPayload.albums[1].is_disqualified, true);
    assert.strictEqual(createPayload.albums[1].release_date, '2018');
    assert.strictEqual(createPayload.albums[1].genre_2, 'Experimental');
    assert.strictEqual(
      createPayload.albums[1].disqualification_reason,
      'Released before the eligible year'
    );
    assert.strictEqual(invalidateListCaches.mock.calls.length, 1);
    assert.strictEqual(
      triggerAggregateListRecompute.mock.calls[0].arguments[0],
      2018
    );
  });

  it('preserves an explicit release year instead of the list-year default', async () => {
    const { service, body, listService } = createHarness({ albumRows: [] });
    body.imports[0].payload.albums = [
      {
        position: 1,
        artist: 'Prior Year Artist',
        album: 'Prior Year Album',
        release_date: '2017',
        is_disqualified: true,
        disqualification_reason: 'Released before the eligible year',
      },
    ];
    const preview = await service.preview(body);

    await service.commit(
      { ...body, previewHash: preview.previewHash },
      { _id: 'admin-1' }
    );

    assert.strictEqual(
      listService.createList.mock.calls[0].arguments[1].albums[0].release_date,
      '2017'
    );
  });

  it('blocks files without a year or with duplicate ranked albums', async () => {
    const { service, body, listService } = createHarness();
    body.imports[0].payload.list.year = null;
    body.imports[0].payload.albums.push({
      position: 3,
      artist: 'existing artist',
      album: 'existing album',
    });

    const preview = await service.preview(body);

    assert.strictEqual(preview.canCommit, false);
    assert.ok(preview.imports[0].errors.includes('List year is required'));
    assert.ok(
      preview.imports[0].errors.some((error) =>
        error.includes('duplicates the canonical identity')
      )
    );
    assert.strictEqual(listService.createList.mock.calls.length, 0);
  });

  it('rejects global album metadata and ambiguous canonical records', async () => {
    const albumRows = [
      {
        album_id: 'canonical-1',
        artist: 'Existing Artist',
        album: 'Existing Album',
      },
      {
        album_id: 'canonical-2',
        artist: 'Existing Artist',
        album: 'Existing Album',
      },
    ];
    const { service, body } = createHarness({ albumRows });
    body.imports[0].payload.albums[0].summary = 'Must not be imported';

    const preview = await service.preview(body);

    assert.strictEqual(preview.canCommit, false);
    assert.ok(
      preview.imports[0].errors.some((error) =>
        error.includes('unsupported fields: summary')
      )
    );
    assert.ok(
      preview.imports[0].errors.some((error) =>
        error.includes('Canonical album identity is ambiguous')
      )
    );
  });

  it('rejects stale preview hashes and existing target lists', async () => {
    const { service, body } = createHarness({ listRows: [{ '?column?': 1 }] });
    const preview = await service.preview(body);
    assert.strictEqual(preview.canCommit, false);
    assert.ok(
      preview.imports[0].errors.some((error) =>
        error.includes('already exists')
      )
    );

    await assert.rejects(
      () =>
        service.commit({ ...body, previewHash: 'stale' }, { _id: 'admin-1' }),
      (error) => error instanceof HistoricalImportError && error.status === 409
    );
  });

  it('reuses canonical albums created by an earlier file in the same batch', async () => {
    const albumRows = [];
    let createCount = 0;
    const createList = mock.fn(async (_userId, payload) => {
      createCount++;
      if (createCount === 1) {
        albumRows.push({
          album_id: 'created-canonical-id',
          artist: payload.albums[0].artist,
          album: payload.albums[0].album,
        });
      }
      return { listId: `list-${createCount}` };
    });
    const db = {
      raw: mock.fn(async (sql) => {
        if (sql.includes('FROM users')) {
          return { rows: [{ _id: 'user-1', username: 'alice' }] };
        }
        if (sql.includes('FROM albums')) return { rows: [...albumRows] };
        return { rows: [] };
      }),
    };
    const service = createHistoricalListImportService({
      db,
      listService: { createList },
      logger: createMockLogger(),
    });
    const makeImport = (clientId, name, year) => ({
      clientId,
      fileName: `${year}.json`,
      targetUserId: 'user-1',
      payload: {
        version: 1,
        list: { name, year },
        albums: [
          { position: 1, artist: 'Shared Artist', album: 'Shared Album' },
        ],
      },
    });
    const body = {
      imports: [
        makeImport('file-1', 'List One', 2011),
        makeImport('file-2', 'List Two', 2012),
      ],
    };
    const preview = await service.preview(body);

    const result = await service.commit(
      { ...body, previewHash: preview.previewHash },
      { _id: 'admin-1' }
    );

    assert.strictEqual(result.imported, 2);
    assert.strictEqual(
      createList.mock.calls[1].arguments[1].albums[0].album_id,
      'created-canonical-id'
    );
  });

  it('previews canonical metadata resolution across files in batch order', async () => {
    const { service, body } = createHarness({ albumRows: [] });
    body.imports[0].payload.albums = [
      {
        position: 1,
        artist: 'Shared Artist',
        album: 'Shared Album',
        country: 'Norway',
      },
    ];
    body.imports.push({
      clientId: 'file-2',
      fileName: '2019.json',
      targetUserId: 'user-1',
      payload: {
        version: 1,
        list: { name: 'Best of 2019', year: 2019 },
        albums: [
          {
            position: 1,
            artist: 'Shared Artist',
            album: 'Shared Album',
            country: 'Sweden',
            genre_1: 'Metal',
          },
        ],
      },
    });

    const preview = await service.preview(body);

    assert.strictEqual(preview.canCommit, true);
    assert.strictEqual(preview.imports[0].newCanonicalCount, 1);
    assert.strictEqual(preview.imports[1].newCanonicalCount, 0);
    assert.strictEqual(preview.imports[1].existingCanonicalCount, 1);
    assert.ok(
      preview.imports[1].warnings.some((warning) =>
        warning.includes('metadata preserved')
      )
    );
    assert.ok(
      preview.imports[1].warnings.some((warning) =>
        warning.includes('will be enriched')
      )
    );
  });
});
