import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from '../playback-store';

describe('playback-store', () => {
  beforeEach(() => {
    usePlaybackStore.getState().clearPlayback();
  });

  it('has correct initial state', () => {
    const state = usePlaybackStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.trackName).toBeNull();
    expect(state.artistName).toBeNull();
    expect(state.albumName).toBeNull();
    expect(state.trackId).toBeNull();
    expect(state.albumArt).toBeNull();
    expect(state.deviceName).toBeNull();
    expect(state.deviceType).toBeNull();
    expect(state.progressMs).toBe(0);
    expect(state.durationMs).toBe(0);
    expect(state.lastPollAt).toBe(0);
  });

  it('setPlaybackState merges partial state', () => {
    usePlaybackStore.getState().setPlaybackState({
      isPlaying: true,
      trackName: 'Song',
      artistName: 'Artist',
    });

    const state = usePlaybackStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.trackName).toBe('Song');
    expect(state.artistName).toBe('Artist');
    // Other fields unchanged
    expect(state.albumName).toBeNull();
  });

  it('clearPlayback resets all state', () => {
    usePlaybackStore.getState().setPlaybackState({
      isPlaying: true,
      trackName: 'Song',
      trackId: 'track-1',
      progressMs: 50000,
      lastfmNowPlayingTrackId: 'track-1',
    });

    usePlaybackStore.getState().clearPlayback();

    const state = usePlaybackStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.trackName).toBeNull();
    expect(state.trackId).toBeNull();
    expect(state.progressMs).toBe(0);
    expect(state.lastfmNowPlayingTrackId).toBeNull();
  });

  it('resetScrobbleState resets only scrobble fields', () => {
    usePlaybackStore.getState().setPlaybackState({
      isPlaying: true,
      trackName: 'Song',
      lastfmNowPlayingTrackId: 'track-1',
      lastfmScrobbledTrackId: 'track-1',
      trackPlayStartTime: 12345,
      accumulatedPlayTime: 60000,
    });

    usePlaybackStore.getState().resetScrobbleState();

    const state = usePlaybackStore.getState();
    // Scrobble fields reset
    expect(state.lastfmNowPlayingTrackId).toBeNull();
    expect(state.lastfmScrobbledTrackId).toBeNull();
    expect(state.trackPlayStartTime).toBeNull();
    expect(state.accumulatedPlayTime).toBe(0);
    // Playback fields preserved
    expect(state.isPlaying).toBe(true);
    expect(state.trackName).toBe('Song');
  });
});
