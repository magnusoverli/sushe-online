import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLockedYears,
  checkYearLock,
  clearYearLockCache,
  _testHelpers,
} from '../year-lock';

// Mock the api-client
vi.mock('../api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '../api-client';
const mockApi = vi.mocked(api);

describe('year-lock service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearYearLockCache();
  });

  describe('getLockedYears', () => {
    it('should fetch locked years from the API', async () => {
      mockApi.get.mockResolvedValue({ years: [2022, 2023] });

      const result = await getLockedYears();

      expect(mockApi.get).toHaveBeenCalledWith('/api/locked-years');
      expect(result).toBeInstanceOf(Set);
      expect(result.has(2022)).toBe(true);
      expect(result.has(2023)).toBe(true);
      expect(result.has(2024)).toBe(false);
    });

    it('should return cached result within 30 seconds', async () => {
      mockApi.get.mockResolvedValue({ years: [2022] });

      const result1 = await getLockedYears();
      const result2 = await getLockedYears();

      expect(mockApi.get).toHaveBeenCalledTimes(1);
      expect(result1).toBe(result2); // Same reference
    });

    it('should refetch after cache expires', async () => {
      mockApi.get.mockResolvedValue({ years: [2022] });
      await getLockedYears();
      expect(mockApi.get).toHaveBeenCalledTimes(1);

      // Simulate cache expiration by setting timestamp to 31 seconds ago
      const { getCacheState } = _testHelpers;
      const state = getCacheState();
      _testHelpers.setCacheState(state.cachedYears, Date.now() - 31_000);

      mockApi.get.mockResolvedValue({ years: [2022, 2023] });
      const result = await getLockedYears();

      expect(mockApi.get).toHaveBeenCalledTimes(2);
      expect(result.has(2023)).toBe(true);
    });
  });

  describe('checkYearLock', () => {
    it('should return true for a locked year', async () => {
      mockApi.get.mockResolvedValue({ years: [2022, 2023] });

      const result = await checkYearLock(2022);
      expect(result).toBe(true);
    });

    it('should return false for an unlocked year', async () => {
      mockApi.get.mockResolvedValue({ years: [2022] });

      const result = await checkYearLock(2024);
      expect(result).toBe(false);
    });

    it('should return false for null year', async () => {
      const result = await checkYearLock(null);
      expect(result).toBe(false);
      expect(mockApi.get).not.toHaveBeenCalled();
    });
  });

  describe('clearYearLockCache', () => {
    it('should clear the cache and force a new API call', async () => {
      mockApi.get.mockResolvedValue({ years: [2022] });
      await getLockedYears();
      expect(mockApi.get).toHaveBeenCalledTimes(1);

      clearYearLockCache();

      mockApi.get.mockResolvedValue({ years: [] });
      const result = await getLockedYears();

      expect(mockApi.get).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(0);
    });
  });
});
