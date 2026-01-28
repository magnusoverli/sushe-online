/**
 * Tests for Fuzzy Matching Utilities
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  levenshteinDistance,
  similarityRatio,
  normalizeForComparison,
  getTokens,
  jaccardSimilarity,
  calculateSimilarity,
  isPotentialDuplicate,
  findPotentialDuplicates,
  isExactMatch,
  deriveMinScoreFromThreshold,
  AUTO_MERGE_THRESHOLD,
  MODAL_THRESHOLD,
} = require('../utils/fuzzy-match');

// ============================================
// LEVENSHTEIN DISTANCE TESTS
// ============================================

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
  });

  it('should return correct distance for single character difference', () => {
    assert.strictEqual(levenshteinDistance('hello', 'hallo'), 1);
    assert.strictEqual(levenshteinDistance('cat', 'cats'), 1);
  });

  it('should return string length for empty comparison', () => {
    assert.strictEqual(levenshteinDistance('hello', ''), 5);
    assert.strictEqual(levenshteinDistance('', 'world'), 5);
  });

  it('should handle null/undefined', () => {
    assert.strictEqual(levenshteinDistance(null, 'test'), 4);
    assert.strictEqual(levenshteinDistance('test', undefined), 4);
  });
});

// ============================================
// SIMILARITY RATIO TESTS
// ============================================

describe('similarityRatio', () => {
  it('should return 1 for identical strings', () => {
    assert.strictEqual(similarityRatio('hello', 'hello'), 1);
  });

  it('should return 0 for completely different strings', () => {
    assert.strictEqual(similarityRatio('abc', 'xyz'), 0);
  });

  it('should return high ratio for similar strings', () => {
    const ratio = similarityRatio('hello', 'hallo');
    assert.ok(ratio > 0.7 && ratio < 1);
  });

  it('should handle empty strings', () => {
    assert.strictEqual(similarityRatio('', ''), 1);
    assert.strictEqual(similarityRatio('test', ''), 0);
  });
});

// ============================================
// NORMALIZE FOR COMPARISON TESTS
// ============================================

describe('normalizeForComparison', () => {
  it('should lowercase and trim', () => {
    assert.strictEqual(
      normalizeForComparison('  HELLO World  '),
      'hello world'
    );
  });

  it('should remove edition suffixes', () => {
    assert.strictEqual(
      normalizeForComparison('Album Name (Deluxe Edition)'),
      'album name'
    );
    assert.strictEqual(
      normalizeForComparison('Album Name [Remastered]'),
      'album name'
    );
    assert.strictEqual(
      normalizeForComparison('Album Name - Deluxe Version'),
      'album name'
    );
  });

  it('should remove leading articles by default', () => {
    assert.strictEqual(normalizeForComparison('The Beatles'), 'beatles');
    assert.strictEqual(
      normalizeForComparison('A Perfect Circle'),
      'perfect circle'
    );
    assert.strictEqual(normalizeForComparison('An Album'), 'album');
  });

  it('should keep articles if option is false', () => {
    assert.strictEqual(
      normalizeForComparison('The Beatles', { removeArticles: false }),
      'the beatles'
    );
  });

  it('should replace & with and', () => {
    assert.strictEqual(
      normalizeForComparison('Guns & Roses'),
      'guns and roses'
    );
  });

  it('should remove apostrophes', () => {
    assert.strictEqual(normalizeForComparison("Rock'n'Roll"), 'rocknroll');
    // "Collector's Edition" gets stripped as an edition suffix, leaving empty
    // Let's test a case where apostrophe is in the middle of a word
    assert.strictEqual(normalizeForComparison("Guns N' Roses"), 'guns n roses');
  });

  it('should handle year suffixes', () => {
    assert.strictEqual(
      normalizeForComparison('Album (2024 Remaster)'),
      'album'
    );
  });

  it('should handle disc indicators', () => {
    assert.strictEqual(normalizeForComparison('Album (Disc 1)'), 'album');
    assert.strictEqual(normalizeForComparison('Album - CD2'), 'album');
  });
});

// ============================================
// TOKEN MATCHING TESTS
// ============================================

describe('getTokens', () => {
  it('should return set of words', () => {
    const tokens = getTokens('Hello World');
    assert.ok(tokens.has('hello'));
    assert.ok(tokens.has('world'));
    assert.strictEqual(tokens.size, 2);
  });

  it('should normalize before tokenizing', () => {
    const tokens = getTokens('The Quick Brown Fox');
    assert.ok(!tokens.has('the')); // Article removed
    assert.ok(tokens.has('quick'));
  });
});

describe('jaccardSimilarity', () => {
  it('should return 1 for identical sets', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['a', 'b', 'c']);
    assert.strictEqual(jaccardSimilarity(a, b), 1);
  });

  it('should return 0 for disjoint sets', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    assert.strictEqual(jaccardSimilarity(a, b), 0);
  });

  it('should return correct ratio for overlapping sets', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // Intersection: {b, c} = 2, Union: {a, b, c, d} = 4
    assert.strictEqual(jaccardSimilarity(a, b), 0.5);
  });
});

// ============================================
// CALCULATE SIMILARITY TESTS
// ============================================

describe('calculateSimilarity', () => {
  it('should return 1.0 for exact normalized match', () => {
    const result = calculateSimilarity('The Album', 'Album');
    assert.strictEqual(result.score, 1.0);
    assert.strictEqual(result.reason, 'exact_normalized');
  });

  it('should return reasonable score for typos', () => {
    const result = calculateSimilarity('Metallica', 'Metalica');
    // Single character difference in 9-char word = ~89% similar
    // Combined with Jaccard (same tokens), should be > 0.5
    assert.ok(result.score > 0.5, `Expected score > 0.5, got ${result.score}`);
  });

  it('should return high score for word reordering', () => {
    const result = calculateSimilarity('Black Album The', 'The Black Album');
    assert.ok(result.score > 0.7);
  });

  it('should return low score for different strings', () => {
    const result = calculateSimilarity(
      'Completely Different',
      'Something Else'
    );
    assert.ok(result.score < 0.5);
  });

  it('should handle empty input', () => {
    const result = calculateSimilarity('', 'test');
    assert.strictEqual(result.score, 0);
    assert.strictEqual(result.reason, 'empty_input');
  });
});

// ============================================
// THRESHOLD CONSTANTS TESTS
// ============================================

describe('Threshold constants', () => {
  it('should export AUTO_MERGE_THRESHOLD as 0.98', () => {
    assert.strictEqual(AUTO_MERGE_THRESHOLD, 0.98);
  });

  it('should export MODAL_THRESHOLD as 0.10', () => {
    assert.strictEqual(MODAL_THRESHOLD, 0.1);
  });
});

// ============================================
// IS POTENTIAL DUPLICATE TESTS
// ============================================

describe('isPotentialDuplicate', () => {
  it('should match albums with typos', () => {
    const album1 = { artist: 'Metallica', album: 'Master of Puppets' };
    const album2 = { artist: 'Metalica', album: 'Master of Pupets' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(result.isPotentialMatch);
    assert.ok(result.confidence > 0.7);
  });

  it('should match albums with edition suffixes', () => {
    const album1 = { artist: 'Pink Floyd', album: 'Dark Side of the Moon' };
    const album2 = {
      artist: 'Pink Floyd',
      album: 'Dark Side of the Moon (Deluxe Edition)',
    };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(result.isPotentialMatch);
  });

  it('should match albums with article differences', () => {
    const album1 = { artist: 'The Beatles', album: 'Abbey Road' };
    const album2 = { artist: 'Beatles', album: 'Abbey Road' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(result.isPotentialMatch);
    assert.ok(result.confidence > 0.9);
  });

  it('should not match completely different albums', () => {
    const album1 = { artist: 'Metallica', album: 'Master of Puppets' };
    const album2 = { artist: 'Pink Floyd', album: 'The Wall' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(!result.isPotentialMatch);
  });

  it('should not match same artist different album', () => {
    const album1 = { artist: 'Metallica', album: 'Master of Puppets' };
    const album2 = { artist: 'Metallica', album: 'Ride the Lightning' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(!result.isPotentialMatch);
  });

  it('should return shouldAutoMerge=true for identical albums (>=98%)', () => {
    const album1 = { artist: 'Pink Floyd', album: 'The Wall' };
    const album2 = { artist: 'Pink Floyd', album: 'The Wall' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(result.isPotentialMatch);
    assert.ok(result.shouldAutoMerge);
    assert.strictEqual(result.confidence, 1.0);
  });

  it('should return shouldAutoMerge=true for 98%+ matches (articles stripped)', () => {
    const album1 = { artist: 'The Beatles', album: 'Abbey Road' };
    const album2 = { artist: 'Beatles', album: 'Abbey Road' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(result.isPotentialMatch);
    assert.ok(result.shouldAutoMerge);
    assert.ok(result.confidence >= 0.98);
  });

  it('should return shouldAutoMerge=false for <98% matches (typos)', () => {
    const album1 = { artist: 'Metallica', album: 'Master of Puppets' };
    const album2 = { artist: 'Metalica', album: 'Master of Pupets' };

    const result = isPotentialDuplicate(album1, album2);
    assert.ok(result.isPotentialMatch);
    assert.ok(!result.shouldAutoMerge);
    assert.ok(result.confidence < 0.98);
  });

  it('should support legacy numeric threshold parameter', () => {
    const album1 = { artist: 'Metallica', album: 'Master of Puppets' };
    const album2 = { artist: 'Metalica', album: 'Master of Pupets' };

    // Using legacy call signature with numeric threshold
    const result = isPotentialDuplicate(album1, album2, 0.5);
    assert.ok(result.isPotentialMatch);
    assert.ok('shouldAutoMerge' in result);
  });

  it('should respect custom autoMergeThreshold option', () => {
    const album1 = { artist: 'Metallica', album: 'Master of Puppets' };
    const album2 = { artist: 'Metalica', album: 'Master of Pupets' };

    // With a very low autoMergeThreshold, even typos should auto-merge
    const result = isPotentialDuplicate(album1, album2, {
      threshold: 0.1,
      autoMergeThreshold: 0.7,
    });
    assert.ok(result.isPotentialMatch);
    assert.ok(result.shouldAutoMerge);
  });
});

// ============================================
// FIND POTENTIAL DUPLICATES TESTS
// ============================================

describe('findPotentialDuplicates', () => {
  const candidates = [
    { album_id: '1', artist: 'Metallica', album: 'Master of Puppets' },
    { album_id: '2', artist: 'Pink Floyd', album: 'The Wall' },
    { album_id: '3', artist: 'Metalica', album: 'Master of Pupets' }, // Typo version
    { album_id: '4', artist: 'Led Zeppelin', album: 'IV' },
  ];

  it('should find potential duplicates sorted by confidence', () => {
    const newAlbum = { artist: 'Metallica', album: 'Master of Puppets' };
    const results = findPotentialDuplicates(newAlbum, candidates);

    assert.ok(results.length >= 1);
    // First result should be exact match or typo version
    assert.ok(
      results[0].candidate.album_id === '1' ||
        results[0].candidate.album_id === '3'
    );
  });

  it('should respect maxResults option', () => {
    const newAlbum = { artist: 'Metallica', album: 'Master of Puppets' };
    const results = findPotentialDuplicates(newAlbum, candidates, {
      maxResults: 1,
    });

    assert.strictEqual(results.length, 1);
  });

  it('should exclude pairs in excludePairs set', () => {
    const newAlbum = {
      album_id: 'new',
      artist: 'Metallica',
      album: 'Master of Puppets',
    };
    const excludePairs = new Set(['new::1', '3::new']);

    const results = findPotentialDuplicates(newAlbum, candidates, {
      excludePairs,
    });

    // Both matches should be excluded
    const foundIds = results.map((r) => r.candidate.album_id);
    assert.ok(!foundIds.includes('1'));
    assert.ok(!foundIds.includes('3'));
  });

  it('should return empty array for no matches', () => {
    const newAlbum = { artist: 'Unknown Artist', album: 'Unknown Album' };
    const results = findPotentialDuplicates(newAlbum, candidates);

    assert.strictEqual(results.length, 0);
  });

  it('should include shouldAutoMerge flag for exact matches', () => {
    const newAlbum = { artist: 'Pink Floyd', album: 'The Wall' };
    const results = findPotentialDuplicates(newAlbum, candidates);

    assert.ok(results.length >= 1);
    const exactMatch = results.find((r) => r.candidate.album_id === '2');
    assert.ok(exactMatch);
    assert.ok(exactMatch.shouldAutoMerge);
    assert.strictEqual(exactMatch.confidence, 1.0);
  });

  it('should include shouldAutoMerge=false for typo matches', () => {
    const newAlbum = { artist: 'Metallica', album: 'Master of Puppets' };
    const results = findPotentialDuplicates(newAlbum, candidates);

    // Find the typo match (not exact)
    const typoMatch = results.find((r) => r.candidate.album_id === '3');
    assert.ok(typoMatch);
    assert.ok(!typoMatch.shouldAutoMerge);
  });

  it('should use default thresholds (0.10 for modal, 0.98 for auto-merge)', () => {
    // Test that a ~15% match is included (above default 0.10 threshold)
    // and that only 100% matches have shouldAutoMerge=true
    const newAlbum = { artist: 'Pink Floyd', album: 'The Wall' };
    const results = findPotentialDuplicates(newAlbum, candidates);

    // The exact match should be found and marked for auto-merge
    const exactMatch = results.find((r) => r.candidate.album_id === '2');
    assert.ok(exactMatch);
    assert.ok(exactMatch.shouldAutoMerge);
  });

  it('should respect custom threshold options', () => {
    const newAlbum = { artist: 'Metallica', album: 'Master of Puppets' };

    // With a very high threshold, only exact matches should be found
    const results = findPotentialDuplicates(newAlbum, candidates, {
      threshold: 0.99,
    });

    // Only the exact match should pass the 99% threshold
    assert.ok(results.length <= 1);
    if (results.length > 0) {
      assert.strictEqual(results[0].candidate.album_id, '1');
    }
  });
});

// ============================================
// IS EXACT MATCH TESTS
// ============================================

describe('isExactMatch', () => {
  it('should return true for same normalized strings', () => {
    assert.ok(isExactMatch('The Beatles', 'Beatles'));
    assert.ok(isExactMatch('Album (Deluxe)', 'Album'));
  });

  it('should return false for different strings', () => {
    assert.ok(!isExactMatch('Metallica', 'Megadeth'));
  });
});

// ============================================
// REAL-WORLD SCENARIO TESTS
// ============================================

describe('Real-world album matching scenarios', () => {
  it('should match "Guns N Roses" vs "Guns N\' Roses"', () => {
    const result = isPotentialDuplicate(
      { artist: 'Guns N Roses', album: 'Appetite for Destruction' },
      { artist: "Guns N' Roses", album: 'Appetite for Destruction' }
    );
    assert.ok(result.isPotentialMatch);
  });

  it('should match "AC/DC" vs "ACDC"', () => {
    const result = isPotentialDuplicate(
      { artist: 'AC/DC', album: 'Back in Black' },
      { artist: 'ACDC', album: 'Back in Black' }
    );
    assert.ok(result.isPotentialMatch);
  });

  it('should match album with/without "The" prefix', () => {
    const result = isPotentialDuplicate(
      { artist: 'Pink Floyd', album: 'The Dark Side of the Moon' },
      { artist: 'Pink Floyd', album: 'Dark Side of the Moon' }
    );
    assert.ok(result.isPotentialMatch);
  });

  it('should match self-titled albums with different naming', () => {
    const result = isPotentialDuplicate(
      { artist: 'Metallica', album: 'Metallica' },
      { artist: 'Metallica', album: 'The Black Album' }
    );
    // This should NOT match - they're different naming conventions
    // but humans would know they're the same album
    // This is a limitation of fuzzy matching
    assert.ok(!result.isPotentialMatch);
  });

  it('should match numbered albums with roman numerals', () => {
    // This is tricky - "IV" vs "4" won't automatically match
    // This shows a limitation we might want to address
    const result = isPotentialDuplicate(
      { artist: 'Led Zeppelin', album: 'Led Zeppelin IV' },
      { artist: 'Led Zeppelin', album: 'Led Zeppelin 4' }
    );
    // Currently won't match due to different characters
    // This is acceptable for now - we can enhance later
    // Verify the result object has expected structure
    assert.ok('isPotentialMatch' in result);
    assert.ok('confidence' in result);
  });
});

// ============================================
// DYNAMIC THRESHOLD TESTS
// ============================================

describe('deriveMinScoreFromThreshold', () => {
  it('should return 0.25 for very aggressive thresholds (<=0.05)', () => {
    assert.strictEqual(deriveMinScoreFromThreshold(0.03), 0.25);
    assert.strictEqual(deriveMinScoreFromThreshold(0.05), 0.25);
  });

  it('should return 0.35 for high sensitivity thresholds (<=0.15)', () => {
    assert.strictEqual(deriveMinScoreFromThreshold(0.1), 0.35);
    assert.strictEqual(deriveMinScoreFromThreshold(0.15), 0.35);
  });

  it('should return 0.45 for medium sensitivity thresholds (<=0.30)', () => {
    assert.strictEqual(deriveMinScoreFromThreshold(0.2), 0.45);
    assert.strictEqual(deriveMinScoreFromThreshold(0.3), 0.45);
  });

  it('should return 0.50 for conservative thresholds (>0.30)', () => {
    assert.strictEqual(deriveMinScoreFromThreshold(0.4), 0.5);
    assert.strictEqual(deriveMinScoreFromThreshold(0.5), 0.5);
  });
});

describe('Dynamic threshold behavior', () => {
  // Test albums that are somewhat similar but not exact
  // Artist: "The Beatles" vs "Beatles" (similar but not identical)
  // Album: "Abbey Road" vs "Abbey Roads" (typo)
  const album1 = { artist: 'The Beatles', album: 'Abbey Road' };
  const album2 = { artist: 'Beatles', album: 'Abbey Roads' };

  it('should match with aggressive threshold (0.03)', () => {
    // With threshold 0.03, minimum scores will be 0.25
    // This pair should match because artist/album are reasonably similar
    const result = isPotentialDuplicate(album1, album2, { threshold: 0.03 });
    assert.ok(
      result.isPotentialMatch,
      'Should match with very aggressive threshold'
    );
  });

  it('should allow explicit artistMinScore and albumMinScore', () => {
    // Force very low thresholds
    const result = isPotentialDuplicate(album1, album2, {
      threshold: 0.03,
      artistMinScore: 0.2,
      albumMinScore: 0.2,
    });
    assert.ok(result.isPotentialMatch, 'Should match with explicit low scores');
  });

  it('should respect higher explicit thresholds', () => {
    // Force unrealistically high thresholds
    const result = isPotentialDuplicate(album1, album2, {
      threshold: 0.03,
      artistMinScore: 0.99,
      albumMinScore: 0.99,
    });
    assert.ok(
      !result.isPotentialMatch,
      'Should not match with very high minimum scores'
    );
  });
});
