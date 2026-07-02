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
