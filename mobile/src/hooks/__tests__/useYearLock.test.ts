import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useYearLock, useLockedYears } from '../useYearLock';

// Mock the year-lock service
const mockCheckYearLock = vi.fn();
const mockGetLockedYears = vi.fn();

vi.mock('@/services/year-lock', () => ({
  checkYearLock: (...args: unknown[]) => mockCheckYearLock(...args),
  getLockedYears: () => mockGetLockedYears(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe('useYearLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isLocked=false when year is null', async () => {
    const { result } = renderHook(() => useYearLock(null), {
      wrapper: createWrapper(),
    });

    // Should not call the API for null year
    expect(mockCheckYearLock).not.toHaveBeenCalled();
    expect(result.current.isLocked).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns isLocked=true when year is locked', async () => {
    mockCheckYearLock.mockResolvedValue(true);

    const { result } = renderHook(() => useYearLock(2024), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLocked).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('returns isLocked=false when year is not locked', async () => {
    mockCheckYearLock.mockResolvedValue(false);

    const { result } = renderHook(() => useYearLock(2024), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.isLocked).toBe(false);
  });

  it('shows loading state while fetching', () => {
    mockCheckYearLock.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useYearLock(2024), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isLocked).toBe(false);
  });
});

describe('useLockedYears', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty set initially', () => {
    mockGetLockedYears.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useLockedYears(), {
      wrapper: createWrapper(),
    });

    expect(result.current.lockedYears).toEqual(new Set());
    expect(result.current.isLoading).toBe(true);
  });

  it('returns locked years after fetch', async () => {
    mockGetLockedYears.mockResolvedValue(new Set([2022, 2023]));

    const { result } = renderHook(() => useLockedYears(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.lockedYears.has(2022)).toBe(true);
    expect(result.current.lockedYears.has(2023)).toBe(true);
  });
});
