/**
 * usePlaybackPolling - Headless Spotify polling for mobile.
 *
 * Polls GET /api/spotify/playback at 3-second intervals.
 * Pauses when tab is hidden (via useVisibility).
 * Updates the playback store with current state.
 * Triggers Last.fm scrobbling when user has lastfm connected.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useVisibility } from '@/hooks/useVisibility';
import { usePlaybackStore } from '@/stores/playback-store';
import { getPlaybackState } from '@/services/spotify';
import { checkAndScrobble, updateAccumulatedTime } from './scrobbler';
import { POLL_INTERVAL_MOBILE } from '@/lib/constants';

interface UsePlaybackPollingOptions {
  /** Whether the user has Spotify connected. */
  spotifyConnected: boolean;
  /** Whether the user has Last.fm connected. */
  lastfmConnected: boolean;
}

export function usePlaybackPolling({
  spotifyConnected,
  lastfmConnected,
}: UsePlaybackPollingOptions): void {
  const isVisible = useVisibility();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasPlayingRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await getPlaybackState();

      const wasPlaying = wasPlayingRef.current;
      const previousTrackId = usePlaybackStore.getState().trackId;

      const trackId = data.item?.id ?? null;
      const isPlaying = data.is_playing;

      // Detect track change — reset scrobble state
      if (trackId && trackId !== previousTrackId) {
        usePlaybackStore.getState().resetScrobbleState();
      }

      // Extract smallest album art image (for now-playing bar)
      const images = data.item?.album?.images ?? [];
      const albumArt =
        images.length > 0 ? (images[images.length - 1]?.url ?? null) : null;

      usePlaybackStore.getState().setPlaybackState({
        isPlaying,
        trackName: data.item?.name ?? null,
        artistName: data.item?.artists?.[0]?.name ?? null,
        albumName: data.item?.album?.name ?? null,
        trackId,
        albumArt,
        deviceName: data.device?.name ?? null,
        deviceType: data.device?.type ?? null,
        progressMs: data.progress_ms ?? 0,
        durationMs: data.item?.duration_ms ?? 0,
        lastPollAt: Date.now(),
      });

      // Update accumulated play time for scrobbling
      if (lastfmConnected) {
        updateAccumulatedTime(wasPlaying);
        checkAndScrobble();
      }

      wasPlayingRef.current = isPlaying;
    } catch {
      // On error, clear playback state (user may have disconnected)
      usePlaybackStore.getState().clearPlayback();
      wasPlayingRef.current = false;
    }
  }, [lastfmConnected]);

  useEffect(() => {
    if (!spotifyConnected || !isVisible) {
      // Clear interval when not connected or tab hidden
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial poll
    poll();

    // Start polling
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MOBILE);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [spotifyConnected, isVisible, poll]);
}
