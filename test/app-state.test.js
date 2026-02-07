/**
 * Tests for app-state.js centralized state store
 *
 * Since app-state.js is an ES module that references `window` and `localStorage`,
 * we set up minimal browser-like globals before importing.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Set up minimal browser globals before importing the ES module
globalThis.window = globalThis.window || {};
globalThis.localStorage = globalThis.localStorage || {
  _store: {},
  getItem(key) {
    return this._store[key] ?? null;
  },
  setItem(key, val) {
    this._store[key] = String(val);
  },
  removeItem(key) {
    delete this._store[key];
  },
  clear() {
    this._store = {};
  },
};

// Import the module (ESM dynamic import)
let mod;

describe('app-state', async () => {
  mod = await import('../src/js/modules/app-state.js');

  // ============ LISTS STATE ============

  describe('Lists state', () => {
    beforeEach(() => {
      // Reset lists to empty
      mod.setLists({});
    });

    it('getLists returns the lists object', () => {
      const lists = mod.getLists();
      assert.deepStrictEqual(lists, {});
    });

    it('setLists replaces the entire lists object', () => {
      const newLists = {
        id1: {
          _id: 'id1',
          name: 'Test List',
          year: 2024,
          isMain: false,
          count: 0,
          _data: [],
        },
      };
      mod.setLists(newLists);
      assert.strictEqual(mod.getLists(), newLists);
    });

    it('setLists syncs to window.lists', () => {
      const newLists = { id1: { _id: 'id1', name: 'Test' } };
      mod.setLists(newLists);
      assert.strictEqual(window.lists, newLists);
    });

    it('getListData returns null for nonexistent list', () => {
      assert.strictEqual(mod.getListData('nonexistent'), null);
    });

    it('getListData returns null for null/empty listId', () => {
      assert.strictEqual(mod.getListData(null), null);
      assert.strictEqual(mod.getListData(''), null);
    });

    it('getListData returns _data from metadata object', () => {
      const albums = [{ album_id: 'a1' }, { album_id: 'a2' }];
      mod.setLists({
        id1: { _id: 'id1', name: 'Test', _data: albums, count: 2 },
      });
      assert.strictEqual(mod.getListData('id1'), albums);
    });

    it('getListData handles legacy array format', () => {
      const albums = [{ album_id: 'a1' }];
      mod.setLists({ id1: albums });
      assert.strictEqual(mod.getListData('id1'), albums);
    });

    it('getListData returns null when _data is null', () => {
      mod.setLists({
        id1: { _id: 'id1', name: 'Test', _data: null, count: 0 },
      });
      assert.strictEqual(mod.getListData('id1'), null);
    });

    it('setListData creates new entry if list does not exist', () => {
      mod.setLists({});
      const albums = [{ album_id: 'a1' }];
      mod.setListData('newId', albums, false);
      const entry = mod.getLists()['newId'];
      assert.strictEqual(entry._id, 'newId');
      assert.strictEqual(entry.count, 1);
      assert.strictEqual(entry._data, albums);
    });

    it('setListData updates existing entry _data and count', () => {
      mod.setLists({
        id1: {
          _id: 'id1',
          name: 'Test',
          _data: [],
          count: 0,
          year: 2024,
        },
      });
      const albums = [{ album_id: 'a1' }, { album_id: 'a2' }];
      mod.setListData('id1', albums, false);
      const entry = mod.getLists()['id1'];
      assert.strictEqual(entry._data, albums);
      assert.strictEqual(entry.count, 2);
      assert.strictEqual(entry.name, 'Test'); // preserved
    });

    it('setListData handles legacy array format by converting', () => {
      mod.setLists({ id1: [{ album_id: 'old' }] });
      const albums = [{ album_id: 'new1' }, { album_id: 'new2' }];
      mod.setListData('id1', albums, false);
      const entry = mod.getLists()['id1'];
      assert.strictEqual(entry._data, albums);
      assert.strictEqual(entry.count, 2);
      assert.strictEqual(entry._id, 'id1');
    });

    it('setListData does nothing when listId is falsy', () => {
      mod.setLists({});
      mod.setListData(null, []);
      assert.deepStrictEqual(mod.getLists(), {});
    });

    it('getListMetadata returns null for nonexistent list', () => {
      assert.strictEqual(mod.getListMetadata('nope'), null);
    });

    it('getListMetadata returns the entry for metadata objects', () => {
      const entry = {
        _id: 'id1',
        name: 'Test',
        year: 2024,
        isMain: false,
        count: 3,
        _data: [1, 2, 3],
      };
      mod.setLists({ id1: entry });
      assert.strictEqual(mod.getListMetadata('id1'), entry);
    });

    it('getListMetadata handles legacy array format', () => {
      mod.setLists({ id1: [{ album_id: 'a1' }] });
      const meta = mod.getListMetadata('id1');
      assert.strictEqual(meta._id, 'id1');
      assert.strictEqual(meta.count, 1);
      assert.strictEqual(meta.name, 'Unknown');
    });

    it('updateListMetadata applies updates to existing list', () => {
      mod.setLists({
        id1: { _id: 'id1', name: 'Old', year: 2023, _data: [] },
      });
      mod.updateListMetadata('id1', { name: 'New', year: 2024 });
      const entry = mod.getLists()['id1'];
      assert.strictEqual(entry.name, 'New');
      assert.strictEqual(entry.year, 2024);
    });

    it('updateListMetadata does nothing for nonexistent list', () => {
      mod.setLists({});
      mod.updateListMetadata('nope', { name: 'Test' });
      assert.deepStrictEqual(mod.getLists(), {});
    });

    it('updateListMetadata converts legacy array format first', () => {
      mod.setLists({ id1: [{ album_id: 'a1' }] });
      mod.updateListMetadata('id1', { name: 'Converted' });
      const entry = mod.getLists()['id1'];
      assert.strictEqual(entry.name, 'Converted');
      assert.strictEqual(entry._id, 'id1');
    });

    it('findListByName finds a list by name', () => {
      mod.setLists({
        id1: { _id: 'id1', name: 'Best 2024', groupId: 'g1' },
        id2: { _id: 'id2', name: 'Favorites', groupId: 'g2' },
      });
      const result = mod.findListByName('Favorites');
      assert.strictEqual(result._id, 'id2');
    });

    it('findListByName returns null when not found', () => {
      mod.setLists({ id1: { _id: 'id1', name: 'Test' } });
      assert.strictEqual(mod.findListByName('Nonexistent'), null);
    });

    it('findListByName filters by groupId when provided', () => {
      mod.setLists({
        id1: { _id: 'id1', name: 'Best', groupId: 'g1' },
        id2: { _id: 'id2', name: 'Best', groupId: 'g2' },
      });
      const result = mod.findListByName('Best', 'g2');
      assert.strictEqual(result._id, 'id2');
    });

    it('getCurrentListName returns name of current list', () => {
      mod.setLists({ id1: { _id: 'id1', name: 'My List' } });
      mod.setCurrentListId('id1');
      assert.strictEqual(mod.getCurrentListName(), 'My List');
    });

    it('getCurrentListName returns empty string when no current list', () => {
      mod.setCurrentListId('');
      assert.strictEqual(mod.getCurrentListName(), '');
    });

    it('isListDataLoaded returns false for nonexistent list', () => {
      assert.strictEqual(mod.isListDataLoaded('nope'), false);
    });

    it('isListDataLoaded returns true for legacy array format', () => {
      mod.setLists({ id1: [{ album_id: 'a1' }] });
      assert.strictEqual(mod.isListDataLoaded('id1'), true);
    });

    it('isListDataLoaded returns true when _data has items', () => {
      mod.setLists({
        id1: { _id: 'id1', _data: [{ album_id: 'a1' }], count: 1 },
      });
      assert.strictEqual(mod.isListDataLoaded('id1'), true);
    });

    it('isListDataLoaded returns true when _data is empty and count is 0', () => {
      mod.setLists({ id1: { _id: 'id1', _data: [], count: 0 } });
      assert.strictEqual(mod.isListDataLoaded('id1'), true);
    });

    it('isListDataLoaded returns false when _data is null', () => {
      mod.setLists({ id1: { _id: 'id1', _data: null, count: 5 } });
      assert.strictEqual(mod.isListDataLoaded('id1'), false);
    });
  });

  // ============ GROUPS STATE ============

  describe('Groups state', () => {
    beforeEach(() => {
      mod.updateGroupsFromServer([]);
    });

    it('getGroups returns the groups object', () => {
      assert.deepStrictEqual(mod.getGroups(), {});
    });

    it('getGroup returns null for nonexistent group', () => {
      assert.strictEqual(mod.getGroup('nope'), null);
    });

    it('updateGroupsFromServer populates groups', () => {
      mod.updateGroupsFromServer([
        {
          _id: 'g1',
          name: '2024',
          year: 2024,
          sortOrder: 1,
          listCount: 2,
          isYearGroup: true,
          createdAt: '2024-01-01',
          updatedAt: '2024-06-01',
        },
        {
          _id: 'g2',
          name: 'Custom',
          year: null,
          sortOrder: 2,
          listCount: 1,
          isYearGroup: false,
          createdAt: '2024-02-01',
          updatedAt: '2024-07-01',
        },
      ]);
      assert.strictEqual(mod.getGroup('g1').name, '2024');
      assert.strictEqual(mod.getGroup('g2').isYearGroup, false);
      assert.strictEqual(Object.keys(mod.getGroups()).length, 2);
    });

    it('updateGroupsFromServer syncs to window.groups', () => {
      mod.updateGroupsFromServer([
        {
          _id: 'g1',
          name: 'Test',
          year: 2024,
          sortOrder: 1,
          listCount: 0,
          isYearGroup: true,
        },
      ]);
      assert.strictEqual(window.groups, mod.getGroups());
    });

    it('getSortedGroups returns groups sorted by sortOrder', () => {
      mod.updateGroupsFromServer([
        {
          _id: 'g2',
          name: 'Second',
          year: null,
          sortOrder: 2,
          listCount: 0,
          isYearGroup: false,
        },
        {
          _id: 'g1',
          name: 'First',
          year: null,
          sortOrder: 1,
          listCount: 0,
          isYearGroup: false,
        },
        {
          _id: 'g3',
          name: 'Third',
          year: null,
          sortOrder: 3,
          listCount: 0,
          isYearGroup: false,
        },
      ]);
      const sorted = mod.getSortedGroups();
      assert.strictEqual(sorted[0].name, 'First');
      assert.strictEqual(sorted[1].name, 'Second');
      assert.strictEqual(sorted[2].name, 'Third');
    });

    it('updateGroupsFromServer clears previous groups', () => {
      mod.updateGroupsFromServer([
        {
          _id: 'g1',
          name: 'Old',
          year: null,
          sortOrder: 1,
          listCount: 0,
          isYearGroup: false,
        },
      ]);
      assert.strictEqual(Object.keys(mod.getGroups()).length, 1);
      mod.updateGroupsFromServer([]);
      assert.strictEqual(Object.keys(mod.getGroups()).length, 0);
    });
  });

  // ============ CURRENT LIST / RECOMMENDATIONS ============

  describe('Current list and recommendations state', () => {
    it('getCurrentListId / setCurrentListId', () => {
      mod.setCurrentListId('abc123');
      assert.strictEqual(mod.getCurrentListId(), 'abc123');
      mod.setCurrentListId('');
      assert.strictEqual(mod.getCurrentListId(), '');
    });

    it('isViewingRecommendations returns false when year is null', () => {
      mod.setCurrentRecommendationsYear(null);
      assert.strictEqual(mod.isViewingRecommendations(), false);
    });

    it('isViewingRecommendations returns true when year is set', () => {
      mod.setCurrentRecommendationsYear(2024);
      assert.strictEqual(mod.isViewingRecommendations(), true);
      mod.setCurrentRecommendationsYear(null); // cleanup
    });

    it('setCurrentRecommendationsYear syncs to window', () => {
      mod.setCurrentRecommendationsYear(2023);
      assert.strictEqual(window.currentRecommendationsYear, 2023);
      mod.setCurrentRecommendationsYear(null);
    });
  });

  // ============ CONTEXT MENU STATE ============

  describe('Context menu state', () => {
    it('getContextAlbum / setContextAlbum', () => {
      mod.setContextAlbum(5, 'album-xyz');
      const ctx = mod.getContextAlbum();
      assert.strictEqual(ctx.index, 5);
      assert.strictEqual(ctx.albumId, 'album-xyz');
    });

    it('getContextList / setContextList', () => {
      mod.setContextList('list-id-1');
      assert.strictEqual(mod.getContextList(), 'list-id-1');
      mod.setContextList(null);
      assert.strictEqual(mod.getContextList(), null);
    });

    it('getContextState returns combined context', () => {
      mod.setContextAlbum(3, 'album-abc');
      mod.setContextList('list-1');
      const state = mod.getContextState();
      assert.strictEqual(state.album, 3);
      assert.strictEqual(state.albumId, 'album-abc');
      assert.strictEqual(state.list, 'list-1');
    });

    it('setContextState applies partial updates', () => {
      mod.setContextAlbum(1, 'old');
      mod.setContextList('old-list');
      mod.setContextState({ album: 10, albumId: 'new' });
      const state = mod.getContextState();
      assert.strictEqual(state.album, 10);
      assert.strictEqual(state.albumId, 'new');
      assert.strictEqual(state.list, 'old-list'); // unchanged
    });

    it('getContextGroup / setContextGroup', () => {
      const group = { id: 'g1', name: 'Test', isYearGroup: true };
      mod.setContextGroup(group);
      assert.deepStrictEqual(mod.getContextGroup(), group);
      mod.setContextGroup(null);
      assert.strictEqual(mod.getContextGroup(), null);
    });
  });

  // ============ IMPORT STATE ============

  describe('Import state', () => {
    it('getPendingImport / setPendingImport', () => {
      mod.setPendingImport({ tracks: [] }, 'test.json');
      const imp = mod.getPendingImport();
      assert.deepStrictEqual(imp.data, { tracks: [] });
      assert.strictEqual(imp.filename, 'test.json');
    });

    it('setPendingImport clears with null', () => {
      mod.setPendingImport(null, null);
      const imp = mod.getPendingImport();
      assert.strictEqual(imp.data, null);
      assert.strictEqual(imp.filename, null);
    });
  });

  // ============ TRACK ABORT CONTROLLER ============

  describe('Track abort controller', () => {
    it('getTrackAbortController / setTrackAbortController', () => {
      assert.strictEqual(mod.getTrackAbortController(), null);
      const controller = { abort: () => {} };
      mod.setTrackAbortController(controller);
      assert.strictEqual(mod.getTrackAbortController(), controller);
      mod.setTrackAbortController(null);
    });
  });

  // ============ MOVE SUBMENU STATE ============

  describe('Move submenu state', () => {
    it('getCurrentHighlightedYear / setCurrentHighlightedYear', () => {
      mod.setCurrentHighlightedYear(2024);
      assert.strictEqual(mod.getCurrentHighlightedYear(), 2024);
      mod.setCurrentHighlightedYear(null);
    });

    it('getMoveListsHideTimeout / setMoveListsHideTimeout', () => {
      mod.setMoveListsHideTimeout(42);
      assert.strictEqual(mod.getMoveListsHideTimeout(), 42);
      mod.setMoveListsHideTimeout(null);
    });
  });

  // ============ RECOMMENDATION CONTEXT STATE ============

  describe('Recommendation context state', () => {
    it('getCurrentRecommendationContext / setCurrentRecommendationContext', () => {
      const ctx = { rec: { album_id: 'a1' }, year: 2024 };
      mod.setCurrentRecommendationContext(ctx);
      assert.strictEqual(mod.getCurrentRecommendationContext(), ctx);
      mod.setCurrentRecommendationContext(null);
    });

    it('getRecommendationAddHighlightedYear / setRecommendationAddHighlightedYear', () => {
      mod.setRecommendationAddHighlightedYear(2025);
      assert.strictEqual(mod.getRecommendationAddHighlightedYear(), 2025);
      mod.setRecommendationAddHighlightedYear(null);
    });

    it('getRecommendationAddListsHideTimeout / setRecommendationAddListsHideTimeout', () => {
      mod.setRecommendationAddListsHideTimeout(99);
      assert.strictEqual(mod.getRecommendationAddListsHideTimeout(), 99);
      mod.setRecommendationAddListsHideTimeout(null);
    });
  });

  // ============ LAZY MODULE ACCESSORS ============

  describe('Lazy module accessors', () => {
    it('getMusicServicesModule / setMusicServicesModule', () => {
      assert.strictEqual(mod.getMusicServicesModule(), null);
      const mockMod = { search: () => {} };
      mod.setMusicServicesModule(mockMod);
      assert.strictEqual(mod.getMusicServicesModule(), mockMod);
      mod.setMusicServicesModule(null);
    });

    it('getImportExportModule / setImportExportModule', () => {
      const mockMod = { importData: () => {} };
      mod.setImportExportModule(mockMod);
      assert.strictEqual(mod.getImportExportModule(), mockMod);
      mod.setImportExportModule(null);
    });

    it('getRealtimeSyncModule / setRealtimeSyncModule', () => {
      const mockMod = { connect: () => {} };
      mod.setRealtimeSyncModule(mockMod);
      assert.strictEqual(mod.getRealtimeSyncModule(), mockMod);
      mod.setRealtimeSyncModule(null);
    });
  });

  // ============ SAVE STATE ============

  describe('Save state', () => {
    it('getSaveTimeout / setSaveTimeout', () => {
      mod.setSaveTimeout(123);
      assert.strictEqual(mod.getSaveTimeout(), 123);
      mod.setSaveTimeout(null);
    });
  });

  // ============ LOCAL SAVE TRACKING ============

  describe('Local save tracking', () => {
    it('markLocalSave + wasRecentLocalSave returns true within grace period', () => {
      mod.markLocalSave('test-list');
      assert.strictEqual(mod.wasRecentLocalSave('test-list'), true);
    });

    it('wasRecentLocalSave returns false for unsaved list', () => {
      assert.strictEqual(mod.wasRecentLocalSave('never-saved'), false);
    });

    it('wasRecentLocalSave clears after first check (single-use)', () => {
      mod.markLocalSave('one-shot');
      assert.strictEqual(mod.wasRecentLocalSave('one-shot'), true);
      assert.strictEqual(mod.wasRecentLocalSave('one-shot'), false);
    });
  });

  // ============ SNAPSHOT STATE ============

  describe('Snapshot functions', () => {
    it('createListSnapshot returns album IDs', () => {
      const albums = [
        { album_id: 'a1', name: 'Album 1' },
        { album_id: 'a2', name: 'Album 2' },
      ];
      const snapshot = mod.createListSnapshot(albums);
      assert.deepStrictEqual(snapshot, ['a1', 'a2']);
    });

    it('createListSnapshot handles albumId field', () => {
      const albums = [{ albumId: 'b1' }, { albumId: 'b2' }];
      const snapshot = mod.createListSnapshot(albums);
      assert.deepStrictEqual(snapshot, ['b1', 'b2']);
    });

    it('createListSnapshot returns empty for null/invalid input', () => {
      assert.deepStrictEqual(mod.createListSnapshot(null), []);
      assert.deepStrictEqual(mod.createListSnapshot('not-array'), []);
    });

    it('createListSnapshot filters out albums without IDs', () => {
      const albums = [
        { album_id: 'a1' },
        { name: 'No ID' },
        { album_id: 'a3' },
      ];
      const snapshot = mod.createListSnapshot(albums);
      assert.deepStrictEqual(snapshot, ['a1', 'a3']);
    });

    it('getLastSavedSnapshots returns the Map', () => {
      const snapshots = mod.getLastSavedSnapshots();
      assert.ok(snapshots instanceof Map);
    });

    it('saveSnapshotToStorage persists to localStorage', () => {
      localStorage.clear();
      mod.saveSnapshotToStorage('list-1', ['a1', 'a2']);
      const stored = localStorage.getItem('list-snapshot-list-1');
      assert.deepStrictEqual(JSON.parse(stored), ['a1', 'a2']);
    });

    it('saveSnapshotToStorage does nothing for falsy inputs', () => {
      localStorage.clear();
      mod.saveSnapshotToStorage(null, ['a1']);
      mod.saveSnapshotToStorage('id', null);
      assert.strictEqual(Object.keys(localStorage._store).length, 0);
    });

    it('loadSnapshotFromStorage retrieves stored snapshot', () => {
      localStorage.clear();
      localStorage.setItem('list-snapshot-x', JSON.stringify(['a1', 'a2']));
      const result = mod.loadSnapshotFromStorage('x');
      assert.deepStrictEqual(result, ['a1', 'a2']);
    });

    it('loadSnapshotFromStorage returns null for missing data', () => {
      localStorage.clear();
      assert.strictEqual(mod.loadSnapshotFromStorage('missing'), null);
    });

    it('loadSnapshotFromStorage returns null for null listId', () => {
      assert.strictEqual(mod.loadSnapshotFromStorage(null), null);
    });

    it('loadSnapshotFromStorage returns null for corrupted data', () => {
      localStorage.clear();
      localStorage.setItem('list-snapshot-bad', 'not-json{{{');
      // JSON.parse will throw, should return null
      const result = mod.loadSnapshotFromStorage('bad');
      assert.strictEqual(result, null);
    });

    it('loadSnapshotFromStorage returns null for non-array JSON', () => {
      localStorage.clear();
      localStorage.setItem('list-snapshot-obj', JSON.stringify({ key: 'val' }));
      const result = mod.loadSnapshotFromStorage('obj');
      assert.strictEqual(result, null);
    });

    it('clearSnapshotFromStorage removes entry', () => {
      localStorage.clear();
      localStorage.setItem('list-snapshot-del', JSON.stringify(['a1']));
      mod.clearSnapshotFromStorage('del');
      assert.strictEqual(localStorage.getItem('list-snapshot-del'), null);
    });

    it('clearSnapshotFromStorage does nothing for null listId', () => {
      localStorage.clear();
      mod.clearSnapshotFromStorage(null); // should not throw
    });
  });

  // ============ COMPUTED / STATIC DATA ============

  describe('Static data accessors', () => {
    it('getAvailableGenres / setAvailableGenres', () => {
      mod.setAvailableGenres(['Rock', 'Pop', 'Jazz']);
      assert.deepStrictEqual(mod.getAvailableGenres(), ['Rock', 'Pop', 'Jazz']);
    });

    it('getAvailableCountries / setAvailableCountries', () => {
      mod.setAvailableCountries(['US', 'UK', 'JP']);
      assert.deepStrictEqual(mod.getAvailableCountries(), ['US', 'UK', 'JP']);
    });

    it('setAvailableCountries syncs to window.availableCountries', () => {
      mod.setAvailableCountries(['SE']);
      assert.deepStrictEqual(window.availableCountries, ['SE']);
    });
  });

  // ============ WINDOW GLOBALS ============

  describe('initWindowGlobals', () => {
    it('creates window.currentList as alias for currentListId', () => {
      mod.initWindowGlobals();
      mod.setCurrentListId('test-id');
      assert.strictEqual(window.currentList, 'test-id');
    });

    it('window.currentList setter updates currentListId', () => {
      mod.initWindowGlobals();
      window.currentList = 'from-window';
      assert.strictEqual(mod.getCurrentListId(), 'from-window');
      mod.setCurrentListId(''); // cleanup
    });

    it('window.currentListId getter reflects state', () => {
      mod.initWindowGlobals();
      mod.setCurrentListId('via-setter');
      assert.strictEqual(window.currentListId, 'via-setter');
      mod.setCurrentListId('');
    });

    it('window.currentListId setter updates state', () => {
      mod.initWindowGlobals();
      window.currentListId = 'direct-set';
      assert.strictEqual(mod.getCurrentListId(), 'direct-set');
      mod.setCurrentListId('');
    });
  });
});
