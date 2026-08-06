const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Regression guard for the mobile album-action sheet XSS (MARKUP-7): album and
// artist are interpolated into an innerHTML string, so they must be escaped.
describe('buildAlbumActionMenuHtml — escaping', () => {
  let buildAlbumActionMenuHtml;

  beforeEach(async () => {
    const mod =
      await import('../src/js/modules/mobile-ui/album-actions-menu-template.js');
    buildAlbumActionMenuHtml = mod.buildAlbumActionMenuHtml;
  });

  const baseArgs = {
    hasAnyService: false,
    showSpotifyConnect: false,
    primaryServiceName: 'Spotify',
    showRecommend: false,
    hasLastfm: false,
  };

  it('escapes a script-injection album title and artist', () => {
    const html = buildAlbumActionMenuHtml({
      ...baseArgs,
      album: { album: '<script>alert(1)</script>', artist: 'A & B' },
    });
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('A &amp; B'));
    assert.ok(!html.includes('<script>alert(1)</script>'));
  });

  it('leaves an ordinary album title intact', () => {
    const html = buildAlbumActionMenuHtml({
      ...baseArgs,
      album: { album: 'Abbey Road', artist: 'The Beatles' },
    });
    assert.ok(html.includes('Abbey Road'));
    assert.ok(html.includes('The Beatles'));
  });
});

// Regenerating a summary spends API credit, so the entry is admin-only. The
// mobile sheet gates by interpolation, not by a post-render .hidden toggle —
// a non-admin's markup must not contain the button at all.
describe('buildAlbumActionMenuHtml — admin gating', () => {
  let buildAlbumActionMenuHtml;

  beforeEach(async () => {
    const mod =
      await import('../src/js/modules/mobile-ui/album-actions-menu-template.js');
    buildAlbumActionMenuHtml = mod.buildAlbumActionMenuHtml;
  });

  const args = {
    album: { album: 'Reign in Blood', artist: 'Slayer' },
    hasAnyService: false,
    showSpotifyConnect: false,
    primaryServiceName: '',
    showRecommend: false,
    hasLastfm: false,
  };

  it('offers regenerate-summary to an admin', () => {
    const html = buildAlbumActionMenuHtml({ ...args, isAdmin: true });
    assert.ok(html.includes('data-action="regenerate-summary"'));
  });

  it('withholds it from a non-admin', () => {
    const html = buildAlbumActionMenuHtml({ ...args, isAdmin: false });
    assert.ok(!html.includes('regenerate-summary'));
  });

  it('defaults to withholding it when the flag is omitted', () => {
    const html = buildAlbumActionMenuHtml(args);
    assert.ok(!html.includes('regenerate-summary'));
  });
});
