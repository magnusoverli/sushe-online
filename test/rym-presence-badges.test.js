const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

const badgeSelector = '[data-sushe-presence-badge]';
const albumUrl = 'https://rateyourmusic.com/release/album/horn/apokalyps-1618/';
const singleUrl =
  'https://rateyourmusic.com/release/single/horn/apokalyps-1618/';

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

  if (selector === 'img' || selector === 'h1' || selector === 'tr') {
    return element.tagName === selector.toUpperCase();
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

function installBrowserGlobals(document) {
  const sentMessages = [];

  globalThis.document = document;
  globalThis.location = { href: 'https://rateyourmusic.com/artist/horn' };
  globalThis.chrome = {
    runtime: {
      sendMessage: mock.fn(async (message) => {
        sentMessages.push(message);
        return {
          success: true,
          matches: {
            'horn::apokalyps': [
              { listId: 'list-2026', listName: '2026', year: 2026 },
            ],
          },
        };
      }),
      onMessage: { addListener: mock.fn() },
    },
  };
  globalThis.MutationObserver = class {
    observe() {}
  };

  return sentMessages;
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
    const sentMessages = installBrowserGlobals(page.document);
    loadBadgeScripts();

    await waitForBadgeScan();

    assert.strictEqual(page.document.querySelectorAll(badgeSelector).length, 0);
    assert.strictEqual(sentMessages.length, 0);
  });
});
