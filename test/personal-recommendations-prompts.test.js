const test = require('node:test');
const assert = require('node:assert');
const {
  buildPrompt,
  formatAffinityForPrompt,
  formatNewReleasesForPrompt,
  DEFAULT_SYSTEM_PROMPT,
} = require('../utils/personal-recommendations-prompts.js');

// =============================================================================
// formatAffinityForPrompt
// =============================================================================

test('formatAffinityForPrompt should format affinity array', () => {
  const affinity = [
    { name: 'Rock', score: 95 },
    { name: 'Jazz', score: 80 },
    { name: 'Electronic', score: 70 },
  ];

  const result = formatAffinityForPrompt(affinity);
  assert.ok(result.includes('1. Rock (score: 95)'));
  assert.ok(result.includes('2. Jazz (score: 80)'));
  assert.ok(result.includes('3. Electronic (score: 70)'));
});

test('formatAffinityForPrompt should respect limit parameter', () => {
  const affinity = [
    { name: 'Rock', score: 95 },
    { name: 'Jazz', score: 80 },
    { name: 'Electronic', score: 70 },
    { name: 'Pop', score: 60 },
  ];

  const result = formatAffinityForPrompt(affinity, 2);
  assert.ok(result.includes('Rock'));
  assert.ok(result.includes('Jazz'));
  assert.ok(!result.includes('Electronic'));
  assert.ok(!result.includes('Pop'));
});

test('formatAffinityForPrompt should handle empty array', () => {
  assert.strictEqual(formatAffinityForPrompt([]), 'No data available');
});

test('formatAffinityForPrompt should handle null input', () => {
  assert.strictEqual(formatAffinityForPrompt(null), 'No data available');
});

test('formatAffinityForPrompt should handle undefined input', () => {
  assert.strictEqual(formatAffinityForPrompt(undefined), 'No data available');
});

// =============================================================================
// formatNewReleasesForPrompt
// =============================================================================

test('formatNewReleasesForPrompt should format releases with all fields', () => {
  const releases = [
    {
      artist: 'Radiohead',
      album: 'OK Computer',
      genre_1: 'Alternative Rock',
      genre_2: 'Art Rock',
      country: 'United Kingdom',
      release_date: '2025-02-03',
      source: 'spotify',
      verified: true,
    },
  ];

  const result = formatNewReleasesForPrompt(releases);
  assert.ok(result.includes('1. Radiohead - OK Computer'));
  assert.ok(result.includes('Genre: Alternative Rock, Art Rock'));
  assert.ok(result.includes('Country: United Kingdom'));
  assert.ok(result.includes('Released: 2025-02-03'));
  assert.ok(result.includes('Source: spotify'));
  assert.ok(result.includes('(verified)'));
});

test('formatNewReleasesForPrompt should handle single genre', () => {
  const releases = [
    {
      artist: 'Radiohead',
      album: 'OK Computer',
      genre_1: 'Alternative Rock',
      release_date: '2025-02-03',
      source: 'spotify',
    },
  ];

  const result = formatNewReleasesForPrompt(releases);
  assert.ok(result.includes('Genre: Alternative Rock'));
  assert.ok(!result.includes(','));
});

test('formatNewReleasesForPrompt should handle legacy genre field', () => {
  const releases = [
    {
      artist: 'Radiohead',
      album: 'OK Computer',
      genre: 'Alternative Rock',
      release_date: '2025-02-03',
      source: 'spotify',
    },
  ];

  const result = formatNewReleasesForPrompt(releases);
  assert.ok(result.includes('Genre: Alternative Rock'));
});

test('formatNewReleasesForPrompt should handle releases with minimal fields', () => {
  const releases = [{ artist: 'Artist', album: 'Album' }];

  const result = formatNewReleasesForPrompt(releases);
  assert.ok(result.includes('1. Artist - Album'));
  assert.ok(!result.includes('Genre:'));
  assert.ok(!result.includes('Released:'));
});

test('formatNewReleasesForPrompt should handle empty array', () => {
  assert.strictEqual(
    formatNewReleasesForPrompt([]),
    'No new releases available'
  );
});

test('formatNewReleasesForPrompt should handle null input', () => {
  assert.strictEqual(
    formatNewReleasesForPrompt(null),
    'No new releases available'
  );
});

// =============================================================================
// buildPrompt
// =============================================================================

test('buildPrompt should build complete prompt with all data', () => {
  const options = {
    newReleases: [
      { artist: 'Artist1', album: 'Album1', genre_1: 'Rock' },
      { artist: 'Artist2', album: 'Album2', genre_1: 'Jazz' },
    ],
    genreAffinity: [{ name: 'Rock', score: 95 }],
    artistAffinity: [{ name: 'Radiohead', score: 90 }],
    countryAffinity: [{ name: 'UK', score: 85 }],
    userAlbumKeys: ['artist3::album3'],
    customPrompt: 'I love shoegaze',
    count: 5,
  };

  const { systemPrompt, userPrompt } = buildPrompt(options);

  assert.strictEqual(systemPrompt, DEFAULT_SYSTEM_PROMPT);
  assert.ok(userPrompt.includes('select 5 albums'));
  assert.ok(userPrompt.includes('Artist1 - Album1'));
  assert.ok(userPrompt.includes('Artist2 - Album2'));
  assert.ok(userPrompt.includes('Rock (score: 95)'));
  assert.ok(userPrompt.includes('Radiohead (score: 90)'));
  assert.ok(userPrompt.includes('UK (score: 85)'));
  assert.ok(userPrompt.includes('I love shoegaze'));
  assert.ok(userPrompt.includes('PERSONAL PREFERENCES'));
  assert.ok(userPrompt.includes('artist3::album3'));
});

test('buildPrompt should handle missing affinity data (new user)', () => {
  const { userPrompt } = buildPrompt({
    newReleases: [{ artist: 'Artist1', album: 'Album1' }],
    count: 5,
  });

  assert.ok(userPrompt.includes('No data available'));
  assert.ok(userPrompt.includes('None (new user)'));
});

test('buildPrompt should insert custom prompt in PERSONAL PREFERENCES section', () => {
  const { userPrompt } = buildPrompt({
    newReleases: [{ artist: 'A', album: 'B' }],
    customPrompt: 'More shoegaze please',
  });

  assert.ok(userPrompt.includes('## PERSONAL PREFERENCES'));
  assert.ok(userPrompt.includes('More shoegaze please'));
});

test('buildPrompt should omit custom prompt section when empty', () => {
  const { userPrompt } = buildPrompt({
    newReleases: [{ artist: 'A', album: 'B' }],
    customPrompt: '',
  });

  assert.ok(!userPrompt.includes('PERSONAL PREFERENCES'));
});

test('buildPrompt should truncate exclusion list at 200 entries', () => {
  const albumKeys = Array.from(
    { length: 250 },
    (_, i) => `artist${i}::album${i}`
  );
  const { userPrompt } = buildPrompt({
    newReleases: [{ artist: 'A', album: 'B' }],
    userAlbumKeys: albumKeys,
  });

  // Should include truncation note
  assert.ok(userPrompt.includes('and 50 more albums not shown'));
  // Should include the first entries
  assert.ok(userPrompt.includes('artist0::album0'));
  assert.ok(userPrompt.includes('artist199::album199'));
  // Should NOT include entries beyond 200
  assert.ok(!userPrompt.includes('artist200::album200'));
});

test('buildPrompt should handle Set input for userAlbumKeys', () => {
  const albumKeys = new Set(['key1::album1', 'key2::album2']);
  const { userPrompt } = buildPrompt({
    newReleases: [{ artist: 'A', album: 'B' }],
    userAlbumKeys: albumKeys,
  });

  assert.ok(userPrompt.includes('key1::album1'));
  assert.ok(userPrompt.includes('key2::album2'));
});

test('buildPrompt should use default count of 7', () => {
  const { userPrompt } = buildPrompt({
    newReleases: [{ artist: 'A', album: 'B' }],
  });

  assert.ok(userPrompt.includes('select 7 albums'));
});

test('buildPrompt should handle empty new releases pool', () => {
  const { userPrompt } = buildPrompt({
    newReleases: [],
  });

  assert.ok(userPrompt.includes('No new releases available'));
});
