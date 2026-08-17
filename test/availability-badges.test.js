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

  it('renders all seven platforms in stable priority order', () => {
    const html = renderAvailabilityBadges([
      'youtube',
      'soundcloud',
      'bandcamp',
      'tidal',
      'qobuz',
      'itunes',
      'spotify',
    ]);
    assert.ok(html.includes('album-availability'));
    assert.ok(html.includes('fa-spotify'));
    assert.ok(html.includes('fa-soundcloud'));
    assert.ok(html.includes('fa-youtube'));
    const labels = [
      'Spotify',
      'iTunes',
      'Qobuz',
      'Tidal',
      'Bandcamp',
      'SoundCloud',
      'YouTube',
    ];
    labels.slice(1).forEach((label, index) => {
      assert.ok(html.indexOf(labels[index]) < html.indexOf(label));
    });
  });

  it('renders only the defined availability platforms', () => {
    const all = [
      'spotify',
      'itunes',
      'qobuz',
      'tidal',
      'bandcamp',
      'soundcloud',
      'youtube',
      'amazon_music',
    ];
    const html = renderAvailabilityBadges(all);
    const count = (html.match(/availability-badge"/g) || []).length;
    assert.strictEqual(count, 7);
    assert.ok(!html.includes('Amazon Music'));
  });

  it('links badges only to HTTPS URLs matching the declared provider', () => {
    const html = renderAvailabilityBadges(['spotify', 'youtube', 'qobuz'], {
      links: [
        {
          service: 'spotify',
          url: 'https://open.spotify.com/album/abc?a=1&b=2',
        },
        {
          service: 'youtube',
          url: 'https://youtube.com.evil.test/watch?v=abcdefghijk',
        },
        { service: 'qobuz', url: 'javascript:alert(1)' },
      ],
    });

    assert.match(
      html,
      /<a [^>]*href="https:\/\/open\.spotify\.com\/album\/abc\?a=1&amp;b=2"/
    );
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(html, /href="[^"]*(?:evil|javascript)/);
    assert.match(html, /<span [^>]*aria-label="YouTube"/);
    assert.match(html, /<span [^>]*aria-label="Qobuz"/);
  });

  it('does not let one provider URL make a different badge clickable', () => {
    const html = renderAvailabilityBadges(['spotify'], {
      links: [
        {
          service: 'spotify',
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
        },
      ],
    });

    assert.doesNotMatch(html, /<a /);
    assert.match(html, /<span [^>]*aria-label="Spotify"/);
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
