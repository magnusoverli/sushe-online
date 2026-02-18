/**
 * SimilarArtistsSheet - Bottom sheet showing Last.fm similar artists.
 *
 * Fetches similar artists on open. Shows artist image (from Deezer),
 * name, match percentage, and a RateYourMusic link.
 */

import { useState, useEffect, useCallback } from 'react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { getSimilarArtists, type SimilarArtist } from '@/services/lastfm';
import { useArtistImage } from '@/hooks/useArtistImage';
import { getRymArtistUrl } from '@/lib/utils';

interface SimilarArtistsSheetProps {
  open: boolean;
  onClose: () => void;
  artistName: string;
}

/** Individual artist row — isolates the useArtistImage hook per artist. */
function ArtistRow({ artist }: { artist: SimilarArtist }) {
  const matchPercent = Math.round(parseFloat(artist.match) * 100);
  const rymUrl = getRymArtistUrl(artist.name);

  // Prefer image already provided by Last.fm; fall back to Deezer lookup.
  const hasFmImage = !!artist.image;
  const { imageUrl: deezerUrl } = useArtistImage(hasFmImage ? '' : artist.name);
  const imageUrl = artist.image || deezerUrl;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 4px',
        borderBottom: '1px solid var(--color-divider)',
      }}
      data-testid="similar-artist-item"
    >
      {/* Artist image */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={artist.name}
          loading="lazy"
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            objectFit: 'cover',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.04)',
          }}
          data-testid="artist-image"
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            flexShrink: 0,
            background: 'rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            color: 'var(--color-text-secondary)',
          }}
          data-testid="artist-image-placeholder"
        >
          {artist.name.charAt(0)}
        </div>
      )}

      {/* Artist info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={artist.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            letterSpacing: '-0.01em',
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
            textDecoration: 'none',
          }}
        >
          {artist.name}
        </a>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.04em',
            color: 'var(--color-text-secondary)',
            marginTop: 2,
          }}
        >
          {matchPercent}% match
        </div>
      </div>

      {/* RYM link */}
      <a
        href={rymUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="rym-link"
        style={{
          flexShrink: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.04em',
          color: 'var(--color-text-secondary)',
          textDecoration: 'none',
          padding: '4px 8px',
          border: '1px solid var(--color-divider)',
          borderRadius: 4,
        }}
      >
        RYM
      </a>
    </div>
  );
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
          artists.map((artist) => (
            <ArtistRow key={artist.name} artist={artist} />
          ))}
      </div>
    </BottomSheet>
  );
}
