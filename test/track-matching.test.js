const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  matchTrackByNumber,
  extractTrackName,
  matchTrackByName,
} = require('../utils/track-matching');

describe('track-matching', () => {
  const tracks = [
    { id: 'a', name: 'First Track' },
    { id: 'b', name: 'Second Track' },
    { id: 'c', name: 'Third Track' },
  ];

  describe('matchTrackByNumber', () => {
    it('should match track by 1-based number', () => {
      const result = matchTrackByNumber(tracks, '1');
      assert.strictEqual(result.id, 'a');
    });

    it('should match last track', () => {
      const result = matchTrackByNumber(tracks, '3');
      assert.strictEqual(result.id, 'c');
    });

    it('should return null for out-of-bounds number', () => {
      assert.strictEqual(matchTrackByNumber(tracks, '0'), null);
      assert.strictEqual(matchTrackByNumber(tracks, '4'), null);
    });

    it('should return null for non-numeric string', () => {
      assert.strictEqual(matchTrackByNumber(tracks, 'abc'), null);
    });

    it('should return null for negative numbers', () => {
      assert.strictEqual(matchTrackByNumber(tracks, '-1'), null);
    });
  });

  describe('extractTrackName', () => {
    it('should extract name from "3. Track Name" format', () => {
      assert.strictEqual(extractTrackName('3. Some Song'), 'Some Song');
    });

    it('should extract name from "3 - Track Name" format', () => {
      assert.strictEqual(extractTrackName('3 - Some Song'), 'Some Song');
    });

    it('should extract name from "3  Track Name" format', () => {
      assert.strictEqual(extractTrackName('3  Some Song'), 'Some Song');
    });

    it('should return original string if no number prefix', () => {
      assert.strictEqual(extractTrackName('Some Song'), 'Some Song');
    });

    it('should handle track name starting with numbers', () => {
      assert.strictEqual(extractTrackName('1. 1999'), '1999');
    });
  });

  describe('matchTrackByName', () => {
    it('should match exact name (case-insensitive)', () => {
      const result = matchTrackByName(tracks, 'first track');
      assert.strictEqual(result.id, 'a');
    });

    it('should match when track name includes search', () => {
      const result = matchTrackByName(tracks, 'First');
      assert.strictEqual(result.id, 'a');
    });

    it('should match when search includes track name', () => {
      const extTracks = [{ id: 'x', name: 'Song' }];
      const result = matchTrackByName(extTracks, 'Song (feat. Someone)');
      assert.strictEqual(result.id, 'x');
    });

    it('should return null when no match', () => {
      assert.strictEqual(matchTrackByName(tracks, 'NonExistent'), null);
    });

    it('should skip tracks without name', () => {
      const noNameTracks = [{ id: 'x', name: '' }];
      assert.strictEqual(matchTrackByName(noNameTracks, 'anything'), null);
    });
  });
});
