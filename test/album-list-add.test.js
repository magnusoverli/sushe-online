const { beforeEach, describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('album list adder', () => {
  let state;
  let createAlbumListAdder;
  let createAppListOperations;
  let computeListDiff;
  const old = { album_id: 'old', _id: 'old-item', album: 'Old' };
  const album = { album_id: 'new', album: 'New', artist: 'Artist' };

  beforeEach(async (t) => {
    state = await import('../src/js/modules/app-state.js');
    ({ createAlbumListAdder } =
      await import('../src/js/modules/album-list-add.js'));
    ({ createAppListOperations } =
      await import('../src/js/modules/app-list-operations.js'));
    ({ computeListDiff } = await import('../src/js/utils/save-optimizer.js'));
    const previousStorage = globalThis.localStorage;
    globalThis.localStorage = { setItem: mock.fn() };
    state.setLists({});
    state.getLastSavedSnapshots().clear();
    state.setCurrentListId('list-1');
    t.after(() => {
      if (previousStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousStorage;
      state.setLists({});
      state.getLastSavedSnapshots().clear();
      state.setCurrentListId('');
    });
  });

  function fixture(baseline = [old]) {
    state.setListData('list-1', globalThis.structuredClone(baseline));
    const saveApiCall = mock.fn(async (_url, options) => ({
      addedItems: (JSON.parse(options.body).added || []).map((item) => ({
        album_id: item.album_id,
        _id: `item-${item.album_id}`,
      })),
    }));
    const showToast = mock.fn();
    const { saveList, getListSaveState } = createAppListOperations({
      ...state,
      computeListDiff,
      apiCall: saveApiCall,
      showToast,
      markLocalSave: mock.fn(),
      updateListNav: mock.fn(),
      logger: { log() {} },
    });
    const deps = {
      ...state,
      resolveAndDedup: mock.fn(async (resolved) => ({ resolved })),
      isAlbumInList: (candidate, data) =>
        data.some((item) => item.album_id === candidate.album_id),
      saveList: mock.fn(saveList),
      getListSaveState,
      // Reconciliation is optional; individual tests enable a controlled response.
      apiCall: mock.fn(async () => {
        throw new Error('Reconciliation unavailable');
      }),
      displayAlbums: mock.fn(),
      closeAddAlbumModal: mock.fn(),
      showToast,
      fetchAndDisplayPlaycounts: mock.fn(async () => {}),
    };
    const adder = createAlbumListAdder(deps);
    const context = {
      listId: 'list-1',
      isCurrent: () => state.getCurrentListId() === 'list-1',
    };
    return { ...deps, adder, context, saveApiCall };
  }

  for (const manual of [false, true]) {
    for (const baseline of [[], [old]]) {
      it(`${manual ? 'manual' : 'search'} addition preserves the ${baseline.length ? 'populated' : 'empty'} saved snapshot until one PATCH succeeds`, async () => {
        const f = fixture(baseline);
        const gate = Promise.withResolvers();
        const started = Promise.withResolvers();
        f.resolveAndDedup.mock.mockImplementation(async (resolved) => ({
          resolved,
          usedExisting: true,
        }));
        f.saveApiCall.mock.mockImplementation(() => {
          started.resolve();
          return gate.promise;
        });
        const adding = f.adder.add(album, { ...f.context, manual });
        await started.promise;
        assert.deepEqual(state.getListData('list-1'), [...baseline, album]);
        assert.deepEqual(
          state.getLastSavedSnapshots().get('list-1'),
          baseline.map((item) => item.album_id)
        );
        assert.equal(globalThis.localStorage.setItem.mock.callCount(), 1);
        assert.equal(f.saveApiCall.mock.callCount(), 1);
        const [url, options] = f.saveApiCall.mock.calls[0].arguments;
        assert.equal(url, '/api/lists/list-1/items');
        assert.equal(options.method, 'PATCH');
        assert.deepEqual(JSON.parse(options.body), {
          added: [{ ...album, position: baseline.length + 1 }],
          removed: [],
          updated: [],
        });
        gate.resolve({ addedItems: [{ album_id: 'new', _id: 'item-new' }] });
        await adding;
        assert.equal(state.getListData('list-1').at(-1)._id, 'item-new');
        assert.deepEqual(state.getLastSavedSnapshots().get('list-1'), [
          ...baseline.map((item) => item.album_id),
          'new',
        ]);
        assert.equal(f.closeAddAlbumModal.mock.callCount(), 1);
        assert.match(
          f.showToast.mock.calls.at(-1).arguments[0],
          manual ? /using existing album/ : /to the list/
        );
      });
    }
  }

  for (const duplicate of [false, true]) {
    it(`re-reads state after deferred dedup ${duplicate ? 'to avoid a duplicate addition' : 'without dropping a concurrent addition'}`, async () => {
      const f = fixture();
      const dedup = Promise.withResolvers();
      const started = Promise.withResolvers();
      f.resolveAndDedup.mock.mockImplementation(() => {
        started.resolve();
        return dedup.promise;
      });
      const adding = f.adder.add(album, f.context);
      await started.promise;
      const remote = {
        album_id: duplicate ? 'new' : 'remote',
        _id: 'remote-item',
      };
      state.setListData('list-1', [old, remote]);
      dedup.resolve({ resolved: album });
      await adding;
      assert.deepEqual(
        state.getListData('list-1').map((item) => item.album_id),
        duplicate ? ['old', 'new'] : ['old', 'remote', 'new']
      );
      assert.equal(f.saveApiCall.mock.callCount(), duplicate ? 0 : 1);
      if (duplicate)
        assert.equal(state.getListData('list-1')[1]._id, 'remote-item');
      else
        assert.deepEqual(
          JSON.parse(f.saveApiCall.mock.calls[0].arguments[1].body).added,
          [{ ...album, position: 3 }]
        );
    });
  }

  it('serializes successive additions across a failed first save, using the rolled-back state for the second', async () => {
    const f = fixture();
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    f.saveApiCall.mock.mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    const first = f.adder.add(album, f.context);
    await started.promise;
    const secondAlbum = { album_id: 'second', album: 'Second' };
    const second = f.adder.add(secondAlbum, f.context);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.resolveAndDedup.mock.callCount(), 1);
    assert.equal(f.saveApiCall.mock.callCount(), 1);
    gate.reject(new Error('first save failed'));
    await Promise.all([first, second]);

    assert.deepEqual(f.resolveAndDedup.mock.calls[1].arguments[1], [old]);
    assert.equal(f.saveApiCall.mock.callCount(), 2);
    assert.deepEqual(
      JSON.parse(f.saveApiCall.mock.calls[1].arguments[1].body),
      {
        added: [{ ...secondAlbum, position: 2 }],
        removed: [],
        updated: [],
      }
    );
    assert.deepEqual(state.getListData('list-1'), [
      old,
      { ...secondAlbum, _id: 'item-second' },
    ]);
    assert.deepEqual(state.getLastSavedSnapshots().get('list-1'), [
      'old',
      'second',
    ]);
  });

  for (const succeeds of [true, false]) {
    it(`preserves a queued comment edit when the optimistic addition ${succeeds ? 'succeeds, without reconciling over the pending save' : 'fails, without resurrecting the addition'}`, async () => {
      const f = fixture();
      const additionResponse = Promise.withResolvers();
      const additionStarted = Promise.withResolvers();
      const editResponse = Promise.withResolvers();
      const editStarted = Promise.withResolvers();
      f.saveApiCall.mock.mockImplementation((_url, options) => {
        if (options.method === 'PATCH') {
          additionStarted.resolve();
          return additionResponse.promise;
        }
        editStarted.resolve();
        return editResponse.promise;
      });
      f.apiCall.mock.mockImplementation(async () => [old, album]);

      const adding = f.adder.add(album, f.context);
      await additionStarted.promise;
      state.getListData('list-1')[0].comment = 'New comment';
      const editing = f.saveList('list-1', state.getListData('list-1'));
      assert.equal(f.getListSaveState('list-1').pending, 2);
      if (succeeds) {
        additionResponse.resolve({
          addedItems: [{ album_id: 'new', _id: 'item-new' }],
        });
      } else {
        additionResponse.reject(new Error('addition failed'));
      }
      await adding;
      await editStarted.promise;

      const expected = [
        { ...old, comment: 'New comment' },
        ...(succeeds ? [{ ...album, _id: 'item-new' }] : []),
      ];
      assert.equal(f.getListSaveState('list-1').pending, 1);
      assert.equal(f.apiCall.mock.callCount(), 0);
      assert.deepEqual(state.getListData('list-1'), expected);
      assert.equal(f.saveApiCall.mock.callCount(), 2);
      const [url, options] = f.saveApiCall.mock.calls[1].arguments;
      assert.equal(url, '/api/lists/list-1');
      assert.equal(options.method, 'PUT');
      assert.deepEqual(JSON.parse(options.body), { data: expected });
      editResponse.resolve({});
      await editing;

      assert.equal(f.getListSaveState('list-1').pending, 0);
      assert.equal(f.apiCall.mock.callCount(), 0);
      assert.deepEqual(state.getListData('list-1'), expected);
      assert.deepEqual(
        state.getLastSavedSnapshots().get('list-1'),
        expected.map((item) => item.album_id)
      );
    });
  }

  for (const persisted of [false, true]) {
    it(`rolls back only its unsaved addition, preserving a later tail${persisted ? ' and a persisted copy' : ''}`, async () => {
      const f = fixture();
      const gate = Promise.withResolvers();
      const started = Promise.withResolvers();
      f.saveApiCall.mock.mockImplementation(() => {
        started.resolve();
        return gate.promise;
      });
      const adding = f.adder.add(album, f.context);
      await started.promise;
      const tail = { album_id: 'tail' };
      const copy = { ...album, _id: 'remote-item' };
      state.setListData(
        'list-1',
        [old, album, ...(persisted ? [copy] : []), tail],
        false
      );
      gate.reject(new Error('save failed'));
      await adding;
      assert.deepEqual(state.getListData('list-1'), [
        old,
        ...(persisted ? [copy] : []),
        tail,
      ]);
      assert.deepEqual(state.getLastSavedSnapshots().get('list-1'), ['old']);
      assert.deepEqual(f.displayAlbums.mock.calls.at(-1).arguments, [
        state.getListData('list-1'),
        { forceFullRebuild: true },
      ]);
    });
  }

  it('does not let a later preflight failure roll back an album owned by a prior failed attempt', async () => {
    const f = fixture();
    f.saveApiCall.mock.mockImplementationOnce(async () => {
      throw new Error('save failed');
    });
    await f.adder.add(album, f.context);
    const newer = [old, { ...album }, { album_id: 'tail' }];
    state.setListData('list-1', newer, false);
    const paints = f.displayAlbums.mock.callCount();
    f.resolveAndDedup.mock.mockImplementationOnce(async () => {
      throw new Error('preflight failed');
    });
    await f.adder.add({ album_id: 'second' }, f.context);
    assert.equal(state.getListData('list-1'), newer);
    assert.equal(f.displayAlbums.mock.callCount(), paints);
    assert.equal(f.saveApiCall.mock.callCount(), 1);
    assert.deepEqual(state.getLastSavedSnapshots().get('list-1'), ['old']);
  });

  for (const reason of ['navigation', 'closed context', 'dedup cancellation']) {
    it(`cancels deferred preflight on ${reason} without saving or repainting`, async () => {
      const f = fixture();
      const gate = Promise.withResolvers();
      const started = Promise.withResolvers();
      let open = true;
      f.resolveAndDedup.mock.mockImplementation(() => {
        started.resolve();
        return gate.promise;
      });
      const adding = f.adder.add(album, {
        ...f.context,
        isCurrent: () => open && f.context.isCurrent(),
      });
      await started.promise;
      state.setListData('list-2', [{ album_id: 'other' }]);
      if (reason === 'navigation') state.setCurrentListId('list-2');
      if (reason === 'closed context') open = false;
      gate.resolve({
        resolved: album,
        cancelled: reason === 'dedup cancellation',
      });
      await adding;
      assert.deepEqual(state.getListData('list-1'), [old]);
      assert.deepEqual(state.getListData('list-2'), [{ album_id: 'other' }]);
      assert.equal(f.saveApiCall.mock.callCount(), 0);
      assert.equal(f.displayAlbums.mock.callCount(), 0);
      assert.equal(f.closeAddAlbumModal.mock.callCount(), 0);
      assert.equal(f.apiCall.mock.callCount(), 0);
    });
  }

  it('skips preflight for a context closed while its addition was queued', async () => {
    const f = fixture();
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    f.saveApiCall.mock.mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    const first = f.adder.add(album, f.context);
    await started.promise;
    let open = true;
    const second = f.adder.add(
      { album_id: 'second' },
      { ...f.context, isCurrent: () => open }
    );
    open = false;
    gate.resolve({ addedItems: [{ album_id: 'new', _id: 'item-new' }] });
    await Promise.all([first, second]);
    assert.equal(f.resolveAndDedup.mock.callCount(), 1);
    assert.equal(f.saveApiCall.mock.callCount(), 1);
  });

  it('rolls back a failed save after navigation without repainting the other list', async () => {
    const f = fixture();
    const gate = Promise.withResolvers();
    const started = Promise.withResolvers();
    f.saveApiCall.mock.mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    const adding = f.adder.add(album, f.context);
    await started.promise;
    state.setListData('list-2', [{ album_id: 'other' }]);
    state.setCurrentListId('list-2');
    const paints = f.displayAlbums.mock.callCount();
    gate.reject(new Error('offline'));
    await adding;
    assert.deepEqual(state.getListData('list-1'), [old]);
    assert.deepEqual(state.getListData('list-2'), [{ album_id: 'other' }]);
    assert.equal(f.displayAlbums.mock.callCount(), paints);
  });

  for (const completed of [false, true]) {
    it(`discards reconciliation when a newer save ${completed ? 'has finished' : 'is pending'}, even with unchanged data and array identity`, async () => {
      const f = fixture();
      const reconciliation = Promise.withResolvers();
      f.apiCall.mock.mockImplementation(() => reconciliation.promise);
      await f.adder.add(album, f.context);
      assert.equal(f.apiCall.mock.callCount(), 1);
      const expected = state.getListData('list-1');
      const fingerprint = JSON.stringify(expected);
      const snapshot = state.getLastSavedSnapshots().get('list-1');
      const version = f.getListSaveState('list-1').version;
      const paints = f.displayAlbums.mock.callCount();
      const response = Promise.withResolvers();
      const started = Promise.withResolvers();
      f.saveApiCall.mock.mockImplementationOnce(() => {
        started.resolve();
        return response.promise;
      });
      const saving = f.saveList('list-1', expected);
      const rejected = assert.rejects(saving, /newer save failed/);
      await started.promise;
      // A failed save leaves the array and its contents unchanged, isolating
      // the save-version guard from the reference/fingerprint guards.
      if (completed) {
        response.reject(new Error('newer save failed'));
        await rejected;
      }
      assert.equal(state.getListData('list-1'), expected);
      assert.equal(JSON.stringify(expected), fingerprint);
      assert.equal(f.getListSaveState('list-1').pending, completed ? 0 : 1);
      assert.ok(f.getListSaveState('list-1').version > version);
      reconciliation.resolve([old]);
      await reconciliation.promise;

      assert.equal(state.getListData('list-1'), expected);
      assert.equal(state.getLastSavedSnapshots().get('list-1'), snapshot);
      assert.equal(f.displayAlbums.mock.callCount(), paints);
      assert.equal(f.fetchAndDisplayPlaycounts.mock.callCount(), 0);
      if (!completed) {
        response.reject(new Error('newer save failed'));
        await rejected;
      }
    });
  }

  for (const change of ['replacement', 'in-place edit', 'navigation', 'none']) {
    it(`${change === 'none' ? 'applies current' : `ignores stale (${change})`} reconciliation without corrupting state or its saved snapshot`, async () => {
      const f = fixture();
      const gate = Promise.withResolvers();
      f.apiCall.mock.mockImplementation(() => gate.promise);
      await f.adder.add(album, f.context);
      assert.equal(f.apiCall.mock.callCount(), 1);
      assert.equal(f.apiCall.mock.calls[0].arguments[0], '/api/lists/list-1');
      const savedSnapshot = state.getLastSavedSnapshots().get('list-1');
      if (change === 'replacement')
        state.setListData('list-1', [old, { album_id: 'latest' }], false);
      if (change === 'in-place edit')
        state.getListData('list-1')[1].album = 'Edited';
      if (change === 'navigation') {
        state.setListData('list-2', [{ album_id: 'other' }]);
        state.setCurrentListId('list-2');
      }
      const expected = globalThis.structuredClone(state.getListData('list-1'));
      const paints = f.displayAlbums.mock.callCount();
      const remote = [
        old,
        { ...album, _id: 'item-new', album: 'Server metadata' },
      ];
      gate.resolve(remote);
      await gate.promise;

      assert.deepEqual(
        state.getListData('list-1'),
        change === 'none' ? remote : expected
      );
      assert.deepEqual(
        state.getLastSavedSnapshots().get('list-1'),
        savedSnapshot
      );
      assert.equal(
        f.displayAlbums.mock.callCount(),
        paints + (change === 'none' ? 1 : 0)
      );
      assert.equal(
        f.fetchAndDisplayPlaycounts.mock.callCount(),
        change === 'none' ? 1 : 0
      );
      if (change === 'navigation')
        assert.deepEqual(state.getListData('list-2'), [{ album_id: 'other' }]);
    });
  }
});
