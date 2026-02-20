/**
 * AddAlbumSheet - Bottom sheet for searching and adding albums to a list.
 *
 * Two search modes:
 * - Artist: search artists by name, then browse their discography
 * - Album: search albums directly by name
 *
 * Albums are added to the specified list via incremental PATCH.
 * The sheet stays open after adding so users can add multiple albums.
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '@/components/ui/BottomSheet';
import {
  useArtistSearch,
  useAlbumSearch,
  useArtistAlbums,
  useArtistImage,
} from '@/hooks/useAlbumSearch';
import { getCoverArtUrl } from '@/services/search';
import { updateListItems } from '@/services/lists';
import { showToast } from '@/components/ui/Toast';
import type { MBArtistResult, MBAlbumResult } from '@/lib/types';
import { ArrowLeft, Search, Loader, Check } from 'lucide-react';

type SearchMode = 'artist' | 'album';

interface AddAlbumSheetProps {
  open: boolean;
  onClose: () => void;
  listId: string;
  listName: string;
  /** Called after an album is successfully added (sheet will close itself) */
  onAlbumAdded?: () => void;
}

// ── Styles ──

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: '8px',
  padding: '10px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: '16px',
  color: 'var(--color-text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const modeButtonStyle = (active: boolean): CSSProperties => ({
  flex: 1,
  padding: '6px 0',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  fontWeight: active ? 500 : 400,
  letterSpacing: '0.05em',
  color: active ? 'var(--color-gold)' : 'var(--color-text-secondary)',
  background: active ? 'rgba(232,200,122,0.10)' : 'transparent',
  border: active
    ? '1px solid rgba(232,200,122,0.25)'
    : '1px solid rgba(255,255,255,0.06)',
  borderRadius: '6px',
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
});

const resultCardStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '8px',
  padding: '10px',
  cursor: 'pointer',
  border: 'none',
  width: '100%',
  textAlign: 'left' as const,
};

const monoSmall: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  color: 'var(--color-text-secondary)',
};

const typeBadgeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '9px',
  fontWeight: 500,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
  padding: '2px 6px',
  borderRadius: '4px',
  flexShrink: 0,
};

// ── Sub-components ──

function ArtistCard({
  artist,
  onSelect,
}: {
  artist: MBArtistResult;
  onSelect: () => void;
}) {
  const { imageUrl } = useArtistImage(artist.name, artist.id);

  return (
    <button
      type="button"
      style={{
        ...resultCardStyle,
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
      }}
      onClick={onSelect}
    >
      {/* Artist thumbnail */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          overflow: 'hidden',
          flexShrink: 0,
          background: 'rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '18px',
              color: 'rgba(255,255,255,0.15)',
              lineHeight: 1,
            }}
          >
            {artist.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'rgba(255,255,255,0.75)',
            marginBottom: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {artist.name}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            ...monoSmall,
            fontSize: '11px',
          }}
        >
          {artist.type && <span>{artist.type}</span>}
          {artist.country && <span>{artist.country}</span>}
          {artist.disambiguation && (
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {artist.disambiguation}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function AlbumResultCard({
  album,
  onAdd,
  adding,
  added,
}: {
  album: MBAlbumResult;
  onAdd: () => void;
  adding: boolean;
  added: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const coverUrl = getCoverArtUrl(album.id);
  const year = album.releaseDate?.substring(0, 4);
  const currentYear = new Date().getFullYear().toString();
  const isNew = year === currentYear;

  return (
    <button
      type="button"
      style={{
        ...resultCardStyle,
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        opacity: adding ? 0.6 : 1,
      }}
      onClick={onAdd}
      disabled={adding || added}
    >
      {/* Cover art */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '4px',
          overflow: 'hidden',
          flexShrink: 0,
          background: 'rgba(255,255,255,0.05)',
        }}
      >
        {!imgError ? (
          <img
            src={coverUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: 'rgba(255,255,255,0.15)',
            }}
          >
            No art
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'rgba(255,255,255,0.75)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: '2px',
          }}
        >
          {album.title}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: '3px',
          }}
        >
          {album.artist}
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span
            style={{
              ...typeBadgeStyle,
              background:
                album.type === 'EP'
                  ? 'rgba(96,165,250,0.12)'
                  : 'rgba(255,255,255,0.05)',
              color: album.type === 'EP' ? '#60a5fa' : 'rgba(255,255,255,0.35)',
            }}
          >
            {album.type}
          </span>
          {year && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.30)',
              }}
            >
              {year}
            </span>
          )}
          {isNew && (
            <span
              style={{
                ...typeBadgeStyle,
                background: 'rgba(52,211,153,0.12)',
                color: '#34d399',
              }}
            >
              NEW
            </span>
          )}
        </div>
      </div>

      {/* Added indicator */}
      {added && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'rgba(76,175,80,0.15)',
            alignSelf: 'center',
          }}
        >
          <Check size={14} style={{ color: '#4CAF50' }} />
        </div>
      )}

      {adding && (
        <div style={{ flexShrink: 0, alignSelf: 'center' }}>
          <Loader
            size={16}
            style={{
              color: 'var(--color-text-secondary)',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      )}
    </button>
  );
}

// ── Main Component ──

export function AddAlbumSheet({
  open,
  onClose,
  listId,
  listName,
  onAlbumAdded,
}: AddAlbumSheetProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<SearchMode>('artist');
  const [query, setQuery] = useState('');
  const [selectedArtist, setSelectedArtist] = useState<MBArtistResult | null>(
    null
  );
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Search queries
  const artistSearch = useArtistSearch(query);
  const albumSearch = useAlbumSearch(query);
  const artistAlbums = useArtistAlbums(selectedArtist?.id ?? null);

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (open) {
      setQuery('');
      setMode('artist');
      setSelectedArtist(null);
      setAddingId(null);
      setAddedIds(new Set());
      // Focus input after animation
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [open]);

  const handleSearch = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      // Dismiss the keyboard on iOS
      inputRef.current?.blur();
      setSelectedArtist(null);
      if (mode === 'artist') {
        artistSearch.refetch();
      } else {
        albumSearch.refetch();
      }
    },
    [query, mode, artistSearch, albumSearch]
  );

  const handleSelectArtist = useCallback((artist: MBArtistResult) => {
    setSelectedArtist(artist);
  }, []);

  const handleBackToArtists = useCallback(() => {
    setSelectedArtist(null);
  }, []);

  const handleAddAlbum = useCallback(
    async (album: MBAlbumResult) => {
      if (addingId || addedIds.has(album.id)) return;

      setAddingId(album.id);
      try {
        const albumData = {
          artist: album.artist,
          album: album.title,
          album_id: album.id,
          release_date: album.releaseDate ?? '',
          country: '',
          genre_1: '',
          genre_2: '',
          track_pick: '',
          comments: '',
          comments_2: '',
        };

        const result = await updateListItems(listId, {
          added: [albumData],
        });

        if (result.duplicates && result.duplicates.length > 0) {
          showToast(`"${album.title}" is already in this list`, 'error');
        } else {
          showToast(`Added "${album.title}"`, 'success');
          // Invalidate list data so it refreshes
          queryClient.invalidateQueries({
            queryKey: ['lists', listId, 'albums'],
          });
          queryClient.invalidateQueries({
            queryKey: ['lists', 'metadata'],
          });
          // Close sheet and notify parent
          onClose();
          onAlbumAdded?.();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to add album';
        showToast(msg, 'error');
      } finally {
        setAddingId(null);
      }
    },
    [listId, addingId, addedIds, queryClient, onClose, onAlbumAdded]
  );

  const isSearching = artistSearch.isFetching || albumSearch.isFetching;
  const isLoadingAlbums = artistAlbums.isFetching;

  // Determine what to display
  const showArtistResults =
    mode === 'artist' &&
    !selectedArtist &&
    artistSearch.data &&
    artistSearch.data.length > 0;

  const showAlbumResults =
    (mode === 'album' && albumSearch.data && albumSearch.data.length > 0) ||
    (mode === 'artist' && selectedArtist && artistAlbums.data);

  const albumResults =
    mode === 'album' ? (albumSearch.data ?? []) : (artistAlbums.data ?? []);

  const noResults =
    !isSearching &&
    !isLoadingAlbums &&
    ((mode === 'artist' &&
      !selectedArtist &&
      artistSearch.data &&
      artistSearch.data.length === 0) ||
      (mode === 'album' && albumSearch.data && albumSearch.data.length === 0));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add Album"
      subtitle={`to ${listName}`}
      tall
    >
      <div style={{ padding: '0 4px' }}>
        {/* Search form */}
        <form onSubmit={handleSearch} style={{ marginBottom: '8px' }}>
          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginBottom: '8px',
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === 'artist'
                  ? 'Search for an artist...'
                  : 'Search for an album...'
              }
              style={{ ...inputStyle, flex: 1 }}
              data-testid="add-album-search-input"
            />
            <button
              type="submit"
              disabled={!query.trim() || isSearching}
              style={{
                padding: '0 14px',
                borderRadius: '8px',
                border: 'none',
                background:
                  query.trim() && !isSearching
                    ? 'var(--color-gold)'
                    : 'rgba(255,255,255,0.08)',
                color:
                  query.trim() && !isSearching
                    ? '#1A1A1F'
                    : 'rgba(255,255,255,0.3)',
                cursor: query.trim() && !isSearching ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              data-testid="add-album-search-btn"
            >
              {isSearching ? (
                <Loader
                  size={16}
                  style={{ animation: 'spin 1s linear infinite' }}
                />
              ) : (
                <Search size={16} />
              )}
            </button>
          </div>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              style={modeButtonStyle(mode === 'artist')}
              onClick={() => {
                setMode('artist');
                setSelectedArtist(null);
              }}
            >
              Artist
            </button>
            <button
              type="button"
              style={modeButtonStyle(mode === 'album')}
              onClick={() => {
                setMode('album');
                setSelectedArtist(null);
              }}
            >
              Album
            </button>
          </div>
        </form>

        {/* Artist breadcrumb (when viewing an artist's albums) */}
        {selectedArtist && (
          <button
            type="button"
            onClick={handleBackToArtists}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'none',
              border: 'none',
              padding: '6px 0',
              cursor: 'pointer',
              marginBottom: '4px',
            }}
          >
            <ArrowLeft
              size={14}
              style={{ color: 'var(--color-text-secondary)' }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: 'var(--color-gold)',
                fontWeight: 500,
              }}
            >
              {selectedArtist.name}
            </span>
            {artistAlbums.data && (
              <span style={{ ...monoSmall, fontSize: '11px' }}>
                {artistAlbums.data.length} album
                {artistAlbums.data.length !== 1 ? 's' : ''}
              </span>
            )}
          </button>
        )}

        {/* Loading state */}
        {(isSearching || isLoadingAlbums) && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              padding: '24px 0',
            }}
          >
            <Loader
              size={18}
              style={{
                color: 'var(--color-text-secondary)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
              }}
            >
              {isSearching ? 'Searching...' : 'Loading albums...'}
            </span>
          </div>
        )}

        {/* No results */}
        {noResults && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 0',
              ...monoSmall,
              fontSize: '11px',
            }}
          >
            No results found for &quot;{query}&quot;
          </div>
        )}

        {/* Artist results */}
        {showArtistResults && !isSearching && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {artistSearch.data!.map((artist) => (
              <ArtistCard
                key={artist.id}
                artist={artist}
                onSelect={() => handleSelectArtist(artist)}
              />
            ))}
          </div>
        )}

        {/* Album results */}
        {showAlbumResults && !isSearching && !isLoadingAlbums && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {albumResults.map((album) => (
              <AlbumResultCard
                key={album.id}
                album={album}
                onAdd={() => handleAddAlbum(album)}
                adding={addingId === album.id}
                added={addedIds.has(album.id)}
              />
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
