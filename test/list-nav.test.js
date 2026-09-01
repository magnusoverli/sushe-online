/**
 * Tests for List Navigation Module
 *
 * Tests the list-nav.js module's core functionality using dependency injection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

function createClassList() {
  const classes = new Set();
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function createFakeButton(dataset = {}) {
  return {
    dataset,
    classList: createClassList(),
    onclick: null,
    addEventListener() {},
    querySelector() {
      return { classList: createClassList() };
    },
  };
}

function createFakeListItem() {
  const children = new Map();
  const appended = [];
  const attributes = new Map();
  const classList = createClassList();
  return {
    className: '',
    classList,
    children: appended,
    dataset: {},
    style: {},
    _innerHTML: '',
    set innerHTML(value) {
      this._innerHTML = value;
      const listId = value.match(/data-list-id="([^"]+)"/)?.[1];
      const menuListId = value.match(/data-list-menu-btn="([^"]+)"/)?.[1];
      const recommendationsYear = value.match(
        /data-recommendations-year="([^"]+)"/
      )?.[1];

      if (listId) {
        children.set('[data-list-id]', createFakeButton({ listId }));
      }
      if (menuListId) {
        children.set('[data-list-menu-btn]', createFakeButton({ menuListId }));
      }
      if (recommendationsYear) {
        children.set(
          '[data-recommendations-year]',
          createFakeButton({ recommendationsYear })
        );
      }
    },
    get innerHTML() {
      return this._innerHTML;
    },
    querySelector(selector) {
      return children.get(selector) || null;
    },
    appendChild(child) {
      appended.push(child);
      return child;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    addEventListener() {},
  };
}

async function withFakeDocument(callback) {
  const previousDocument = global.document;
  global.document = {
    createElement() {
      return createFakeListItem();
    },
  };

  try {
    await callback();
  } finally {
    if (previousDocument === undefined) {
      delete global.document;
    } else {
      global.document = previousDocument;
    }
  }
}

function createSidebarSelectionDeps(overrides = {}) {
  const calls = {
    selectedLists: [],
    selectedRecommendations: [],
    mobileToggles: 0,
  };

  return {
    calls,
    deps: {
      getListMetadata: () => ({ name: 'List One' }),
      getCurrentList: () => 'list-1',
      getCurrentRecommendationsYear: () => null,
      selectList: (listId) => calls.selectedLists.push(listId),
      selectRecommendations: (year) => calls.selectedRecommendations.push(year),
      toggleMobileLists: () => {
        calls.mobileToggles += 1;
      },
      hideAllContextMenus() {},
      positionContextMenu() {},
      ...overrides,
    },
  };
}

// Most of these tests cover logic patterns directly; targeted behavior tests
// import the module and use a tiny fake DOM surface.

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

    it('renders category expansion and mobile options as sibling controls', async () => {
      const previousLocalStorage = global.localStorage;
      const previousWindow = global.window;
      global.localStorage = {
        getItem: () => null,
        setItem() {},
      };
      global.window = { lastSelectedList: null };

      try {
        await withFakeDocument(async () => {
          const { createListNav } =
            await import('../src/js/modules/list-nav.js');
          const group = {
            _id: 'group-1',
            name: '2025',
            year: 2025,
            isYearGroup: true,
          };
          const listNav = createListNav({
            getLists: () => ({ 'list-1': {} }),
            getListMetadata: () => ({
              name: 'Main list',
              groupId: 'group-1',
              count: 20,
            }),
            getGroups: () => ({ 'group-1': group }),
            getSortedGroups: () => [group],
            getCurrentList: () => 'list-1',
            getCurrentUser: () => ({ _id: 'user-1' }),
          });
          const container = createFakeListItem();

          listNav.renderListItems(container, true);

          const section = container.children[0];
          const headerWrapper = section.children[0];
          const header = headerWrapper.children[0];
          const menu = headerWrapper.children[1];
          const lists = section.children[1];
          assert.strictEqual(headerWrapper.children.length, 2);
          assert.match(header.className, /sidebar-group-header/);
          assert.strictEqual(header.getAttribute('aria-expanded'), 'true');
          assert.strictEqual(
            header.getAttribute('aria-controls'),
            'sidebar-group-lists-group-1'
          );
          assert.doesNotMatch(header.innerHTML, /data-category-menu-btn/);
          assert.match(menu.className, /sidebar-menu-trigger/);
          assert.strictEqual(menu.dataset.categoryMenuBtn, 'group-1');
          assert.strictEqual(lists.id, 'sidebar-group-lists-group-1');
          assert.match(lists.className, /sidebar-nested/);
        });
      } finally {
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
        if (previousWindow === undefined) delete global.window;
        else global.window = previousWindow;
      }
    });
  });

  describe('createListButtonHTML logic', () => {
    it('shows the album count as compact right-aligned metadata', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const listNav = createListNav();

      const html = listNav.createListButtonHTML(
        'list-1',
        'Favorites',
        false,
        false,
        false,
        42
      );

      assert.match(html, /sidebar-label">Favorites</);
      assert.match(html, /sidebar-count[^>]*>42</);
      assert.doesNotMatch(html, /Favorites \(42\)|fa-list/);
    });

    it('should default a missing album count to zero', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const listNav = createListNav();

      const html = listNav.createListButtonHTML(
        'list-1',
        'Empty List',
        false,
        false,
        false
      );

      assert.match(html, /sidebar-label">Empty List</);
      assert.match(html, /sidebar-count[^>]*>0</);
    });

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

    it('uses shared density classes and a mobile-sized menu trigger', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const listNav = createListNav();
      const mobileHtml = listNav.createListButtonHTML(
        'list-1',
        'Test List',
        false,
        false,
        true,
        3
      );
      const desktopHtml = listNav.createListButtonHTML(
        'list-1',
        'Test List',
        false,
        false,
        false,
        3
      );

      assert.match(mobileHtml, /sidebar-list-btn sidebar-leaf/);
      assert.match(mobileHtml, /sidebar-menu-trigger/);
      assert.doesNotMatch(mobileHtml, /py-2|py-2\.5/);
      assert.match(desktopHtml, /sidebar-list-btn sidebar-leaf/);
      assert.doesNotMatch(desktopHtml, /data-list-menu-btn/);
    });
  });

  describe('Year expand state management', () => {
    it('expands only the group containing the startup list', async () => {
      const previousDocument = global.document;
      const previousLocalStorage = global.localStorage;
      const values = new Map([
        ['groupExpandState', JSON.stringify({ groupA: true, groupB: true })],
        ['communityRootExpanded:user-1', 'true'],
      ]);
      global.document = { getElementById: () => null };
      global.localStorage = {
        get length() {
          return values.size;
        },
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
        key: (index) => Array.from(values.keys())[index] || null,
      };

      try {
        const { createListNav } = await import('../src/js/modules/list-nav.js');
        const metadata = {
          listA: { name: 'List A', groupId: 'groupA' },
          listB: { name: 'List B', groupId: 'groupB' },
        };
        const groups = {
          groupA: { _id: 'groupA', name: 'Group A' },
          groupB: { _id: 'groupB', name: 'Group B' },
        };
        const listNav = createListNav({
          getLists: () => ({ listA: {}, listB: {} }),
          getListMetadata: (listId) => metadata[listId],
          getGroups: () => groups,
          getSortedGroups: () => Object.values(groups),
          getCurrentList: () => null,
          getCurrentUser: () => ({ _id: 'user-1' }),
        });

        listNav.updateListNav('listB');

        assert.deepStrictEqual(JSON.parse(values.get('groupExpandState')), {
          groupA: false,
          groupB: true,
        });
        assert.strictEqual(values.get('communityRootExpanded:user-1'), 'false');
      } finally {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
      }
    });

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

  describe('Sidebar list selection behavior', () => {
    it('renders the metadata album count on desktop and mobile', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps } = createSidebarSelectionDeps({
        getListMetadata: () => ({ name: 'List One', count: 7 }),
      });
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const desktopItem = listNav.createListButton('list-1', false);
        const mobileItem = listNav.createListButton('list-1', true);

        assert.match(desktopItem.innerHTML, /sidebar-label">List One</);
        assert.match(desktopItem.innerHTML, /sidebar-count[^>]*>7</);
        assert.match(mobileItem.innerHTML, /sidebar-label">List One</);
        assert.match(mobileItem.innerHTML, /sidebar-count[^>]*>7</);
      });
    });

    it('ignores desktop clicks on the active list', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps();
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createListButton('list-1', false);
        item.querySelector('[data-list-id]').onclick();
      });

      assert.deepStrictEqual(calls.selectedLists, []);
    });

    it('keeps the mobile drawer open when tapping the active list', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps();
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createListButton('list-1', true);
        item.querySelector('[data-list-id]').onclick();
      });

      assert.deepStrictEqual(calls.selectedLists, []);
      assert.strictEqual(calls.mobileToggles, 0);
    });

    it('still selects and closes mobile drawer for inactive lists', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps({
        getCurrentList: () => 'list-2',
      });
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createListButton('list-1', true);
        item.querySelector('[data-list-id]').onclick();
      });

      assert.deepStrictEqual(calls.selectedLists, ['list-1']);
      assert.strictEqual(calls.mobileToggles, 1);
    });

    it('selects the current list when returning from recommendations', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps({
        getCurrentRecommendationsYear: () => 2024,
      });
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createListButton('list-1', true);
        item.querySelector('[data-list-id]').onclick();
      });

      assert.deepStrictEqual(calls.selectedLists, ['list-1']);
      assert.strictEqual(calls.mobileToggles, 1);
    });
  });

  describe('Sidebar recommendations selection behavior', () => {
    it('ignores desktop clicks on the active recommendations year', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps({
        getCurrentRecommendationsYear: () => 2024,
      });
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createRecommendationsButton(2024, false);
        item.querySelector('[data-recommendations-year]').onclick();
      });

      assert.deepStrictEqual(calls.selectedRecommendations, []);
    });

    it('keeps the mobile drawer open when tapping the active recommendations year', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps({
        getCurrentRecommendationsYear: () => 2024,
      });
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createRecommendationsButton(2024, true);
        item.querySelector('[data-recommendations-year]').onclick();
      });

      assert.deepStrictEqual(calls.selectedRecommendations, []);
      assert.strictEqual(calls.mobileToggles, 0);
    });

    it('still selects and closes mobile drawer for inactive recommendations years', async () => {
      const { createListNav } = await import('../src/js/modules/list-nav.js');
      const { deps, calls } = createSidebarSelectionDeps({
        getCurrentRecommendationsYear: () => 2023,
      });
      const listNav = createListNav(deps);

      await withFakeDocument(() => {
        const item = listNav.createRecommendationsButton(2024, true);
        item.querySelector('[data-recommendations-year]').onclick();
      });

      assert.deepStrictEqual(calls.selectedRecommendations, [2024]);
      assert.strictEqual(calls.mobileToggles, 1);
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
