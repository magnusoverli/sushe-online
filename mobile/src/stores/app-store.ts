/**
 * App Store - Global UI state managed with Zustand.
 */

import { create } from 'zustand';
import type { User, ListMetadata } from '@/lib/types';

const ACTIVE_LIST_KEY = 'sushe-mobile-active-list';

function readPersistedListId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LIST_KEY);
  } catch {
    return null;
  }
}

function persistListId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_LIST_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_LIST_KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}

interface AppState {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;

  // Active list
  activeListId: string | null;
  setActiveListId: (id: string | null) => void;

  // Lists metadata cache
  listsMetadata: Record<string, ListMetadata>;
  setListsMetadata: (lists: Record<string, ListMetadata>) => void;

  // UI state
  isDrawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Auth
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: user !== null }),

  // Active list — restored from localStorage on init
  activeListId: readPersistedListId(),
  setActiveListId: (id) => {
    persistListId(id);
    set({ activeListId: id });
  },

  // Lists metadata
  listsMetadata: {},
  setListsMetadata: (lists) => set({ listsMetadata: lists }),

  // UI state
  isDrawerOpen: false,
  setDrawerOpen: (open) => set({ isDrawerOpen: open }),
  toggleDrawer: () => set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
}));
