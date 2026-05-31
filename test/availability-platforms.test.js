const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  SUPPORTED_SERVICES,
  normalizeOdesliPlatform,
  normalizeMusicbrainzUrl,
} = require('../services/availability/platforms');

describe('availability/platforms', () => {
  it('allows identity + availability services', () => {
    for (const s of ['spotify', 'tidal', 'lastfm', 'itunes', 'qobuz']) {
      assert.ok(SUPPORTED_SERVICES.has(s), `${s} should be supported`);
    }
  });

  it('maps Odesli platform keys to canonical services', () => {
    assert.strictEqual(normalizeOdesliPlatform('itunes'), 'itunes');
    assert.strictEqual(normalizeOdesliPlatform('qobuz'), 'qobuz');
    assert.strictEqual(normalizeOdesliPlatform('tidal'), 'tidal');
    assert.strictEqual(normalizeOdesliPlatform('amazonMusic'), null);
    assert.strictEqual(normalizeOdesliPlatform('unknownThing'), null);
  });

  it('maps MusicBrainz hosts to canonical services (most-specific first)', () => {
    assert.strictEqual(
      normalizeMusicbrainzUrl('https://music.apple.com/us/album/1655432387'),
      'itunes'
    );
    assert.strictEqual(
      normalizeMusicbrainzUrl('https://itunes.apple.com/fr/album/id1679530462'),
      'itunes'
    );
    assert.strictEqual(
      normalizeMusicbrainzUrl('https://listen.tidal.com/album/288984589'),
      'tidal'
    );
    assert.strictEqual(
      normalizeMusicbrainzUrl('https://artist.bandcamp.com/album/x'),
      'bandcamp'
    );
    assert.strictEqual(
      normalizeMusicbrainzUrl('https://play.qobuz.com/album/x'),
      'qobuz'
    );
    assert.strictEqual(normalizeMusicbrainzUrl('not a url'), null);
    assert.strictEqual(normalizeMusicbrainzUrl('https://example.com/x'), null);
  });
});
