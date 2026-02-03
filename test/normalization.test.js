/**
 * Tests for Normalization Utilities
 *
 * Tests the shared normalization functions used for matching
 * artists, albums, and genres across different data sources.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeForStorage,
  normalizeForLookup,
  normalizeForExternalApi,
  normalizeArtistName,
  normalizeAlbumName,
  normalizeGenre,
  normalizeForMatch,
  artistNamesMatch,
  albumNamesMatch,
  findArtistInMap,
  stringSimilarity,
} = require('../utils/normalization');

test('Normalization Utilities', async (t) => {
  // ============================================
  // Storage and Lookup Normalization Tests
  // ============================================

  await t.test('sanitizeForStorage', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(sanitizeForStorage(null), '');
      assert.strictEqual(sanitizeForStorage(undefined), '');
      assert.strictEqual(sanitizeForStorage(''), '');
    });

    await t.test('should trim whitespace', () => {
      assert.strictEqual(sanitizeForStorage('  Metallica  '), 'Metallica');
    });

    await t.test('should convert ellipsis to three periods', () => {
      assert.strictEqual(sanitizeForStorage('…and Oceans'), '...and Oceans');
    });

    await t.test('should convert en-dash and em-dash to hyphen', () => {
      assert.strictEqual(sanitizeForStorage('Black – Metal'), 'Black - Metal');
      assert.strictEqual(sanitizeForStorage('Black — Metal'), 'Black - Metal');
    });

    await t.test('should normalize smart quotes to straight quotes', () => {
      assert.strictEqual(sanitizeForStorage("Rock 'n' Roll"), "Rock 'n' Roll");
      assert.strictEqual(
        sanitizeForStorage('Rock "Live" Album'),
        'Rock "Live" Album'
      );
    });

    await t.test('should PRESERVE diacritics (for display purposes)', () => {
      // This is intentional - diacritics are preserved for display
      assert.strictEqual(sanitizeForStorage('Mötley Crüe'), 'Mötley Crüe');
      assert.strictEqual(sanitizeForStorage('Björk'), 'Björk');
      assert.strictEqual(sanitizeForStorage('Exxûl'), 'Exxûl');
    });

    await t.test('should normalize multiple spaces to single space', () => {
      assert.strictEqual(sanitizeForStorage('Pink   Floyd'), 'Pink Floyd');
    });
  });

  await t.test('normalizeForLookup', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(normalizeForLookup(null), '');
      assert.strictEqual(normalizeForLookup(undefined), '');
      assert.strictEqual(normalizeForLookup(''), '');
    });

    await t.test('should lowercase and sanitize', () => {
      assert.strictEqual(normalizeForLookup('  METALLICA  '), 'metallica');
    });

    await t.test('should convert ellipsis and lowercase', () => {
      assert.strictEqual(normalizeForLookup('…and Oceans'), '...and oceans');
    });

    await t.test('should PRESERVE diacritics but lowercase', () => {
      // Diacritics preserved for database unique constraint matching
      assert.strictEqual(normalizeForLookup('Exxûl'), 'exxûl');
      assert.strictEqual(normalizeForLookup('Mötley Crüe'), 'mötley crüe');
    });
  });

  await t.test('normalizeForExternalApi', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(normalizeForExternalApi(null), '');
      assert.strictEqual(normalizeForExternalApi(undefined), '');
      assert.strictEqual(normalizeForExternalApi(''), '');
    });

    await t.test('should STRIP diacritics for external API matching', () => {
      // This is the key function for Last.fm, Spotify, iTunes matching
      assert.strictEqual(normalizeForExternalApi('Exxûl'), 'Exxul');
      assert.strictEqual(normalizeForExternalApi('Mötley Crüe'), 'Motley Crue');
      assert.strictEqual(normalizeForExternalApi('Björk'), 'Bjork');
      assert.strictEqual(normalizeForExternalApi('Sigur Rós'), 'Sigur Ros');
    });

    await t.test('should convert ellipsis to three periods', () => {
      assert.strictEqual(
        normalizeForExternalApi('…and Oceans'),
        '...and Oceans'
      );
    });

    await t.test('should normalize smart quotes', () => {
      assert.strictEqual(
        normalizeForExternalApi("Rock 'n' Roll"),
        "Rock 'n' Roll"
      );
    });

    await t.test('should convert en-dash and em-dash to hyphen', () => {
      assert.strictEqual(
        normalizeForExternalApi('Black – Metal'),
        'Black - Metal'
      );
      assert.strictEqual(
        normalizeForExternalApi('Black — Metal'),
        'Black - Metal'
      );
    });

    await t.test('should normalize whitespace', () => {
      assert.strictEqual(
        normalizeForExternalApi('  Pink   Floyd  '),
        'Pink Floyd'
      );
    });

    await t.test(
      'should preserve original case (for display in API calls)',
      () => {
        // Unlike normalizeForLookup, this preserves case
        assert.strictEqual(normalizeForExternalApi('METALLICA'), 'METALLICA');
        assert.strictEqual(normalizeForExternalApi('Metallica'), 'Metallica');
      }
    );

    await t.test('should handle complex Unicode characters', () => {
      // Various diacritics from different languages
      assert.strictEqual(normalizeForExternalApi('Ásgeir'), 'Asgeir');
      assert.strictEqual(normalizeForExternalApi('Naïve'), 'Naive');
      assert.strictEqual(normalizeForExternalApi('Café'), 'Cafe');
      assert.strictEqual(normalizeForExternalApi('Über'), 'Uber');
    });

    await t.test('should handle Japanese/non-Latin scripts gracefully', () => {
      // Non-Latin scripts are preserved (diacritic stripping only affects combining marks)
      // Note: whitespace may be normalized but characters are preserved
      const result = normalizeForExternalApi('マキシマム ザ ホルモン');
      assert.ok(
        result.includes('マキシマム'),
        'Japanese characters should be preserved'
      );
      assert.ok(
        result.includes('ホルモン'),
        'Japanese characters should be preserved'
      );
    });
  });

  // ============================================
  // Artist/Album Name Normalization Tests
  // ============================================

  await t.test('normalizeArtistName', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(normalizeArtistName(null), '');
      assert.strictEqual(normalizeArtistName(undefined), '');
      assert.strictEqual(normalizeArtistName(''), '');
    });

    await t.test('should convert to lowercase and trim', () => {
      assert.strictEqual(normalizeArtistName('  METALLICA  '), 'metallica');
    });

    await t.test('should remove "The " prefix at start only', () => {
      // Only removes "The " at the beginning, not within the title
      assert.strictEqual(
        normalizeAlbumName('The Dark Side of the Moon'),
        'dark side of the moon'
      );
    });

    await t.test('should handle ellipsis in names', () => {
      // Ellipsis is converted to periods, which are then stripped as punctuation
      // The important thing is consistent normalization across sources
      const result = normalizeArtistName('…and Oceans');
      assert.strictEqual(result, 'and oceans');
    });

    await t.test('should remove parenthetical content', () => {
      assert.strictEqual(normalizeArtistName('Nirvana (band)'), 'nirvana');
      assert.strictEqual(normalizeArtistName('Queen (UK)'), 'queen');
    });

    await t.test('should remove bracketed content', () => {
      assert.strictEqual(normalizeArtistName('Nirvana [US]'), 'nirvana');
    });

    await t.test('should normalize quotes', () => {
      assert.strictEqual(
        normalizeArtistName("Guns N' Roses"),
        normalizeArtistName("Guns N' Roses")
      );
    });

    await t.test('should remove diacritics', () => {
      assert.strictEqual(normalizeArtistName('Björk'), 'bjork');
      assert.strictEqual(normalizeArtistName('Motörhead'), 'motorhead');
      assert.strictEqual(normalizeArtistName('Sigur Rós'), 'sigur ros');
    });

    await t.test('should remove punctuation', () => {
      assert.strictEqual(normalizeArtistName('AC/DC'), 'ac/dc');
      assert.strictEqual(
        normalizeArtistName('Godspeed You! Black Emperor'),
        'godspeed you black emperor'
      );
    });

    await t.test('should normalize whitespace', () => {
      assert.strictEqual(normalizeArtistName('Pink   Floyd'), 'pink floyd');
    });
  });

  await t.test('normalizeAlbumName', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(normalizeAlbumName(null), '');
      assert.strictEqual(normalizeAlbumName(undefined), '');
      assert.strictEqual(normalizeAlbumName(''), '');
    });

    await t.test('should remove "The " prefix at start', () => {
      // Note: Only removes "The " at the beginning, keeps "the" in the middle
      assert.strictEqual(
        normalizeAlbumName('The Dark Side of the Moon'),
        'dark side of the moon'
      );
    });

    await t.test('should remove edition suffixes', () => {
      assert.strictEqual(
        normalizeAlbumName('Abbey Road (Deluxe Edition)'),
        'abbey road'
      );
      assert.strictEqual(
        normalizeAlbumName('OK Computer [Remastered]'),
        'ok computer'
      );
    });

    await t.test('should handle album names with special characters', () => {
      assert.strictEqual(normalizeAlbumName('Mötley Crüe'), 'motley crue');
    });
  });

  await t.test('normalizeGenre', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(normalizeGenre(null), '');
      assert.strictEqual(normalizeGenre(undefined), '');
      assert.strictEqual(normalizeGenre(''), '');
    });

    await t.test('should convert to lowercase', () => {
      assert.strictEqual(normalizeGenre('ROCK'), 'rock');
    });

    await t.test('should normalize hyphens and underscores to spaces', () => {
      assert.strictEqual(normalizeGenre('post-punk'), 'post punk');
      assert.strictEqual(normalizeGenre('death_metal'), 'death metal');
    });

    await t.test('should normalize whitespace', () => {
      assert.strictEqual(normalizeGenre('hip  hop'), 'hip hop');
    });
  });

  await t.test('normalizeForMatch', async (t) => {
    await t.test('should return empty string for null/undefined input', () => {
      assert.strictEqual(normalizeForMatch(null), '');
      assert.strictEqual(normalizeForMatch(undefined), '');
      assert.strictEqual(normalizeForMatch(''), '');
    });

    await t.test('should remove special characters', () => {
      assert.strictEqual(normalizeForMatch('AC/DC'), 'acdc');
      assert.strictEqual(normalizeForMatch("Rock 'n' Roll"), 'rock n roll');
    });

    await t.test('should normalize whitespace', () => {
      assert.strictEqual(normalizeForMatch('  hello   world  '), 'hello world');
    });
  });

  await t.test('artistNamesMatch', async (t) => {
    await t.test('should match identical names', () => {
      assert.strictEqual(artistNamesMatch('Metallica', 'Metallica'), true);
    });

    await t.test('should match case-insensitively', () => {
      assert.strictEqual(artistNamesMatch('METALLICA', 'metallica'), true);
    });

    await t.test('should match with/without "The" prefix', () => {
      assert.strictEqual(artistNamesMatch('The Beatles', 'Beatles'), true);
    });

    await t.test('should not match different artists', () => {
      assert.strictEqual(artistNamesMatch('Metallica', 'Megadeth'), false);
    });

    await t.test('should handle null inputs', () => {
      assert.strictEqual(artistNamesMatch(null, 'Beatles'), false);
      assert.strictEqual(artistNamesMatch('Beatles', null), false);
      assert.strictEqual(artistNamesMatch(null, null), true); // both normalize to ''
    });
  });

  await t.test('albumNamesMatch', async (t) => {
    await t.test('should match identical names', () => {
      assert.strictEqual(albumNamesMatch('Abbey Road', 'Abbey Road'), true);
    });

    await t.test('should match with different editions', () => {
      assert.strictEqual(
        albumNamesMatch('Abbey Road', 'Abbey Road (Deluxe Edition)'),
        true
      );
    });

    await t.test('should not match different albums', () => {
      assert.strictEqual(albumNamesMatch('Abbey Road', 'Let It Be'), false);
    });
  });

  await t.test('findArtistInMap', async (t) => {
    await t.test('should find artist by normalized name', () => {
      const map = new Map();
      map.set('beatles', { id: 1, name: 'The Beatles' });

      const result = findArtistInMap(map, 'The Beatles');
      assert.deepStrictEqual(result, { id: 1, name: 'The Beatles' });
    });

    await t.test('should return undefined for non-existent artist', () => {
      const map = new Map();
      map.set('beatles', { id: 1, name: 'The Beatles' });

      const result = findArtistInMap(map, 'Pink Floyd');
      assert.strictEqual(result, undefined);
    });
  });

  await t.test('stringSimilarity', async (t) => {
    await t.test('should return 1 for identical strings', () => {
      assert.strictEqual(stringSimilarity('hello', 'hello'), 1);
    });

    await t.test(
      'should return 1 for strings that normalize identically',
      () => {
        assert.strictEqual(stringSimilarity('Hello', 'HELLO'), 1);
      }
    );

    await t.test('should return 0 for empty strings', () => {
      assert.strictEqual(stringSimilarity('', 'hello'), 0);
      assert.strictEqual(stringSimilarity('hello', ''), 0);
      assert.strictEqual(stringSimilarity(null, 'hello'), 0);
    });

    await t.test('should return 0.9 when one contains the other', () => {
      assert.strictEqual(stringSimilarity('Abbey Road', 'Abbey'), 0.9);
      assert.strictEqual(stringSimilarity('Abbey', 'Abbey Road'), 0.9);
    });

    await t.test('should return partial score for word overlap', () => {
      const score = stringSimilarity('Dark Side', 'Side of Moon');
      assert.ok(score > 0 && score < 1, 'Score should be between 0 and 1');
    });

    await t.test('should return 0 for completely different strings', () => {
      assert.strictEqual(stringSimilarity('xyz', 'abc'), 0);
    });
  });
});
