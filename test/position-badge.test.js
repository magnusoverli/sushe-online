const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// The mobile rank badge color contract must be identical for initial render and
// for the drag-reorder recolor (POS-1), so both import this one module.
describe('position-badge color contract', () => {
  let getPositionBadgeColor;

  beforeEach(async () => {
    const mod =
      await import('../src/js/modules/album-display/position-badge.js');
    getPositionBadgeColor = mod.getPositionBadgeColor;
  });

  it('returns gold/silver/bronze at 8px for ranks 1-3', () => {
    assert.deepStrictEqual(getPositionBadgeColor(1), {
      border: '#eab308',
      shadow: 'rgba(255,215,0,1.0)',
      size: '8px',
    });
    assert.strictEqual(getPositionBadgeColor(2).border, '#9ca3af');
    assert.strictEqual(getPositionBadgeColor(3).border, '#b45309');
    assert.strictEqual(getPositionBadgeColor(2).size, '8px');
  });

  it('falls back to gray at 5px for ranks beyond 3 and for nullish', () => {
    for (const p of [4, 99, null, undefined]) {
      assert.strictEqual(getPositionBadgeColor(p).border, '#6b7280');
      assert.strictEqual(getPositionBadgeColor(p).size, '5px');
    }
  });
});
