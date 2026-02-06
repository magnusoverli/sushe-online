/**
 * Tests for list-grouping.js utility module
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

let groupListsByYear;

describe('list-grouping', async () => {
  const mod = await import('../src/js/utils/list-grouping.js');
  groupListsByYear = mod.groupListsByYear;

  const sampleLists = {
    list1: { name: 'Best of 2024', year: 2024 },
    list2: { name: 'Favorites 2024', year: 2024 },
    list3: { name: 'Best of 2023', year: 2023 },
    list4: { name: 'Collection A', year: null },
    list5: { name: 'Best of 2025', year: 2025 },
  };

  it('should group lists by year', () => {
    const { listsByYear, sortedYears } = groupListsByYear(sampleLists);
    assert.deepStrictEqual(sortedYears, ['2025', '2024', '2023']);
    assert.deepStrictEqual(listsByYear['2024'], ['list1', 'list2']);
    assert.deepStrictEqual(listsByYear['2023'], ['list3']);
    assert.deepStrictEqual(listsByYear['2025'], ['list5']);
  });

  it('should sort years descending', () => {
    const { sortedYears } = groupListsByYear(sampleLists);
    assert.strictEqual(sortedYears[0], '2025');
    assert.strictEqual(sortedYears[sortedYears.length - 1], '2023');
  });

  it('should exclude specified list', () => {
    const { listsByYear } = groupListsByYear(sampleLists, {
      excludeListId: 'list1',
    });
    assert.deepStrictEqual(listsByYear['2024'], ['list2']);
  });

  it('should not include lists without year by default', () => {
    const { listsByYear } = groupListsByYear(sampleLists);
    assert.strictEqual(
      Object.values(listsByYear).flat().includes('list4'),
      false
    );
  });

  it('should include lists without year when option set', () => {
    const { listsWithoutYear } = groupListsByYear(sampleLists, {
      includeWithoutYear: true,
    });
    assert.deepStrictEqual(listsWithoutYear, ['list4']);
  });

  it('should include names when option set', () => {
    const { listsByYear } = groupListsByYear(sampleLists, {
      includeNames: true,
    });
    assert.deepStrictEqual(listsByYear['2023'], [
      { id: 'list3', name: 'Best of 2023' },
    ]);
  });

  it('should handle includeWithoutYear and includeNames together', () => {
    const { listsWithoutYear } = groupListsByYear(sampleLists, {
      includeWithoutYear: true,
      includeNames: true,
    });
    assert.deepStrictEqual(listsWithoutYear, [
      { id: 'list4', name: 'Collection A' },
    ]);
  });

  it('should handle empty lists object', () => {
    const { listsByYear, sortedYears } = groupListsByYear({});
    assert.deepStrictEqual(listsByYear, {});
    assert.deepStrictEqual(sortedYears, []);
  });

  it('should use "Unknown" for missing names with includeNames', () => {
    const lists = { list1: { year: 2024 } };
    const { listsByYear } = groupListsByYear(lists, { includeNames: true });
    assert.deepStrictEqual(listsByYear['2024'], [
      { id: 'list1', name: 'Unknown' },
    ]);
  });
});
