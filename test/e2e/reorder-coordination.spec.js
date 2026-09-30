const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Isolated browser regression: real sorting/state/persistence/API modules and DOM,
// with only Sortable's move notification and the HTTP server controlled by the test.
async function mountHarness(page, mobile, rejectReorder = false) {
  const root = path.resolve(__dirname, '../..');
  const requests = [];
  const revisions = { a: 1, b: 1 };
  await page.route('http://reorder.test/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><main id="list"></main></body></html>',
      });
    }
    if (pathname.startsWith('/api/lists/')) {
      const id = pathname.split('/')[3];
      requests.push({
        path: pathname,
        method: request.method(),
        revision: request.headers()['if-match'],
        body: request.postDataJSON(),
      });
      const conflict =
        rejectReorder || request.headers()['if-match'] !== `"${revisions[id]}"`;
      return route.fulfill({
        status: conflict ? 412 : 200,
        headers: {
          'X-List-Revision': String(conflict ? revisions[id] : ++revisions[id]),
        },
        json: conflict
          ? { code: 'LIST_CONFLICT', error: 'Reload and reconcile this list.' }
          : {},
      });
    }
    const file = path.resolve(root, `.${pathname}`);
    if (
      !file.startsWith(`${root}${path.sep}`) ||
      !/^\/(src\/js|utils)\/.+\.js$/.test(pathname)
    ) {
      return route.abort();
    }
    return route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(file, 'utf8'),
    });
  });
  await page.goto('http://reorder.test/');
  await page.evaluate(async (mobile) => {
    const moduleRoot = new URL('./src/js/', window.location.href);
    const load = (name) => import(new URL(name, moduleRoot).href);
    const { createSorting } = await load('modules/sorting.js');
    const { createAppListOperations } = await load(
      'modules/app-list-operations.js'
    );
    const { createAppApiClient } = await load('modules/app-api-client.js');
    const state = await load('modules/app-state.js');
    const { computeListDiff } = await load('utils/save-optimizer.js');
    const { rememberListRevision } = await load('modules/list-revisions.js');
    const { hasUnsavedLists } = await load('modules/unsaved-lists.js');
    const container = document.getElementById('list');
    const notices = [];
    const showToast = (message) => notices.push(message);
    const { apiCall } = createAppApiClient({
      getRealtimeSyncModuleInstance: () => null,
      logger: { error() {} },
    });
    const operations = createAppListOperations({
      ...state,
      apiCall,
      computeListDiff,
      markLocalSave() {},
      updateListNav() {},
      showToast,
      logger: { log() {}, error() {} },
    });
    for (const id of ['a', 'b']) {
      state.setListData(
        id,
        [1, 2, 3].map((n) => ({ album_id: `${id}${n}`, album: `Album ${n}` }))
      );
      rememberListRevision(id, '1');
    }
    const sorting = createSorting({
      getCurrentList: state.getCurrentListId,
      getListData: state.getListData,
      debouncedSaveReorder: operations.debouncedSaveReorder,
      flushReorder: operations.flushReorder,
      updatePositionNumbers() {},
      showToast,
      loadSortable: async () =>
        class {
          constructor(_target, options) {
            this.options = options;
          }
          destroy() {}
        },
    });
    window.reorderHarness = {
      state,
      operations,
      notices,
      hasUnsavedLists,
      async select(id) {
        sorting.destroySorting(container);
        state.setCurrentListId(id);
        const rows = document.createElement('div');
        rows.className = mobile ? 'mobile-album-list' : 'album-rows-container';
        for (const album of state.getListData(id)) {
          const row = document.createElement('div');
          row.dataset.albumId = album.album_id;
          row.className = 'album-card-wrapper';
          row.textContent = album.album;
          rows.append(row);
        }
        container.replaceChildren(rows);
        await sorting.initializeUnifiedSorting(container, mobile);
        return rows;
      },
      drag() {
        const rows = container.firstElementChild;
        const item = rows.firstElementChild;
        rows.append(item);
        return container._sortable.options.onEnd({
          item,
          to: rows,
          oldIndex: 0,
          newIndex: 2,
        });
      },
    };
  }, mobile);
  return requests;
}

for (const mobile of [false, true]) {
  test(`coordinates rapid reorders, navigation and following edits (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }
    );
    const requests = await mountHarness(page, mobile);
    const result = await page.evaluate(async () => {
      const h = window.reorderHarness;
      await h.select('a');
      const first = h.drag();
      const second = h.drag();
      const protectedDuringDebounce = h.hasUnsavedLists();
      await h.select('b');
      const third = h.drag();
      const edited = h.state
        .getListData('b')
        .map((item) => ({ ...item, album: 'Edited' }));
      h.state.setListData('b', edited, false);
      await Promise.all([
        first,
        second,
        third,
        h.operations.saveList('b', edited),
      ]);
      return {
        protectedDuringDebounce,
        stillUnsaved: h.hasUnsavedLists(),
        snapshots: ['a', 'b'].map((id) =>
          h.state.getLastSavedSnapshots().get(id)
        ),
        notices: h.notices,
      };
    });
    expect(result).toEqual({
      protectedDuringDebounce: true,
      stillUnsaved: false,
      snapshots: [
        ['a3', 'a1', 'a2'],
        ['b2', 'b3', 'b1'],
      ],
      notices: [],
    });
    const writes = requests.map(({ path, method, revision }) => ({
      path,
      method,
      revision,
    }));
    expect(
      writes.filter((write) => write.path.startsWith('/api/lists/a'))
    ).toEqual([
      { path: '/api/lists/a/reorder', method: 'POST', revision: '"1"' },
    ]);
    expect(
      writes.filter((write) => write.path.startsWith('/api/lists/b'))
    ).toEqual([
      { path: '/api/lists/b/reorder', method: 'POST', revision: '"1"' },
      { path: '/api/lists/b', method: 'PUT', revision: '"2"' },
    ]);
    expect(
      requests
        .find((request) => request.method === 'PUT')
        .body.data.every((item) => item.album === 'Edited')
    ).toBe(true);
  });

  test(`restores row identity after a rejected coalesced batch (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    const requests = await mountHarness(page, mobile, true);
    const result = await page.evaluate(async () => {
      const h = window.reorderHarness;
      const rows = await h.select('a');
      const before = [...rows.children];
      const first = h.drag();
      const second = h.drag();
      await h.operations.waitForListSaves('a');
      await Promise.all([first, second]);
      return {
        order: h.state.getListData('a').map((item) => item.album_id),
        sameNodes: [...rows.children].every((row, i) => row === before[i]),
        dirty: h.operations.getListSaveState('a').dirty,
        notices: h.notices,
      };
    });
    expect(result).toEqual({
      order: ['a1', 'a2', 'a3'],
      sameNodes: true,
      dirty: true,
      notices: ['Reload and reconcile this list.'],
    });
    expect(requests).toHaveLength(1);
  });
}
