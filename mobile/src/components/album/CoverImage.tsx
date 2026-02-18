/**
 * CoverImage - Lazy-loaded album cover with IntersectionObserver.
 *
 * Features:
 * - Lazy loading with 200px rootMargin (loads before entering viewport)
 * - Placeholder gradient while loading
 * - Fade-in on load
 * - Position badge overlay (rank with gold/silver/bronze for top 3)
 * - AI summary badge
 * - Recommendation badge
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Bot, ThumbsUp } from 'lucide-react';

interface CoverImageProps {
  src: string | undefined;
  alt: string;
  /** Album rank (1-based) - shown as position badge */
  rank?: number;
  /** Whether to show rank badge (only for main lists) */
  showRank?: boolean;
  /** Whether album has an AI summary */
  hasSummary?: boolean;
  /** Whether album was recommended by someone */
  hasRecommendation?: boolean;
  /** Handler for clicking the summary badge */
  onSummaryClick?: () => void;
  /** Handler for clicking the recommendation badge */
  onRecommendationClick?: () => void;
  /** Size in pixels (default 52) */
  size?: number;
}

/** Badge colors for top 3 positions */
function getRankBadgeColor(rank: number): string {
  switch (rank) {
    case 1:
      return '#E8C87A'; // gold
    case 2:
      return '#C0C0C0'; // silver
    case 3:
      return '#CD7F32'; // bronze
    default:
      return 'rgba(255,255,255,0.6)';
  }
}

function getRankBadgeBg(rank: number): string {
  if (rank <= 3) return 'rgba(0,0,0,0.7)';
  return 'rgba(0,0,0,0.5)';
}

export const CoverImage = memo(function CoverImage({
  src,
  alt,
  rank,
  showRank = false,
  hasSummary = false,
  hasRecommendation = false,
  onSummaryClick,
  onRecommendationClick,
  size = 52,
}: CoverImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsInView(true);
          observer.unobserve(el);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleLoad = useCallback(() => setIsLoaded(true), []);
  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true);
  }, []);

  const showImage = isInView && src && !hasError;

  return (
    <div
      ref={containerRef}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-cover)',
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
        background:
          'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
      }}
      data-testid="cover-image"
    >
      {/* Actual image */}
      {showImage && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={handleLoad}
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 200ms ease',
          }}
          data-testid="cover-img"
        />
      )}

      {/* Position badge */}
      {showRank && rank != null && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            minWidth: 16,
            height: 16,
            borderRadius: 4,
            background: getRankBadgeBg(rank),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
          }}
          data-testid="cover-rank-badge"
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              fontWeight: 500,
              color: getRankBadgeColor(rank),
              lineHeight: 1,
            }}
          >
            {rank}
          </span>
        </div>
      )}

      {/* AI Summary badge */}
      {hasSummary && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSummaryClick?.();
          }}
          style={{
            position: 'absolute',
            bottom: 2,
            left: 2,
            width: 16,
            height: 16,
            borderRadius: 4,
            background: 'rgba(0,0,0,0.65)',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.7)',
          }}
          aria-label="View AI summary"
          data-testid="cover-summary-badge"
        >
          <Bot size={10} strokeWidth={1.5} />
        </button>
      )}

      {/* Recommendation badge */}
      {hasRecommendation && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRecommendationClick?.();
          }}
          style={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            width: 16,
            height: 16,
            borderRadius: 4,
            background: 'rgba(0,0,0,0.65)',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.7)',
          }}
          aria-label="View recommendation"
          data-testid="cover-recommendation-badge"
        >
          <ThumbsUp size={10} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
});
