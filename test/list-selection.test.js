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
        if (url === '/api/lists/list-1?profile=core') {
          return [{ album_id: 'fetched' }];
        }
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
    assert.deepStrictEqual(apiCalls[0], [
      '/api/lists/list-1?profile=core',
      undefined,
    ]);
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

  it('defers hydration without rerendering unchanged list order', async () => {
    const scheduledTasks = [];
    const apiCalls = [];
    const setListDataCalls = [];
    const renderCalls = [];
    let playcountCalls = 0;
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1' },
      storage: { setItem() {} },
      logger: { warn() {} },
      schedulePostRenderTask(task, options) {
        scheduledTasks.push({ task, options });
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [{ _id: 'item-1', album_id: 'album-1' }],
      isListDataLoaded: () => true,
      isListDataFullyLoaded: () => false,
      getListDataProfile: () => 'core',
      apiCall: async (url, options) => {
        apiCalls.push([url, options]);
        return [
          {
            _id: 'item-1',
            album_id: 'album-1',
            summary: 'Hydrated summary',
          },
        ];
      },
      setListData(...args) {
        setListDataCalls.push(args);
      },
      displayAlbums(...args) {
        renderCalls.push(args);
      },
      fetchAndDisplayPlaycounts: async () => {
        playcountCalls += 1;
      },
      showToast() {},
    });

    await selectList('list-1');

    assert.deepStrictEqual(renderCalls[0], [
      [{ _id: 'item-1', album_id: 'album-1' }],
      { forceFullRebuild: true },
    ]);
    assert.strictEqual(scheduledTasks.length, 2);
    assert.deepStrictEqual(scheduledTasks[0].options, { timeoutMs: 2500 });
    assert.deepStrictEqual(scheduledTasks[1].options, {
      delayMs: 250,
      timeoutMs: 3000,
    });
    assert.strictEqual(apiCalls.length, 0);
    assert.strictEqual(playcountCalls, 0);

    scheduledTasks[0].task();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(apiCalls[0], ['/api/lists/list-1', undefined]);
    assert.deepStrictEqual(setListDataCalls[0], [
      'list-1',
      [
        {
          _id: 'item-1',
          album_id: 'album-1',
          summary: 'Hydrated summary',
        },
      ],
      true,
      { profile: 'full' },
    ]);
    assert.strictEqual(renderCalls.length, 1);

    scheduledTasks[1].task();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(playcountCalls, 1);
  });

  it('rerenders hydrated data when item order changed', async () => {
    const scheduledTasks = [];
    const renderCalls = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1' },
      storage: { setItem() {} },
      logger: { warn() {} },
      schedulePostRenderTask(task, options) {
        scheduledTasks.push({ task, options });
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [
        { _id: 'item-1', album_id: 'album-1' },
        { _id: 'item-2', album_id: 'album-2' },
      ],
      isListDataLoaded: () => true,
      isListDataFullyLoaded: () => false,
      getListDataProfile: () => 'core',
      apiCall: async () => [
        { _id: 'item-2', album_id: 'album-2' },
        { _id: 'item-1', album_id: 'album-1' },
      ],
      setListData() {},
      displayAlbums(...args) {
        renderCalls.push(args);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    await selectList('list-1');
    scheduledTasks[0].task();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(renderCalls.length, 2);
    assert.deepStrictEqual(renderCalls[1], [
      [
        { _id: 'item-2', album_id: 'album-2' },
        { _id: 'item-1', album_id: 'album-1' },
      ],
      { forceFullRebuild: true },
    ]);
  });

  it('preloads first-screen cover images before rendering the selected list', async () => {
    const images = [];
    const timers = new Map();
    const renderCalls = [];
    let nextTimerId = 1;
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1', innerWidth: 1280 },
      storage: { setItem() {} },
      logger: { warn() {} },
      setTimeoutFn(callback, ms) {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, { callback, ms });
        return id;
      },
      clearTimeoutFn(id) {
        timers.delete(id);
      },
      schedulePostRenderTask() {},
      createImage() {
        const image = {
          complete: false,
          naturalWidth: 0,
          decode: () => Promise.resolve(),
        };
        Object.defineProperty(image, 'src', {
          set(value) {
            image.srcValue = value;
            images.push(image);
          },
        });
        return image;
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [
        { album_id: 'album-1', cover_thumb_url: '/thumb-1.jpg' },
        { album_id: 'album-2', cover_thumb_url: '/thumb-2.jpg' },
      ],
      isListDataLoaded: () => true,
      getListDataProfile: () => 'full',
      apiCall: async () => ({ success: true }),
      setListData() {},
      displayAlbums(...args) {
        renderCalls.push(args);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    const selectPromise = selectList('list-1');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(
      images.map((image) => image.srcValue),
      ['/thumb-1.jpg', '/thumb-2.jpg']
    );
    assert.strictEqual(renderCalls.length, 0);
    assert.strictEqual([...timers.values()][0].ms, 650);

    images[0].onload();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(renderCalls.length, 0);

    images[1].onload();
    await selectPromise;

    assert.strictEqual(renderCalls.length, 1);
    assert.strictEqual(timers.size, 0);
  });

  it('primes bootstrapped playcounts after clearing stale cache and before render', async () => {
    const calls = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1', innerWidth: 1280 },
      storage: { setItem() {} },
      logger: { warn() {} },
      schedulePostRenderTask() {},
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {
        calls.push(['clearPlaycountCache']);
      },
      primePlaycountCache(playcounts) {
        calls.push(['primePlaycountCache', playcounts]);
      },
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [{ _id: 'item-1', album_id: 'album-1' }],
      isListDataLoaded: () => true,
      getListDataProfile: () => 'full',
      apiCall: async () => ({ success: true }),
      setListData() {},
      displayAlbums(...args) {
        calls.push(['displayAlbums', ...args]);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    const initialPlaycounts = {
      'item-1': { playcount: 42, status: 'success' },
    };

    await selectList('list-1', { initialPlaycounts });

    assert.deepStrictEqual(calls, [
      ['clearPlaycountCache'],
      ['primePlaycountCache', initialPlaycounts],
      [
        'displayAlbums',
        [{ _id: 'item-1', album_id: 'album-1' }],
        { forceFullRebuild: true },
      ],
    ]);
  });

  it('prefetches playcounts before rendering when bootstrap playcounts are absent', async () => {
    const calls = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1', innerWidth: 1280 },
      storage: { setItem() {} },
      logger: { warn() {} },
      schedulePostRenderTask(task, options) {
        calls.push(['schedulePostRenderTask', options]);
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {
        calls.push(['clearPlaycountCache']);
      },
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [{ _id: 'item-1', album_id: 'album-1' }],
      isListDataLoaded: () => true,
      getListDataProfile: () => 'full',
      apiCall: async () => ({ success: true }),
      setListData() {},
      prefetchPlaycountsForRender: async (listId) => {
        calls.push(['prefetchPlaycountsForRender', listId]);
        return {
          playcounts: { 'item-1': { playcount: 42, status: 'success' } },
          refreshing: 0,
        };
      },
      displayAlbums(...args) {
        calls.push(['displayAlbums', ...args]);
      },
      fetchAndDisplayPlaycounts: async () => {
        calls.push(['fetchAndDisplayPlaycounts']);
      },
      showToast() {},
    });

    await selectList('list-1');

    assert.deepStrictEqual(calls, [
      ['clearPlaycountCache'],
      ['prefetchPlaycountsForRender', 'list-1'],
      [
        'displayAlbums',
        [{ _id: 'item-1', album_id: 'album-1' }],
        { forceFullRebuild: true },
      ],
    ]);
  });

  it('does not render stale list data if selection changes during cover preload', async () => {
    const timers = [];
    const renderCalls = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1', innerWidth: 1280 },
      storage: { setItem() {} },
      logger: { warn() {} },
      setTimeoutFn(callback, ms) {
        timers.push({ callback, ms });
        return timers.length;
      },
      clearTimeoutFn() {},
      schedulePostRenderTask() {},
      createImage() {
        const image = { complete: false, naturalWidth: 0 };
        Object.defineProperty(image, 'src', { set() {} });
        return image;
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [
        { album_id: 'album-1', cover_thumb_url: '/thumb-1.jpg' },
      ],
      isListDataLoaded: () => true,
      getListDataProfile: () => 'full',
      apiCall: async () => ({ success: true }),
      setListData() {},
      displayAlbums(...args) {
        renderCalls.push(args);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    const selectPromise = selectList('list-1');
    await new Promise((resolve) => setImmediate(resolve));

    currentListId = 'other-list';
    timers[0].callback();
    await selectPromise;

    assert.strictEqual(renderCalls.length, 0);
  });

  it('renders the selected list after cover preload timeout', async () => {
    const timers = [];
    const renderCalls = [];
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1', innerWidth: 1280 },
      storage: { setItem() {} },
      logger: { warn() {} },
      setTimeoutFn(callback, ms) {
        timers.push({ callback, ms });
        return timers.length;
      },
      clearTimeoutFn() {},
      schedulePostRenderTask() {},
      createImage() {
        const image = { complete: false, naturalWidth: 0 };
        Object.defineProperty(image, 'src', { set() {} });
        return image;
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [
        { album_id: 'album-1', cover_thumb_url: '/thumb-1.jpg' },
      ],
      isListDataLoaded: () => true,
      getListDataProfile: () => 'full',
      apiCall: async () => ({ success: true }),
      setListData() {},
      displayAlbums(...args) {
        renderCalls.push(args);
      },
      fetchAndDisplayPlaycounts: async () => {},
      showToast() {},
    });

    const selectPromise = selectList('list-1');
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(renderCalls.length, 0);
    assert.strictEqual(timers[0].ms, 650);

    timers[0].callback();
    await selectPromise;

    assert.strictEqual(renderCalls.length, 1);
  });

  it('limits cover preloads to the first screen by viewport size', async () => {
    const albums = Array.from({ length: 20 }, (_, index) => ({
      album_id: `album-${index}`,
      cover_thumb_url: `/thumb-${index}.jpg`,
    }));

    async function getPreloadedCoverCount(innerWidth) {
      const images = [];
      let currentListId = null;

      const { selectList } = createListSelection({
        doc: {
          getElementById() {
            return null;
          },
        },
        win: { lastSelectedList: 'list-1', innerWidth },
        storage: { setItem() {} },
        logger: { warn() {} },
        setTimeoutFn() {
          return 1;
        },
        clearTimeoutFn() {},
        schedulePostRenderTask() {},
        createImage() {
          const image = {
            complete: true,
            naturalWidth: 1,
            decode: () => Promise.resolve(),
          };
          Object.defineProperty(image, 'src', {
            set(value) {
              images.push(value);
            },
          });
          return image;
        },
        setCurrentListId(id) {
          currentListId = id;
        },
        setCurrentRecommendationsYear() {},
        getCurrentListId: () => currentListId,
        getRealtimeSyncModuleInstance: () => null,
        clearPlaycountCache() {},
        getLists: () => ({ 'list-1': { name: 'List One' } }),
        updateListNavActiveState() {},
        updateHeaderTitle() {},
        updateMobileHeader() {},
        showLoadingSpinner() {},
        getListData: () => albums,
        isListDataLoaded: () => true,
        getListDataProfile: () => 'full',
        apiCall: async () => ({ success: true }),
        setListData() {},
        displayAlbums() {},
        fetchAndDisplayPlaycounts: async () => {},
        showToast() {},
      });

      await selectList('list-1');

      return images.length;
    }

    assert.strictEqual(await getPreloadedCoverCount(1280), 16);
    assert.strictEqual(await getPreloadedCoverCount(390), 8);
  });

  it('skips deferred list work after switching lists', async () => {
    const scheduledTasks = [];
    const apiCalls = [];
    let playcountCalls = 0;
    let currentListId = null;

    const { selectList } = createListSelection({
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { lastSelectedList: 'list-1' },
      storage: { setItem() {} },
      logger: { warn() {} },
      schedulePostRenderTask(task, options) {
        scheduledTasks.push({ task, options });
      },
      setCurrentListId(id) {
        currentListId = id;
      },
      setCurrentRecommendationsYear() {},
      getCurrentListId: () => currentListId,
      getRealtimeSyncModuleInstance: () => null,
      clearPlaycountCache() {},
      getLists: () => ({ 'list-1': { name: 'List One' } }),
      updateListNavActiveState() {},
      updateHeaderTitle() {},
      updateMobileHeader() {},
      showLoadingSpinner() {},
      getListData: () => [{ album_id: 'core' }],
      isListDataLoaded: () => true,
      isListDataFullyLoaded: () => false,
      getListDataProfile: () => 'core',
      apiCall: async (url, options) => {
        apiCalls.push([url, options]);
        return [{ album_id: 'full' }];
      },
      setListData() {},
      displayAlbums() {},
      fetchAndDisplayPlaycounts: async () => {
        playcountCalls += 1;
      },
      showToast() {},
    });

    await selectList('list-1');
    currentListId = 'other-list';

    scheduledTasks[0].task();
    scheduledTasks[1].task();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepStrictEqual(apiCalls, []);
    assert.strictEqual(playcountCalls, 0);
  });
});
