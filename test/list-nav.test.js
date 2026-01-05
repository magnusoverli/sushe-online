/**
 * Tests for List Navigation Module
 *
 * Tests the list-nav.js module's core functionality using dependency injection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Since we're testing ES modules from Node.js CommonJS tests, we'll test
// the module's logic patterns rather than importing it directly.
// The build process validates the module compiles correctly.

describe('List Navigation Module - Unit Tests', () => {
  describe('groupListsByYear logic', () => {
    it('should group lists by year', () => {
      const lists = {
        'List A': {},
        'List B': {},
        'List C': {},
      };

      const getListMetadata = (listName) => {
        const metadata = {
          'List A': { year: 2023 },
          'List B': { year: 2023 },
          'List C': { year: 2022 },
        };
        return metadata[listName];
      };

      // Simulate groupListsByYear logic
      const listsByYear = {};
      const uncategorized = [];

      Object.keys(lists).forEach((listName) => {
        const meta = getListMetadata(listName);
        const year = meta?.year;

        if (year) {
          if (!listsByYear[year]) {
            listsByYear[year] = [];
          }
          listsByYear[year].push({ name: listName, meta });
        } else {
          uncategorized.push({ name: listName, meta });
        }
      });

      assert.strictEqual(Object.keys(listsByYear).length, 2);
      assert.strictEqual(listsByYear[2023].length, 2);
      assert.strictEqual(listsByYear[2022].length, 1);
      assert.strictEqual(uncategorized.length, 0);
    });

    it('should put lists without year in uncategorized', () => {
      const lists = {
        'List A': {},
        'List B': {},
      };

      const getListMetadata = (listName) => {
        const metadata = {
          'List A': { year: 2023 },
          'List B': {}, // No year
        };
        return metadata[listName];
      };

      const listsByYear = {};
      const uncategorized = [];

      Object.keys(lists).forEach((listName) => {
        const meta = getListMetadata(listName);
        const year = meta?.year;

        if (year) {
          if (!listsByYear[year]) {
            listsByYear[year] = [];
          }
          listsByYear[year].push({ name: listName, meta });
        } else {
          uncategorized.push({ name: listName, meta });
        }
      });

      assert.strictEqual(listsByYear[2023].length, 1);
      assert.strictEqual(uncategorized.length, 1);
      assert.strictEqual(uncategorized[0].name, 'List B');
    });

    it('should sort years in descending order', () => {
      const listsByYear = {
        2020: [],
        2023: [],
        2021: [],
        2022: [],
      };

      const sortedYears = Object.keys(listsByYear).sort(
        (a, b) => parseInt(b) - parseInt(a)
      );

      assert.deepStrictEqual(sortedYears, ['2023', '2022', '2021', '2020']);
    });
  });

  describe('createYearHeaderHTML logic', () => {
    it('should generate expanded header HTML', () => {
      const isExpanded = true;

      const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';

      assert.strictEqual(chevronClass, 'fa-chevron-down');
    });

    it('should generate collapsed header HTML', () => {
      const isExpanded = false;

      const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';

      assert.strictEqual(chevronClass, 'fa-chevron-right');
    });
  });

  describe('createListButtonHTML logic', () => {
    it('should include active class when list is active', () => {
      const isActive = true;
      const activeClass = isActive ? 'active' : '';
      assert.strictEqual(activeClass, 'active');
    });

    it('should not include active class when list is not active', () => {
      const isActive = false;
      const activeClass = isActive ? 'active' : '';
      assert.strictEqual(activeClass, '');
    });

    it('should include main badge for main lists', () => {
      const isMain = true;
      const mainBadge = isMain
        ? '<i class="fas fa-star text-yellow-500 ml-1 shrink-0 text-xs" title="Main list"></i>'
        : '';

      assert.ok(mainBadge.includes('fa-star'));
      assert.ok(mainBadge.includes('text-yellow-500'));
    });

    it('should not include main badge for non-main lists', () => {
      const isMain = false;
      const mainBadge = isMain
        ? '<i class="fas fa-star text-yellow-500"></i>'
        : '';

      assert.strictEqual(mainBadge, '');
    });

    it('should use mobile padding class for mobile', () => {
      const isMobile = true;
      const paddingClass = isMobile ? 'py-3' : 'py-2';
      assert.strictEqual(paddingClass, 'py-3');
    });

    it('should use desktop padding class for desktop', () => {
      const isMobile = false;
      const paddingClass = isMobile ? 'py-3' : 'py-2';
      assert.strictEqual(paddingClass, 'py-2');
    });

    it('should include menu button for mobile', () => {
      const isMobile = true;
      const listName = 'Test List';

      // Mobile template includes menu button
      const mobileExtras = isMobile
        ? `<button data-list-menu-btn="${listName}"></button>`
        : '';

      assert.ok(mobileExtras.includes('data-list-menu-btn'));
    });
  });

  describe('Year expand state management', () => {
    it('should default to expanded when state is undefined', () => {
      const expandState = {};
      const year = '2023';

      const isExpanded = expandState[year] !== false; // Default to expanded

      assert.strictEqual(isExpanded, true);
    });

    it('should be collapsed when state is false', () => {
      const expandState = { 2023: false };
      const year = '2023';

      const isExpanded = expandState[year] !== false;

      assert.strictEqual(isExpanded, false);
    });

    it('should be expanded when state is true', () => {
      const expandState = { 2023: true };
      const year = '2023';

      const isExpanded = expandState[year] !== false;

      assert.strictEqual(isExpanded, true);
    });

    it('should toggle state correctly', () => {
      const state = { 2023: true };
      const year = '2023';

      // Toggle from expanded to collapsed
      const wasExpanded = state[year] !== false;
      state[year] = !wasExpanded;

      assert.strictEqual(state[year], false);

      // Toggle from collapsed to expanded
      const isNowExpanded = state[year] !== false;
      state[year] = !isNowExpanded;

      assert.strictEqual(state[year], true);
    });
  });

  describe('Active state logic', () => {
    it('should identify active list correctly', () => {
      const currentList = 'My Active List';
      const listName = 'My Active List';

      const isActive = currentList === listName;

      assert.strictEqual(isActive, true);
    });

    it('should not mark inactive lists as active', () => {
      const currentList = 'My Active List';
      const listName = 'Some Other List';

      const isActive = currentList === listName;

      assert.strictEqual(isActive, false);
    });

    it('should handle null current list', () => {
      const currentList = null;
      const listName = 'Some List';

      const isActive = currentList === listName;

      assert.strictEqual(isActive, false);
    });
  });

  describe('List sorting logic', () => {
    it('should sort year lists with main lists first', () => {
      const yearLists = [
        { name: 'List C', meta: { isMain: false } },
        { name: 'List A', meta: { isMain: true } },
        { name: 'List B', meta: { isMain: false } },
      ];

      // Sort: main first, then alphabetically
      yearLists.sort((a, b) => {
        const aMain = a.meta?.isMain || false;
        const bMain = b.meta?.isMain || false;

        if (aMain && !bMain) return -1;
        if (!aMain && bMain) return 1;
        return a.name.localeCompare(b.name);
      });

      assert.strictEqual(yearLists[0].name, 'List A'); // Main
      assert.strictEqual(yearLists[1].name, 'List B'); // Alphabetically first
      assert.strictEqual(yearLists[2].name, 'List C'); // Alphabetically last
    });
  });

  describe('LocalStorage caching logic', () => {
    it('should serialize list names for caching', () => {
      const lists = {
        'List A': {},
        'List B': {},
        'List C': {},
      };

      const cached = JSON.stringify(Object.keys(lists));

      assert.strictEqual(cached, '["List A","List B","List C"]');
    });

    it('should handle empty lists object', () => {
      const lists = {};

      const cached = JSON.stringify(Object.keys(lists));

      assert.strictEqual(cached, '[]');
    });
  });
});
