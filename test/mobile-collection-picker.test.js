/**
 * The mobile "Move to Collection" sheet.
 *
 * It is handed an opaque list id, which it used to print straight into the
 * heading and the toast, and it interpolated collection names into markup
 * without escaping.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

function createButton(dataset) {
  const listeners = new Map();
  return {
    dataset,
    addEventListener: (name, handler) => listeners.set(name, handler),
    click: () =>
      listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} }),
  };
}

/** What the browser does to attribute values on parse. */
function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function buildPicker({ collections = [], listMeta } = {}) {
  const { createMobileCollectionPicker } =
    await import('../src/js/modules/mobile-ui/list-collection-picker.js');

  const state = { contentHtml: '', toasts: [], requests: [], buttons: [] };

  const showMobileCollectionPicker = createMobileCollectionPicker({
    createActionSheet: (options) => {
      state.contentHtml = options.contentHtml;

      state.buttons = [
        ...options.contentHtml.matchAll(
          /data-group-id="([^"]*)"\s*\n?\s*data-group-name="([^"]*)"/g
        ),
      ].map(([, groupId, groupName]) =>
        createButton({ groupId, groupName: decodeEntities(groupName) })
      );

      return {
        sheet: { querySelectorAll: () => state.buttons },
        close: () => {},
      };
    },
    getListMetadata: () => listMeta,
    getSortedGroups: () => collections,
    apiCall: async (url, options) => {
      state.requests.push({ url, body: options?.body });
      return {};
    },
    showToast: (message) => state.toasts.push(message),
    refreshGroupsAndLists: async () => {},
    updateListNav: () => {},
    logger: { error() {} },
  });

  return { state, showMobileCollectionPicker };
}

describe('mobile collection picker', () => {
  it('names the list in the heading rather than showing its id', async () => {
    const { state, showMobileCollectionPicker } = await buildPicker({
      listMeta: { name: 'Best of 2024' },
      collections: [{ _id: 'g-2', name: 'Favourites', isYearGroup: false }],
    });

    showMobileCollectionPicker('a3f9c2b1d4e5f607');

    assert.match(state.contentHtml, /Move "Best of 2024"/);
    assert.ok(!state.contentHtml.includes('a3f9c2b1d4e5f607'));
  });

  it('still moves the list by id', async () => {
    const { state, showMobileCollectionPicker } = await buildPicker({
      listMeta: { name: 'Best of 2024' },
      collections: [{ _id: 'g-2', name: 'Favourites', isYearGroup: false }],
    });

    showMobileCollectionPicker('a3f9c2b1d4e5f607');
    await state.buttons[0].click();

    assert.strictEqual(
      state.requests[0].url,
      '/api/lists/a3f9c2b1d4e5f607/move'
    );
    assert.deepStrictEqual(state.toasts, [
      'Moved "Best of 2024" to "Favourites"',
    ]);
  });

  it('escapes collection names into the sheet', async () => {
    const { state, showMobileCollectionPicker } = await buildPicker({
      listMeta: { name: 'Alpha' },
      collections: [
        { _id: 'g-2', name: 'Rock "n" Roll', isYearGroup: false },
        {
          _id: 'g-3',
          name: '<img src=x onerror=alert(1)>',
          isYearGroup: false,
        },
      ],
    });

    showMobileCollectionPicker('a3f9c2b1d4e5f607');

    assert.ok(
      state.contentHtml.includes('data-group-name="Rock &quot;n&quot; Roll"')
    );
    assert.ok(!state.contentHtml.includes('<img'));
    assert.ok(state.contentHtml.includes('&lt;img'));
  });

  it('escapes the list name in the heading', async () => {
    const { state, showMobileCollectionPicker } = await buildPicker({
      listMeta: { name: '<script>alert(1)</script>' },
      collections: [],
    });

    showMobileCollectionPicker('a3f9c2b1d4e5f607');

    assert.ok(!state.contentHtml.includes('<script>'));
    assert.ok(state.contentHtml.includes('&lt;script&gt;'));
  });

  it('falls back to the id when the list has no metadata', async () => {
    const { state, showMobileCollectionPicker } = await buildPicker({
      listMeta: null,
      collections: [],
    });

    showMobileCollectionPicker('a3f9c2b1d4e5f607');

    assert.match(state.contentHtml, /Move "a3f9c2b1d4e5f607"/);
  });
});
