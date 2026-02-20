/**
 * Playback feature - barrel export.
 *
 * Provides Spotify polling, Last.fm scrobbling, and album matching utilities.
 */

export { usePlaybackPolling } from './usePlaybackPolling';
export { checkAndScrobble, updateAccumulatedTime } from './scrobbler';
export {
  normalizeForMatch,
  isAlbumMatchingPlayback,
  getDeviceIcon,
} from './playback-utils';
