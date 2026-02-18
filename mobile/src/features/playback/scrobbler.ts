/**
 * Scrobbler - Last.fm scrobbling logic for mobile headless mode.
 *
 * Runs as part of the polling cycle. Checks:
 * 1. On track change: send "now playing" to Last.fm
 * 2. On sufficient play time (50% or 4 minutes): send scrobble
 *
 * Deduplicates by trackId to avoid repeat scrobbles.
 */

import { usePlaybackStore } from '@/stores/playback-store';
import { scrobble, updateNowPlaying } from '@/services/lastfm';
import {
  SCROBBLE_THRESHOLD_PERCENT,
  SCROBBLE_THRESHOLD_MS,
} from '@/lib/constants';

/**
 * Check and perform Last.fm scrobbling based on current playback state.
 * Called after each poll update.
 */
export function checkAndScrobble(): void {
  const state = usePlaybackStore.getState();

  if (!state.trackId || !state.artistName || !state.trackName) {
    return;
  }

  // Send "now playing" on track change
  if (state.trackId !== state.lastfmNowPlayingTrackId) {
    usePlaybackStore.getState().setPlaybackState({
      lastfmNowPlayingTrackId: state.trackId,
      trackPlayStartTime: Date.now(),
      accumulatedPlayTime: 0,
    });

    updateNowPlaying({
      artist: state.artistName,
      track: state.trackName,
      album: state.albumName ?? undefined,
      duration:
        state.durationMs > 0 ? Math.round(state.durationMs / 1000) : undefined,
    }).catch(() => {
      // Silently ignore now-playing failures
    });

    return; // Don't scrobble on the same tick as now-playing
  }

  // Check scrobble threshold
  if (state.trackId === state.lastfmScrobbledTrackId) {
    return; // Already scrobbled this track
  }

  // Calculate accumulated play time
  const now = Date.now();
  let totalPlayTime = state.accumulatedPlayTime;
  if (state.isPlaying && state.trackPlayStartTime) {
    totalPlayTime += now - state.trackPlayStartTime;
  }

  const threshold = Math.min(
    state.durationMs * SCROBBLE_THRESHOLD_PERCENT,
    SCROBBLE_THRESHOLD_MS
  );

  if (totalPlayTime >= threshold && state.durationMs > 0) {
    usePlaybackStore.getState().setPlaybackState({
      lastfmScrobbledTrackId: state.trackId,
    });

    scrobble({
      artist: state.artistName,
      track: state.trackName,
      album: state.albumName ?? undefined,
      duration: Math.round(state.durationMs / 1000),
      timestamp: Math.floor(Date.now() / 1000),
    }).catch(() => {
      // Silently ignore scrobble failures
    });
  }
}

/**
 * Update accumulated play time when playback state changes (pause/resume).
 */
export function updateAccumulatedTime(wasPlaying: boolean): void {
  const state = usePlaybackStore.getState();
  const now = Date.now();

  if (wasPlaying && state.trackPlayStartTime) {
    // Was playing, now stopped or track changed — accumulate
    const elapsed = now - state.trackPlayStartTime;
    usePlaybackStore.getState().setPlaybackState({
      accumulatedPlayTime: state.accumulatedPlayTime + elapsed,
      trackPlayStartTime: state.isPlaying ? now : null,
    });
  } else if (!wasPlaying && state.isPlaying) {
    // Was paused, now playing — set start time
    usePlaybackStore.getState().setPlaybackState({
      trackPlayStartTime: now,
    });
  }
}
