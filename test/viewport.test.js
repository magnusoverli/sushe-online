const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('viewport helper', () => {
  let isMobileViewport, onViewportChange, MOBILE_MAX_WIDTH_PX;

  beforeEach(async () => {
    const mod = await import('../src/js/utils/viewport.js');
    isMobileViewport = mod.isMobileViewport;
    onViewportChange = mod.onViewportChange;
    MOBILE_MAX_WIDTH_PX = mod.MOBILE_MAX_WIDTH_PX;
  });

  it('uses 1023 as the max mobile width (integer-equivalent to the old < 1024)', () => {
    assert.strictEqual(MOBILE_MAX_WIDTH_PX, 1023);
  });

  it('treats <=1023 as mobile and >=1024 as desktop via innerWidth', () => {
    assert.strictEqual(isMobileViewport({ innerWidth: 1023 }), true);
    assert.strictEqual(isMobileViewport({ innerWidth: 1024 }), false);
    assert.strictEqual(isMobileViewport({ innerWidth: 390 }), true);
    assert.strictEqual(isMobileViewport({ innerWidth: 1280 }), false);
  });

  it('prefers matchMedia over innerWidth when both are present', () => {
    assert.strictEqual(
      isMobileViewport({
        innerWidth: 1280,
        matchMedia: () => ({ matches: true }),
      }),
      true
    );
    assert.strictEqual(
      isMobileViewport({
        innerWidth: 390,
        matchMedia: () => ({ matches: false }),
      }),
      false
    );
  });

  it('returns false when no window is available', () => {
    assert.strictEqual(isMobileViewport(null), false);
  });

  it('onViewportChange returns an unsubscribe function even without matchMedia', () => {
    // In node there is no global window/matchMedia, so mobileMediaQuery is null.
    const off = onViewportChange(() => {});
    assert.strictEqual(typeof off, 'function');
    off();
  });
});
