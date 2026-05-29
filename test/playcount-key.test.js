/**
 * Tests for the shared canonical playcount cache key.
 *
 * Locks the invariant that the read path (list view / scrobble lookup) and the
 * write path (sync upsert) compose the SAME key — including for accented names,
 * which is the exact divergence that previously made playcounts vanish.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { canonicalAlbumKey } = require('../utils/playcount-key');
const { normalizeAlbumKey } = require('../utils/fuzzy-match');

describe('canonicalAlbumKey', () => {
  it('produces a stable key for an accented artist/album', () => {
    const key = canonicalAlbumKey(normalizeAlbumKey, 'Sigur Rós', '( )');
    // Diacritics are stripped before the album key is built.
    assert.ok(key.includes('sigur ros'));
  });

  it('matches regardless of diacritics / casing on the inputs', () => {
    const accented = canonicalAlbumKey(
      normalizeAlbumKey,
      'Mötley Crüe',
      'Dr. Feelgood'
    );
    const ascii = canonicalAlbumKey(
      normalizeAlbumKey,
      'MOTLEY CRUE',
      'Dr Feelgood'
    );
    // Combining diacritics (ö→o, ü→u) are stripped on both sides, so the keys
    // must be identical. This only holds if both paths share one normalizer.
    assert.strictEqual(accented, ascii);
  });

  it('is idempotent when fed an already-canonical value', () => {
    const once = canonicalAlbumKey(
      normalizeAlbumKey,
      'Marianas Rest',
      'The Bereaved'
    );
    const [artist, album] = once.split('::');
    // Re-feeding the normalized halves yields the same key (read path may
    // re-key already-stored canonical rows).
    const twice = canonicalAlbumKey(normalizeAlbumKey, artist, album);
    assert.strictEqual(once, twice);
  });
});
