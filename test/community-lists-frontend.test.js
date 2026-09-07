const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

function eventNode(parent = null) {
  const listeners = new Map();
  return {
    parent,
    dataset: {},
    style: {},
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    dispatch(type, details = {}) {
      const event = {
        type,
        target: this,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...details,
      };
      for (let node = this; node && !event.stopped; node = node.parent) {
        node[`on${type}`]?.(event);
        node.handleEvent(event);
      }
      return event;
    },
    handleEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function communityHarness(createCommunityViewer, items, overrides = {}) {
  const win = eventNode();
  const container = eventNode();
  const renders = [];
  // Model fresh event targets on each innerHTML replacement, not reused owner
  // nodes. Markup contracts are checked separately against the shared layouts.
  Object.defineProperty(container, 'innerHTML', {
    get: () => renders.at(-1)?.html || '',
    set(html) {
      const rows = [];
      const cards = [];
      const covers = [];
      for (const match of html.matchAll(
        /<div class="(album-row album-grid[^"]*|album-card album-row[^"]*)" data-index="([^"]*)"/g
      )) {
        const node = eventNode(container);
        node.dataset.index = match[2];
        const mobile = match[1].startsWith('album-card');
        const cover = eventNode(node);
        const cells = ['country-cell', 'genre-1-cell', 'genre-2-cell'].map(() =>
          eventNode(node)
        );
        node.cells = cells;
        node.cover = cover;
        node.querySelector = (selector) => {
          if (selector === (mobile ? '.mobile-album-cover' : '.album-cover')) {
            return cover;
          }
          const index = [
            '.country-cell',
            '.genre-1-cell',
            '.genre-2-cell',
          ].indexOf(selector);
          return cells[index] || null;
        };
        (mobile ? cards : rows).push(node);
        if (!mobile) covers.push(cover);
      }
      container.querySelectorAll = (selector) => {
        if (selector === '.mobile-album-list .album-card') return cards;
        if (selector === '.album-rows-container .album-cover') return covers;
        if (selector === '.album-row') return [...rows, ...cards];
        return [];
      };
      renders.push({ html, rows, cards, covers });
    },
  });
  const forbidden = Object.fromEntries(
    [
      'saveList',
      'makeCountryEditable',
      'makeGenreEditable',
      'makeCommentEditable',
      'makeComment2Editable',
      'showMobileEditForm',
      'showMobileAlbumMenu',
      'showTrackSelectionMenu',
      'fetchTracksForAlbum',
      'initializeUnifiedSorting',
      'setContextAlbum',
      'getListData',
    ].map((name) => [name, mock.fn()])
  );
  const previewClicks = mock.fn();
  const deps = {
    ...forbidden,
    doc: {
      getElementById: (id) => (id === 'albumContainer' ? container : null),
    },
    win,
    apiCall: mock.fn(async () => ({ name: 'Community', items })),
    getCurrentListId: () => 'owned-1',
    setCurrentListId: mock.fn(),
    setCurrentRecommendationsYear: mock.fn(),
    getRealtimeSyncModuleInstance: () => null,
    updateListNavActiveState: mock.fn(),
    updateHeaderTitle: mock.fn(),
    showLoadingSpinner: mock.fn(),
    showToast: mock.fn(),
    playAlbumByMetadata: mock.fn(),
    deactivateOwnedView: mock.fn(),
    attachDesktopCoverPreview: mock.fn((image) => {
      image.addEventListener('click', () => previewClicks(image));
    }),
    closeCoverPreview: mock.fn(),
    ...overrides,
  };
  return {
    viewer: createCommunityViewer(deps),
    container,
    win,
    renders,
    deps,
    forbidden,
    previewClicks,
  };
}

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

  it('renders escaped expandable users with every revealed year and no album counts', async () => {
    const { renderCommunityRootHtml } =
      await import('../src/js/modules/community-list-nav.js');
    const username = 'b<o"b';
    const html = renderCommunityRootHtml({
      expanded: true,
      status: 'loaded',
      users: [
        {
          username,
          lists: [2014, 2013, 2012, 2011, 2010].map((year) => ({
            id: year === 2014 ? 'list"<1' : `list-${year}`,
            name:
              year === 2014
                ? '<img src=x onerror=alert(1)>'
                : `Årslisten ${year}`,
            year,
            itemCount: 4,
          })),
        },
      ],
      userExpandState: { [username]: true },
      activeListId: 'list"<1',
    });

    assert.match(html, /User lists/);
    assert.match(html, /b&lt;o&quot;b/);
    assert.match(html, /list&quot;&lt;1/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /community-list-btn[^"\n]*active/);
    assert.match(html, /sidebar-group-header/);
    assert.match(html, /community-list-btn sidebar-leaf/);
    assert.match(html, /data-community-user-toggle="b&lt;o&quot;b"/);
    assert.match(html, /aria-expanded="true"/);
    assert.strictEqual(
      (html.match(/data-community-list-id=/g) || []).length,
      5
    );
    for (const year of [2014, 2013, 2012, 2011, 2010]) {
      assert.match(html, new RegExp(`${year} ·`));
    }
    assert.doesNotMatch(html, /group-section/);
    assert.doesNotMatch(
      html,
      /data-list-menu-btn|fa-star|fa-list|sidebar-count/
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
    assert.match(createdRoots[1].innerHTML, />bob</);
    assert.match(createdRoots[1].innerHTML, />zoe</);
    assert.doesNotMatch(createdRoots[1].innerHTML, /Best of 2025/);

    await createdRoots[1].listeners.click({
      target: {
        closest(selector) {
          if (selector === '[data-community-user-toggle]') {
            return { dataset: { communityUserToggle: 'bob' } };
          }
          return null;
        },
      },
    });
    assert.strictEqual(
      values.get('communityUserExpandState:viewer-1'),
      JSON.stringify({ bob: true })
    );

    nav.appendCommunityRoot(container, true);
    assert.match(createdRoots[2].innerHTML, /Best of 2025/);
    assert.doesNotMatch(createdRoots[2].innerHTML, /Zoe&#39;s 2025/);
    await createdRoots[2].listeners.click({
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
    assert.strictEqual(rerenders, 4);

    nav.appendCommunityRoot(container, true);
    assert.match(createdRoots[3].innerHTML, /2010 · Best of 2010/);
    assert.doesNotMatch(createdRoots[3].innerHTML, /Zoe&#39;s 2010/);
    assert.doesNotMatch(createdRoots[3].innerHTML, /sidebar-count/);
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
      dataset: { index: '0' },
      querySelector(selector) {
        return selector === '.mobile-album-cover' ? cover : null;
      },
    };
    const container = {
      innerHTML: '',
      querySelectorAll(selector) {
        return selector === '.mobile-album-list .album-card'
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
      deactivateOwnedView: () => calls.push(['deactivate']),
      attachDesktopCoverPreview: (...args) => calls.push(['preview', ...args]),
      closeCoverPreview: () => calls.push(['closePreview']),
    });

    await viewer.selectCommunityList('community-1', {
      id: 'community-1',
      name: 'Top albums',
      year: 2025,
      owner: { username: 'bob' },
    });

    assert.strictEqual(viewer.getActiveCommunityListId(), 'community-1');
    assert.strictEqual(
      calls.filter((call) => call[0] === 'deactivate').length,
      1
    );
    assert.ok(
      calls.findIndex((call) => call[0] === 'deactivate') <
        calls.findIndex((call) => call[0] === 'setCurrentListId')
    );
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

  it('composes the shared desktop header/rows and 145px mobile shells using only revealed columns', async () => {
    const { renderCommunityList } =
      await import('../src/js/modules/community-viewer.js');
    const { renderDesktopAlbumHeader, renderDesktopAlbumRow } =
      await import('../src/js/modules/album-display/desktop-layout.js');
    const { renderMobileAlbumCard } =
      await import('../src/js/modules/album-display/mobile-layout.js');
    const { getAllColumns } =
      await import('../src/js/modules/column-config.js');
    const { formatReleaseDate } =
      await import('../src/js/modules/date-utils.js');
    const item = {
      position: 7,
      albumId: 'album-7',
      album: 'Shared Album',
      artist: 'Shared Artist',
      releaseDate: '2025-01-02',
      country: 'NO',
      genre1: 'Jazz',
      genre2: '',
      coverThumbnailUrl: '/thumb.jpg',
      coverImageUrl: '/full.jpg',
      comments: 'PRIVATE_COMMENT',
      comments_2: 'PRIVATE_COMMENT_2',
      primary_track: 'PRIVATE_TRACK',
      tracks: ['PRIVATE_TRACK'],
      playcount: 123456,
      summary: 'PRIVATE_SUMMARY',
      recommended_by: 'PRIVATE_RECOMMENDER',
      availability: ['spotify'],
      taxonomy: { rym: { primary_genres: ['PRIVATE_TAXONOMY'] } },
    };
    const before = globalThis.structuredClone(item);
    const columns = getAllColumns().filter(({ id }) =>
      [
        'position',
        'cover',
        'album',
        'artist',
        'country',
        'genre_1',
        'genre_2',
      ].includes(id)
    );
    assert.strictEqual(columns.length, 7);
    const options = {
      columns,
      visibleColumns: columns,
      editable: false,
      includeAvailability: false,
      coverOptions: { loadMode: 'lazy' },
    };
    const data = {
      position: 7,
      albumId: item.albumId,
      albumName: item.album,
      artist: item.artist,
      releaseDate: formatReleaseDate(item.releaseDate),
      country: item.country,
      genre1: item.genre1,
      genre2: '',
      genre1Display: item.genre1,
      genre2Display: '',
      isDisqualified: false,
      disqualificationReason: '',
      coverImageUrl: item.coverImageUrl,
      coverThumbUrl: item.coverThumbnailUrl,
      availability: [],
    };
    const header = renderDesktopAlbumHeader(options);
    const row = renderDesktopAlbumRow(data, 0, options);
    const card = renderMobileAlbumCard(data, 0, options);
    const html = renderCommunityList({ items: [item] });
    for (const part of [header, row, card])
      assert.ok(html.includes(part.outerHTML));
    assert.strictEqual(
      header.gridTemplate,
      '7px 75px 0.65fr 0.55fr 0.45fr 0.55fr 0.55fr'
    );
    assert.strictEqual(row.gridTemplate, header.gridTemplate);
    assert.strictEqual(card.wrapperClassName, 'album-card-wrapper h-[145px]');
    assert.strictEqual(
      card.className,
      'album-card album-row relative h-[145px] bg-gray-900'
    );
    assert.match(html, /data-read-only="true"/);
    assert.doesNotMatch(
      html,
      /PRIVATE_|123456|data-playcount|track-cell|comment-cell|comment-2-cell|album-availability|taxonomy-trigger/
    );
    assert.doesNotMatch(
      html,
      /data-album-menu-btn|data-track-play-btn|column-toggle|contenteditable|draggable|cursor-pointer|hover:text-gray-100/
    );
    assert.doesNotMatch(row.html, />Genre 2</);
    assert.match(row.html, /genre-2-cell[^>]*>\s*<span[^>]*><\/span>/);
    assert.deepStrictEqual(item, before);
  });

  it('preserves zero-based data-index values, including the first item, in both layouts', async () => {
    const { renderCommunityList } =
      await import('../src/js/modules/community-viewer.js');
    const html = renderCommunityList({
      items: [
        { album: 'First', artist: 'Artist' },
        { album: 'Second', artist: 'Artist' },
      ],
    });
    assert.deepStrictEqual(
      [...html.matchAll(/data-index="([^"]*)"/g)].map((match) => match[1]),
      ['0', '1', '0', '1']
    );
  });

  it('escapes community names, disqualification reasons and ranks in both layouts', async () => {
    const { renderCommunityList } =
      await import('../src/js/modules/community-viewer.js');
    const attack = '"><script>alert(1)</script>&';
    const html = renderCommunityList({
      items: [
        {
          position: attack,
          artist: attack,
          album: attack,
          country: attack,
          genre1: attack,
          genre2: attack,
          isDisqualified: true,
          disqualificationReason: attack,
        },
      ],
    });
    const escaped = '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;';
    const [desktop, mobile] = html.split(
      '<div class="mobile-album-list md:hidden">'
    );
    for (const markup of [desktop, mobile]) {
      assert.ok(markup.includes(escaped));
      assert.match(markup, /Disqualified/);
      assert.doesNotMatch(markup, /<script>|&amp;lt;script|\son\w+=/);
    }
    assert.ok(
      desktop.includes(`data-position-element="true">${escaped}</div>`)
    );
    assert.ok(mobile.includes(`>${escaped}</span>`));
  });

  it('honors viewer preferences on render and rerender without saving or expanding the projection', async (t) => {
    const { createCommunityViewer } =
      await import('../src/js/modules/community-viewer.js');
    const columns = await import('../src/js/modules/column-config.js');
    const previousDocument = globalThis.document;
    const previousPrefs = columns.getVisibilityPrefs();
    globalThis.document = { documentElement: { style: { setProperty() {} } } };
    t.after(() => {
      columns.init(previousPrefs);
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    });
    const schedule = t.mock.method(globalThis, 'setTimeout', () => 1);
    const prefs = Object.freeze({
      country: false,
      genre_2: false,
      track: true,
      comment: true,
    });
    columns.init(prefs);
    const h = communityHarness(createCommunityViewer, [
      { album: 'Album', artist: 'Artist' },
    ]);
    await h.viewer.selectCommunityList('community-1');
    const first = h.renders[0];
    assert.match(first.html, /country-cell column-hidden/);
    assert.match(first.html, /column-hidden flex items-center country-cell/);
    assert.match(first.html, /genre-2-cell column-hidden/);
    assert.match(
      first.html,
      /grid-template-columns: 7px 75px 0.65fr 0.55fr 0.55fr[";]/
    );
    assert.strictEqual(columns.getVisibilityPrefs(), prefs);

    columns.init({ genre_1: false });
    h.win.dispatch('columnvisibilitychange');
    assert.strictEqual(h.renders.length, 2);
    assert.notStrictEqual(h.renders[1].cards[0], first.cards[0]);
    assert.match(h.container.innerHTML, /genre-1-cell column-hidden/);
    assert.doesNotMatch(
      h.container.innerHTML,
      /country-cell column-hidden|track-cell|comment-cell|data-playcount/
    );
    assert.strictEqual(h.deps.apiCall.mock.calls.length, 1);
    assert.strictEqual(h.deps.deactivateOwnedView.mock.calls.length, 1);
    assert.strictEqual(
      schedule.mock.calls.length,
      0,
      'reading preferences must not schedule a settings save'
    );
    for (const [name, fn] of Object.entries(h.forbidden)) {
      assert.strictEqual(fn.mock.calls.length, 0, name);
    }
    h.viewer.clearSelection();
    h.win.dispatch('columnvisibilitychange');
    assert.strictEqual(h.renders.length, 2);
    assert.strictEqual(h.deps.closeCoverPreview.mock.calls.length, 1);
  });

  it('dispatches read-only input on fresh community nodes and plays/previews the selected item explicitly', async () => {
    const { createCommunityViewer } =
      await import('../src/js/modules/community-viewer.js');
    const items = [0, 1].map((index) => ({
      artist: `Artist ${index}`,
      album: `Album ${index}`,
      albumId: `album-${index}`,
      releaseDate: `2025-01-0${index + 1}`,
      coverThumbnailUrl: `/cover-${index}.jpg`,
    }));
    const h = communityHarness(createCommunityViewer, items);
    await h.viewer.selectCommunityList('community-1');
    h.win.dispatch('columnvisibilitychange');
    const { rows, cards, covers } = h.renders.at(-1);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(cards.length, 2);
    assert.notStrictEqual(cards[1], h.renders[0].cards[1]);
    for (const node of [
      h.container,
      ...rows,
      ...cards,
      ...rows.flatMap((row) => row.cells),
      ...cards.flatMap((card) => card.cells),
    ]) {
      for (const type of [
        'click',
        'dblclick',
        'contextmenu',
        'dragstart',
        'dragover',
        'drop',
        'dragend',
        'input',
        'change',
      ]) {
        node.dispatch(type);
      }
    }
    assert.strictEqual(h.deps.playAlbumByMetadata.mock.calls.length, 0);
    const cover = cards[1].cover;
    assert.strictEqual(cover.attributes.role, 'button');
    assert.strictEqual(cover.attributes.tabindex, '0');
    for (const [type, key] of [
      ['click'],
      ['keydown', 'Enter'],
      ['keydown', ' '],
    ]) {
      const event = cover.dispatch(type, { key });
      assert.strictEqual(event.stopped, true);
      assert.strictEqual(event.defaultPrevented, true);
    }
    cover.dispatch('keydown', { key: 'Escape' });
    cover.dispatch('dblclick');
    cover.dispatch('contextmenu');
    cover.dispatch('dragstart');
    assert.strictEqual(h.deps.playAlbumByMetadata.mock.calls.length, 3);
    for (const call of h.deps.playAlbumByMetadata.mock.calls) {
      assert.deepStrictEqual(call.arguments, [
        'Artist 1',
        'Album 1',
        {
          albumId: 'album-1',
          releaseDate: '2025-01-02',
        },
      ]);
    }
    covers[1].dispatch('click');
    assert.deepStrictEqual(h.previewClicks.mock.calls[0].arguments, [
      covers[1],
    ]);
    assert.deepStrictEqual(
      h.deps.attachDesktopCoverPreview.mock.calls.at(-1).arguments,
      [covers[1]]
    );
    assert.strictEqual(h.deps.apiCall.mock.calls.length, 1);
    assert.strictEqual(h.deps.showToast.mock.calls.length, 0);
    for (const [name, fn] of Object.entries(h.forbidden)) {
      assert.strictEqual(fn.mock.calls.length, 0, name);
    }
  });

  it('rejects unavailable community playback without falling back to owner state', async () => {
    const { playCommunityAlbum } =
      await import('../src/js/modules/community-viewer.js');
    const play = mock.fn();
    const toast = mock.fn();
    for (const item of [null, {}, { artist: 'Artist' }, { album: 'Album' }]) {
      assert.strictEqual(playCommunityAlbum(item, play, toast), false);
    }
    assert.strictEqual(play.mock.calls.length, 0);
    assert.strictEqual(
      playCommunityAlbum(
        { artist: 'Artist', album: 'Album' },
        undefined,
        toast
      ),
      false
    );
    assert.deepStrictEqual(toast.mock.calls.at(-1).arguments, [
      'Play album is unavailable',
      'error',
    ]);
  });
});
