import { describe, it, expect } from 'vitest';
import {
  extractYear,
  isYearMismatch,
  formatRank,
  clamp,
  buildAlbumTags,
  sortAlbums,
} from '../utils';

describe('utils', () => {
  describe('extractYear', () => {
    it('extracts year from YYYY-MM-DD format', () => {
      expect(extractYear('1977-02-04')).toBe(1977);
    });

    it('extracts year from YYYY format', () => {
      expect(extractYear('2024')).toBe(2024);
    });

    it('returns null for empty string', () => {
      expect(extractYear('')).toBeNull();
    });

    it('returns null for invalid date', () => {
      expect(extractYear('not-a-date')).toBeNull();
    });
  });

  describe('isYearMismatch', () => {
    it('returns true when years differ', () => {
      expect(isYearMismatch('1977-02-04', 2024)).toBe(true);
    });

    it('returns false when years match', () => {
      expect(isYearMismatch('2024-06-15', 2024)).toBe(false);
    });

    it('returns false when listYear is null', () => {
      expect(isYearMismatch('2024-01-01', null)).toBe(false);
    });

    it('returns false when releaseDate is empty', () => {
      expect(isYearMismatch('', 2024)).toBe(false);
    });
  });

  describe('formatRank', () => {
    it('pads single digit with leading zero', () => {
      expect(formatRank(1)).toBe('01');
      expect(formatRank(9)).toBe('09');
    });

    it('does not pad double digits', () => {
      expect(formatRank(10)).toBe('10');
      expect(formatRank(42)).toBe('42');
    });
  });

  describe('clamp', () => {
    it('clamps below min', () => {
      expect(clamp(-5, 0, 100)).toBe(0);
    });

    it('clamps above max', () => {
      expect(clamp(150, 0, 100)).toBe(100);
    });

    it('returns value when in range', () => {
      expect(clamp(50, 0, 100)).toBe(50);
    });
  });

  describe('buildAlbumTags', () => {
    it('returns genres as tags', () => {
      expect(
        buildAlbumTags({ genre_1: 'Art Pop', genre_2: 'Dream Pop' })
      ).toEqual(['Art Pop', 'Dream Pop']);
    });

    it('skips empty genres', () => {
      expect(buildAlbumTags({ genre_1: 'Rock', genre_2: '' })).toEqual([
        'Rock',
      ]);
    });

    it('returns empty array when no genres', () => {
      expect(buildAlbumTags({ genre_1: '', genre_2: '' })).toEqual([]);
    });

    it('handles missing fields', () => {
      expect(buildAlbumTags({})).toEqual([]);
    });
  });

  describe('sortAlbums', () => {
    const albums = [
      {
        artist: 'Radiohead',
        album: 'OK Computer',
        release_date: '1997-06-16',
        genre_1: 'Alternative Rock',
        country: 'United Kingdom',
      },
      {
        artist: 'Björk',
        album: 'Homogenic',
        release_date: '1997-09-22',
        genre_1: 'Electronic',
        country: 'Iceland',
      },
      {
        artist: 'Daft Punk',
        album: 'Discovery',
        release_date: '2001-03-12',
        genre_1: 'Electronic',
        country: 'France',
      },
    ];

    it('returns same order for custom sort', () => {
      const result = sortAlbums(albums, 'custom');
      expect(result).toBe(albums); // same reference
    });

    it('sorts by artist name', () => {
      const result = sortAlbums(albums, 'artist');
      expect(result.map((a) => a.artist)).toEqual([
        'Björk',
        'Daft Punk',
        'Radiohead',
      ]);
    });

    it('sorts by title', () => {
      const result = sortAlbums(albums, 'title');
      expect(result.map((a) => a.album)).toEqual([
        'Discovery',
        'Homogenic',
        'OK Computer',
      ]);
    });

    it('sorts by year', () => {
      const result = sortAlbums(albums, 'year');
      expect(result.map((a) => a.release_date)).toEqual([
        '1997-06-16',
        '1997-09-22',
        '2001-03-12',
      ]);
    });

    it('sorts by genre', () => {
      const result = sortAlbums(albums, 'genre');
      expect(result.map((a) => a.genre_1)).toEqual([
        'Alternative Rock',
        'Electronic',
        'Electronic',
      ]);
    });

    it('does not mutate original array', () => {
      const original = [...albums];
      sortAlbums(albums, 'artist');
      expect(albums).toEqual(original);
    });
  });
});
