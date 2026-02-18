/**
 * RecommendAlbumSheet - Enter reasoning for recommending an album.
 *
 * Shown when "Recommend" is tapped in the AlbumActionSheet for year-based lists.
 * The reasoning is limited to 500 characters.
 */

import { useState, useCallback } from 'react';
import { ThumbsUp, Loader } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAddRecommendation } from '@/hooks/useRecommendations';
import type { Album } from '@/lib/types';

interface RecommendAlbumSheetProps {
  open: boolean;
  onClose: () => void;
  album: Album | null;
  year: number | null;
}

const MAX_REASONING_LENGTH = 500;

export function RecommendAlbumSheet({
  open,
  onClose,
  album,
  year,
}: RecommendAlbumSheetProps) {
  const [reasoning, setReasoning] = useState('');
  const addRecommendation = useAddRecommendation();

  const handleSubmit = useCallback(async () => {
    if (!album || !year || !reasoning.trim()) return;

    try {
      await addRecommendation.mutateAsync({
        year,
        album: {
          artist: album.artist,
          album: album.album,
          release_date: album.release_date,
          country: album.country,
          genre_1: album.genre_1,
          genre_2: album.genre_2,
        },
        reasoning: reasoning.trim(),
      });
      setReasoning('');
      onClose();
    } catch {
      // Error already handled by the mutation hook (shows toast)
    }
  }, [album, year, reasoning, addRecommendation, onClose]);

  const handleClose = useCallback(() => {
    setReasoning('');
    onClose();
  }, [onClose]);

  if (!album || !year) return null;

  const subtitle = `${album.artist} \u2014 ${album.album}`;
  const charCount = reasoning.length;
  const isOverLimit = charCount > MAX_REASONING_LENGTH;

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title="Recommend Album"
      subtitle={subtitle}
    >
      <div style={{ padding: '4px 10px 8px' }}>
        {/* Album info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '12px',
            padding: '8px',
            borderRadius: '10px',
            background: 'rgba(96,165,250,0.08)',
          }}
        >
          <ThumbsUp size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.50)',
              lineHeight: 1.4,
            }}
          >
            Recommending to the {year} list
          </div>
        </div>

        {/* Reasoning textarea */}
        <div style={{ marginBottom: '4px' }}>
          <label
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '7px',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.25)',
              display: 'block',
              marginBottom: '6px',
            }}
          >
            Why are you recommending this?
          </label>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="Share your reasoning..."
            maxLength={MAX_REASONING_LENGTH + 50} // Allow typing slightly over to show warning
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '10px 12px',
              borderRadius: '8px',
              border: isOverLimit
                ? '1px solid var(--color-destructive)'
                : '1px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '16px', // Prevents iOS zoom
              lineHeight: 1.5,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Character count */}
        <div
          style={{
            textAlign: 'right',
            fontFamily: 'var(--font-mono)',
            fontSize: '7px',
            color: isOverLimit
              ? 'var(--color-destructive)'
              : 'rgba(255,255,255,0.25)',
            marginBottom: '12px',
          }}
        >
          {charCount}/{MAX_REASONING_LENGTH}
        </div>

        {/* Submit button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            !reasoning.trim() || isOverLimit || addRecommendation.isPending
          }
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '8px',
            border: 'none',
            background:
              !reasoning.trim() || isOverLimit
                ? 'rgba(255,255,255,0.05)'
                : 'rgba(96,165,250,0.20)',
            color:
              !reasoning.trim() || isOverLimit
                ? 'rgba(255,255,255,0.25)'
                : '#60a5fa',
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            fontWeight: 500,
            cursor: !reasoning.trim() || isOverLimit ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          {addRecommendation.isPending ? (
            <>
              <Loader
                size={12}
                style={{ animation: 'spin 1s linear infinite' }}
              />
              Recommending...
            </>
          ) : (
            'Recommend'
          )}
        </button>
      </div>
    </BottomSheet>
  );
}
