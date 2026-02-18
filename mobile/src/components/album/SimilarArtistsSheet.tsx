/**
 * SimilarArtistsSheet - Bottom sheet showing Last.fm similar artists.
 *
 * Fetches similar artists on open. Shows name, match percentage, and link.
 */

import { useState, useEffect, useCallback } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { getSimilarArtists, type SimilarArtist } from '@/services/lastfm';

interface SimilarArtistsSheetProps {
  open: boolean;
  onClose: () => void;
  artistName: string;
}

export function SimilarArtistsSheet({
  open,
  onClose,
  artistName,
}: SimilarArtistsSheetProps) {
  const [artists, setArtists] = useState<SimilarArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchArtists = useCallback(async () => {
    if (!artistName) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getSimilarArtists(artistName, 15);
      setArtists(result.artists ?? []);
    } catch {
      setError('Failed to load similar artists');
    } finally {
      setLoading(false);
    }
  }, [artistName]);

  useEffect(() => {
    if (open && artistName) {
      fetchArtists();
    }
    if (!open) {
      setArtists([]);
      setError(null);
    }
  }, [open, artistName, fetchArtists]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Similar Artists"
      subtitle={artistName}
    >
      <div style={{ padding: '0 16px 16px', minHeight: 120 }}>
        {loading && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 0',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading...
          </div>
        )}

        {error && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 0',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-destructive)',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && artists.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 0',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-secondary)',
            }}
          >
            No similar artists found.
          </div>
        )}

        {!loading &&
          artists.map((artist) => {
            const matchPercent = Math.round(parseFloat(artist.match) * 100);
            return (
              <a
                key={artist.name}
                href={artist.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 4px',
                  borderBottom: '1px solid var(--color-divider)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
                data-testid="similar-artist-item"
              >
                {/* Artist image */}
                {artist.image ? (
                  <img
                    src={artist.image}
                    alt={artist.name}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      objectFit: 'cover',
                      flexShrink: 0,
                      background: 'rgba(255,255,255,0.04)',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      flexShrink: 0,
                      background: 'rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {artist.name.charAt(0)}
                  </div>
                )}

                {/* Artist info */}
                <div style={{ flex: 1, minWidth: 0 }}>
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
                  >
                    {artist.name}
                  </div>
                </div>

                {/* Match percentage */}
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {matchPercent}%
                </div>
              </a>
            );
          })}
      </div>
    </BottomSheet>
  );
}
