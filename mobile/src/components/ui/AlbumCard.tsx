/**
 * AlbumCard - Album list item with 6 visual states.
 *
 * Spec (pages 3-5, 7):
 * States: default, hover, active (selected), drop-target, dragging, dimmed
 *
 * Anatomy:
 * - Rank: 11px DM Mono w300, rgba(255,255,255,0.15), width 18px, text-align right
 * - Cover: 52x52px, radius 10px, gradient + shadow, position relative (play btn child)
 * - Title: DM Serif Display 15px, #F0ECE4, -0.01em, lh 1.3, truncate
 * - Artist: DM Mono 11px, rgba(255,255,255,0.4), +0.02em, mt 2px, truncate
 * - Tags: flex row, gap 6px, mt 6px
 * - Active indicator: 3x32px, radius 2px, gold gradient, opacity 0/1
 * - Three-dot button: 28x28px on right edge
 *
 * Card: flex center, gap 12px, padding 10px 12px, radius 16px, border 1px transparent
 * Transitions: background 150ms, opacity 200ms, transform 200ms, border-color 150ms
 */

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useState,
} from 'react';
import { MoreVertical } from 'lucide-react';
import { TagPill } from './TagPill';

export type CardState =
  | 'default'
  | 'hover'
  | 'active'
  | 'drop-target'
  | 'dragging'
  | 'dimmed';

export interface AlbumCardProps {
  rank?: number;
  title: string;
  artist: string;
  coverElement?: ReactNode;
  tags?: string[];
  isActive?: boolean;
  cardState?: CardState;
  onMenuClick?: (e: React.MouseEvent | React.TouchEvent) => void;
  onClick?: () => void;
  showRank?: boolean;
  className?: string;
  style?: CSSProperties;
}

// ── State-dependent styles ──

function getCardBg(state: CardState): string {
  switch (state) {
    case 'hover':
      return 'var(--color-card-hover)';
    case 'drop-target':
      return 'var(--color-card-drop)';
    default:
      return 'transparent';
  }
}

function getCardBorder(state: CardState): string {
  switch (state) {
    case 'drop-target':
      return '1px solid var(--color-border-drop)';
    default:
      return '1px solid transparent';
  }
}

function getCardOpacity(state: CardState): number {
  switch (state) {
    case 'dragging':
      return 0.2;
    case 'dimmed':
      return 0.55;
    default:
      return 1;
  }
}

function getCardTransform(state: CardState): string {
  return state === 'dragging' ? 'scale(0.97)' : 'none';
}

// ── Component ──

export function AlbumCard({
  rank,
  title,
  artist,
  coverElement,
  tags,
  isActive = false,
  cardState = 'default',
  onMenuClick,
  onClick,
  showRank = true,
  className,
  style,
}: AlbumCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const effectiveState =
    cardState === 'default' && isHovered ? 'hover' : cardState;

  const handleMenuClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      onMenuClick?.(e);
    },
    [onMenuClick]
  );

  const titleColor = isActive
    ? 'var(--color-gold)'
    : 'var(--color-text-primary)';

  const cardStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-card-gap-inner)',
    padding: 'var(--space-card-y) var(--space-card-x)',
    borderRadius: 'var(--radius-card)',
    background: getCardBg(effectiveState),
    border: getCardBorder(effectiveState),
    opacity: getCardOpacity(effectiveState),
    transform: getCardTransform(effectiveState),
    transition:
      'background 150ms ease, opacity 200ms ease, transform 200ms ease, border-color 150ms ease',
    cursor: onClick ? 'pointer' : 'default',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
    position: 'relative',
    ...style,
  };

  return (
    <div
      className={className}
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid="album-card"
      role="listitem"
    >
      {/* Rank */}
      {showRank && rank != null && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 300,
            letterSpacing: 0,
            color: 'var(--color-text-rank)',
            width: '18px',
            textAlign: 'right',
            flexShrink: 0,
          }}
          data-testid="album-rank"
        >
          {rank}
        </span>
      )}

      {/* Cover art */}
      <div
        style={{
          width: '52px',
          height: '52px',
          borderRadius: 'var(--radius-cover)',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
        data-testid="album-cover"
      >
        {coverElement}
      </div>

      {/* Info: title, artist, tags */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '15px',
            fontWeight: 400,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
            color: titleColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            transition: 'color 200ms ease',
          }}
          data-testid="album-title"
        >
          {title}
        </span>

        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 400,
            letterSpacing: '0.02em',
            color: 'var(--color-text-secondary)',
            marginTop: '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          data-testid="album-artist"
        >
          {artist}
        </span>

        {tags && tags.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              marginTop: '6px',
            }}
          >
            {tags.map((tag) => (
              <TagPill key={tag}>{tag}</TagPill>
            ))}
          </div>
        )}
      </div>

      {/* Three-dot menu button */}
      {onMenuClick && (
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
          onTouchEnd={handleMenuClick}
          aria-label={`Menu for ${title}`}
          data-testid="album-menu-button"
        >
          <MoreVertical size={14} />
        </button>
      )}

      {/* Active indicator bar */}
      <div
        style={{
          width: '3px',
          height: '32px',
          borderRadius: 'var(--radius-indicator)',
          background:
            'linear-gradient(180deg, var(--color-gold) 0%, var(--color-gold-dark) 100%)',
          opacity: isActive ? 1 : 0,
          flexShrink: 0,
          transition: 'opacity 200ms ease',
        }}
        data-testid="active-indicator"
      />
    </div>
  );
}
