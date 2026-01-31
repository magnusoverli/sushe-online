const test = require('node:test');
const assert = require('node:assert');

/**
 * Unit tests for year-lock utilities
 *
 * These tests verify the locking logic without requiring a database.
 * The new locking behavior:
 * - Main lists are locked when their year is locked
 * - Non-main lists are never locked (even in locked years)
 * - Main status changes are blocked in locked years
 */

// Mock pool that simulates database responses
function createMockPool(locked = false) {
  return {
    query: async (sql, _params) => {
      if (sql.includes('SELECT locked FROM master_lists')) {
        return {
          rows: locked ? [{ locked: true }] : [],
        };
      }
      return { rows: [] };
    },
  };
}

// =============================================================================
// isYearLocked tests
// =============================================================================

test('isYearLocked should return false for null year', async () => {
  const { isYearLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  const result = await isYearLocked(pool, null);
  assert.strictEqual(result, false);
});

test('isYearLocked should return false for undefined year', async () => {
  const { isYearLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  const result = await isYearLocked(pool, undefined);
  assert.strictEqual(result, false);
});

test('isYearLocked should return true for locked year', async () => {
  const { isYearLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  const result = await isYearLocked(pool, 2024);
  assert.strictEqual(result, true);
});

test('isYearLocked should return false for unlocked year', async () => {
  const { isYearLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(false);

  const result = await isYearLocked(pool, 2024);
  assert.strictEqual(result, false);
});

// =============================================================================
// isMainListLocked tests
// =============================================================================

test('isMainListLocked should return false for null year', async () => {
  const { isMainListLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  const result = await isMainListLocked(pool, null, true);
  assert.strictEqual(result, false);
});

test('isMainListLocked should return false for non-main list', async () => {
  const { isMainListLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  // Even if year is locked, non-main lists should not be locked
  const result = await isMainListLocked(pool, 2024, false);
  assert.strictEqual(result, false);
});

test('isMainListLocked should return true for main list in locked year', async () => {
  const { isMainListLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  const result = await isMainListLocked(pool, 2024, true);
  assert.strictEqual(result, true);
});

test('isMainListLocked should return false for main list in unlocked year', async () => {
  const { isMainListLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(false);

  const result = await isMainListLocked(pool, 2024, true);
  assert.strictEqual(result, false);
});

test('isMainListLocked should return false for undefined isMain', async () => {
  const { isMainListLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  const result = await isMainListLocked(pool, 2024, undefined);
  assert.strictEqual(result, false);
});

// =============================================================================
// validateYearNotLocked tests
// =============================================================================

test('validateYearNotLocked should not throw for null year', async () => {
  const { validateYearNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  // Should not throw
  await validateYearNotLocked(pool, null, 'test operation');
});

test('validateYearNotLocked should throw for locked year', async () => {
  const { validateYearNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  await assert.rejects(
    async () => {
      await validateYearNotLocked(pool, 2024, 'test operation');
    },
    (err) => {
      assert.ok(err.message.includes('locked'));
      assert.ok(err.message.includes('2024'));
      return true;
    }
  );
});

test('validateYearNotLocked should not throw for unlocked year', async () => {
  const { validateYearNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(false);

  // Should not throw
  await validateYearNotLocked(pool, 2024, 'test operation');
});

// =============================================================================
// validateMainListNotLocked tests
// =============================================================================

test('validateMainListNotLocked should not throw for null year', async () => {
  const { validateMainListNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  // Should not throw even if isMain is true
  await validateMainListNotLocked(pool, null, true, 'test operation');
});

test('validateMainListNotLocked should not throw for non-main list', async () => {
  const { validateMainListNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  // Should not throw even if year is locked
  await validateMainListNotLocked(pool, 2024, false, 'test operation');
});

test('validateMainListNotLocked should throw for main list in locked year', async () => {
  const { validateMainListNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  await assert.rejects(
    async () => {
      await validateMainListNotLocked(pool, 2024, true, 'test operation');
    },
    (err) => {
      assert.ok(err.message.includes('locked'));
      assert.ok(err.message.includes('2024'));
      return true;
    }
  );
});

test('validateMainListNotLocked should not throw for main list in unlocked year', async () => {
  const { validateMainListNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(false);

  // Should not throw
  await validateMainListNotLocked(pool, 2024, true, 'test operation');
});

// =============================================================================
// Edge cases
// =============================================================================

test('validateMainListNotLocked should not throw for undefined isMain', async () => {
  const { validateMainListNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  // Should not throw for undefined isMain (treated as non-main)
  await validateMainListNotLocked(pool, 2024, undefined, 'test operation');
});

test('validateMainListNotLocked should not throw for isMain=0', async () => {
  const { validateMainListNotLocked } = require('../utils/year-lock.js');
  const pool = createMockPool(true);

  // Should not throw for falsy isMain
  await validateMainListNotLocked(pool, 2024, 0, 'test operation');
});
