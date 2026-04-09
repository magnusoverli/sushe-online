const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('year-lock-status-refresh module', () => {
  let createYearLockStatusRefresh;

  beforeEach(async () => {
    const module =
      await import('../src/js/modules/year-lock-status-refresh.js');
    createYearLockStatusRefresh = module.createYearLockStatusRefresh;
  });

  it('returns early when current list year does not match target year', async () => {
    const calls = [];

    const { refreshLockedYearStatus } = createYearLockStatusRefresh({
      invalidateLockedYearsCache() {
        calls.push('invalidate');
      },
      getListMetadata() {
        return { year: 2024, isMain: true };
      },
      getCurrentListId() {
        return 'list-1';
      },
      isListLocked: async () => {
        calls.push('isListLocked');
        return true;
      },
      getSortingModule() {
        return null;
      },
      showYearLockUI() {
        calls.push('show');
      },
      clearYearLockUI() {
        calls.push('clear');
      },
      doc: {
        getElementById() {
          calls.push('container');
          return null;
        },
      },
      win: { innerWidth: 1400 },
    });

    await refreshLockedYearStatus(2025);

    assert.deepStrictEqual(calls, ['invalidate']);
  });

  it('disables sorting and shows lock UI when the year is locked', async () => {
    const calls = [];
    const container = { id: 'albumContainer' };
    const sorting = {
      destroySorting(target) {
        calls.push(['destroy', target]);
      },
      initializeUnifiedSorting() {
        calls.push(['init']);
      },
    };

    const { refreshLockedYearStatus } = createYearLockStatusRefresh({
      invalidateLockedYearsCache() {
        calls.push('invalidate');
      },
      getListMetadata() {
        return { year: 2024, isMain: true };
      },
      getCurrentListId() {
        return 'list-main';
      },
      isListLocked: async () => true,
      getSortingModule() {
        return sorting;
      },
      showYearLockUI(target, year) {
        calls.push(['show', target, year]);
      },
      clearYearLockUI() {
        calls.push(['clear']);
      },
      doc: {
        getElementById(id) {
          if (id === 'albumContainer') return container;
          return null;
        },
      },
      win: { innerWidth: 1280 },
    });

    await refreshLockedYearStatus(2024);

    assert.deepStrictEqual(calls[0], 'invalidate');
    assert.deepStrictEqual(calls[1], ['destroy', container]);
    assert.deepStrictEqual(calls[2], ['show', container, 2024]);
    assert.strictEqual(
      calls.find((entry) => entry[0] === 'init'),
      undefined
    );
  });

  it('enables sorting and clears lock UI when the year is unlocked', async () => {
    const calls = [];
    const container = { id: 'albumContainer' };
    const sorting = {
      destroySorting() {
        calls.push(['destroy']);
      },
      initializeUnifiedSorting(target, isMobile) {
        calls.push(['init', target, isMobile]);
      },
    };

    const { refreshLockedYearStatus } = createYearLockStatusRefresh({
      invalidateLockedYearsCache() {
        calls.push('invalidate');
      },
      getListMetadata() {
        return { year: 2024, isMain: true };
      },
      getCurrentListId() {
        return 'list-main';
      },
      isListLocked: async () => false,
      getSortingModule() {
        return sorting;
      },
      showYearLockUI() {
        calls.push(['show']);
      },
      clearYearLockUI(target) {
        calls.push(['clear', target]);
      },
      doc: {
        getElementById() {
          return container;
        },
      },
      win: { innerWidth: 600 },
    });

    await refreshLockedYearStatus(2024);

    assert.deepStrictEqual(calls[0], 'invalidate');
    assert.deepStrictEqual(calls[1], ['init', container, true]);
    assert.deepStrictEqual(calls[2], ['clear', container]);
    assert.strictEqual(
      calls.find((entry) => entry[0] === 'destroy'),
      undefined
    );
  });

  it('returns without sorting calls when album container is missing', async () => {
    const calls = [];
    const sorting = {
      destroySorting() {
        calls.push('destroy');
      },
      initializeUnifiedSorting() {
        calls.push('init');
      },
    };

    const { refreshLockedYearStatus } = createYearLockStatusRefresh({
      invalidateLockedYearsCache() {
        calls.push('invalidate');
      },
      getListMetadata() {
        return { year: 2024, isMain: true };
      },
      getCurrentListId() {
        return 'list-main';
      },
      isListLocked: async () => true,
      getSortingModule() {
        calls.push('sorting');
        return sorting;
      },
      showYearLockUI() {
        calls.push('show');
      },
      clearYearLockUI() {
        calls.push('clear');
      },
      doc: {
        getElementById() {
          return null;
        },
      },
      win: { innerWidth: 900 },
    });

    await refreshLockedYearStatus(2024);

    assert.deepStrictEqual(calls, ['invalidate']);
  });
});
