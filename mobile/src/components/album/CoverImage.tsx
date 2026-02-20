/**
 * CoverImage - Lazy-loaded album cover with IntersectionObserver.
 *
 * Features:
 * - Lazy loading with 200px rootMargin (loads before entering viewport)
 * - Placeholder gradient while loading
 * - Fade-in on load
 * - AI summary badge
 * - Recommendation badge
 * - Play button overlay (design spec p10-11: translucent bg, SVG triangle)
 * - Now-playing animated border (rotating conic-gradient, Spotify green)
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Bot, ThumbsUp } from 'lucide-react';

interface CoverImageProps {
  src: string | undefined;
  alt: string;
  /** Whether album has an AI summary */
  hasSummary?: boolean;
  /** Whether album was recommended by someone */
  hasRecommendation?: boolean;
  /** Handler for clicking the summary badge */
  onSummaryClick?: () => void;
  /** Handler for clicking the recommendation badge */
  onRecommendationClick?: () => void;
  /** Handler for tapping the play button overlay */
  onPlay?: () => void;
  /** Whether this album is currently playing (shows animated border) */
  isNowPlaying?: boolean;
}

export const CoverImage = memo(function CoverImage({
  src,
  alt,
  hasSummary = false,
  hasRecommendation = false,
  onSummaryClick,
  onRecommendationClick,
  onPlay,
  isNowPlaying = false,
}: CoverImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

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

  // Clean up play overlay timer
  useEffect(() => {
    return () => {
      if (playOverlayTimerRef.current) {
        clearTimeout(playOverlayTimerRef.current);
      }
    };
  }, []);

  const handleLoad = useCallback(() => setIsLoaded(true), []);
  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true);
  }, []);

  const handlePlayTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!onPlay) return;
      e.stopPropagation();
      e.preventDefault();

      // Show overlay briefly, then trigger action
      setShowPlayOverlay(true);
      playOverlayTimerRef.current = setTimeout(() => {
        setShowPlayOverlay(false);
        onPlay();
      }, 300);
    },
    [onPlay]
  );

  const showImage = isInView && src && !hasError;

  return (
    <div
      ref={containerRef}
      className={isNowPlaying ? 'cover-now-playing' : undefined}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'var(--radius-cover)',
        overflow: isNowPlaying ? 'visible' : 'hidden',
        position: 'relative',
        flexShrink: 0,
        background:
          'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
      }}
      data-testid="cover-image"
    >
      {/* Inner container to clip image while allowing border overflow */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 'var(--radius-cover)',
          overflow: 'hidden',
          position: 'relative',
        }}
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

        {/* Play button overlay */}
        {onPlay && isLoaded && !hasError && (
          <button
            type="button"
            onClick={handlePlayTap}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.55)',
              border: 'none',
              borderRadius: 'var(--radius-cover)',
              cursor: 'pointer',
              padding: 0,
              opacity: showPlayOverlay ? 1 : 0,
              transition: 'opacity 150ms ease',
              zIndex: 2,
            }}
            aria-label="Play album"
            data-testid="cover-play-overlay"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <polygon points="3,1 13,7 3,13" fill="white" />
            </svg>
          </button>
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
              zIndex: 1,
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
              zIndex: 1,
            }}
            aria-label="View recommendation"
            data-testid="cover-recommendation-badge"
          >
            <ThumbsUp size={10} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
});
