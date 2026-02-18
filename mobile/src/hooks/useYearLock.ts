/**
 * useYearLock - React Query hooks for checking year lock status.
 *
 * Uses a 30-second staleTime to match the service-level cache TTL.
 * Returns { isLocked: false } for null years (collections, etc.).
 */

import { useQuery } from '@tanstack/react-query';
import { checkYearLock, getLockedYears } from '@/services/year-lock';

interface YearLockResult {
  isLocked: boolean;
  isLoading: boolean;
}

/** Check if a single year is locked. */
export function useYearLock(year: number | null): YearLockResult {
  const { data, isLoading } = useQuery({
    queryKey: ['year-lock', year],
    queryFn: () => checkYearLock(year),
    enabled: year != null,
    staleTime: 30_000,
  });

  return {
    isLocked: data ?? false,
    isLoading: year != null && isLoading,
  };
}

/** Fetch all locked years as a Set. Useful for batch-checking in the drawer. */
export function useLockedYears(): {
  lockedYears: Set<number>;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['year-lock', 'all'],
    queryFn: getLockedYears,
    staleTime: 30_000,
  });

  return {
    lockedYears: data ?? new Set(),
    isLoading,
  };
}
