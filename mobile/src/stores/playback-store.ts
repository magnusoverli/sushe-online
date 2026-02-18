/**
 * Playback Store - Now-playing state.
 */

import { create } from 'zustand';

interface PlaybackState {
  isPlaying: boolean;
  trackName: string | null;
  artistName: string | null;
  albumId: string | null;
  albumArt: string | null;
  deviceName: string | null;
  deviceType: string | null;
  progressMs: number;
  durationMs: number;

  setPlaybackState: (state: Partial<PlaybackState>) => void;
  clearPlayback: () => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  isPlaying: false,
  trackName: null,
  artistName: null,
  albumId: null,
  albumArt: null,
  deviceName: null,
  deviceType: null,
  progressMs: 0,
  durationMs: 0,

  setPlaybackState: (partial) => set(partial),
  clearPlayback: () =>
    set({
      isPlaying: false,
      trackName: null,
      artistName: null,
      albumId: null,
      albumArt: null,
      deviceName: null,
      deviceType: null,
      progressMs: 0,
      durationMs: 0,
    }),
}));
