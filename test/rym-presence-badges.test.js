const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

const badgeSelector = '[data-sushe-presence-badge]';
const albumUrl = 'https://rateyourmusic.com/release/album/horn/apokalyps-1618/';
const singleUrl =
  'https://rateyourmusic.com/release/single/horn/apokalyps-1618/';
const detailAlbumUrl =
  'https://rateyourmusic.com/release/album/warning/rituals-of-shame/';
const detailAlbumKey = 'warning::rituals of shame';

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = options.className || '';
    this.href = options.href || '';
    this.title = options.title || '';
    this.textContent = options.text || '';
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
  }

  appendChild(child) {
    if (child.parentElement) {
      const oldSiblings = child.parentElement.children;
      const oldIndex = oldSiblings.indexOf(child);
      if (oldIndex !== -1) oldSiblings.splice(oldIndex, 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertAdjacentElement(position, element) {
    assert.strictEqual(position, 'afterend');
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    element.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, element);
    return element;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index !== -1) siblings.splice(index, 1);
    this.parentElement = null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];

    for (const child of this.children) {
      if (matchesSelector(child, selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }

    return matches;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

class FakeDocument {
  constructor(root) {
    this.documentElement = root;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return findElement(this.documentElement, (element) => element.id === id);
  }

  querySelector(selector) {
    if (matchesSelector(this.documentElement, selector)) {
      return this.documentElement;
    }
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    const matches = matchesSelector(this.documentElement, selector)
      ? [this.documentElement]
      : [];
    return [...matches, ...this.documentElement.querySelectorAll(selector)];
  }
}

function matchesSelector(element, selector) {
  if (selector === 'a[href*="/release/"]') {
    return element.tagName === 'A' && element.href.includes('/release/');
  }

  if (selector === 'a[href]') {
    return element.tagName === 'A' && !!element.href;
  }

  if (
    selector === 'a' ||
    selector === 'img' ||
    selector === 'h1' ||
    selector === 'tr'
  ) {
    return element.tagName === selector.toUpperCase();
  }

  const tagClassMatch = selector.match(/^([a-z]+)\.([\w-]+)$/i);
  if (tagClassMatch) {
    return (
      element.tagName === tagClassMatch[1].toUpperCase() &&
      element.className.split(/\s+/).includes(tagClassMatch[2])
    );
  }

  const tagAttributeMatch = selector.match(/^([a-z]+)\[([^=]+)="([^"]+)"\]$/i);
  if (tagAttributeMatch) {
    return (
      element.tagName === tagAttributeMatch[1].toUpperCase() &&
      element.getAttribute(tagAttributeMatch[2]) === tagAttributeMatch[3]
    );
  }

  if (selector.startsWith('.')) {
    return element.className.split(/\s+/).includes(selector.slice(1));
  }

  const classContainsMatch = selector.match(/^\[class\*="(.+)"\]$/);
  if (classContainsMatch) {
    return element.className.includes(classContainsMatch[1]);
  }

  const attributeMatch = selector.match(/^\[([^\]]+)\]$/);
  if (attributeMatch) {
    return element.getAttribute(attributeMatch[1]) !== null;
  }

  return false;
}

function findElement(element, predicate) {
  if (predicate(element)) return element;

  for (const child of element.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }

  return null;
}

function buildArtistReleaseRow(url = albumUrl) {
  const root = new FakeElement('html');
  const row = root.appendChild(new FakeElement('div'));
  const coverCell = row.appendChild(new FakeElement('div'));
  const coverLink = coverCell.appendChild(new FakeElement('a', { href: url }));
  const titleCell = row.appendChild(new FakeElement('div'));
  const titleLink = titleCell.appendChild(
    new FakeElement('a', { href: url, text: 'Apokalyps 1618' })
  );

  coverLink.appendChild(new FakeElement('img'));

  return {
    coverCell,
    document: new FakeDocument(root),
    titleCell,
    titleLink,
  };
}

function buildAlbumDetailPage({ includePlatformRow = true } = {}) {
  const root = new FakeElement('html');
  const leftColumn = root.appendChild(
    new FakeElement('div', { className: 'release_left_column' })
  );
  const coverArea = leftColumn.appendChild(new FakeElement('div'));
  const cover = coverArea.appendChild(
    new FakeElement('img', { className: 'coverart_img' })
  );
  let platformRow = null;

  if (includePlatformRow) {
    platformRow = leftColumn.appendChild(
      new FakeElement('div', { className: 'release_media_links' })
    );
    const spotifyLink = platformRow.appendChild(
      new FakeElement('a', { href: 'https://open.spotify.com/album/example' })
    );
    spotifyLink.appendChild(new FakeElement('img'));
  }

  const issues = root.appendChild(new FakeElement('div'));
  const issueRows = [];
  for (let issueNumber = 1; issueNumber <= 3; issueNumber++) {
    const issueRow = issues.appendChild(
      new FakeElement('div', { className: 'release_row' })
    );
    issueRow.appendChild(
      new FakeElement('a', {
        href: `${detailAlbumUrl.slice(0, -1)}-${issueNumber}/`,
        text: 'Rituals of Shame',
      })
    );
    issueRows.push(issueRow);
  }

  const reviewPagination = root.appendChild(
    new FakeElement('div', { className: 'review_pagination' })
  );
  for (let pageNumber = 1; pageNumber <= 4; pageNumber++) {
    reviewPagination.appendChild(
      new FakeElement('a', {
        href: `${detailAlbumUrl}?review_page=${pageNumber}`,
        text: String(pageNumber),
      })
    );
  }

  return {
    cover,
    coverArea,
    document: new FakeDocument(root),
    issueRows,
    leftColumn,
    platformRow,
    reviewPagination,
  };
}

function installBrowserGlobals(document, options = {}) {
  const sentMessages = [];
  const messageListeners = [];
  const observerCallbacks = [];
  const matches = options.matches || {
    'horn::apokalyps': [{ listId: 'list-2026', listName: '2026', year: 2026 }],
  };

  globalThis.document = document;
  globalThis.location = {
    href: options.locationHref || 'https://rateyourmusic.com/artist/horn',
  };
  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: mock.fn(async (message) => {
        sentMessages.push(message);
        return {
          success: true,
          matches,
        };
      }),
      onMessage: {
        addListener: mock.fn((listener) => messageListeners.push(listener)),
      },
    },
  };
  globalThis.MutationObserver = class FakeMutationObserver {
    constructor(callback) {
      observerCallbacks.push(callback);
    }

    observe() {}
  };

  return { messageListeners, observerCallbacks, sentMessages };
}

function loadBadgeScripts() {
  delete globalThis.ExtensionConstants;
  delete globalThis.AlbumIdentity;

  delete require.cache[
    require.resolve('../browser-extension/extension-constants.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/album-identity-service.js')
  ];
  delete require.cache[
    require.resolve('../browser-extension/rym-presence-badges.js')
  ];

  require('../browser-extension/extension-constants.js');
  require('../browser-extension/album-identity-service.js');
  require('../browser-extension/rym-presence-badges.js');
}

async function waitForBadgeScan() {
  await new Promise((resolve) => setTimeout(resolve, 350));
}

describe('RYM presence badges', () => {
  beforeEach(() => {
    mock.reset();
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.MutationObserver;
  });

  it('adds one badge after the album title link, not the cover link', async () => {
    const page = buildArtistReleaseRow();
    installBrowserGlobals(page.document);
    loadBadgeScripts();

    await waitForBadgeScan();

    const badges = page.document.querySelectorAll(badgeSelector);
    assert.strictEqual(badges.length, 1);
    assert.strictEqual(badges[0].textContent, 'In SuShe');
    assert.strictEqual(badges[0].title, 'In: 2026');
    assert.strictEqual(badges[0].parentElement, page.titleCell);
    assert.strictEqual(
      page.coverCell.querySelectorAll(badgeSelector).length,
      0
    );
    assert.strictEqual(
      page.titleCell.children.indexOf(badges[0]),
      page.titleCell.children.indexOf(page.titleLink) + 1
    );
  });

  it('does not badge singles with the same title as a listed album', async () => {
    const page = buildArtistReleaseRow(singleUrl);
    const { sentMessages } = installBrowserGlobals(page.document);
    loadBadgeScripts();

    await waitForBadgeScan();

    assert.strictEqual(page.document.querySelectorAll(badgeSelector).length, 0);
    assert.strictEqual(sentMessages.length, 0);
  });

  it('adds one platform badge on album pages and none to issues or reviews', async () => {
    const page = buildAlbumDetailPage();
    const { sentMessages } = installBrowserGlobals(page.document, {
      locationHref: detailAlbumUrl,
      matches: {
        [detailAlbumKey]: [
          { listId: 'list-2026', listName: '2026', year: 2026 },
        ],
      },
    });
    loadBadgeScripts();

    await waitForBadgeScan();

    const badges = page.document.querySelectorAll(badgeSelector);
    assert.strictEqual(badges.length, 1);
    assert.strictEqual(badges[0].parentElement, page.platformRow);
    assert.ok(badges[0].className.includes('sushe-presence-badge--platform'));
    assert.strictEqual(badges[0].title, 'In SuShe: 2026');
    assert.strictEqual(
      badges[0].querySelector('img').src,
      'chrome-extension://test/store-icon-128.png'
    );
    for (const issueRow of page.issueRows) {
      assert.strictEqual(issueRow.querySelectorAll(badgeSelector).length, 0);
    }
    assert.strictEqual(
      page.reviewPagination.querySelectorAll(badgeSelector).length,
      0
    );
    assert.strictEqual(sentMessages[0].albums.length, 1);
    assert.strictEqual(sentMessages[0].albums[0].key, detailAlbumKey);
  });

  it('updates the album platform badge without duplicating it', async () => {
    const page = buildAlbumDetailPage();
    const { messageListeners } = installBrowserGlobals(page.document, {
      locationHref: detailAlbumUrl,
      matches: {
        [detailAlbumKey]: [
          { listId: 'list-2026', listName: '2026', year: 2026 },
        ],
      },
    });
    loadBadgeScripts();

    await waitForBadgeScan();

    const message = {
      action: globalThis.ExtensionConstants.ACTIONS.ALBUM_ADDED_TO_LIST,
      album: { artist: 'Warning', album: 'Rituals of Shame' },
      list: { listId: 'favorites', listName: 'Favorites' },
    };
    messageListeners[0](message);
    messageListeners[0](message);

    const badges = page.document.querySelectorAll(badgeSelector);
    assert.strictEqual(badges.length, 1);
    assert.strictEqual(badges[0].title, 'In SuShe: 2026, Favorites');
    assert.strictEqual(
      badges[0].getAttribute('data-sushe-presence-lists'),
      '2026\nFavorites'
    );
  });

  it('moves the badge from its fallback row when native platform links load', async () => {
    const page = buildAlbumDetailPage({ includePlatformRow: false });
    const { observerCallbacks } = installBrowserGlobals(page.document, {
      locationHref: detailAlbumUrl,
      matches: {
        [detailAlbumKey]: [
          { listId: 'list-2026', listName: '2026', year: 2026 },
        ],
      },
    });
    loadBadgeScripts();

    await waitForBadgeScan();

    const fallbackRow = page.document.querySelector(
      '[data-sushe-presence-platform-row]'
    );
    assert.ok(fallbackRow);
    assert.strictEqual(fallbackRow.querySelectorAll(badgeSelector).length, 1);

    const nativeRow = page.leftColumn.appendChild(
      new FakeElement('div', { className: 'release_media_links' })
    );
    nativeRow.appendChild(
      new FakeElement('a', { href: 'https://open.spotify.com/album/example' })
    );
    observerCallbacks[0]();
    await waitForBadgeScan();

    assert.strictEqual(
      page.document.querySelector('[data-sushe-presence-platform-row]'),
      null
    );
    assert.strictEqual(page.document.querySelectorAll(badgeSelector).length, 1);
    assert.strictEqual(
      nativeRow.querySelectorAll(badgeSelector)[0].parentElement,
      nativeRow
    );
  });
});
