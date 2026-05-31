const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('availability-badges', () => {
  let renderAvailabilityBadges;

  beforeEach(async () => {
    ({ renderAvailabilityBadges } =
      await import('../src/js/modules/album-display/availability-badges.js'));
  });

  it('returns empty when there is nothing to show', () => {
    assert.strictEqual(renderAvailabilityBadges([]), '');
    assert.strictEqual(renderAvailabilityBadges(null), '');
    assert.strictEqual(renderAvailabilityBadges(undefined), '');
  });

  it('renders known platforms in priority order (spotify before qobuz)', () => {
    const html = renderAvailabilityBadges(['qobuz', 'spotify']);
    assert.ok(html.includes('album-availability'));
    assert.ok(html.includes('fa-spotify'));
    assert.ok(html.indexOf('Spotify') < html.indexOf('Qobuz'));
  });

  it('renders only the defined availability platforms', () => {
    const all = [
      'spotify',
      'itunes',
      'qobuz',
      'tidal',
      'bandcamp',
      'soundcloud',
      'amazon_music',
    ];
    const html = renderAvailabilityBadges(all);
    const count = (html.match(/availability-badge"/g) || []).length;
    assert.strictEqual(count, 5);
    assert.ok(!html.includes('SoundCloud'));
    assert.ok(!html.includes('Amazon Music'));
  });

  it('ignores unmapped services', () => {
    assert.strictEqual(renderAvailabilityBadges(['pandora', 'napster']), '');
  });

  it('renders an initial letter for platforms without a brand icon', () => {
    const html = renderAvailabilityBadges(['tidal']);
    assert.ok(html.includes('availability-badge-letter'));
    assert.ok(html.includes('>T<'));
  });

  it('adds the mobile modifier class for the mobile variant only', () => {
    const desktop = renderAvailabilityBadges(['spotify']);
    assert.ok(desktop.includes('class="album-availability"'));
    assert.ok(!desktop.includes('album-availability--mobile'));

    const mobile = renderAvailabilityBadges(['spotify'], { variant: 'mobile' });
    assert.ok(mobile.includes('album-availability--mobile'));
    assert.ok(mobile.includes('fa-spotify'));
  });
});
