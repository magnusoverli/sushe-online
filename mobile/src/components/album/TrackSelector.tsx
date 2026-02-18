/**
 * TrackSelector - Track selection with dual-priority cycling.
 *
 * Click cycle: unselected -> secondary (☆) -> primary (★) -> unselected
 * Track picks save immediately via API.
 *
 * Features:
 * - "Get" button to fetch tracks from MusicBrainz
 * - Visual indicators for primary (★ yellow) and secondary (☆ yellow)
 * - Duration display
 */

import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { fetchTracks } from '@/services/tracks';
import { setTrackPick, removeTrackPick } from '@/services/track-picks';
import type { Track } from '@/lib/types';

interface TrackSelectorProps {
  listItemId: string;
  artist: string;
  albumName: string;
  tracks: Track[] | null;
  primaryTrack: string | null;
  secondaryTrack: string | null;
  onTrackPickChanged: (
    primary: string | null,
    secondary: string | null
  ) => void;
  onTracksLoaded: (tracks: Track[]) => void;
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function TrackSelector({
  listItemId,
  artist,
  albumName,
  tracks,
  primaryTrack,
  secondaryTrack,
  onTrackPickChanged,
  onTracksLoaded,
}: TrackSelectorProps) {
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleFetchTracks = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const result = await fetchTracks(artist, albumName);
      onTracksLoaded(result.tracks);
    } catch {
      setFetchError('Failed to fetch tracks');
    } finally {
      setFetching(false);
    }
  }, [artist, albumName, onTracksLoaded]);

  const handleTrackClick = useCallback(
    async (trackTitle: string) => {
      if (saving) return;
      setSaving(trackTitle);

      try {
        const isPrimary = primaryTrack === trackTitle;
        const isSecondary = secondaryTrack === trackTitle;

        let result;

        if (isPrimary) {
          // Primary -> Unselected: remove this track
          result = await removeTrackPick(listItemId, trackTitle);
        } else if (isSecondary) {
          // Secondary -> Primary: promote
          result = await setTrackPick(listItemId, trackTitle, 1);
        } else {
          // Unselected -> Secondary
          result = await setTrackPick(listItemId, trackTitle, 2);
        }

        onTrackPickChanged(
          result.primary_track || null,
          result.secondary_track || null
        );
      } catch {
        // Silently fail - user can retry
      } finally {
        setSaving(null);
      }
    },
    [listItemId, primaryTrack, secondaryTrack, saving, onTrackPickChanged]
  );

  if (!tracks || tracks.length === 0) {
    return (
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-secondary)',
            }}
          >
            Track Selection
          </span>
          <button
            type="button"
            onClick={handleFetchTracks}
            disabled={fetching}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--color-divider)',
              borderRadius: '8px',
              cursor: fetching ? 'default' : 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '16px',
              color: 'var(--color-text-primary)',
              opacity: fetching ? 0.5 : 1,
            }}
            data-testid="fetch-tracks-btn"
          >
            <Download size={12} />
            {fetching ? 'Loading...' : 'Get Tracks'}
          </button>
        </div>

        {fetchError && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-destructive)',
              padding: '8px 0',
            }}
          >
            {fetchError}
          </div>
        )}

        {/* Show current picks even without track list */}
        {(primaryTrack || secondaryTrack) && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              padding: '8px 0',
            }}
          >
            {primaryTrack && (
              <div>
                <span style={{ color: '#facc15' }}>★</span> {primaryTrack}
              </div>
            )}
            {secondaryTrack && (
              <div>
                <span style={{ color: '#facc15' }}>☆</span> {secondaryTrack}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-secondary)',
          }}
        >
          Track Selection
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--color-text-secondary)',
          }}
        >
          tap: ☆ secondary | tap again: ★ primary
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {tracks.map((track) => {
          const isPrimary = primaryTrack === track.title;
          const isSecondary = secondaryTrack === track.title;
          const isSaving = saving === track.title;

          let bg = 'transparent';
          let indicator = '';
          if (isPrimary) {
            bg = 'rgba(250, 204, 21, 0.08)';
            indicator = '★';
          } else if (isSecondary) {
            bg = 'rgba(255, 255, 255, 0.03)';
            indicator = '☆';
          }

          return (
            <button
              key={track.title}
              type="button"
              onClick={() => handleTrackClick(track.title)}
              disabled={!!saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                background: bg,
                border: 'none',
                borderRadius: '8px',
                cursor: saving ? 'default' : 'pointer',
                opacity: isSaving ? 0.5 : 1,
                transition: 'background 150ms ease, opacity 150ms ease',
              }}
              data-testid={`track-${track.position}`}
            >
              {/* Indicator */}
              <span
                style={{
                  width: '16px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: isPrimary || isSecondary ? '#facc15' : 'transparent',
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {indicator}
              </span>

              {/* Position */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--color-text-secondary)',
                  width: '20px',
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {track.position}
              </span>

              {/* Title */}
              <span
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: isPrimary ? '#facc15' : 'var(--color-text-primary)',
                  textAlign: 'left',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {track.title}
              </span>

              {/* Duration */}
              {track.length != null && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: 'var(--color-text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {formatDuration(track.length)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
