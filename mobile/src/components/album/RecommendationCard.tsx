/**
 * RecommendationCard - Album card variant for recommendation browsing.
 *
 * Similar to AlbumCard but shows recommender info and reasoning excerpt.
 * Used when viewing recommendations for a year in the LibraryPage.
 *
 * Anatomy:
 * - Cover: 60x60px with lazy-loaded image
 * - Title: album name
 * - Artist: artist name
 * - Recommender: "By {username}" with date
 * - Reasoning: truncated to 2 lines (if exists)
 * - Three-dot menu button for actions
 */

import { type CSSProperties, useCallback, memo } from 'react';
import { MoreVertical, ThumbsUp, MessageCircle } from 'lucide-react';
import { CoverImage } from './CoverImage';
import { getAlbumCoverUrl } from '@/services/albums';
import type { Recommendation } from '@/lib/types';

export interface RecommendationCardProps {
  recommendation: Recommendation;
  onMenuClick: (rec: Recommendation) => void;
  onReasoningClick?: (rec: Recommendation) => void;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-card-gap-inner)',
  padding: 'var(--space-card-y) var(--space-card-x)',
  borderRadius: 'var(--radius-card)',
  background: 'transparent',
  border: '1px solid transparent',
  transition: 'background 150ms ease',
  cursor: 'default',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  position: 'relative',
};

export const RecommendationCard = memo(function RecommendationCard({
  recommendation: rec,
  onMenuClick,
  onReasoningClick,
}: RecommendationCardProps) {
  const handleMenuClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      onMenuClick(rec);
    },
    [onMenuClick, rec]
  );

  const handleReasoningClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onReasoningClick?.(rec);
    },
    [onReasoningClick, rec]
  );

  const hasReasoning = !!rec.reasoning?.trim();
  const dateStr = formatDate(rec.created_at);
  const genreParts = [rec.genre_1, rec.genre_2].filter(Boolean);
  const genreText = genreParts.length > 0 ? genreParts.join(', ') : null;

  return (
    <div style={cardStyle} data-testid="recommendation-card" role="listitem">
      {/* Cover art */}
      <div
        style={{
          width: '60px',
          height: '60px',
          borderRadius: 'var(--radius-cover)',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <CoverImage
          src={rec.album_id ? getAlbumCoverUrl(rec.album_id) : undefined}
          alt={`${rec.album} by ${rec.artist}`}
        />
      </div>

      {/* Info */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '1px',
        }}
      >
        {/* Album name */}
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            fontWeight: 400,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          data-testid="rec-card-title"
        >
          {rec.album}
        </span>

        {/* Artist */}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 400,
            letterSpacing: '0.02em',
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          data-testid="rec-card-artist"
        >
          {rec.artist}
        </span>

        {/* Recommender + date */}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginTop: '2px',
          }}
        >
          <ThumbsUp size={9} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              fontWeight: 400,
              color: '#60a5fa',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            data-testid="rec-card-recommender"
          >
            {rec.recommended_by}
          </span>
          {dateStr && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--color-text-muted)',
                flexShrink: 0,
              }}
            >
              {dateStr}
            </span>
          )}
          {genreText && (
            <>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                }}
              >
                ·
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {genreText}
              </span>
            </>
          )}
        </span>

        {/* Reasoning excerpt */}
        {hasReasoning && (
          <button
            type="button"
            onClick={handleReasoningClick}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '4px',
              marginTop: '3px',
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            data-testid="rec-card-reasoning"
          >
            <MessageCircle
              size={9}
              style={{
                color: '#a78bfa',
                flexShrink: 0,
                marginTop: '1px',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                fontWeight: 400,
                color: 'rgba(255,255,255,0.30)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {rec.reasoning}
            </span>
          </button>
        )}
      </div>

      {/* Three-dot menu button */}
      <button
        type="button"
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '7px',
          border: '1px solid transparent',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          padding: 0,
          color: 'rgba(255,255,255,0.55)',
          transition: 'background 150ms ease, border-color 150ms ease',
        }}
        onClick={handleMenuClick}
        onTouchEnd={(e: React.TouchEvent) => {
          e.preventDefault();
          handleMenuClick(e);
        }}
        aria-label={`Menu for ${rec.album}`}
        data-testid="rec-card-menu-button"
      >
        <MoreVertical size={14} />
      </button>
    </div>
  );
});
