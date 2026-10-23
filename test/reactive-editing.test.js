const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('reactive editing and persistence', () => {
  let state,
    events,
    createTrackPickService,
    createAlbumEditSession,
    computeListDiff;
  before(async () => {
    state = await import('../src/js/modules/app-state.js');
    events = await import('../src/js/modules/state-events.js');
    ({ createTrackPickService } =
      await import('../src/js/modules/track-pick-service.js'));
    ({ createAlbumEditSession } =
      await import('../src/js/modules/album-edit-session.js'));
    ({ computeListDiff } = await import('../src/js/utils/save-optimizer.js'));
  });

  it('batches related scopes once and releases subscriptions', async () => {
    const bus = events.createStateEvents();
    let updates = 0;
    const unsubscribe = bus.subscribe(['list:a', 'item:a'], () => updates++);
    bus.publish('list:a');
    bus.publish('item:a');
    bus.publish('list:b');
    await Promise.resolve();
    assert.equal(updates, 1);
    unsubscribe();
    bus.publish('item:a');
    await Promise.resolve();
    assert.equal(updates, 1);
  });

  it('keeps snapshot fields through storage and rejects obsolete revisions', async (t) => {
    const oldStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage'
    );
    let value;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem: (_key, next) => {
          value = next;
        },
        getItem: () => value,
      },
    });
    t.after(() => {
      if (oldStorage)
        Object.defineProperty(globalThis, 'localStorage', oldStorage);
      else delete globalThis.localStorage;
    });
    state.saveSnapshotToStorage(
      'snapshot',
      state.createListSnapshot([{ album_id: 'a', comments: 'before' }])
    );
    assert.equal(
      computeListDiff(state.loadSnapshotFromStorage('snapshot'), [
        { album_id: 'a', comments: 'after' },
      ]),
      null
    );
    const revisions = await import('../src/js/modules/list-revisions.js');
    revisions.rememberListRevision('revision-test', '9007199254740995');
    revisions.rememberListRevision('revision-test', '9007199254740994');
    assert.equal(
      revisions.getListRevision('revision-test'),
      '9007199254740995'
    );
  });

  it('does not lose a comment when the same save also reorders', () => {
    const original = [{ album_id: 'a', comments: 'before' }, { album_id: 'b' }];
    const snapshot = state.createListSnapshot(original);
    assert.equal(
      computeListDiff(snapshot, [
        original[1],
        { ...original[0], comments: 'after' },
      ]),
      null
    );
    assert.ok(computeListDiff(snapshot, [original[1], original[0]]));
  });

  it('resolves manual positions while preserving exact numeric titles', async () => {
    const { resolveTrackTitle } =
      await import('../src/js/utils/track-reference.js');
    const tracks = [{ name: '1979' }, { name: '2 + 2 = 5' }, { name: '2' }];
    assert.equal(resolveTrackTitle('#2', tracks), '2 + 2 = 5');
    assert.equal(resolveTrackTitle('2', tracks), '2');
    assert.equal(resolveTrackTitle('1979', tracks), '1979');
    assert.equal(resolveTrackTitle('#9', tracks), '#9');
  });

  it('rebases list edits without restoring cleared picks or removed items', async () => {
    const { rebaseListChanges } =
      await import('../src/js/utils/rebase-list.js');
    const original = [
      { album_id: 'a', comments: 'before', primary_track: 'Track' },
      { album_id: 'b' },
    ];
    const snapshot = state.createListSnapshot(original);
    const remote = [
      { ...original[0], primary_track: null },
      { album_id: 'remote-add' },
    ];
    assert.deepEqual(
      rebaseListChanges(
        snapshot,
        [{ ...original[0], comments: 'after' }, original[1]],
        remote
      ),
      [
        { ...original[0], comments: 'after', primary_track: null },
        { album_id: 'remote-add' },
      ]
    );
    assert.throws(
      () =>
        rebaseListChanges(
          snapshot,
          [{ ...original[0], comments: 'local' }],
          [{ ...original[0], comments: 'remote' }]
        ),
      { code: 'LIST_CONFLICT' }
    );
    assert.equal(
      computeListDiff(
        ['a', 'b'],
        [{ ...original[0], comments: 'after' }, original[1]]
      ),
      null
    );
  });

  it('prepares whole-list bodies after earlier field writes have finished', async () => {
    const { createAppApiClient } =
      await import('../src/js/modules/app-api-client.js');
    const { rebaseListChanges } =
      await import('../src/js/utils/rebase-list.js');
    const original = [
      {
        _id: 'queue-item',
        album_id: 'a',
        primary_track: 'Track',
        comments: 'before',
      },
    ];
    state.setListData('queue-list', original);
    let remote = original;
    const writes = [];
    const { apiCall } = createAppApiClient({
      getRealtimeSyncModuleInstance: () => null,
      win: null,
      fetchImpl: async (_url, options) => {
        if (options.method === 'PATCH')
          remote = [{ ...remote[0], primary_track: null }];
        if (options.method === 'PUT')
          writes.push(JSON.parse(options.body).data);
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => remote,
        };
      },
    });
    const snapshot = state.createListSnapshot(original);
    await Promise.all([
      apiCall('/api/lists/queue-list/items/a/comment', { method: 'PATCH' }),
      apiCall('/api/lists/queue-list', {
        method: 'PUT',
        prepareWrite: async () => ({
          body: JSON.stringify({
            data: rebaseListChanges(
              snapshot,
              [{ ...original[0], comments: 'after' }],
              await apiCall('/api/lists/queue-list')
            ),
          }),
        }),
      }),
    ]);
    assert.equal(writes[0][0].primary_track, null);
    assert.equal(writes[0][0].comments, 'after');
  });

  it('uses the acknowledged reorder rather than field-record insertion order as its baseline', async () => {
    const { rebaseListChanges } =
      await import('../src/js/utils/rebase-list.js');
    const original = [
      { album_id: 'a', comments: 'before' },
      { album_id: 'b', comments: '' },
    ];
    const snapshot = ['b', 'a'];
    Object.defineProperty(snapshot, 'records', {
      value: state.createListSnapshot(original).records,
    });
    const desired = [original[1], { ...original[0], comments: 'after' }];
    const rebased = rebaseListChanges(snapshot, desired, original);
    assert.deepEqual(rebased, [
      { ...original[0], comments: 'after' },
      original[1],
    ]);
  });

  it('serializes rapid clicks using acknowledged picks and keeps lists isolated', async () => {
    state.setLists({
      one: { _data: [{ _id: 'pick-one', album_id: 'shared' }] },
      two: {
        _data: [
          { _id: 'pick-two', album_id: 'shared', primary_track: 'Other' },
        ],
      },
    });
    const writes = [];
    const service = createTrackPickService({
      apiCall: async (_url, options) => {
        const body = JSON.parse(options.body);
        writes.push(body);
        await Promise.resolve();
        return { ...body, listId: 'one', revision: String(writes.length) };
      },
    });
    await Promise.all([
      service.updateTrackPick('pick-one', '1979'),
      service.updateTrackPick('pick-one', '1979'),
    ]);
    assert.deepEqual(writes, [
      { primary_track: null, secondary_track: '1979' },
      { primary_track: '1979', secondary_track: null },
    ]);
    assert.equal(state.getListData('one')[0].primary_track, '1979');
    assert.equal(state.getListData('two')[0].primary_track, 'Other');
    await service.clearTrackPicks('pick-one');
    assert.equal(state.getListData('one')[0].primary_track, null);
  });

  it('preserves the field baseline after reordering and retries conflicts against the original intent', async () => {
    const { createAppListOperations } =
      await import('../src/js/modules/app-list-operations.js');
    const original = [
      {
        album_id: 'retry-album',
        comments: 'before',
        primary_track: 'Original',
      },
    ];
    const desired = [{ ...original[0], comments: 'after' }];
    const lists = { retry: { _data: desired } };
    const snapshots = new Map([['retry', state.createListSnapshot(original)]]);
    const writes = [];
    const operations = createAppListOperations({
      getLists: () => lists,
      getLastSavedSnapshots: () => snapshots,
      createListSnapshot: state.createListSnapshot,
      computeListDiff,
      setListData: (id, items) => {
        lists[id]._data = items;
      },
      saveSnapshotToStorage() {},
      markLocalSave() {},
      updateListNav() {},
      showToast() {},
      apiCall: async (_url, options = {}) => {
        if (_url.endsWith('/reorder')) return {};
        if (!options.method)
          return [
            {
              ...original[0],
              primary_track: writes.length ? 'New remote pick' : null,
            },
          ];
        const prepared = await options.prepareWrite();
        writes.push(JSON.parse(prepared.body).data);
        if (writes.length === 1)
          throw Object.assign(new Error('Conflict'), { code: 'LIST_CONFLICT' });
        return {};
      },
    });
    const reorder = operations.debouncedSaveReorder('retry', original);
    operations.flushReorder('retry');
    await reorder;
    assert.ok(snapshots.get('retry').records);
    await operations.saveList('retry', desired);
    assert.equal(writes.length, 2);
    assert.equal(writes[0][0].primary_track, null);
    assert.equal(writes[1][0].primary_track, 'New remote pick');
    assert.equal(writes[1][0].comments, 'after');
  });

  function editor(apiCall) {
    const album = {
      _id: 'edit-one',
      album_id: 'canonical',
      artist: 'Artist',
      album: 'Album',
      comments: 'before',
      primary_track: 'Track',
    };
    state.setLists({ edit: { _data: [album] } });
    return createAlbumEditSession({
      album,
      listId: 'edit',
      getListData: state.getListData,
      setListData: state.setListData,
      apiCall,
      trackPickService: createTrackPickService({ apiCall }),
    });
  }

  it('uses item identity and preserves a remote-cleared pick when saving comments', async () => {
    const calls = [];
    const draft = editor(async (url) => {
      calls.push(url);
      return {};
    });
    state.setListData(
      'edit',
      [
        { _id: 'other', album_id: 'other' },
        { ...draft.findItem(), primary_track: null },
      ],
      false
    );
    await draft.save({ comments: 'after' });
    assert.equal(state.getListData('edit')[0].comments, undefined);
    assert.equal(state.getListData('edit')[1].comments, 'after');
    assert.equal(state.getListData('edit')[1].primary_track, null);
    assert.equal(calls.length, 1);
  });

  it('retains committed metadata after artwork failure and retries only artwork', async () => {
    const calls = [];
    let failCover = true;
    const draft = editor(async (url) => {
      calls.push(url);
      if (url.endsWith('/cover') && failCover)
        throw new Error('Artwork unavailable');
      return { cover_image_url: '/cover?v=2' };
    });
    const cover = { base64: 'image', format: 'PNG' };
    await assert.rejects(
      draft.save({ artist: 'New artist', comments: 'saved' }, cover),
      /Artwork unavailable/
    );
    assert.equal(draft.findItem().artist, 'New artist');
    assert.equal(draft.findItem().comments, 'saved');
    failCover = false;
    await draft.save({ artist: 'New artist', comments: 'saved' }, cover);
    assert.equal(calls.filter((url) => url.endsWith('batch-update')).length, 1);
    assert.equal(calls.filter((url) => url.endsWith('/comment')).length, 1);
    assert.equal(calls.filter((url) => url.endsWith('/cover')).length, 2);
  });

  it('preserves newer realtime metadata after delayed saves and partial retries', async () => {
    const { liveAlbumPatches } =
      await import('../src/js/modules/realtime-album-patches.js');
    let metadataWrites = 0;
    let failCover = true;
    const draft = editor(async (url) => {
      if (url.endsWith('batch-update')) {
        metadataWrites++;
        liveAlbumPatches.remember('canonical', { country: 'Denmark' }, '1000');
        state.patchListItem('edit', 'edit-one', { country: 'Denmark' });
      }
      if (url.endsWith('/cover') && failCover)
        throw new Error('Artwork unavailable');
      return {};
    });
    const values = { artist: 'New artist', country: 'Sweden' };
    const cover = { base64: 'image', format: 'PNG' };
    await assert.rejects(draft.save(values, cover), /Artwork unavailable/);
    assert.equal(draft.findItem().country, 'Denmark');
    assert.equal(draft.findItem().artist, 'New artist');
    failCover = false;
    await draft.save(values, cover);
    assert.equal(draft.findItem().country, 'Denmark');
    assert.equal(metadataWrites, 1);
  });

  it('rejects conflicting field drafts and removed items before writing', async () => {
    let writes = 0;
    const draft = editor(async () => {
      writes++;
    });
    state.patchListItem('edit', 'edit-one', { comments: 'remote' });
    await assert.rejects(draft.save({ comments: 'local' }), /changed while/);
    state.setListData('edit', [], false);
    await assert.rejects(draft.save({ comments: 'local' }), /removed/);
    assert.equal(writes, 0);
  });
});
