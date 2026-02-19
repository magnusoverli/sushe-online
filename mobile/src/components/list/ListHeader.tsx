/**
 * ListHeader - Section header for the album list view.
 *
 * Split into two parts:
 * - ListHeader: Title row + divider — rendered in the fixed AppShell header slot
 * - ListHeaderMeta: Metadata + sort control — rendered inside the scroll area
 *   so it naturally scrolls away as the user scrolls the album list
 *
 * Design spec:
 * - Title: DM Serif Display 32px, #F0ECE4, letter-spacing -0.01em
 * - Metadata: DM Mono 12px, secondary color
 * - Divider: 1px solid rgba(255,255,255,0.05), 4px from edges
 * - Padding: 28px horizontal, 6px top, 0px bottom
 */

import { useRef, useEffect, type ReactNode, type RefObject } from 'react';
import { MoreVertical, Lock } from 'lucide-react';

/** Title font size range */
const FONT_SIZE_START = 32;
const FONT_SIZE_END = 18;

/** Header top padding range */
const PADDING_TOP_START = 6;
const PADDING_TOP_END = 0;

/** Divider margin-top range */
const DIVIDER_MT_START = 4;
const DIVIDER_MT_END = 2;

/** Scroll distance (px) over which the title shrinks */
const SHRINK_DISTANCE = 120;

interface ListHeaderProps {
  /** List name */
  title: string;
  /** Hamburger menu click handler */
  onMenuClick?: () => void;
  /** List options (ellipsis) click handler */
  onOptionsClick?: () => void;
  /** Ref to the scroll container — drives title shrink via direct DOM updates */
  scrollRef?: RefObject<HTMLElement | null>;
}

export function ListHeader({
  title,
  onMenuClick,
  onOptionsClick,
  scrollRef,
}: ListHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);

  // Attach scroll listener and animate title size via direct DOM updates
  useEffect(() => {
    const scrollEl = scrollRef?.current;
    const headerEl = headerRef.current;
    const titleEl = titleRef.current;
    const dividerEl = dividerRef.current;
    if (!scrollEl || !headerEl || !titleEl || !dividerEl) return;

    const lerp = (start: number, end: number, t: number) =>
      start + (end - start) * t;

    const onScroll = () => {
      const progress = Math.min(
        1,
        Math.max(0, scrollEl.scrollTop / SHRINK_DISTANCE)
      );
      titleEl.style.fontSize = `${lerp(FONT_SIZE_START, FONT_SIZE_END, progress)}px`;
      headerEl.style.paddingTop = `${lerp(PADDING_TOP_START, PADDING_TOP_END, progress)}px`;
      dividerEl.style.marginTop = `${lerp(DIVIDER_MT_START, DIVIDER_MT_END, progress)}px`;
    };

    onScroll();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', onScroll);
  });

  return (
    <header
      ref={headerRef}
      style={{
        padding: `${PADDING_TOP_START}px var(--space-header-x) 0px`,
      }}
      data-testid="list-header"
    >
      {/* Title row: title + actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <h1
          ref={titleRef}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: `${FONT_SIZE_START}px`,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            lineHeight: 1.15,
            color: 'var(--color-text-primary)',
            margin: 0,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          data-testid="list-header-title"
        >
          {title}
        </h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            flexShrink: 0,
          }}
        >
          {onOptionsClick && (
            <button
              type="button"
              onClick={onOptionsClick}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="List options"
              data-testid="list-header-options"
            >
              <MoreVertical size={18} />
            </button>
          )}
          {onMenuClick && (
            <button
              type="button"
              onClick={onMenuClick}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Open navigation"
              data-testid="list-header-menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="3" y1="5" x2="17" y2="5" />
                <line x1="3" y1="10" x2="17" y2="10" />
                <line x1="3" y1="15" x2="17" y2="15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div
        ref={dividerRef}
        style={{
          height: '1px',
          background: 'var(--color-divider)',
          marginTop: `${DIVIDER_MT_START}px`,
          marginLeft: 'calc(-1 * var(--space-header-x) + 4px)',
          marginRight: 'calc(-1 * var(--space-header-x) + 4px)',
        }}
      />
    </header>
  );
}

interface ListHeaderMetaProps {
  /** Album count */
  albumCount?: number;
  /** List year */
  year?: number | null;
  /** Whether this list is locked (year locked + main list) */
  isLocked?: boolean;
  /** Optional sort control rendered right-aligned */
  sortControl?: ReactNode;
}

export function ListHeaderMeta({
  albumCount,
  year,
  isLocked = false,
  sortControl,
}: ListHeaderMetaProps) {
  const metaParts: string[] = [];
  if (albumCount != null) {
    metaParts.push(`${albumCount} album${albumCount !== 1 ? 's' : ''}`);
  }
  if (year) {
    metaParts.push(String(year));
  }

  const hasContent = metaParts.length > 0 || isLocked || sortControl;
  if (!hasContent) return null;

  return (
    <div
      style={{
        padding: '4px var(--space-header-x)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
      data-testid="list-header-meta-row"
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: 400,
          letterSpacing: '0.02em',
          lineHeight: 1,
          color: 'var(--color-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
        data-testid="list-header-meta"
      >
        {metaParts.join(' · ')}
        {isLocked && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              opacity: 0.6,
            }}
            data-testid="list-header-lock"
          >
            <Lock size={10} />
            <span style={{ fontSize: '8px', letterSpacing: '0.06em' }}>
              LOCKED
            </span>
          </span>
        )}
      </span>
      {sortControl && <div style={{ position: 'relative' }}>{sortControl}</div>}
    </div>
  );
}
