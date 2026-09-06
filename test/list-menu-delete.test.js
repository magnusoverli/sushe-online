/**
 * deleteList backs both the desktop context menu's "Delete List" and the
 * mobile action sheet's, which previously carried separate copies of the flow.
 *
 * The desktop copy captured the lists object once at initialisation. setLists()
 * replaces that object on every refresh — and the delete itself triggers one —
 * so from the second delete onward the handler chose the replacement list from
 * a snapshot of startup, which could name a list that had since been deleted.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

function createHarness(overrides = {}) {
  const state = {
    // The live map, reassigned by refreshes exactly as setLists() does.
    lists: {
      'id-a': { _id: 'id-a', name: 'Alpha' },
      'id-b': { _id: 'id-b', name: 'Beta' },
    },
    currentList: 'id-a',
    deleted: [],
    selected: [],
    snapshotsCleared: [],
    toasts: [],
    albumContainer: { innerHTML: '' },
    refreshes: 0,
  };

  const deps = {
    doc: {
      getElementById: (id) =>
        id === 'albumContainer' ? state.albumContainer : null,
    },
    getLists: () => state.lists,
    getListMetadata: (id) => state.lists[id],
    getCurrentList: () => state.currentList,
    setCurrentList: (id) => {
      state.currentList = id;
    },
    selectList: async (id) => {
      state.selected.push(id);
      state.currentList = id;
    },
    apiCall: async (url, options) => {
      state.deleted.push({ url, method: options?.method });
      return {};
    },
    showConfirmation: async () => true,
    showToast: (message) => state.toasts.push(message),
    refreshGroupsAndLists: async () => {
      state.refreshes += 1;
    },
    updateListNav() {},
    clearSnapshotFromStorage: (id) => state.snapshotsCleared.push(id),
    logger: { error() {}, warn() {}, info() {} },
    ...overrides,
  };

  return { state, deps };
}

async function buildActions(overrides) {
  const { createListMenuActions } =
    await import('../src/js/modules/list-menu-shared.js');
  const { state, deps } = createHarness(overrides);
  return { state, actions: createListMenuActions(deps) };
}

describe('deleteList', () => {
  it('deletes the list and reports it by name', async () => {
    const { state, actions } = await buildActions();

    const deleted = await actions.deleteList('id-b');

    assert.strictEqual(deleted, true);
    assert.deepStrictEqual(state.deleted, [
      { url: '/api/lists/id-b', method: 'DELETE' },
    ]);
    assert.deepStrictEqual(state.toasts, ['List "Beta" deleted']);
    assert.strictEqual(state.refreshes, 1);
  });

  it('does nothing when the confirmation is declined', async () => {
    const { state, actions } = await buildActions({
      showConfirmation: async () => false,
    });

    const deleted = await actions.deleteList('id-b');

    assert.strictEqual(deleted, false);
    assert.deepStrictEqual(state.deleted, []);
    assert.deepStrictEqual(state.toasts, []);
    assert.strictEqual(state.refreshes, 0);
  });

  it('picks the replacement from live state, not from a startup snapshot', async () => {
    const { state, actions } = await buildActions();

    // A refresh between init and the delete: setLists() hands out a brand-new
    // object, and 'id-b' is gone from it. A captured reference would still be
    // offering 'id-b' as somewhere to go.
    state.lists = {
      'id-a': { _id: 'id-a', name: 'Alpha' },
      'id-c': { _id: 'id-c', name: 'Gamma' },
    };

    await actions.deleteList('id-a');

    assert.deepStrictEqual(
      state.selected,
      ['id-c'],
      'must select a list that still exists'
    );
  });

  it('clears the selection and paints the empty state when the last list goes', async () => {
    const { state, actions } = await buildActions();
    state.lists = { 'id-a': { _id: 'id-a', name: 'Alpha' } };

    await actions.deleteList('id-a');

    assert.deepStrictEqual(state.selected, []);
    assert.strictEqual(state.currentList, null);
    assert.match(state.albumContainer.innerHTML, /No list selected/);
  });

  it('leaves the selection alone when another list was deleted', async () => {
    const { state, actions } = await buildActions();

    await actions.deleteList('id-b');

    assert.deepStrictEqual(state.selected, []);
    assert.strictEqual(state.currentList, 'id-a');
  });

  it('clears the deleted list snapshot from local storage', async () => {
    // The mobile copy of this flow never did, leaving a snapshot behind for a
    // list that no longer existed.
    const { state, actions } = await buildActions();

    await actions.deleteList('id-b');

    assert.deepStrictEqual(state.snapshotsCleared, ['id-b']);
  });

  it('reports a failed delete and changes nothing', async () => {
    const { state, actions } = await buildActions({
      apiCall: async () => {
        throw new Error('boom');
      },
    });

    const deleted = await actions.deleteList('id-b');

    assert.strictEqual(deleted, false);
    assert.deepStrictEqual(state.toasts, ['Error deleting list']);
    assert.strictEqual(state.refreshes, 0);
    assert.deepStrictEqual(state.snapshotsCleared, []);
    assert.ok(state.lists['id-b'], 'the list must survive a failed delete');
  });

  it('escapes the list id into the request path', async () => {
    const { state, actions } = await buildActions();
    state.lists['weird/id'] = { _id: 'weird/id', name: 'Weird' };

    await actions.deleteList('weird/id');

    assert.strictEqual(state.deleted[0].url, '/api/lists/weird%2Fid');
  });
});
