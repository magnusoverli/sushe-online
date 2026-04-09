const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('list-selection module', () => {
  let createListSelection;

  beforeEach(async () => {
    const module = await import('../src/js/modules/list-selection.js');
    createListSelection = module.createListSelection;
  });

  it('selects list, fetches data, renders, and persists preference', async () => {
    const apiCalls = [];
    const states = [];
    const toasts = [];
    let currentListId = 'old-list';
    let refreshCalls = 0;
    let spinnerTarget = null;

    const fab = { style: { display: '' } };
    const container = {};

    const rtSync = {
      unsubscribed: [],
      subscribed: [],
      unsubscribeFromList(id) {
        this.unsubscribed.push(id);
      },
      subscribeToList(id) {
        this.subscribed.push(id);
      },
    };

    const storageWrites = [];

    const { selectList } = createListSelection({
      doc: {
        getElementById(id) {
          if (id === 'addAlbumFAB') return fab;
          if (id === 'albumContainer') return container;
          return null;
        },
      },
      win: {
        lastSelectedList: null,
        refreshMobileBarVisibility() {
          refreshCalls += 1;
        },
      },
      storage: {
        setItem(key, value) {
          storageWrites.push([key, value]);
        },
      },
      logger: {
        warn() {},
      },
      setCurrentListId(id) {
        currentListId = id;
        states.push(['setCurrentListId', id]);
      },
      setCurrentRecommendationsYear(year) {
        states.push(['setCurrentRecommendationsYear', year]);
      },
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => rtSync,
      clearPlaycountCache() {
        states.push(['clearPlaycountCache']);
      },
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState(listId) {
        states.push(['updateListNavActiveState', listId]);
      },
      updateHeaderTitle(name) {
        states.push(['updateHeaderTitle', name]);
      },
      updateMobileHeader() {
        states.push(['updateMobileHeader']);
      },
      showLoadingSpinner(target) {
        spinnerTarget = target;
      },
      getListData: () => [{ album_id: 'cached' }],
      isListDataLoaded: () => false,
      apiCall: async (url, options) => {
        apiCalls.push([url, options]);
        if (url === '/api/lists/list-1') {
          return [{ album_id: 'fetched' }];
        }
        return { success: true };
      },
      setListData(id, data) {
        states.push(['setListData', id, data]);
      },
      displayAlbums(data, options) {
        states.push(['displayAlbums', data, options]);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast: (...args) => toasts.push(args),
    });

    await selectList('list-1');
    await Promise.resolve();

    assert.deepStrictEqual(rtSync.unsubscribed, ['old-list']);
    assert.deepStrictEqual(rtSync.subscribed, ['list-1']);
    assert.strictEqual(fab.style.display, 'flex');
    assert.strictEqual(spinnerTarget, container);
    assert.deepStrictEqual(storageWrites, [['lastSelectedList', 'list-1']]);
    assert.deepStrictEqual(apiCalls[0], ['/api/lists/list-1', undefined]);
    assert.strictEqual(apiCalls[1][0], '/api/user/last-list');
    assert.deepStrictEqual(states[1], ['setCurrentRecommendationsYear', null]);
    assert.deepStrictEqual(states[6], [
      'setListData',
      'list-1',
      [{ album_id: 'fetched' }],
    ]);
    assert.deepStrictEqual(states[7], [
      'displayAlbums',
      [{ album_id: 'fetched' }],
      { forceFullRebuild: true },
    ]);
    assert.strictEqual(refreshCalls, 1);
    assert.deepStrictEqual(toasts, []);
  });

  it('uses cached list data when already loaded', async () => {
    const apiCalls = [];
    let currentListId = null;
    const cached = [{ album_id: 'cached-1' }];
    const rendered = [];

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-2' },
      storage: { setItem() {} },
      logger: { warn() {} },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-2': { name: 'List Two' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => cached,
      isListDataLoaded: () => true,
      apiCall: async (...args) => {
        apiCalls.push(args);
        return { success: true };
      },
      setListData() {
        throw new Error('should not set list data when cached');
      },
      displayAlbums(data, options) {
        rendered.push([data, options]);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    await selectList('list-2');

    assert.strictEqual(apiCalls.length, 0);
    assert.deepStrictEqual(rendered[0], [cached, { forceFullRebuild: true }]);
  });

  it('shows list-data error toast when fetch fails', async () => {
    const toasts = [];
    const warnings = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: null },
      storage: { setItem() {} },
      logger: {
        warn: (...args) => warnings.push(args),
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ bad: { name: 'Bad List' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => null,
      isListDataLoaded: () => false,
      apiCall: async (url) => {
        if (url.startsWith('/api/lists/')) {
          throw new Error('fetch failed');
        }
        return { success: true };
      },
      setListData() {},
      displayAlbums() {},
      fetchAndDisplayPlaycounts: async () => {},
      showToast: (...args) => toasts.push(args),
    });

    await selectList('bad');

    assert.deepStrictEqual(toasts[0], ['Error loading list data', 'error']);
    assert.strictEqual(warnings[0][0], 'Failed to fetch list data:');
  });

  it('warns and continues when storage quota is exceeded', async () => {
    const warnings = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'quota-list' },
      storage: {
        setItem() {
          const error = new Error('quota');
          error.name = 'QuotaExceededError';
          throw error;
        },
      },
      logger: {
        warn: (...args) => warnings.push(args),
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'quota-list': { name: 'Quota List' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [],
      isListDataLoaded: () => true,
      apiCall: async () => ({ success: true }),
      setListData() {},
      displayAlbums() {},
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    await selectList('quota-list');

    assert.deepStrictEqual(warnings[0], [
      'LocalStorage quota exceeded, skipping lastSelectedList save',
    ]);
  });
});
