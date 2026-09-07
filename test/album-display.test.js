/**
 * Tests for album-display.js module
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const { register } = require('node:module');
const path = require('node:path');

// Register a loader that handles Vite-specific features for Node.js:
// 1. .txt?raw imports (used by app.js for genres data)
// 2. @utils/ alias (used by normalization.js to import from utils/)
const projectRoot = path.resolve(__dirname, '..').replace(/\\/g, '/');
register(
  'data:text/javascript,' +
    encodeURIComponent(`
  const PROJECT_ROOT = ${JSON.stringify(projectRoot)};
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  export function resolve(specifier, context, next) {
    if (specifier.startsWith('@utils/')) {
      const resolved = 'file://' + PROJECT_ROOT + '/utils/' + specifier.slice(7);
      return { url: resolved, shortCircuit: true };
    }
    if (specifier.endsWith('.txt') || specifier.includes('.txt?')) {
      return { url: new URL(specifier.split('?')[0], context.parentURL).href, shortCircuit: true };
    }
    if (specifier.endsWith('.json') && !specifier.includes('node_modules')) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return next(specifier, context);
  }
  export function load(url, context, next) {
    if (url.endsWith('.txt')) {
      return { format: 'module', source: 'export default ""', shortCircuit: true };
    }
    if (url.endsWith('.json') && !url.includes('node_modules')) {
      const filePath = fileURLToPath(url);
      const json = readFileSync(filePath, 'utf8');
      return { format: 'module', source: 'export default ' + json, shortCircuit: true };
    }
    return next(url, context);
  }
`)
);

// Provide minimal browser globals needed by the ESM import chain
// (various modules in src/js/modules/ reference window/document at module level)
if (typeof globalThis.window === 'undefined') {
  globalThis.addEventListener = globalThis.addEventListener || (() => {});
  globalThis.removeEventListener = globalThis.removeEventListener || (() => {});
  globalThis.dispatchEvent = globalThis.dispatchEvent || (() => {});
  globalThis.window = globalThis;
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({
      style: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      addEventListener: () => {},
    }),
    body: { appendChild: () => {}, style: {} },
    documentElement: { style: {} },
  };
  globalThis.navigator = { userAgent: 'node' };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.getComputedStyle = () => ({});
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => ({}) });
}

function lifecycleNode(className = '', fragment = false) {
  const listeners = new Map();
  const node = {
    className,
    fragment,
    dataset: {},
    style: {},
    children: [],
    innerHTML: '',
    parentNode: null,
    appendChild(child) {
      if (child.fragment) {
        for (const entry of [...child.children]) this.appendChild(entry);
        child.children = [];
      } else {
        child.remove();
        child.parentNode = this;
        this.children.push(child);
      }
      return child;
    },
    replaceChildren(...children) {
      for (const child of [...this.children]) child.remove();
      children.forEach((child) => this.appendChild(child));
    },
    removeChild(child) {
      child.remove();
      return child;
    },
    remove() {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(selector.startsWith('.') &&
        child.className.split(' ').includes(selector.slice(1))
          ? [child]
          : []),
        ...child.querySelectorAll(selector),
      ]);
    },
    querySelector(selector) {
      if (
        selector === '.column-toggle-reset' &&
        this.className.includes('column-toggle-dropdown')
      ) {
        this.resetButton ||= lifecycleNode();
        return this.resetButton;
      }
      return this.querySelectorAll(selector)[0] || null;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || [])
        handler({ type, ...event });
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return {
        left: 10,
        top: 20,
        width: 75,
        height: 75,
        right: 85,
        bottom: 95,
      };
    },
  };
  node.classList = {
    add(...names) {
      node.className = [
        ...new Set([...node.className.split(' '), ...names]),
      ].join(' ');
    },
    remove(...names) {
      node.className = node.className
        .split(' ')
        .filter((name) => !names.includes(name))
        .join(' ');
    },
    contains(name) {
      return node.className.split(' ').includes(name);
    },
    toggle(name, force = !this.contains(name)) {
      this[force ? 'add' : 'remove'](name);
    },
  };
  return node;
}

function ownerLifecycleHarness(
  t,
  createAlbumDisplay,
  { mobile = false, albums = [], ...overrides } = {}
) {
  const container = lifecycleNode();
  const body = lifecycleNode();
  const docEvents = lifecycleNode();
  const winEvents = lifecycleNode();
  const frames = [];
  const batches = [];
  const timers = [];
  const oldBody = document.body;
  const oldIdle = window.requestIdleCallback;
  document.body = body;
  window.requestIdleCallback = (callback) => batches.push(callback);
  t.mock.method(document, 'createElement', () => lifecycleNode());
  const oldFragment = document.createDocumentFragment;
  document.createDocumentFragment = () => lifecycleNode('', true);
  t.mock.method(document, 'getElementById', (id) =>
    id === 'albumContainer' ? container : null
  );
  t.mock.method(document, 'querySelector', (selector) =>
    selector === 'body > .column-toggle-dropdown'
      ? body.querySelector('.column-toggle-dropdown')
      : null
  );
  t.mock.method(document, 'addEventListener', docEvents.addEventListener);
  t.mock.method(document, 'removeEventListener', docEvents.removeEventListener);
  t.mock.method(window, 'addEventListener', winEvents.addEventListener);
  t.mock.method(window, 'matchMedia', () => ({ matches: mobile }));
  t.mock.method(globalThis, 'requestAnimationFrame', (callback) =>
    frames.push(callback)
  );
  t.mock.method(globalThis, 'setTimeout', (callback, delay) =>
    timers.push({ callback, delay })
  );
  const deps = {
    getCurrentList: () => 'owned-1',
    getListData: () => albums,
    getListMetadata: () => ({ isMain: false }),
    isCommunityView: () => false,
    isListLocked: mock.fn(async () => false),
    initializeUnifiedSorting: mock.fn(),
    destroySorting: mock.fn(),
    clearYearLockUI: mock.fn(),
    showYearLockUI: mock.fn(),
    reapplyNowPlayingHighlight: mock.fn(),
    apiCall: mock.fn(async () => ({})),
    ...overrides,
  };
  const module = createAlbumDisplay(deps);
  module.clearLastRenderedCache();
  t.after(() => {
    module.deactivate();
    document.body = oldBody;
    if (oldIdle === undefined) delete window.requestIdleCallback;
    else window.requestIdleCallback = oldIdle;
    if (oldFragment === undefined) delete document.createDocumentFragment;
    else document.createDocumentFragment = oldFragment;
  });
  return {
    module,
    container,
    body,
    docEvents,
    winEvents,
    frames,
    batches,
    timers,
    deps,
  };
}

describe('album-display module', () => {
  describe('createAlbumDisplay factory', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      // Dynamic import of ES module
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should export createAlbumDisplay function', () => {
      assert.strictEqual(typeof createAlbumDisplay, 'function');
    });

    it('should create module with all required methods', () => {
      // Create with minimal mock dependencies
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        saveList: mock.fn(),
        showToast: mock.fn(),
        apiCall: mock.fn(),
        formatReleaseDate: mock.fn((d) => d),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
        fetchTracksForAlbum: mock.fn(),
        makeCountryEditable: mock.fn(),
        makeGenreEditable: mock.fn(),
        makeCommentEditable: mock.fn(),
        attachLinkPreview: mock.fn(),
        showTrackSelectionMenu: mock.fn(),
        showMobileEditForm: mock.fn(),
        showMobileAlbumMenu: mock.fn(),
        playTrackSafe: mock.fn(),
        reapplyNowPlayingBorder: mock.fn(),
        initializeUnifiedSorting: mock.fn(),
      };

      const module = createAlbumDisplay(mockDeps);

      // Check all public methods exist
      assert.strictEqual(typeof module.displayAlbums, 'function');
      assert.strictEqual(typeof module.updatePositionNumbers, 'function');
      assert.strictEqual(typeof module.clearLastRenderedCache, 'function');
      assert.strictEqual(typeof module.processAlbumData, 'function');
      assert.strictEqual(typeof module.createAlbumItem, 'function');
      assert.strictEqual(typeof module.detectUpdateType, 'function');
      assert.strictEqual(typeof module.deactivate, 'function');
      assert.strictEqual(typeof module.attachDesktopCoverPreview, 'function');
    });

    it('should show locked UI for empty locked main lists', async () => {
      const previousGetElementById = globalThis.document.getElementById;
      const previousCreateElement = globalThis.document.createElement;
      const previousInnerWidth = globalThis.window.innerWidth;
      const container = {
        children: [],
        querySelector: mock.fn(() => null),
        querySelectorAll: mock.fn(() => []),
        replaceChildren(...children) {
          this.children = children;
        },
      };

      globalThis.window.innerWidth = 1280;
      globalThis.document.getElementById = (id) =>
        id === 'albumContainer' ? container : null;
      globalThis.document.createElement = () => ({
        className: '',
        innerHTML: '',
        querySelector: () => null,
      });

      try {
        const showYearLockUI = mock.fn();
        const destroySorting = mock.fn();
        const initializeUnifiedSorting = mock.fn();
        const module = createAlbumDisplay({
          getCurrentList: () => 'main-2024',
          getListMetadata: () => ({ year: 2024, isMain: true }),
          isListLocked: mock.fn(async () => true),
          showYearLockUI,
          clearYearLockUI: mock.fn(),
          destroySorting,
          initializeUnifiedSorting,
          reapplyNowPlayingBorder: mock.fn(),
        });

        module.displayAlbums([], { forceFullRebuild: true });
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.strictEqual(container.children.length, 1);
        assert.strictEqual(destroySorting.mock.calls.length, 1);
        assert.strictEqual(initializeUnifiedSorting.mock.calls.length, 0);
        assert.deepStrictEqual(showYearLockUI.mock.calls[0].arguments, [
          container,
          2024,
        ]);
      } finally {
        globalThis.document.getElementById = previousGetElementById;
        globalThis.document.createElement = previousCreateElement;
        globalThis.window.innerWidth = previousInnerWidth;
      }
    });

    it('uses eager loading without an opacity reveal for initial desktop covers', () => {
      const previousCreateElement = globalThis.document.createElement;
      globalThis.document.createElement = () => ({
        className: '',
        dataset: {},
        style: {},
        innerHTML: '',
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      });

      try {
        const module = createAlbumDisplay({
          getCurrentList: () => 'list-1',
          getListMetadata: () => ({ isMain: false }),
          getListData: () => [],
          getTrackName: (track) => track?.name || track || '',
          getTrackLength: () => null,
          formatTrackTime: () => '',
        });

        const firstRow = module.createAlbumItem(
          {
            album: 'First Album',
            artist: 'Artist',
            album_id: 'album-1',
            cover_thumb_url: '/thumb-1.jpg',
          },
          0,
          false
        );
        const laterRow = module.createAlbumItem(
          {
            album: 'Later Album',
            artist: 'Artist',
            album_id: 'album-2',
            cover_thumb_url: '/thumb-2.jpg',
          },
          16,
          false
        );

        assert.match(firstRow.innerHTML, /src="\/thumb-1\.jpg"/);
        assert.match(firstRow.innerHTML, /fetchpriority="high"/);
        assert.doesNotMatch(firstRow.innerHTML, /data-cover-reveal-group/);
        assert.doesNotMatch(firstRow.innerHTML, /cover-reveal-pending/);
        assert.doesNotMatch(
          firstRow.innerHTML,
          /data-lazy-src="\/thumb-1\.jpg"/
        );

        assert.match(laterRow.innerHTML, /data-lazy-src="\/thumb-2\.jpg"/);
        assert.match(laterRow.innerHTML, /loading="eager"/);
        assert.match(laterRow.innerHTML, /fetchpriority="low"/);
        assert.doesNotMatch(laterRow.innerHTML, /fetchpriority="high"/);
      } finally {
        globalThis.document.createElement = previousCreateElement;
      }
    });

    it('renders mobile hooks for mutable title and availability fields', () => {
      const previousCreateElement = globalThis.document.createElement;
      globalThis.document.createElement = () => ({
        className: '',
        dataset: {},
        style: {},
        children: [],
        innerHTML: '',
        appendChild(child) {
          this.children.push(child);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      });

      try {
        const module = createAlbumDisplay({
          getCurrentList: () => 'list-1',
          getListMetadata: () => ({ isMain: false }),
          getListData: () => [],
          getTrackName: (track) => track?.name || track || '',
          getTrackLength: () => null,
          formatTrackTime: () => '',
        });

        const wrapper = module.createAlbumItem(
          {
            album: 'Mutable Album',
            artist: 'Artist',
            album_id: 'album-1',
            availability: ['spotify'],
            availability_links: [
              {
                service: 'spotify',
                url: 'https://open.spotify.com/album/example',
              },
            ],
            summary: 'A concise album summary.',
            recommended_by: 'Test user',
            taxonomy: {
              rym: {
                primary_genres: ['Post-Rock'],
                secondary_genres: ['Ambient'],
                descriptors: ['Atmospheric'],
                source_url:
                  'https://rateyourmusic.com/release/album/artist/record/',
              },
            },
          },
          0,
          true
        );
        const card = wrapper.children[0];

        assert.match(card.innerHTML, /data-field="album-mobile-title"/);
        assert.match(card.innerHTML, /Mutable Album/);
        assert.match(card.innerHTML, /album-availability--mobile/);
        assert.match(card.innerHTML, /fa-spotify/);
        assert.match(card.innerHTML, /<a [^>]*aria-label="Spotify"/);
        assert.match(card.innerHTML, /taxonomy-trigger-mobile/);
        assert.match(
          card.innerHTML,
          /data-mobile-album-badges[^>]*class="absolute flex flex-col items-center"[^>]*style="top: 0; right: 4px; gap: 0"/
        );
        const summaryIndex = card.innerHTML.indexOf('summary-badge-mobile');
        const recommendationIndex = card.innerHTML.indexOf(
          'recommendation-badge-mobile'
        );
        const taxonomyIndex = card.innerHTML.indexOf('taxonomy-trigger-mobile');
        assert.ok(summaryIndex < recommendationIndex);
        assert.ok(recommendationIndex < taxonomyIndex);
        assert.match(card.innerHTML, /padding-right: 31px/);
        assert.doesNotMatch(card.innerHTML, /data-taxonomy-slot/);
        assert.doesNotMatch(card.innerHTML, /<dt>|album-taxonomy-panel/);
      } finally {
        globalThis.document.createElement = previousCreateElement;
      }
    });

    it('renders selected-track details consistently in desktop and mobile cards', () => {
      const previousCreateElement = globalThis.document.createElement;
      globalThis.document.createElement = () => ({
        className: '',
        dataset: {},
        style: {},
        children: [],
        innerHTML: '',
        appendChild(child) {
          this.children.push(child);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      });

      try {
        const module = createAlbumDisplay({
          getCurrentList: () => 'list-1',
          getListMetadata: () => ({ isMain: false }),
          getListData: () => [],
          getTrackName: (track) => track.name,
          getTrackLength: (track) => track.length,
          formatTrackTime: (length) => {
            if (length === 182000) return '3:02';
            if (length === 269000) return '4:29';
            return '';
          },
        });
        const album = {
          album: 'Example Album',
          artist: 'Example Artist',
          primary_track: 'Primary Track',
          secondary_track: 'Secondary Track',
          tracks: [
            { name: 'Opening Track', length: 120000 },
            { name: 'Primary Track', length: 182000 },
            { name: 'Interlude', length: 65000 },
            { name: 'Closing Track', length: 208000 },
            { name: 'Secondary Track', length: 269000 },
          ],
        };

        const desktop = module.createAlbumItem(album, 0, false);
        const mobile = module.createAlbumItem(album, 0, true).children[0];

        for (const markup of [desktop.innerHTML, mobile.innerHTML]) {
          assert.match(markup, /I:/);
          assert.match(markup, /#2 - Primary Track/);
          assert.match(markup, /\(03:02\)/);
          assert.match(markup, /II:/);
          assert.match(markup, /#5 - Secondary Track/);
          assert.match(markup, /\(04:29\)/);
        }
      } finally {
        globalThis.document.createElement = previousCreateElement;
      }
    });

    it('adds a regenerated mobile summary badge to the title row', async () => {
      const previousGetElementById = globalThis.document.getElementById;
      const previousCreateElement = globalThis.document.createElement;
      const previousMatchMedia = globalThis.window.matchMedia;
      const album = {
        album: 'Summary Album',
        artist: 'Summary Artist',
        album_id: 'album-1',
      };
      const badgeContainer = {
        appended: null,
        querySelector: () => null,
        appendChild(child) {
          this.appended = child;
        },
      };
      const coverContainer = {
        appendChild() {
          throw new Error(
            'Mobile summary badges must not be appended to covers'
          );
        },
      };
      const row = {
        dataset: { index: '0' },
        querySelector(selector) {
          if (selector === '[data-mobile-album-badges]') return badgeContainer;
          if (selector === '.album-cover-container') return coverContainer;
          return null;
        },
      };
      const container = {
        querySelectorAll: () => [row],
      };

      globalThis.window.matchMedia = () => ({ matches: true });
      globalThis.document.getElementById = (id) =>
        id === 'albumContainer' ? container : null;
      globalThis.document.createElement = () => {
        const tempDiv = {};
        Object.defineProperty(tempDiv, 'innerHTML', {
          set() {
            tempDiv.firstElementChild = {
              dataset: {},
              addEventListener: () => {},
            };
          },
        });
        return tempDiv;
      };

      try {
        const module = createAlbumDisplay({
          getCurrentList: () => 'list-1',
          getListData: () => [album],
          getListMetadata: () => ({}),
          showMobileSummarySheet: () => {},
        });

        await module.updateAlbumSummaryInPlace('album-1', {
          summary: 'A newly generated summary.',
          summarySource: 'Claude',
        });

        assert.ok(badgeContainer.appended);
        assert.strictEqual(album.summary, 'A newly generated summary.');
      } finally {
        globalThis.document.getElementById = previousGetElementById;
        globalThis.document.createElement = previousCreateElement;
        globalThis.window.matchMedia = previousMatchMedia;
      }
    });

    it('should handle empty dependencies gracefully', () => {
      // Should not throw when called with empty deps
      const module = createAlbumDisplay({});
      assert.ok(module);
    });
  });

  describe('shared layout integration and owner lifecycle', () => {
    let createAlbumDisplay;
    const albums = [
      {
        _id: 'item-1',
        album_id: 'album-1',
        album: 'Shared Album',
        artist: 'Shared Artist',
      },
    ];

    beforeEach(async () => {
      ({ createAlbumDisplay } =
        await import('../src/js/modules/album-display.js'));
    });

    it('uses the shared component results for owner desktop header/row and mobile card shells', async (t) => {
      const { renderDesktopAlbumHeader, renderDesktopAlbumRow } =
        await import('../src/js/modules/album-display/desktop-layout.js');
      const { renderMobileAlbumCard } =
        await import('../src/js/modules/album-display/mobile-layout.js');
      const { getAllColumns, getVisibleColumns } =
        await import('../src/js/modules/column-config.js');
      const h = ownerLifecycleHarness(t, createAlbumDisplay, { albums });
      h.module.displayAlbums(albums, { forceFullRebuild: true });
      const header = h.container.querySelector('.album-header');
      const row = h.container.querySelector('.album-row');
      const options = {
        columns: getAllColumns(),
        visibleColumns: getVisibleColumns(),
      };
      const headerLayout = renderDesktopAlbumHeader(options);
      assert.strictEqual(header.className, headerLayout.className);
      assert.strictEqual(header.innerHTML, headerLayout.html);
      assert.strictEqual(
        header.style.gridTemplateColumns,
        headerLayout.gridTemplate
      );
      const data = h.module.processAlbumData(albums[0], 0);
      const rowLayout = renderDesktopAlbumRow(data, 0, {
        ...options,
        editable: true,
        badgeState: '||||Shared Album|Shared Artist',
        includePlaycount: true,
        includeAvailabilityLinks: true,
        includeTaxonomy: true,
      });
      assert.strictEqual(row.className, rowLayout.className);
      assert.strictEqual(row.innerHTML, rowLayout.html);
      assert.strictEqual(
        row.style.gridTemplateColumns,
        header.style.gridTemplateColumns
      );
      assert.strictEqual(String(row.dataset.index), '0');

      const wrapper = h.module.createAlbumItem(albums[0], 0, true);
      const card = wrapper.children[0];
      const mobileLayout = renderMobileAlbumCard(data, 0, {
        editable: true,
        includePlaycount: true,
        includeTracks: true,
        badgeState: '||||{}|Shared Album|Shared Artist',
        badgePaddingRight: '0px',
        includeAvailabilityLinks: true,
      });
      assert.strictEqual(wrapper.className, mobileLayout.wrapperClassName);
      assert.strictEqual(wrapper.className, 'album-card-wrapper h-[145px]');
      assert.strictEqual(card.className, mobileLayout.className);
      assert.strictEqual(card.innerHTML, mobileLayout.html);
      assert.strictEqual(String(card.dataset.index), '0');
      assert.match(card.innerHTML, /data-album-menu-btn/);
      assert.match(row.innerHTML, /cursor-pointer/);
    });

    for (const locked of [true, false]) {
      it(`ignores a deferred owner lock result (${locked}) after deactivation`, async (t) => {
        let resolveLock;
        const lock = new Promise((resolve) => {
          resolveLock = resolve;
        });
        const h = ownerLifecycleHarness(t, createAlbumDisplay, {
          albums,
          getListMetadata: () => ({ year: 2025, isMain: true }),
          isListLocked: mock.fn(() => lock),
        });
        h.module.displayAlbums(albums, { forceFullRebuild: true });
        assert.strictEqual(h.deps.isListLocked.mock.calls.length, 1);
        assert.strictEqual(
          h.deps.initializeUnifiedSorting.mock.calls.length,
          0
        );
        h.module.deactivate();
        const community = lifecycleNode('community-list-view');
        h.container.replaceChildren(community);
        const clears = h.deps.clearYearLockUI.mock.calls.length;
        resolveLock(locked);
        await lock;
        while (h.frames.length) h.frames.shift()();
        assert.deepStrictEqual(h.container.children, [community]);
        assert.strictEqual(
          h.deps.initializeUnifiedSorting.mock.calls.length,
          0
        );
        assert.strictEqual(h.deps.showYearLockUI.mock.calls.length, 0);
        assert.strictEqual(h.deps.destroySorting.mock.calls.length, 1);
        assert.strictEqual(h.deps.clearYearLockUI.mock.calls.length, clears);
      });
    }

    for (const finishBatches of [false, true]) {
      it(`fences progressive batches and queued hydration after deactivation (${finishBatches ? 'final frame' : 'mid-batch'})`, (t) => {
        const manyAlbums = Array.from({ length: 121 }, (_, index) => ({
          _id: `item-${index}`,
          artist: 'Artist',
          album: `Album ${index}`,
        }));
        const hydrated = manyAlbums.map((album) => ({
          ...album,
          genre_1: 'Hydrated genre',
        }));
        const h = ownerLifecycleHarness(t, createAlbumDisplay, {
          albums: manyAlbums,
          mobile: true,
        });
        h.module.displayAlbums(manyAlbums, { forceFullRebuild: true });
        const ownerRows = h.container.querySelector('.mobile-album-list');
        assert.strictEqual(ownerRows.children.length, 60);
        assert.strictEqual(h.batches.length, 1);
        h.module.displayAlbums(hydrated, { hydrate: true });
        assert.strictEqual(ownerRows.children.length, 60);
        if (finishBatches) {
          while (h.batches.length) h.batches.shift()();
          assert.strictEqual(ownerRows.children.length, 121);
          assert.strictEqual(h.frames.length, 1);
        }
        h.module.deactivate();
        const community = lifecycleNode('community-list-view');
        h.container.replaceChildren(community);
        const childCount = ownerRows.children.length;
        const highlights = h.deps.reapplyNowPlayingHighlight.mock.calls.length;
        const sorts = h.deps.initializeUnifiedSorting.mock.calls.length;
        const queries = t.mock.method(h.container, 'querySelector');
        const queriesAll = t.mock.method(h.container, 'querySelectorAll');
        while (h.batches.length) h.batches.shift()();
        while (h.frames.length) h.frames.shift()();
        assert.deepStrictEqual(h.container.children, [community]);
        assert.strictEqual(
          ownerRows.children.length,
          childCount,
          'detached owner rows must not receive another batch'
        );
        assert.strictEqual(
          queries.mock.calls.length,
          0,
          'hydration must not query the community DOM'
        );
        assert.strictEqual(queriesAll.mock.calls.length, 0);
        assert.strictEqual(
          h.deps.reapplyNowPlayingHighlight.mock.calls.length,
          highlights
        );
        assert.strictEqual(
          h.deps.initializeUnifiedSorting.mock.calls.length,
          sorts
        );
        assert.strictEqual(h.deps.apiCall.mock.calls.length, 0);
      });
    }

    it('ignores late owner display and column events while community is active, then renders identical owner data on return', (t) => {
      let communityActive = false;
      const h = ownerLifecycleHarness(t, createAlbumDisplay, {
        albums,
        isCommunityView: () => communityActive,
      });
      h.module.displayAlbums(albums, { forceFullRebuild: true });
      while (h.frames.length) h.frames.shift()();
      const oldRow = h.container.querySelector('.album-row');
      h.module.deactivate();
      communityActive = true;
      const community = lifecycleNode('community-list-view');
      h.container.replaceChildren(community);
      const getContainer = t.mock.method(document, 'getElementById');
      for (const options of [
        {},
        { hydrate: true },
        { forceFullRebuild: true },
      ]) {
        h.module.displayAlbums(albums, options);
      }
      h.winEvents.dispatch('columnvisibilitychange');
      assert.strictEqual(getContainer.mock.calls.length, 0);
      assert.deepStrictEqual(h.container.children, [community]);
      communityActive = false;
      h.module.displayAlbums(albums);
      const newRow = h.container.querySelector('.album-row');
      assert.ok(
        newRow,
        'the old fingerprint must not suppress the return render'
      );
      assert.notStrictEqual(newRow, oldRow);
      assert.strictEqual(newRow.innerHTML, oldRow.innerHTML);
      assert.strictEqual(h.deps.initializeUnifiedSorting.mock.calls.length, 2);
    });

    it('discards a queued incremental fingerprint update so identical data still renders on return', (t) => {
      const h = ownerLifecycleHarness(t, createAlbumDisplay, { albums });
      h.module.displayAlbums(albums, { forceFullRebuild: true });
      while (h.frames.length) h.frames.shift()();
      const updated = [
        ...albums,
        { _id: 'item-2', artist: 'Second Artist', album: 'Second Album' },
      ];
      h.module.displayAlbums(updated);
      assert.strictEqual(
        h.container.querySelector('.album-rows-container').children.length,
        2
      );
      assert.strictEqual(h.frames.length, 1);
      h.module.deactivate();
      h.container.replaceChildren(lifecycleNode('community-list-view'));
      while (h.frames.length) h.frames.shift()();
      h.module.displayAlbums(updated);
      assert.strictEqual(
        h.container.querySelector('.album-rows-container')?.children.length,
        2
      );
    });

    it('removes body column controls and their document listeners on rebuild and deactivation', (t) => {
      const h = ownerLifecycleHarness(t, createAlbumDisplay, { albums });
      const baselineKeydowns = h.docEvents.listenerCount('keydown');
      h.module.displayAlbums(albums, { forceFullRebuild: true });
      const dropdown = h.body.querySelector('.column-toggle-dropdown');
      assert.ok(dropdown);
      assert.strictEqual(h.docEvents.listenerCount('click'), 1);
      assert.strictEqual(
        h.docEvents.listenerCount('keydown'),
        baselineKeydowns + 1
      );
      h.module.displayAlbums(albums, { forceFullRebuild: true });
      assert.strictEqual(dropdown.parentNode, null);
      assert.strictEqual(
        h.body.querySelectorAll('.column-toggle-dropdown').length,
        1
      );
      assert.strictEqual(h.docEvents.listenerCount('click'), 1);
      h.module.deactivate();
      assert.strictEqual(h.body.children.length, 0);
      assert.strictEqual(h.docEvents.listenerCount('click'), 0);
      assert.strictEqual(
        h.docEvents.listenerCount('keydown'),
        baselineKeydowns
      );
      assert.deepStrictEqual(h.deps.destroySorting.mock.calls[0].arguments, [
        h.container,
      ]);
      const queries = t.mock.method(h.container, 'querySelectorAll');
      h.winEvents.dispatch('columnvisibilitychange');
      assert.strictEqual(queries.mock.calls.length, 0);
      h.module.deactivate();
      assert.strictEqual(h.body.children.length, 0);
    });

    it('cancels scheduled owner playcount polling on deactivation', async (t) => {
      const h = ownerLifecycleHarness(t, createAlbumDisplay, {
        albums,
        apiCall: mock.fn(async () => ({ playcounts: {}, refreshing: 1 })),
      });
      await h.module.fetchAndDisplayPlaycounts('owned-1');
      assert.strictEqual(h.deps.apiCall.mock.calls.length, 1);
      assert.strictEqual(h.timers.length, 1);
      assert.strictEqual(h.timers[0].delay, 3000);
      h.module.deactivate();
      await h.timers.shift().callback();
      assert.strictEqual(h.deps.apiCall.mock.calls.length, 1);
      assert.strictEqual(h.timers.length, 0);
    });

    it('aborts an in-flight owner playcount poll without rescheduling it', async (t) => {
      let pollSignal;
      let calls = 0;
      const apiCall = mock.fn(async (_url, options) => {
        if (++calls === 1) return { playcounts: {}, refreshing: 1 };
        pollSignal = options.signal;
        return new Promise((_resolve, reject) => {
          pollSignal.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });
      const h = ownerLifecycleHarness(t, createAlbumDisplay, { apiCall });
      await h.module.fetchAndDisplayPlaycounts('owned-1');
      const pendingPoll = h.timers.shift().callback();
      assert.strictEqual(pollSignal.aborted, false);
      h.module.deactivate();
      assert.strictEqual(pollSignal.aborted, true);
      await pendingPoll;
      assert.strictEqual(apiCall.mock.calls.length, 2);
      assert.strictEqual(h.timers.length, 0);
    });

    it('does not restart owner polling when its initial playcount request resolves after deactivation', async (t) => {
      let resolveRequest;
      const response = new Promise((resolve) => {
        resolveRequest = resolve;
      });
      const h = ownerLifecycleHarness(t, createAlbumDisplay, {
        apiCall: mock.fn(() => response),
      });
      const pendingFetch = h.module.fetchAndDisplayPlaycounts('owned-1');
      h.module.deactivate();
      h.container.replaceChildren(lifecycleNode('community-list-view'));
      resolveRequest({ playcounts: {}, refreshing: 1 });
      await pendingFetch;
      assert.strictEqual(
        h.timers.length,
        0,
        'a response from the deactivated owner must not start a new polling session'
      );
    });

    it('attaches desktop cover preview once and uses the explicit image rather than owner album data', (t) => {
      const getListData = mock.fn(() => {
        throw new Error('preview must not read owner albums');
      });
      const h = ownerLifecycleHarness(t, createAlbumDisplay, { getListData });
      const image = lifecycleNode();
      image.src = '/community-thumb.jpg';
      image.dataset.fullSrc = '/community-full.jpg';
      h.module.attachDesktopCoverPreview(image);
      h.module.attachDesktopCoverPreview(image);
      assert.strictEqual(image.listenerCount('click'), 1);
      const stopPropagation = mock.fn();
      image.dispatch('click', { stopPropagation });
      const preview = h.body.querySelector('.album-cover-preview-clone');
      assert.ok(preview);
      assert.strictEqual(preview.src, '/community-full.jpg');
      assert.strictEqual(stopPropagation.mock.calls.length, 1);
      assert.strictEqual(getListData.mock.calls.length, 0);
      while (h.frames.length) h.frames.shift()();
      h.module.closeCoverPreview();
      for (const timer of h.timers.splice(0)) timer.callback();
      assert.strictEqual(h.body.children.length, 0);
      assert.strictEqual(h.body.style.overflow, '');
    });
  });

  describe('processAlbumData', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should process album data correctly', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024, isMain: true })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn((d) => d || ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
        getTrackName: mock.fn((t) =>
          typeof t === 'string' ? t : t?.name || ''
        ),
        getTrackLength: mock.fn(() => ''),
        formatTrackTime: mock.fn(() => ''),
      };

      const module = createAlbumDisplay(mockDeps);

      const album = {
        album: 'Test Album',
        artist: 'Test Artist',
        release_date: '2024-01-15',
        country: 'USA',
        genre_1: 'Rock',
        genre_2: 'Alternative',
        comments: 'Great album',
        primary_track: '1. First Track',
        tracks: ['1. First Track', '2. Second Track'],
      };

      const data = module.processAlbumData(album, 0);

      // Position is only set for main lists
      assert.strictEqual(data.position, 1);
      assert.strictEqual(data.albumName, 'Test Album');
      assert.strictEqual(data.artist, 'Test Artist');
      assert.strictEqual(data.country, 'USA');
      assert.strictEqual(data.genre1, 'Rock');
      assert.strictEqual(data.genre2, 'Alternative');
      assert.strictEqual(data.comment, 'Great album');
      assert.strictEqual(data.countryDisplay, 'USA');
      assert.strictEqual(data.genre1Display, 'Rock');
      assert.strictEqual(data.genre2Display, 'Alternative');
    });

    it('should handle missing album data with defaults', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})), // No isMain, so position should be null
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
      };

      const module = createAlbumDisplay(mockDeps);

      const album = {};
      const data = module.processAlbumData(album, 0);

      // Position is null for non-main lists (isMain not set)
      assert.strictEqual(data.position, null);
      assert.strictEqual(data.albumName, 'Unknown Album');
      assert.strictEqual(data.artist, 'Unknown Artist');
      assert.strictEqual(data.country, '');
      assert.strictEqual(data.countryDisplay, 'Country');
      assert.strictEqual(data.genre1Display, 'Genre 1');
      assert.strictEqual(data.genre2Display, 'Genre 2');
      assert.strictEqual(data.primaryTrackDisplay, '');
    });

    it('should handle genre_2 placeholder values', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
      };

      const module = createAlbumDisplay(mockDeps);

      // Test with 'Genre 2' placeholder
      let album = { genre_2: 'Genre 2' };
      let data = module.processAlbumData(album, 0);
      assert.strictEqual(data.genre2, '');
      assert.strictEqual(data.genre2Display, 'Genre 2');

      // Test with '-' placeholder
      album = { genre_2: '-' };
      data = module.processAlbumData(album, 0);
      assert.strictEqual(data.genre2, '');
    });

    it('should format track picks correctly', () => {
      const mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({})),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => null),
        getTrackName: mock.fn((t) =>
          typeof t === 'string' ? t : t?.name || ''
        ),
        getTrackLength: mock.fn(() => ''),
        formatTrackTime: mock.fn(() => ''),
      };

      const module = createAlbumDisplay(mockDeps);

      // Test with full track info
      let album = {
        primary_track: '3. Favorite Song',
        tracks: ['1. First', '2. Second', '3. Favorite Song'],
      };
      let data = module.processAlbumData(album, 0);
      assert.strictEqual(data.primaryTrackDisplay, '#3 - Favorite Song');
      assert.strictEqual(data.primaryTrackClass, 'text-gray-300');

      // Test with just track number
      album = {
        primary_track: '5',
        tracks: [],
      };
      data = module.processAlbumData(album, 0);
      assert.strictEqual(data.primaryTrackDisplay, '#5 - Track 5');
    });

    it('should set position only for main lists', () => {
      // Test with main list - position should be set
      let mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024, isMain: true })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      let module = createAlbumDisplay(mockDeps);
      let data = module.processAlbumData({ album: 'Test' }, 0);
      assert.strictEqual(data.position, 1);

      data = module.processAlbumData({ album: 'Test' }, 4);
      assert.strictEqual(data.position, 5);

      // Test with non-main list - position should be null
      mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024, isMain: false })),
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      module = createAlbumDisplay(mockDeps);
      data = module.processAlbumData({ album: 'Test' }, 0);
      assert.strictEqual(data.position, null);

      // Test with list without isMain property - position should be null
      mockDeps = {
        getListData: mock.fn(() => []),
        getListMetadata: mock.fn(() => ({ year: 2024 })), // No isMain
        getCurrentList: mock.fn(() => 'test-list'),
        formatReleaseDate: mock.fn(() => ''),
        isYearMismatch: mock.fn(() => false),
        extractYearFromDate: mock.fn(() => 2024),
      };

      module = createAlbumDisplay(mockDeps);
      data = module.processAlbumData({ album: 'Test' }, 0);
      assert.strictEqual(data.position, null);
    });
  });

  describe('playAlbumFromMobileCover', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should trigger metadata-based album playback', () => {
      const playAlbumByMetadata = mock.fn();
      const showToast = mock.fn();
      const module = createAlbumDisplay({ playAlbumByMetadata, showToast });

      const album = {
        artist: 'Opeth',
        album: 'Blackwater Park',
        album_id: 'album-123',
        release_date: '2001-03-12',
      };

      const didPlay = module.playAlbumFromMobileCover(album);

      assert.strictEqual(didPlay, true);
      assert.strictEqual(playAlbumByMetadata.mock.calls.length, 1);
      assert.deepStrictEqual(playAlbumByMetadata.mock.calls[0].arguments, [
        'Opeth',
        'Blackwater Park',
        {
          albumId: 'album-123',
          releaseDate: '2001-03-12',
        },
      ]);
      assert.strictEqual(showToast.mock.calls.length, 0);
    });

    it('should show error toast when album is missing', () => {
      const playAlbumByMetadata = mock.fn();
      const showToast = mock.fn();
      const module = createAlbumDisplay({ playAlbumByMetadata, showToast });

      const didPlay = module.playAlbumFromMobileCover(null);

      assert.strictEqual(didPlay, false);
      assert.strictEqual(playAlbumByMetadata.mock.calls.length, 0);
      assert.deepStrictEqual(showToast.mock.calls[0].arguments, [
        'Album not found',
        'error',
      ]);
    });

    it('should show error toast when playback dependency is unavailable', () => {
      const showToast = mock.fn();
      const module = createAlbumDisplay({ showToast });

      const didPlay = module.playAlbumFromMobileCover({
        artist: 'Agalloch',
        album: 'The Mantle',
      });

      assert.strictEqual(didPlay, false);
      assert.deepStrictEqual(showToast.mock.calls[0].arguments, [
        'Play album is unavailable',
        'error',
      ]);
    });
  });

  describe('detectUpdateType', () => {
    let createAlbumDisplay;

    beforeEach(async () => {
      const module = await import('../src/js/modules/album-display.js');
      createAlbumDisplay = module.createAlbumDisplay;
    });

    it('should return FULL_REBUILD when no previous state', () => {
      const module = createAlbumDisplay({});
      const result = module.detectUpdateType(null, [{ album: 'Test' }]);
      assert.strictEqual(result, 'FULL_REBUILD');
    });

    // Helper: build a fingerprint string from an album object, matching the
    // format used by extractMutableFingerprints in album-display-shared.js.
    // Format: "_id|artist|album|release_date|country|genre_1|genre_2|comments|comments_2|primary_track|secondary_track|availability"
    function fp(a) {
      const availability = Array.isArray(a.availability)
        ? [...a.availability].sort().join(',')
        : '';
      return `${a._id || ''}|${a.artist || ''}|${a.album || ''}|${a.release_date || ''}|${a.country || ''}|${a.genre_1 || ''}|${a.genre_2 || ''}|${a.comments || ''}|${a.comments_2 || ''}|${a.primary_track || ''}|${a.secondary_track || ''}|${availability}`;
    }

    it('should return SINGLE_ADD when one album is added', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [{ artist: 'A', album: '1', release_date: '' }];
      const newAlbums = [
        { artist: 'A', album: '1', release_date: '' },
        { artist: 'B', album: '2', release_date: '' },
      ];
      const result = module.detectUpdateType(oldAlbums.map(fp), newAlbums);
      assert.strictEqual(result.type, 'SINGLE_ADD');
      assert.strictEqual(result.index, 1);
      assert.deepStrictEqual(result.album, {
        artist: 'B',
        album: '2',
        release_date: '',
      });
    });

    it('should return FULL_REBUILD when multiple albums differ', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [{ artist: 'A', album: '1', release_date: '' }];
      const newAlbums = [
        { artist: 'B', album: '2', release_date: '' },
        { artist: 'C', album: '3', release_date: '' },
        { artist: 'D', album: '4', release_date: '' },
      ];
      const result = module.detectUpdateType(oldAlbums.map(fp), newAlbums);
      assert.strictEqual(result, 'FULL_REBUILD');
    });

    it('should return FIELD_UPDATE for small field changes', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [
        { artist: 'A', album: '1', release_date: '', country: 'USA' },
      ];
      const newAlbums = [
        { artist: 'A', album: '1', release_date: '', country: 'UK' },
      ];
      const result = module.detectUpdateType(oldAlbums.map(fp), newAlbums);
      assert.strictEqual(result, 'FIELD_UPDATE');
    });

    it('should return FIELD_UPDATE for availability changes', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [
        {
          artist: 'A',
          album: '1',
          release_date: '',
          availability: ['spotify'],
        },
      ];
      const newAlbums = [
        {
          artist: 'A',
          album: '1',
          release_date: '',
          availability: ['spotify', 'qobuz'],
        },
      ];
      const result = module.detectUpdateType(oldAlbums.map(fp), newAlbums);
      assert.strictEqual(result, 'FIELD_UPDATE');
    });

    it('should track versioned cover URL changes as field updates', () => {
      const module = createAlbumDisplay({});
      const oldState = [
        {
          artist: 'A',
          album: '1',
          release_date: '',
          cover_thumb_url: '/cover?size=thumb&v=1',
        },
      ];
      const newAlbums = [
        {
          artist: 'A',
          album: '1',
          release_date: '',
          cover_thumb_url: '/cover?size=thumb&v=2',
        },
      ];
      const result = module.detectUpdateType(oldState.map(fp), newAlbums);
      assert.strictEqual(result, 'FIELD_UPDATE');
    });

    it('should return POSITION_UPDATE when only positions change', () => {
      const module = createAlbumDisplay({});
      const oldAlbums = [
        { artist: 'A', album: '1', release_date: '' },
        { artist: 'B', album: '2', release_date: '' },
      ];
      const newAlbums = [
        { artist: 'B', album: '2', release_date: '' },
        { artist: 'A', album: '1', release_date: '' },
      ];
      const result = module.detectUpdateType(oldAlbums.map(fp), newAlbums);
      assert.strictEqual(result, 'POSITION_UPDATE');
    });
  });
});
