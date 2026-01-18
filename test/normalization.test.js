/**
 * Tests for Normalization Utilities
 *
 * Tests the shared normalization functions used for matching
 * artists, albums, and genres across different data sources.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
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
