/**
 * Playback Store - Now-playing state + scrobbling tracking.
 *
 * Updated at 3s intervals by usePlaybackPolling hook.
 * Consumed by NowPlayingBar, CoverImage (animated border), AppShell (layout shift).
 */

import { create } from 'zustand';

interface PlaybackState {
  /** Whether Spotify is currently playing audio. */
  isPlaying: boolean;
  /** Current track name. */
  trackName: string | null;
  /** Current track's primary artist name. */
  artistName: string | null;
  /** Current playing album name (for fuzzy matching to list albums). */
  albumName: string | null;
  /** Spotify track ID (for deduplication). */
  trackId: string | null;
  /** Album art URL from Spotify. */
  albumArt: string | null;
  /** Active Spotify Connect device name. */
  deviceName: string | null;
  /** Active Spotify Connect device type (e.g., "Computer", "Smartphone"). */
  deviceType: string | null;
  /** Current playback progress in milliseconds. */
  progressMs: number;
  /** Current track duration in milliseconds. */
  durationMs: number;
  /** Last poll timestamp (for interpolating progress between polls). */
  lastPollAt: number;

  // Scrobbling state
  /** Track ID for which "now playing" was sent to Last.fm. */
  lastfmNowPlayingTrackId: string | null;
  /** Track ID that was already scrobbled (to avoid duplicate scrobbles). */
  lastfmScrobbledTrackId: string | null;
  /** When the current track started playing (ms since epoch). */
  trackPlayStartTime: number | null;
  /** Accumulated play time for the current track (handles pause/resume). */
  accumulatedPlayTime: number;

  // Actions
  setPlaybackState: (state: Partial<PlaybackState>) => void;
  clearPlayback: () => void;
  resetScrobbleState: () => void;
}

const initialPlayback = {
  isPlaying: false,
  trackName: null,
  artistName: null,
  albumName: null,
  trackId: null,
  albumArt: null,
  deviceName: null,
  deviceType: null,
  progressMs: 0,
  durationMs: 0,
  lastPollAt: 0,
  lastfmNowPlayingTrackId: null,
  lastfmScrobbledTrackId: null,
  trackPlayStartTime: null,
  accumulatedPlayTime: 0,
};

export const usePlaybackStore = create<PlaybackState>((set) => ({
  ...initialPlayback,

  setPlaybackState: (partial) => set(partial),

  clearPlayback: () => set(initialPlayback),

  resetScrobbleState: () =>
    set({
      lastfmNowPlayingTrackId: null,
      lastfmScrobbledTrackId: null,
      trackPlayStartTime: null,
      accumulatedPlayTime: 0,
    }),
}));
