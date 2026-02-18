/**
 * App Store - Global UI state managed with Zustand.
 */

import { create } from 'zustand';
import type { User, ListMetadata } from '@/lib/types';

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

  // Active list
  activeListId: null,
  setActiveListId: (id) => set({ activeListId: id }),

  // Lists metadata
  listsMetadata: {},
  setListsMetadata: (lists) => set({ listsMetadata: lists }),

  // UI state
  isDrawerOpen: false,
  setDrawerOpen: (open) => set({ isDrawerOpen: open }),
  toggleDrawer: () => set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
}));
