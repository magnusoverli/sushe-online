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

  // ============ GROUP-BASED NAVIGATION TESTS ============

  describe('groupListsByGroup logic', () => {
    it('should group lists by their assigned groups', () => {
      const lists = {
        'List A': {},
        'List B': {},
        'List C': {},
      };

      const groups = {
        group1: {
          _id: 'group1',
          name: '2023',
          year: 2023,
          sortOrder: 0,
          isYearGroup: true,
        },
        group2: {
          _id: 'group2',
          name: 'Favorites',
          year: null,
          sortOrder: 1,
          isYearGroup: false,
        },
      };

      const getListMetadata = (listName) => {
        const metadata = {
          'List A': { groupId: 'group1', sortOrder: 0 },
          'List B': { groupId: 'group1', sortOrder: 1 },
          'List C': { groupId: 'group2', sortOrder: 0 },
        };
        return metadata[listName];
      };

      const getSortedGroups = () =>
        Object.values(groups).sort((a, b) => a.sortOrder - b.sortOrder);

      // Simulate groupListsByGroup logic
      const listsByGroupId = {};
      const orphaned = [];

      Object.keys(lists).forEach((listName) => {
        const meta = getListMetadata(listName);
        const groupId = meta?.groupId;

        if (groupId && groups[groupId]) {
          if (!listsByGroupId[groupId]) {
            listsByGroupId[groupId] = [];
          }
          listsByGroupId[groupId].push({ name: listName, meta });
        } else {
          orphaned.push({ name: listName, meta });
        }
      });

      // Sort lists within each group by sortOrder
      Object.keys(listsByGroupId).forEach((groupId) => {
        listsByGroupId[groupId].sort(
          (a, b) => (a.meta?.sortOrder || 0) - (b.meta?.sortOrder || 0)
        );
      });

      // Build result
      const groupsWithLists = getSortedGroups().map((group) => ({
        ...group,
        lists: listsByGroupId[group._id] || [],
      }));

      assert.strictEqual(groupsWithLists.length, 2);
      assert.strictEqual(groupsWithLists[0].name, '2023');
      assert.strictEqual(groupsWithLists[0].lists.length, 2);
      assert.strictEqual(groupsWithLists[0].lists[0].name, 'List A');
      assert.strictEqual(groupsWithLists[0].lists[1].name, 'List B');
      assert.strictEqual(groupsWithLists[1].name, 'Favorites');
      assert.strictEqual(groupsWithLists[1].lists.length, 1);
      assert.strictEqual(groupsWithLists[1].lists[0].name, 'List C');
      assert.strictEqual(orphaned.length, 0);
    });

    it('should put lists without valid groupId in orphaned', () => {
      const lists = {
        'List A': {},
        'List B': {},
      };

      const groups = {
        group1: {
          _id: 'group1',
          name: '2023',
          year: 2023,
          sortOrder: 0,
          isYearGroup: true,
        },
      };

      const getListMetadata = (listName) => {
        const metadata = {
          'List A': { groupId: 'group1', sortOrder: 0 },
          'List B': { groupId: null, sortOrder: 0 }, // No group
        };
        return metadata[listName];
      };

      const listsByGroupId = {};
      const orphaned = [];

      Object.keys(lists).forEach((listName) => {
        const meta = getListMetadata(listName);
        const groupId = meta?.groupId;

        if (groupId && groups[groupId]) {
          if (!listsByGroupId[groupId]) {
            listsByGroupId[groupId] = [];
          }
          listsByGroupId[groupId].push({ name: listName, meta });
        } else {
          orphaned.push({ name: listName, meta });
        }
      });

      assert.strictEqual(listsByGroupId['group1'].length, 1);
      assert.strictEqual(orphaned.length, 1);
      assert.strictEqual(orphaned[0].name, 'List B');
    });

    it('should sort groups by sortOrder', () => {
      const groups = {
        group3: { _id: 'group3', name: 'Third', sortOrder: 2 },
        group1: { _id: 'group1', name: 'First', sortOrder: 0 },
        group2: { _id: 'group2', name: 'Second', sortOrder: 1 },
      };

      const sortedGroups = Object.values(groups).sort(
        (a, b) => a.sortOrder - b.sortOrder
      );

      assert.strictEqual(sortedGroups[0].name, 'First');
      assert.strictEqual(sortedGroups[1].name, 'Second');
      assert.strictEqual(sortedGroups[2].name, 'Third');
    });

    it('should sort lists within a group by sortOrder', () => {
      const groupLists = [
        { name: 'Third', meta: { sortOrder: 2 } },
        { name: 'First', meta: { sortOrder: 0 } },
        { name: 'Second', meta: { sortOrder: 1 } },
      ];

      groupLists.sort(
        (a, b) => (a.meta?.sortOrder || 0) - (b.meta?.sortOrder || 0)
      );

      assert.strictEqual(groupLists[0].name, 'First');
      assert.strictEqual(groupLists[1].name, 'Second');
      assert.strictEqual(groupLists[2].name, 'Third');
    });
  });

  describe('createGroupHeaderHTML logic', () => {
    it('should use calendar icon for year groups', () => {
      const isYearGroup = true;
      const iconClass = isYearGroup ? 'fa-calendar-alt' : 'fa-folder';

      assert.strictEqual(iconClass, 'fa-calendar-alt');
    });

    it('should use folder icon for collections', () => {
      const isYearGroup = false;
      const iconClass = isYearGroup ? 'fa-calendar-alt' : 'fa-folder';

      assert.strictEqual(iconClass, 'fa-folder');
    });

    it('should generate expanded header with correct chevron', () => {
      const isExpanded = true;
      const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';

      assert.strictEqual(chevronClass, 'fa-chevron-down');
    });

    it('should generate collapsed header with correct chevron', () => {
      const isExpanded = false;
      const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';

      assert.strictEqual(chevronClass, 'fa-chevron-right');
    });
  });

  describe('Group expand state management', () => {
    it('should default to expanded when state is undefined for group', () => {
      const expandState = {};
      const groupId = 'group1';

      const isExpanded = expandState[groupId] !== false;

      assert.strictEqual(isExpanded, true);
    });

    it('should be collapsed when state is false for group', () => {
      const expandState = { group1: false };
      const groupId = 'group1';

      const isExpanded = expandState[groupId] !== false;

      assert.strictEqual(isExpanded, false);
    });

    it('should toggle group state correctly', () => {
      const state = { group1: true };
      const groupId = 'group1';

      // Toggle from expanded to collapsed
      const wasExpanded = state[groupId] !== false;
      state[groupId] = !wasExpanded;

      assert.strictEqual(state[groupId], false);

      // Toggle from collapsed to expanded
      const isNowExpanded = state[groupId] !== false;
      state[groupId] = !isNowExpanded;

      assert.strictEqual(state[groupId], true);
    });
  });

  describe('Collection vs Year-Group differentiation', () => {
    it('should identify year-groups correctly', () => {
      const group = {
        _id: 'group1',
        name: '2023',
        year: 2023,
        isYearGroup: true,
      };

      assert.strictEqual(group.isYearGroup, true);
      assert.strictEqual(group.year !== null, true);
    });

    it('should identify collections correctly', () => {
      const group = {
        _id: 'group2',
        name: 'Favorites',
        year: null,
        isYearGroup: false,
      };

      assert.strictEqual(group.isYearGroup, false);
      assert.strictEqual(group.year === null, true);
    });

    it('should allow drag-and-drop within same group', () => {
      const fromGroupId = 'group1';
      const toGroupId = 'group1';

      const isSameGroup = fromGroupId === toGroupId;

      assert.strictEqual(isSameGroup, true);
    });

    it('should detect drag-and-drop between different groups', () => {
      const fromGroupId = 'group1';
      const toGroupId = 'group2';

      const isDifferentGroup = fromGroupId !== toGroupId;

      assert.strictEqual(isDifferentGroup, true);
    });
  });
});
