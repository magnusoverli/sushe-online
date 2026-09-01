const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const {
  createItemDisqualification,
} = require('../services/list/item-disqualification');
const { TransactionAbort } = require('../db/transaction');
const {
  preserveDisqualificationState,
} = require('../services/list/write-operations');

function createHarness({ updateRows = [{}] } = {}) {
  const client = {
    query: mock.fn(async (sql) => {
      if (sql.includes('UPDATE list_items')) return { rows: updateRows };
      return { rows: [], rowCount: 1 };
    }),
  };
  const db = {
    withTransaction: mock.fn(async (callback) => callback(client)),
  };
  const findListByIdOrThrow = mock.fn(async () => ({
    _id: 'list-1',
    year: 2010,
    isMain: true,
  }));
  return {
    client,
    service: createItemDisqualification({
      db,
      TransactionAbort,
      findListByIdOrThrow,
    }),
  };
}

describe('list item disqualification', () => {
  it('withholds management for locked main lists but not non-main lists', async () => {
    const { canManageListItemDisqualification } =
      await import('../src/js/modules/list-item-disqualification.js');
    const currentUser = { _id: 'user-1' };
    const isYearLocked = (year) => year === 2010;

    assert.strictEqual(
      canManageListItemDisqualification(
        { ownerId: 'user-1', year: 2010, isMain: true },
        currentUser,
        isYearLocked
      ),
      false
    );
    assert.strictEqual(
      canManageListItemDisqualification(
        { ownerId: 'user-1', year: 2010, isMain: false },
        currentUser,
        isYearLocked
      ),
      true
    );
  });

  it('handles a stale YEAR_LOCKED response without changing local state', async () => {
    const { updateListItemDisqualification } =
      await import('../src/js/modules/list-item-disqualification.js');
    const toasts = [];
    let lockRefreshes = 0;
    let localUpdates = 0;

    const updated = await updateListItemDisqualification(
      {
        apiCall: async () => {
          throw {
            code: 'YEAR_LOCKED',
            error:
              'Cannot change ranking eligibility: Main list for year 2010 is locked',
            year: 2010,
          };
        },
        getListData: () => [{ _id: 'item-21' }],
        setListData: () => {
          localUpdates += 1;
        },
        displayAlbums: () => {
          localUpdates += 1;
        },
        showDisqualificationReasonModal: async () => ({
          cancelled: false,
          reason: null,
        }),
        showToast: (...args) => toasts.push(args),
        refreshLockedYearStatus: async () => {
          lockRefreshes += 1;
        },
      },
      { listId: 'list-1', album: { _id: 'item-21' } }
    );

    assert.strictEqual(updated, false);
    assert.strictEqual(localUpdates, 0);
    assert.strictEqual(lockRefreshes, 1);
    assert.deepStrictEqual(toasts, [
      [
        'Cannot change ranking eligibility: Main list for year 2010 is locked',
        'info',
      ],
    ]);
  });

  it('preserves state when an older client replaces a full list', () => {
    const albums = preserveDisqualificationState(
      [{ _id: 'item-21', album_id: 'album-21', artist: 'A', album: 'B' }],
      [
        {
          _id: 'item-21',
          album_id: 'album-21',
          is_disqualified: true,
          disqualification_reason: 'Released in 2009',
        },
      ]
    );

    assert.strictEqual(albums[0].is_disqualified, true);
    assert.strictEqual(albums[0].disqualification_reason, 'Released in 2009');
  });

  it('stores list-specific state and a normalized reason', async () => {
    const { client, service } = createHarness();
    const result = await service.updateItemDisqualification(
      'list-1',
      'user-1',
      'item-21',
      true,
      '  Released in 2009  '
    );

    assert.strictEqual(result.is_disqualified, true);
    assert.strictEqual(result.disqualification_reason, 'Released in 2009');
    const updateCall = client.query.mock.calls.find((call) =>
      call.arguments[0].includes('UPDATE list_items')
    );
    assert.deepStrictEqual(updateCall.arguments[1].slice(0, 2), [
      true,
      'Released in 2009',
    ]);
  });

  it('clears the reason when restoring ranking eligibility', async () => {
    const { service } = createHarness();
    const result = await service.updateItemDisqualification(
      'list-1',
      'user-1',
      'item-21',
      false,
      'ignored'
    );

    assert.strictEqual(result.is_disqualified, false);
    assert.strictEqual(result.disqualification_reason, null);
  });

  it('rejects non-boolean state and unknown list items', async () => {
    const { service } = createHarness({ updateRows: [] });
    await assert.rejects(
      () =>
        service.updateItemDisqualification(
          'list-1',
          'user-1',
          'item-21',
          'true',
          null
        ),
      (error) => error instanceof TransactionAbort && error.statusCode === 400
    );
    await assert.rejects(
      () =>
        service.updateItemDisqualification(
          'list-1',
          'user-1',
          'missing',
          true,
          null
        ),
      (error) => error instanceof TransactionAbort && error.statusCode === 404
    );
  });
});
