import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkAndScrobble, updateAccumulatedTime } from '../scrobbler';
import { usePlaybackStore } from '@/stores/playback-store';

// Mock the lastfm service
vi.mock('@/services/lastfm', () => ({
  scrobble: vi.fn(() => Promise.resolve({ success: true })),
  updateNowPlaying: vi.fn(() => Promise.resolve({ success: true })),
}));

describe('scrobbler', () => {
  beforeEach(() => {
    // Reset store to defaults
    usePlaybackStore.getState().clearPlayback();
  });

  describe('checkAndScrobble', () => {
    it('does nothing when trackId is null', () => {
      checkAndScrobble();
      // No error thrown, no state change
      expect(usePlaybackStore.getState().lastfmNowPlayingTrackId).toBeNull();
    });

    it('does nothing when artistName is null', () => {
      usePlaybackStore.getState().setPlaybackState({
        trackId: 'track-1',
        trackName: 'Song',
        artistName: null,
      });
      checkAndScrobble();
      expect(usePlaybackStore.getState().lastfmNowPlayingTrackId).toBeNull();
    });

    it('sends now-playing on new track', async () => {
      const { updateNowPlaying } = await import('@/services/lastfm');

      usePlaybackStore.getState().setPlaybackState({
        trackId: 'track-1',
        trackName: 'Song',
        artistName: 'Artist',
        albumName: 'Album',
        durationMs: 240000,
        isPlaying: true,
      });

      checkAndScrobble();

      expect(usePlaybackStore.getState().lastfmNowPlayingTrackId).toBe(
        'track-1'
      );
      expect(updateNowPlaying).toHaveBeenCalledWith({
        artist: 'Artist',
        track: 'Song',
        album: 'Album',
        duration: 240,
      });
    });

    it('does not scrobble on the same tick as now-playing', () => {
      usePlaybackStore.getState().setPlaybackState({
        trackId: 'track-1',
        trackName: 'Song',
        artistName: 'Artist',
        durationMs: 240000,
        isPlaying: true,
      });

      checkAndScrobble();

      // Should not have scrobbled yet
      expect(usePlaybackStore.getState().lastfmScrobbledTrackId).toBeNull();
    });

    it('does not re-scrobble an already scrobbled track', () => {
      usePlaybackStore.getState().setPlaybackState({
        trackId: 'track-1',
        trackName: 'Song',
        artistName: 'Artist',
        durationMs: 240000,
        isPlaying: true,
        lastfmNowPlayingTrackId: 'track-1',
        lastfmScrobbledTrackId: 'track-1',
      });

      checkAndScrobble();

      // State unchanged — already scrobbled
      expect(usePlaybackStore.getState().lastfmScrobbledTrackId).toBe(
        'track-1'
      );
    });

    it('scrobbles when accumulated play time exceeds threshold', async () => {
      const { scrobble } = await import('@/services/lastfm');

      usePlaybackStore.getState().setPlaybackState({
        trackId: 'track-1',
        trackName: 'Song',
        artistName: 'Artist',
        albumName: 'Album',
        durationMs: 240000,
        isPlaying: true,
        lastfmNowPlayingTrackId: 'track-1',
        accumulatedPlayTime: 130000, // > 50% of 240s = 120s
        trackPlayStartTime: Date.now() - 10000, // 10s ago
      });

      checkAndScrobble();

      expect(usePlaybackStore.getState().lastfmScrobbledTrackId).toBe(
        'track-1'
      );
      expect(scrobble).toHaveBeenCalled();
    });

    it('does not scrobble when play time is below threshold', () => {
      usePlaybackStore.getState().setPlaybackState({
        trackId: 'track-1',
        trackName: 'Song',
        artistName: 'Artist',
        durationMs: 240000,
        isPlaying: false,
        lastfmNowPlayingTrackId: 'track-1',
        accumulatedPlayTime: 50000, // < 50% of 240s = 120s
        trackPlayStartTime: null,
      });

      checkAndScrobble();

      expect(usePlaybackStore.getState().lastfmScrobbledTrackId).toBeNull();
    });
  });

  describe('updateAccumulatedTime', () => {
    it('accumulates time when was playing and has start time', () => {
      const startTime = Date.now() - 5000; // 5s ago
      usePlaybackStore.getState().setPlaybackState({
        isPlaying: false,
        trackPlayStartTime: startTime,
        accumulatedPlayTime: 10000,
      });

      updateAccumulatedTime(true); // was playing

      const state = usePlaybackStore.getState();
      // Should have added ~5000ms to the 10000ms
      expect(state.accumulatedPlayTime).toBeGreaterThanOrEqual(14000);
      expect(state.accumulatedPlayTime).toBeLessThanOrEqual(16000);
      // Since isPlaying is false, trackPlayStartTime should be null
      expect(state.trackPlayStartTime).toBeNull();
    });

    it('sets start time when transitioning from paused to playing', () => {
      usePlaybackStore.getState().setPlaybackState({
        isPlaying: true,
        trackPlayStartTime: null,
        accumulatedPlayTime: 0,
      });

      const before = Date.now();
      updateAccumulatedTime(false); // was not playing

      const state = usePlaybackStore.getState();
      expect(state.trackPlayStartTime).toBeGreaterThanOrEqual(before);
    });

    it('does nothing when was not playing and still not playing', () => {
      usePlaybackStore.getState().setPlaybackState({
        isPlaying: false,
        trackPlayStartTime: null,
        accumulatedPlayTime: 0,
      });

      updateAccumulatedTime(false);

      const state = usePlaybackStore.getState();
      expect(state.accumulatedPlayTime).toBe(0);
      expect(state.trackPlayStartTime).toBeNull();
    });
  });
});
