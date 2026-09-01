const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('community list frontend', () => {
  it('groups users alphabetically and lists newest year first', async () => {
    const { groupCommunityLists } =
      await import('../src/js/modules/community-list-nav.js');

    const users = groupCommunityLists(
      [
        { id: '3', name: 'Old', year: 2022, owner: { username: 'zoe' } },
        { id: '1', name: 'New', year: 2025, owner: { username: 'Bob' } },
        { id: '2', name: 'Older', year: 2023, owner: { username: 'Bob' } },
        { id: '4', name: 'Mine', year: 2025, owner: { username: 'alice' } },
      ],
      'alice'
    );

    assert.deepStrictEqual(
      users.map((user) => user.username),
      ['Bob', 'zoe']
    );
    assert.deepStrictEqual(
      users[0].lists.map((list) => list.year),
      [2025, 2023]
    );
  });

  it('renders escaped, non-sortable community navigation without menus or stars', async () => {
    const { renderCommunityRootHtml } =
      await import('../src/js/modules/community-list-nav.js');
    const username = 'b<o"b';
    const html = renderCommunityRootHtml({
      expanded: true,
      status: 'loaded',
      users: [
        {
          username,
          lists: [
            {
              id: 'list"<1',
              name: '<img src=x onerror=alert(1)>',
              year: 2025,
              itemCount: 4,
            },
          ],
        },
      ],
      activeListId: 'list"<1',
      isMobile: false,
    });

    assert.match(html, /User lists/);
    assert.match(html, /b&lt;o&quot;b/);
    assert.match(html, /list&quot;&lt;1/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /community-list-btn[^"\n]*active/);
    assert.match(html, /sidebar-group-header/);
    assert.match(html, /community-list-btn sidebar-leaf/);
    assert.match(html, /sidebar-count[^>]*>4</);
    assert.match(html, /b&lt;o&quot;b · 2025 · &lt;img/);
    assert.doesNotMatch(html, /group-section/);
    assert.doesNotMatch(
      html,
      /data-list-menu-btn|data-community-user-toggle|fa-star|fa-list/
    );
  });

  it('lazy-loads summaries once and selects a community leaf on mobile', async () => {
    const { createCommunityListNav } =
      await import('../src/js/modules/community-list-nav.js');
    const values = new Map([['communityRootExpanded:viewer-1', 'true']]);
    const apiCalls = [];
    const selected = [];
    let mobileToggles = 0;
    let rerenders = 0;
    let responseYear = 2025;
    const createdRoots = [];
    const doc = {
      createElement() {
        const listeners = {};
        const root = {
          innerHTML: '',
          className: '',
          listeners,
          setAttribute() {},
          addEventListener(event, handler) {
            listeners[event] = handler;
          },
        };
        createdRoots.push(root);
        return root;
      },
    };
    const container = {
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    };
    const nav = createCommunityListNav({
      doc,
      storage: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
      },
      getCurrentUser: () => ({ _id: 'viewer-1', username: 'alice' }),
      getActiveCommunityListId: () => null,
      apiCall: async (url) => {
        apiCalls.push(url);
        return {
          lists: [
            {
              id: 'community-1',
              name: `Best of ${responseYear}`,
              year: responseYear,
              itemCount: 10,
              owner: { username: 'bob' },
            },
            {
              id: 'community-2',
              name: `Zoe's ${responseYear}`,
              year: responseYear,
              itemCount: 8,
              owner: { username: 'zoe' },
            },
          ],
        };
      },
      selectCommunityList: (...args) => selected.push(args),
      toggleMobileLists: () => {
        mobileToggles += 1;
      },
      updateListNav: () => {
        rerenders += 1;
      },
    });

    nav.appendCommunityRoot(container, true);
    assert.match(createdRoots[0].innerHTML, /Loading user lists/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(apiCalls, ['/api/community/main-lists']);
    assert.strictEqual(rerenders, 1);

    nav.appendCommunityRoot(container, true);
    assert.match(createdRoots[1].innerHTML, /Best of 2025/);
    await createdRoots[1].listeners.click({
      target: {
        closest(selector) {
          if (selector === '[data-community-list-id]') {
            return { dataset: { communityListId: 'community-1' } };
          }
          return null;
        },
      },
    });

    assert.strictEqual(selected.length, 1);
    assert.strictEqual(selected[0][0], 'community-1');
    assert.strictEqual(selected[0][1].owner.username, 'bob');
    assert.strictEqual(mobileToggles, 1);
    assert.deepStrictEqual(apiCalls, ['/api/community/main-lists']);

    responseYear = 2010;
    await nav.refreshSummaries();
    assert.deepStrictEqual(apiCalls, [
      '/api/community/main-lists',
      '/api/community/main-lists',
    ]);
    assert.strictEqual(rerenders, 3);

    nav.appendCommunityRoot(container, true);
    assert.match(createdRoots[2].innerHTML, /Best of 2010/);
    assert.match(createdRoots[2].innerHTML, /bob · 2010 · Best of 2010/);
    assert.match(createdRoots[2].innerHTML, /zoe · 2010 · Zoe&#39;s 2010/);
  });

  it('selects into isolated read-only state without persistence or realtime subscribe', async () => {
    const { createCommunityViewer } =
      await import('../src/js/modules/community-viewer.js');
    const calls = [];
    let currentListId = 'owned-1';
    const fab = { style: { display: 'flex' } };
    const headerAddButton = {
      classList: { add: (value) => calls.push(['headerClassAdd', value]) },
    };
    const coverListeners = {};
    const cover = {
      style: {},
      setAttribute() {},
      addEventListener(event, handler) {
        coverListeners[event] = handler;
      },
    };
    const communityCard = {
      dataset: { communityItemIndex: '0' },
      querySelector(selector) {
        return selector === '.mobile-album-cover' ? cover : null;
      },
    };
    const container = {
      innerHTML: '',
      querySelectorAll(selector) {
        return selector === '[data-community-item-index]'
          ? [communityCard]
          : [];
      },
    };
    const realtime = {
      unsubscribeFromList: (id) => calls.push(['unsubscribe', id]),
      subscribeToList() {
        throw new Error('community lists must not subscribe');
      },
    };
    const viewer = createCommunityViewer({
      doc: {
        getElementById(id) {
          if (id === 'addAlbumFAB') return fab;
          if (id === 'headerAddAlbumBtn') return headerAddButton;
          if (id === 'albumContainer') return container;
          return null;
        },
      },
      apiCall: async (...args) => {
        calls.push(['apiCall', ...args]);
        return {
          id: 'community-1',
          name: 'Top albums',
          year: 2025,
          owner: { username: 'bob' },
          items: [
            {
              position: 1,
              albumId: 'album-1',
              artist: 'Artist',
              album: 'Album',
              releaseDate: '2025-01-02',
              country: 'NO',
              genre1: 'Rock',
              genre2: 'Noise',
              coverThumbnailUrl: '/cover.jpg',
            },
          ],
        };
      },
      setCurrentListId(id) {
        currentListId = id;
        calls.push(['setCurrentListId', id]);
      },
      getCurrentListId: () => currentListId,
      setCurrentRecommendationsYear: (year) =>
        calls.push(['setRecommendations', year]),
      getRealtimeSyncModuleInstance: () => realtime,
      updateListNavActiveState: (...args) => calls.push(['active', ...args]),
      updateHeaderTitle: (title) => calls.push(['header', title]),
      showLoadingSpinner: () => calls.push(['loading']),
      showToast: (...args) => calls.push(['toast', ...args]),
      playAlbumByMetadata: (...args) => calls.push(['playAlbum', ...args]),
    });

    await viewer.selectCommunityList('community-1', {
      id: 'community-1',
      name: 'Top albums',
      year: 2025,
      owner: { username: 'bob' },
    });

    assert.strictEqual(viewer.getActiveCommunityListId(), 'community-1');
    assert.deepStrictEqual(
      calls.find((call) => call[0] === 'unsubscribe'),
      ['unsubscribe', 'owned-1']
    );
    assert.deepStrictEqual(
      calls.find((call) => call[0] === 'active'),
      ['active', '', null, 'community-1']
    );
    assert.strictEqual(fab.style.display, 'none');
    assert.match(container.innerHTML, /community-list-view/);
    assert.match(container.innerHTML, /album-cover-container/);
    assert.match(container.innerHTML, /album-cell flex flex-col/);
    assert.match(container.innerHTML, /data-mobile-title-row/);
    assert.match(container.innerHTML, /mobile-position-badge/);
    assert.match(container.innerHTML, />1</);
    assert.doesNotMatch(
      container.innerHTML,
      /comments|tracks|editable|context-menu|data-list-id|recommend/i
    );
    assert.strictEqual(
      calls.some(
        (call) => call[0] === 'apiCall' && call[1] === '/api/user/last-list'
      ),
      false
    );

    coverListeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.deepStrictEqual(
      calls.find((call) => call[0] === 'playAlbum'),
      [
        'playAlbum',
        'Artist',
        'Album',
        { albumId: 'album-1', releaseDate: '2025-01-02' },
      ]
    );
  });

  it('uses the shame GIF and keeps the disqualification reason in the tooltip', async () => {
    const { renderCommunityList } =
      await import('../src/js/modules/community-viewer.js');
    const html = renderCommunityList({
      items: [
        {
          position: 9,
          artist: 'Artist',
          album: 'Album',
          isDisqualified: true,
          disqualificationReason: 'Released in the wrong year <nope>',
          coverThumbnailUrl: '/ordinary.jpg',
        },
      ],
    });

    assert.match(html, /\/shame-go-t\.gif/);
    assert.match(html, /Disqualified/);
    assert.match(html, /Released in the wrong year &lt;nope&gt;/);
    assert.doesNotMatch(html, /community-disqualification-reason/);
    assert.doesNotMatch(html, /ordinary\.jpg/);
  });
});
