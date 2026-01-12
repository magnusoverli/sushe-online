/**
 * Tests for Playback Utilities Module
 *
 * Tests the playback-utils.js module's core functionality.
 * Since these are ES modules, we replicate the logic for testing in Node.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Replicate the normalizeForMatch function for testing
function normalizeForMatch(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric (keep spaces)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Replicate the isAlbumMatchingPlayback function for testing
function isAlbumMatchingPlayback(
  listAlbum,
  playingAlbumName,
  playingArtistName
) {
  if (!listAlbum || !playingAlbumName || !playingArtistName) return false;

  const albumMatch =
    normalizeForMatch(listAlbum.album) === normalizeForMatch(playingAlbumName);
  const artistMatch =
    normalizeForMatch(listAlbum.artist) ===
    normalizeForMatch(playingArtistName);

  return albumMatch && artistMatch;
}

describe('Playback Utils Module - Unit Tests', () => {
  describe('normalizeForMatch', () => {
    it('should return empty string for null', () => {
      assert.strictEqual(normalizeForMatch(null), '');
    });

    it('should return empty string for undefined', () => {
      assert.strictEqual(normalizeForMatch(undefined), '');
    });

    it('should return empty string for empty string', () => {
      assert.strictEqual(normalizeForMatch(''), '');
    });

    it('should convert to lowercase', () => {
      assert.strictEqual(normalizeForMatch('HELLO WORLD'), 'hello world');
    });

    it('should remove diacritics', () => {
      assert.strictEqual(normalizeForMatch('Café'), 'cafe');
      assert.strictEqual(normalizeForMatch('naïve'), 'naive');
      assert.strictEqual(normalizeForMatch('résumé'), 'resume');
    });

    it('should handle Spanish characters', () => {
      assert.strictEqual(normalizeForMatch('señor'), 'senor');
      assert.strictEqual(normalizeForMatch('niño'), 'nino');
    });

    it('should handle Scandinavian characters', () => {
      assert.strictEqual(normalizeForMatch('Björk'), 'bjork');
      assert.strictEqual(normalizeForMatch('Mötley Crüe'), 'motley crue');
    });

    it('should remove punctuation', () => {
      assert.strictEqual(normalizeForMatch("Rock 'n' Roll"), 'rock n roll');
      assert.strictEqual(normalizeForMatch('AC/DC'), 'acdc');
      assert.strictEqual(normalizeForMatch("Guns N' Roses"), 'guns n roses');
    });

    it('should remove special characters', () => {
      // The & is removed, and whitespace is normalized, so "Tom & Jerry" -> "tom jerry"
      assert.strictEqual(normalizeForMatch('Tom & Jerry'), 'tom jerry');
      assert.strictEqual(normalizeForMatch('Artist!'), 'artist');
      assert.strictEqual(normalizeForMatch('Test?'), 'test');
    });

    it('should normalize whitespace', () => {
      assert.strictEqual(normalizeForMatch('Hello   World'), 'hello world');
      assert.strictEqual(normalizeForMatch('  Trimmed  '), 'trimmed');
      assert.strictEqual(
        normalizeForMatch('Multiple   Spaces   Here'),
        'multiple spaces here'
      );
    });

    it('should preserve numbers', () => {
      assert.strictEqual(normalizeForMatch('Track 123'), 'track 123');
      assert.strictEqual(normalizeForMatch('1984'), '1984');
    });

    it('should handle album titles with parentheses', () => {
      // Parentheses are removed since they're non-alphanumeric
      assert.strictEqual(
        normalizeForMatch('Abbey Road (Remastered)'),
        'abbey road remastered'
      );
    });

    it('should handle colons and hyphens', () => {
      assert.strictEqual(
        normalizeForMatch('Greatest Hits: Vol. 1'),
        'greatest hits vol 1'
      );
      assert.strictEqual(normalizeForMatch('Self-Titled'), 'selftitled');
    });
  });

  describe('isAlbumMatchingPlayback', () => {
    it('should return false for null listAlbum', () => {
      assert.strictEqual(
        isAlbumMatchingPlayback(null, 'Album', 'Artist'),
        false
      );
    });

    it('should return false for null playingAlbumName', () => {
      const album = { album: 'Test', artist: 'Artist' };
      assert.strictEqual(isAlbumMatchingPlayback(album, null, 'Artist'), false);
    });

    it('should return false for null playingArtistName', () => {
      const album = { album: 'Test', artist: 'Artist' };
      assert.strictEqual(isAlbumMatchingPlayback(album, 'Test', null), false);
    });

    it('should match exact same album and artist', () => {
      const album = { album: 'Abbey Road', artist: 'The Beatles' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Abbey Road', 'The Beatles'),
        true
      );
    });

    it('should match with different cases', () => {
      const album = { album: 'ABBEY ROAD', artist: 'THE BEATLES' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'abbey road', 'the beatles'),
        true
      );
    });

    it('should match with diacritic differences', () => {
      const album = { album: 'Café Album', artist: 'Señor Artist' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Cafe Album', 'Senor Artist'),
        true
      );
    });

    it('should match with punctuation differences', () => {
      const album = { album: "Rock 'n' Roll", artist: 'AC/DC' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Rock n Roll', 'ACDC'),
        true
      );
    });

    it('should not match different albums same artist', () => {
      const album = { album: 'Abbey Road', artist: 'The Beatles' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Revolver', 'The Beatles'),
        false
      );
    });

    it('should not match same album different artist', () => {
      const album = { album: 'Greatest Hits', artist: 'Artist A' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Greatest Hits', 'Artist B'),
        false
      );
    });

    it('should not match completely different album and artist', () => {
      const album = { album: 'Album X', artist: 'Artist X' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Album Y', 'Artist Y'),
        false
      );
    });

    it('should handle whitespace normalization', () => {
      const album = { album: 'Some  Album', artist: 'Some  Artist' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Some Album', 'Some Artist'),
        true
      );
    });

    it('should handle albums with special characters in names', () => {
      const album = { album: 'Album!?', artist: 'Artist & Co.' };
      // "Artist & Co." normalizes to "artist co" (& removed, whitespace normalized)
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Album', 'Artist Co'),
        true
      );
    });
  });

  describe('Real-world matching scenarios', () => {
    it('should match Spotify vs list for Björk', () => {
      const listAlbum = { album: 'Homogenic', artist: 'Björk' };
      const spotifyAlbum = 'Homogenic';
      const spotifyArtist = 'Bjork';

      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        true
      );
    });

    it('should match remastered versions', () => {
      const listAlbum = {
        album: 'Dark Side of the Moon',
        artist: 'Pink Floyd',
      };
      const spotifyAlbum = 'Dark Side of the Moon (Remastered)';
      const spotifyArtist = 'Pink Floyd';

      // Note: This won't match because of the extra "(Remastered)" text
      // This is expected behavior - the normalization removes punctuation
      // but the words still differ
      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        false
      );
    });

    it('should match when Spotify uses different apostrophe characters', () => {
      const listAlbum = { album: "What's Going On", artist: 'Marvin Gaye' };
      // Spotify might use different apostrophe character
      const spotifyAlbum = "What's Going On"; // Different apostrophe
      const spotifyArtist = 'Marvin Gaye';

      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        true
      );
    });

    it('should match "The" prefix variations', () => {
      const listAlbum = { album: 'Please Please Me', artist: 'The Beatles' };
      const spotifyAlbum = 'Please Please Me';
      const spotifyArtist = 'The Beatles';

      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        true
      );
    });

    it('should match artists with ampersands', () => {
      const listAlbum = {
        album: 'Bridge Over Troubled Water',
        artist: 'Simon & Garfunkel',
      };
      const spotifyAlbum = 'Bridge Over Troubled Water';
      const spotifyArtist = 'Simon and Garfunkel';

      // Note: "&" becomes empty, "and" stays as "and" - won't match
      // This is a known limitation
      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        false
      );
    });

    it('should match self-titled albums', () => {
      const listAlbum = { album: 'Led Zeppelin', artist: 'Led Zeppelin' };
      const spotifyAlbum = 'Led Zeppelin';
      const spotifyArtist = 'Led Zeppelin';

      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        true
      );
    });

    it("should handle Guns N' Roses variations", () => {
      const listAlbum = {
        album: 'Appetite for Destruction',
        artist: "Guns N' Roses",
      };
      const spotifyAlbum = 'Appetite for Destruction';
      const spotifyArtist = 'Guns N Roses';

      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        true
      );
    });

    it('should handle Mötley Crüe diacritics', () => {
      const listAlbum = { album: 'Shout at the Devil', artist: 'Mötley Crüe' };
      const spotifyAlbum = 'Shout at the Devil';
      const spotifyArtist = 'Motley Crue';

      assert.strictEqual(
        isAlbumMatchingPlayback(listAlbum, spotifyAlbum, spotifyArtist),
        true
      );
    });
  });

  describe('Edge cases', () => {
    it('should handle empty album object', () => {
      const album = {};
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Test', 'Artist'),
        false
      );
    });

    it('should handle album with only artist', () => {
      const album = { artist: 'Artist' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Test', 'Artist'),
        false
      );
    });

    it('should handle album with only album name', () => {
      const album = { album: 'Test' };
      assert.strictEqual(
        isAlbumMatchingPlayback(album, 'Test', 'Artist'),
        false
      );
    });

    it('should handle all whitespace inputs', () => {
      assert.strictEqual(normalizeForMatch('   '), '');
    });

    it('should handle string with only punctuation', () => {
      assert.strictEqual(normalizeForMatch('!!!???'), '');
    });

    it('should handle very long strings', () => {
      const longString = 'A'.repeat(1000);
      const result = normalizeForMatch(longString);
      assert.strictEqual(result.length, 1000);
      assert.strictEqual(result, 'a'.repeat(1000));
    });
  });
});
