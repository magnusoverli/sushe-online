/**
 * NowPlayingBar - Floating bar above TabBar showing current Spotify playback.
 *
 * Shows: album art, track name, artist, device icon + name, animated progress bar.
 * Only visible when the playing album matches one in the current list.
 * Tapping the bar opens the Spotify app.
 *
 * Layout reference: existing mobile-now-playing from src/styles/input.css
 */

import { memo, useMemo } from 'react';
import { usePlaybackStore } from '@/stores/playback-store';
import { getDeviceIcon } from '@/features/playback';

/** Height of the now-playing bar in px (excluding safe area). */
export const NOW_PLAYING_BAR_HEIGHT = 64;

interface NowPlayingBarProps {
  /** Whether the bar should be visible. */
  visible: boolean;
}

export const NowPlayingBar = memo(function NowPlayingBar({
  visible,
}: NowPlayingBarProps) {
  const trackName = usePlaybackStore((s) => s.trackName);
  const artistName = usePlaybackStore((s) => s.artistName);
  const albumArt = usePlaybackStore((s) => s.albumArt);
  const deviceName = usePlaybackStore((s) => s.deviceName);
  const deviceType = usePlaybackStore((s) => s.deviceType);
  const progressMs = usePlaybackStore((s) => s.progressMs);
  const durationMs = usePlaybackStore((s) => s.durationMs);

  const progressFraction = useMemo(() => {
    if (durationMs <= 0) return 0;
    return Math.min(progressMs / durationMs, 1);
  }, [progressMs, durationMs]);

  const deviceIcon = useMemo(() => getDeviceIcon(deviceType), [deviceType]);

  if (!visible) return null;

  return (
    <div
      style={{
        width: '100%',
        background: 'linear-gradient(to bottom, #1e1e24, #18181e)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}
      data-testid="now-playing-bar"
    >
      {/* Progress bar */}
      <div
        style={{
          height: 2,
          background: 'rgba(255,255,255,0.06)',
          width: '100%',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressFraction * 100}%`,
            background: '#1ed760',
            transition: 'width 1s linear',
          }}
          data-testid="now-playing-progress"
        />
      </div>

      {/* Content */}
      <a
        href="spotify:"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          textDecoration: 'none',
          color: 'inherit',
        }}
        data-testid="now-playing-link"
      >
        {/* Album art */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 6,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          {albumArt ? (
            <img
              src={albumArt}
              alt="Now playing"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              {'\uD83C\uDFB5'}
            </div>
          )}
        </div>

        {/* Track info */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              letterSpacing: '-0.01em',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            data-testid="now-playing-track"
          >
            {trackName ?? 'Not Playing'}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.02em',
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            data-testid="now-playing-artist"
          >
            {artistName ?? '\u2014'}
          </div>
          {deviceName && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.02em',
                color: '#1ed760',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
              data-testid="now-playing-device"
            >
              <span style={{ fontSize: 10 }}>{deviceIcon}</span>
              <span>{deviceName}</span>
            </div>
          )}
        </div>
      </a>
    </div>
  );
});
