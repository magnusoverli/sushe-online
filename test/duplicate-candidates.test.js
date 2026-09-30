const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBlockingBuckets,
  getCandidateIndexes,
} = require('../services/duplicates/candidate-matching');

test('duplicate candidate blocking includes normalized matches only once and never revisits a pair', () => {
  const albums = [
    { artist: 'Björk', album: 'Vespertine' },
    { artist: 'Bjork', album: 'Vespertine' },
    { artist: 'Zebra', album: 'Other' },
  ];
  const buckets = buildBlockingBuckets(albums);
  assert.deepEqual(
    getCandidateIndexes(0, albums[0], buckets, albums.length),
    [1]
  );
  assert.deepEqual(
    getCandidateIndexes(2, albums[2], buckets, albums.length),
    []
  );
});

test('unmatched duplicate candidates use a bounded deterministic fallback', () => {
  const indexes = getCandidateIndexes(
    3,
    { artist: '', album: '' },
    new Map(),
    500
  );
  assert.equal(indexes.length, 200);
  assert.equal(indexes[0], 4);
  assert.equal(indexes.at(-1), 203);
});
