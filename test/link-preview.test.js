/**
 * Tests for modules/link-preview.js
 *
 * Tests the link preview caching, deduplication, and rendering logic.
 * Uses mock DOM elements and apiCall.
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// Set up minimal browser globals
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

// Minimal DOM mock for document.createElement
globalThis.document = globalThis.document || {
  createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
      remove() {
        this._removed = true;
      },
      _removed: false,
    };
    return el;
  },
};

// Minimal IntersectionObserver mock
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor(callback, options) {
    this._callback = callback;
    this._options = options;
    this._observed = [];
  }
  observe(el) {
    this._observed.push(el);
  }
  unobserve(_el) {
    // no-op for tests
  }
  disconnect() {
    this._observed = [];
  }
};

let createLinkPreview;

describe('link-preview', async () => {
  const mod = await import('../src/js/modules/link-preview.js');
  createLinkPreview = mod.createLinkPreview;

  describe('createLinkPreview factory', () => {
    it('returns an object with attachLinkPreview', () => {
      const lp = createLinkPreview({ apiCall: async () => null });
      assert.strictEqual(typeof lp.attachLinkPreview, 'function');
    });

    it('exposes internal cache and pending maps for testing', () => {
      const lp = createLinkPreview({ apiCall: async () => null });
      assert.ok(lp._cache instanceof Map);
      assert.ok(lp._pending instanceof Map);
    });
  });

  describe('fetchLinkPreviewCached (via _fetchCached)', () => {
    it('calls apiCall with correct unfurl URL', async () => {
      const mockApiCall = mock.fn(async () => ({
        title: 'Test',
        description: 'Desc',
      }));
      const lp = createLinkPreview({ apiCall: mockApiCall });

      await lp._fetchCached('https://example.com');
      assert.strictEqual(mockApiCall.mock.calls.length, 1);
      assert.ok(
        mockApiCall.mock.calls[0].arguments[0].includes(
          '/api/unfurl?url=https%3A%2F%2Fexample.com'
        )
      );
    });

    it('caches result after successful fetch', async () => {
      const mockApiCall = mock.fn(async () => ({
        title: 'Cached',
      }));
      const lp = createLinkPreview({ apiCall: mockApiCall });

      await lp._fetchCached('https://example.com');
      assert.ok(lp._cache.has('https://example.com'));
      assert.strictEqual(lp._cache.get('https://example.com').title, 'Cached');
    });

    it('returns cached data on second call without re-fetching', async () => {
      const mockApiCall = mock.fn(async () => ({
        title: 'Once',
      }));
      const lp = createLinkPreview({ apiCall: mockApiCall });

      await lp._fetchCached('https://example.com');
      const result = await lp._fetchCached('https://example.com');

      assert.strictEqual(mockApiCall.mock.calls.length, 1);
      assert.strictEqual(result.title, 'Once');
    });

    it('deduplicates concurrent requests for same URL', async () => {
      let resolveCall;
      const mockApiCall = mock.fn(
        () =>
          new Promise((resolve) => {
            resolveCall = resolve;
          })
      );
      const lp = createLinkPreview({ apiCall: mockApiCall });

      // Start two requests for the same URL simultaneously
      const p1 = lp._fetchCached('https://example.com');
      const p2 = lp._fetchCached('https://example.com');

      // Only one API call should be made
      assert.strictEqual(mockApiCall.mock.calls.length, 1);

      resolveCall({ title: 'Deduped' });
      const [r1, r2] = await Promise.all([p1, p2]);

      assert.strictEqual(r1.title, 'Deduped');
      assert.strictEqual(r2.title, 'Deduped');
    });

    it('caches null on API error to prevent retries', async () => {
      const mockApiCall = mock.fn(async () => {
        throw new Error('Network error');
      });
      const lp = createLinkPreview({ apiCall: mockApiCall });

      const result = await lp._fetchCached('https://fail.com');
      assert.strictEqual(result, null);
      assert.ok(lp._cache.has('https://fail.com'));
      assert.strictEqual(lp._cache.get('https://fail.com'), null);
    });

    it('cleans up pending map after successful fetch', async () => {
      const mockApiCall = mock.fn(async () => ({ title: 'Done' }));
      const lp = createLinkPreview({ apiCall: mockApiCall });

      await lp._fetchCached('https://example.com');
      assert.strictEqual(lp._pending.has('https://example.com'), false);
    });

    it('cleans up pending map after failed fetch', async () => {
      const mockApiCall = mock.fn(async () => {
        throw new Error('Fail');
      });
      const lp = createLinkPreview({ apiCall: mockApiCall });

      await lp._fetchCached('https://fail.com');
      assert.strictEqual(lp._pending.has('https://fail.com'), false);
    });
  });

  describe('attachLinkPreview', () => {
    it('does nothing when comment has no URL', () => {
      const lp = createLinkPreview({ apiCall: async () => null });
      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(container, 'Just a plain comment');
      assert.strictEqual(container.appendChild.mock.calls.length, 0);
    });

    it('does nothing when comment is null', () => {
      const lp = createLinkPreview({ apiCall: async () => null });
      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(container, null);
      assert.strictEqual(container.appendChild.mock.calls.length, 0);
    });

    it('does nothing when comment is empty string', () => {
      const lp = createLinkPreview({ apiCall: async () => null });
      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(container, '');
      assert.strictEqual(container.appendChild.mock.calls.length, 0);
    });

    it('creates placeholder and defers when URL not cached', () => {
      const lp = createLinkPreview({ apiCall: async () => ({ title: 'T' }) });
      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(
        container,
        'Check this: https://example.com/article'
      );
      assert.strictEqual(container.appendChild.mock.calls.length, 1);
      const previewEl = container.appendChild.mock.calls[0].arguments[0];
      assert.strictEqual(previewEl.textContent, 'Loading preview...');
      assert.strictEqual(
        previewEl.dataset.previewUrl,
        'https://example.com/article'
      );
    });

    it('renders immediately when URL is cached', async () => {
      const mockApiCall = mock.fn(async () => ({
        title: 'Cached Title',
        description: 'Cached Desc',
        image: 'https://img.com/thumb.jpg',
      }));
      const lp = createLinkPreview({ apiCall: mockApiCall });

      // Prime the cache
      await lp._fetchCached('https://example.com');

      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(container, 'See https://example.com for details');

      assert.strictEqual(container.appendChild.mock.calls.length, 1);
      const previewEl = container.appendChild.mock.calls[0].arguments[0];
      // Should be rendered (has innerHTML set, not "Loading preview...")
      assert.ok(previewEl.innerHTML.includes('Cached Title'));
      assert.ok(previewEl.innerHTML.includes('Cached Desc'));
    });

    it('skips rendering when cached data is null (failed URL)', async () => {
      const mockApiCall = mock.fn(async () => {
        throw new Error('Fail');
      });
      const lp = createLinkPreview({ apiCall: mockApiCall });

      // Prime cache with null (failed URL)
      await lp._fetchCached('https://failed.com');

      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(container, 'Link: https://failed.com');

      // Should NOT append anything for a previously failed URL
      assert.strictEqual(container.appendChild.mock.calls.length, 0);
    });

    it('extracts first URL from comment with multiple URLs', () => {
      const lp = createLinkPreview({ apiCall: async () => ({ title: 'T' }) });
      const container = { children: [], appendChild: mock.fn() };
      lp.attachLinkPreview(
        container,
        'Check https://first.com and https://second.com'
      );
      const previewEl = container.appendChild.mock.calls[0].arguments[0];
      assert.strictEqual(previewEl.dataset.previewUrl, 'https://first.com');
    });
  });
});
