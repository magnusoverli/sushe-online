/**
 * ServiceChooserSheet - Bottom sheet for choosing between Spotify and Tidal.
 *
 * Shown when both services are connected and the user's preference is "Ask each time"
 * (musicService is null/empty).
 */

import { BottomSheet } from '@/components/ui/BottomSheet';

export type MusicServiceChoice = 'spotify' | 'tidal';

interface ServiceChooserSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (service: MusicServiceChoice) => void;
}

const SPOTIFY_COLOR = '#1DB954';
const TIDAL_COLOR = '#00FFFF';

export function ServiceChooserSheet({
  open,
  onClose,
  onSelect,
}: ServiceChooserSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Play with...">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '0 4px 8px',
        }}
      >
        {/* Spotify option */}
        <button
          type="button"
          onClick={() => onSelect('spotify')}
          data-testid="service-choice-spotify"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 12px',
            borderRadius: 12,
            border: 'none',
            background: 'rgba(29, 185, 84, 0.10)',
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(29, 185, 84, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: SPOTIFY_COLOR,
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            S
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                fontWeight: 500,
                color: SPOTIFY_COLOR,
              }}
            >
              Spotify
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                marginTop: 2,
              }}
            >
              Choose a device to play on
            </div>
          </div>
        </button>

        {/* Tidal option */}
        <button
          type="button"
          onClick={() => onSelect('tidal')}
          data-testid="service-choice-tidal"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 12px',
            borderRadius: 12,
            border: 'none',
            background: 'rgba(0, 255, 255, 0.06)',
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(0, 255, 255, 0.10)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: TIDAL_COLOR,
              fontFamily: 'var(--font-mono)',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            T
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                fontWeight: 500,
                color: TIDAL_COLOR,
              }}
            >
              Tidal
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                marginTop: 2,
              }}
            >
              Open in Tidal app or browser
            </div>
          </div>
        </button>
      </div>
    </BottomSheet>
  );
}
