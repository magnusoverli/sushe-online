/**
 * AlbumCard - Album list item with 6 visual states.
 *
 * Spec (pages 3-5, 7):
 * States: default, hover, active (selected), drop-target, dragging, dimmed
 *
 * Anatomy:
 * - Rank: 11px DM Mono w300, rgba(255,255,255,0.15), width 15px, text-align right
 * - Cover: 60x60px, radius 10px, gradient + shadow, position relative (play btn child)
 * - Title: DM Serif Display 15px, #F0ECE4, -0.01em, lh 1.3, truncate
 * - Artist: DM Mono 11px, rgba(255,255,255,0.4), +0.02em, mt 2px, truncate
 * - Tags: flex row, gap 6px, mt 6px
 * - Active indicator: 3x32px, radius 2px, gold gradient, opacity 0/1
 * - Three-dot button: 28x28px on right edge (always in layout; visibility:hidden when no handler)
 *
 * Card: flex center, gap 10px, padding 5px, radius 16px, border 1px transparent (list has no horizontal margin - cards are full-bleed)
 * Transitions: background 150ms, opacity 200ms, transform 200ms, border-color 150ms
 */

import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useCallback,
} from 'react';
import { MoreVertical, Headphones } from 'lucide-react';
import { TagPill } from './TagPill';
import { formatPlaycount } from '@/lib/utils';

export type CardState = 'default' | 'hover' | 'active';

export interface AlbumCardProps {
  rank?: number;
  title: string;
  artist: string;
  coverElement?: ReactNode;
  tags?: string[];
  /** Release date string (e.g. "1997-06-16"). Year is extracted for display. */
  releaseDate?: string | null;
  /** Country of origin (e.g. "United Kingdom"). */
  country?: string | null;
  /** Whether the release date mismatches the list year (renders date in red). */
  yearMismatch?: boolean;
  isActive?: boolean;
  cardState?: CardState;
  onMenuClick?: (e: React.MouseEvent | React.TouchEvent) => void;
  onClick?: () => void;
  showRank?: boolean;
  /** Whether to actually display the rank number. When false the column space
   *  is still reserved so cover art stays aligned across all cards. */
  rankVisible?: boolean;
  /** Last.fm scrobble count. If provided and > 0, shown next to artist name. */
  playcount?: number;
  className?: string;
  style?: CSSProperties;
}

// ── State-dependent styles ──

function getCardBg(state: CardState): string {
  switch (state) {
    case 'hover':
      return 'var(--color-card-hover)';
    default:
      return 'transparent';
  }
}

// ── Component ──

export const AlbumCard = forwardRef<HTMLDivElement, AlbumCardProps>(
  function AlbumCard(
    {
      rank,
      title,
      artist,
      coverElement,
      tags,
      releaseDate,
      country,
      yearMismatch = false,
      isActive = false,
      cardState = 'default',
      onMenuClick,
      onClick,
      showRank = true,
      rankVisible = true,
      playcount,
      className,
      style,
    },
    ref
  ) {
    const effectiveState = cardState;

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
      border: '1px solid transparent',
      transition: 'background 150ms ease',
      cursor: onClick ? 'pointer' : 'default',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      position: 'relative',
      ...style,
    };

    return (
      <div
        ref={ref}
        className={className || undefined}
        style={cardStyle}
        onClick={onClick}
        data-testid="album-card"
        role="listitem"
      >
        {/* Rank — always rendered to reserve space; visibility controls display */}
        {rank != null && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              fontWeight: 300,
              letterSpacing: 0,
              color: 'var(--color-text-rank)',
              width: '5px',
              textAlign: 'right',
              flexShrink: 0,
              marginRight: '2px',
              visibility: showRank && rankVisible ? 'visible' : 'hidden',
            }}
            data-testid="album-rank"
          >
            {rank}
          </span>
        )}

        {/* Cover art */}
        <div
          style={{
            width: '88px',
            height: '88px',
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

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '2px',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 400,
                letterSpacing: '0.015em',
                color: 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              data-testid="album-artist"
            >
              {artist}
            </span>

            {playcount != null && playcount > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 400,
                  letterSpacing: '0.015em',
                  color: 'rgba(255,255,255,0.25)',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
                data-testid="album-playcount"
                title={`${playcount.toLocaleString()} plays on Last.fm`}
              >
                <Headphones size={9} />
                {formatPlaycount(playcount)}
              </span>
            )}
          </div>

          {/* Release date + country metadata line */}
          {(releaseDate || country) && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 400,
                letterSpacing: '0.015em',
                color: 'var(--color-text-secondary)',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              data-testid="album-metadata"
            >
              {releaseDate && (
                <span
                  style={
                    yearMismatch
                      ? { color: 'var(--color-destructive)' }
                      : undefined
                  }
                  data-testid="album-release-date"
                >
                  {releaseDate.substring(0, 4)}
                </span>
              )}
              {releaseDate && country ? ' · ' : ''}
              {country && <span data-testid="album-country">{country}</span>}
            </span>
          )}

          {tags && tags.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '4px',
                marginTop: '6px',
              }}
            >
              {tags.map((tag) => (
                <TagPill key={tag}>{tag}</TagPill>
              ))}
            </div>
          )}
        </div>

        {/* Three-dot menu button — always rendered to preserve layout width.
          When onMenuClick is absent (e.g. during drag) the button is hidden
          via visibility so the 28px column stays in the flow and card height
          remains stable. */}
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
            cursor: onMenuClick ? 'pointer' : 'default',
            flexShrink: 0,
            padding: 0,
            color: 'rgba(255,255,255,0.55)',
            transition: 'background 150ms ease, border-color 150ms ease',
            visibility: onMenuClick ? 'visible' : 'hidden',
            pointerEvents: onMenuClick ? 'auto' : 'none',
          }}
          onClick={onMenuClick ? handleMenuClick : undefined}
          onTouchStart={
            onMenuClick
              ? (e: React.TouchEvent) => e.stopPropagation()
              : undefined
          }
          onTouchEnd={
            onMenuClick
              ? (e: React.TouchEvent) => {
                  e.preventDefault();
                  handleMenuClick(e);
                }
              : undefined
          }
          aria-label={onMenuClick ? `Menu for ${title}` : undefined}
          aria-hidden={!onMenuClick}
          data-testid="album-menu-button"
        >
          <MoreVertical size={14} />
        </button>

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
);
