import { describe, it, expect } from 'vitest';
import { extractYear, isYearMismatch, formatRank, clamp } from '../utils';

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
});
