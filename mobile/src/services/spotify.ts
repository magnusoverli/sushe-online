/**
 * Spotify Service - API calls for Spotify playback integration.
 */

import { api } from './api-client';

// ── Types ──

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

export interface SpotifyPlaybackState {
  is_playing: boolean;
  device: {
    id: string;
    name: string;
    type: string;
    volume_percent: number;
  } | null;
  item: {
    id: string;
    name: string;
    duration_ms: number;
    album: {
      id: string;
      name: string;
      artists: { name: string }[];
      images: { url: string; width: number; height: number }[];
    };
    artists: { name: string }[];
  } | null;
  progress_ms: number;
}

// ── API Calls ──

/**
 * Get current Spotify playback state.
 */
export async function getPlaybackState(): Promise<SpotifyPlaybackState> {
  return api.get<SpotifyPlaybackState>('/api/spotify/playback');
}

/**
 * Get available Spotify Connect devices.
 */
export async function getDevices(): Promise<{ devices: SpotifyDevice[] }> {
  return api.get<{ devices: SpotifyDevice[] }>('/api/spotify/devices');
}

/**
 * Play an album on a specific device.
 */
export async function playAlbum(
  albumId: string,
  deviceId?: string
): Promise<{ success: boolean }> {
  return api.put<{ success: boolean }>('/api/spotify/play', {
    albumId,
    deviceId,
  });
}

/**
 * Search for a Spotify album by artist/album name.
 */
export async function searchAlbum(
  artist: string,
  album: string
): Promise<{ id: string }> {
  return api.get<{ id: string }>(
    `/api/spotify/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
  );
}

/**
 * Search for a Spotify track.
 */
export async function searchTrack(
  artist: string,
  album: string,
  track: string
): Promise<{ id: string }> {
  return api.get<{ id: string }>(
    `/api/spotify/track?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&track=${encodeURIComponent(track)}`
  );
}

/**
 * Pause playback.
 */
export async function pausePlayback(): Promise<{ success: boolean }> {
  return api.put<{ success: boolean }>('/api/spotify/pause', {});
}

/**
 * Resume playback.
 */
export async function resumePlayback(): Promise<{ success: boolean }> {
  return api.put<{ success: boolean }>('/api/spotify/resume', {});
}

/**
 * Skip to next track.
 */
export async function nextTrack(): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/spotify/next', {});
}

/**
 * Skip to previous track.
 */
export async function previousTrack(): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/spotify/previous', {});
}
