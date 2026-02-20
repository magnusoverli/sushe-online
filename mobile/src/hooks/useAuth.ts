/**
 * useAuth - Hook for authentication state and operations.
 */

import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { checkSession } from '@/services/auth';
import { useEffect } from 'react';

export function useAuth() {
  const { user, isAuthenticated, setUser } = useAppStore();

  const {
    data: session,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: checkSession,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  useEffect(() => {
    if (session?.authenticated && session.user) {
      setUser(session.user);
    } else if (session && !session.authenticated) {
      setUser(null);
    }
  }, [session, setUser]);

  return {
    user,
    isAuthenticated: isAuthenticated || (session?.authenticated ?? false),
    isLoading,
    isError: !!error,
  };
}
