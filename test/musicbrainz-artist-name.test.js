const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('musicbrainz artist name helpers', () => {
  let hasNonLatinCharacters;
  let formatArtistDisplayName;

  beforeEach(async () => {
    const module = await import('../src/js/modules/musicbrainz-artist-name.js');
    hasNonLatinCharacters = module.hasNonLatinCharacters;
    formatArtistDisplayName = module.formatArtistDisplayName;
  });

  it('detects non-latin-heavy strings', () => {
    assert.strictEqual(hasNonLatinCharacters('Mizmor'), false);
    assert.strictEqual(
      hasNonLatinCharacters('\u05de\u05d6\u05de\u05d5\u05e8'),
      true
    );
  });

  it('keeps latin names as primary display', () => {
    const result = formatArtistDisplayName({
      name: 'Radiohead',
      disambiguation: 'UK band',
    });

    assert.deepStrictEqual(result, {
      primary: 'Radiohead',
      secondary: 'UK band',
      original: 'Radiohead',
    });
  });

  it('uses extracted latin transliteration for non-latin names', () => {
    const result = formatArtistDisplayName({
      name: '\u05de\u05d6\u05de\u05d5\u05e8',
      'sort-name': 'Mizmor',
      disambiguation: '',
    });

    assert.deepStrictEqual(result, {
      primary: 'Mizmor',
      secondary: '\u05de\u05d6\u05de\u05d5\u05e8',
      original: '\u05de\u05d6\u05de\u05d5\u05e8',
    });
  });
});
