/**
 * ListHeader - Sticky section header for the album list view.
 *
 * Split into two parts:
 * - ListHeader: Title row + divider — sticky inside the scroll container,
 *   stays pinned at the top as albums scroll underneath.
 * - ListHeaderMeta: Metadata + sort control — rendered below the sticky
 *   header, scrolls away naturally with the album list.
 *
 * The title shrink animation uses compositor-friendly properties
 * (transform, clip-path) for smooth scroll-driven animation:
 * - transform: scale() on the h1 with transform-origin: left top
 *   (title anchors at top-left, space freed below)
 * - transform: translateY() on the divider (moves up to stay close
 *   to the shrunken title)
 * - clip-path: inset(0 0 Xpx 0) on the outer div (clips freed space
 *   from the bottom only — no top clipping of the title)
 *
 * The header includes env(safe-area-inset-top) padding so it covers
 * the notch/status bar zone when stuck at the top.
 *
 * Design spec:
 * - Title: DM Serif Display 32px → 18px via scale(), letter-spacing -0.01em
 * - Divider: 1px solid rgba(255,255,255,0.05), 4px from edges
 * - Padding: 28px horizontal, 6px top + safe area
 */

import { useRef, useEffect, type ReactNode } from 'react';
import { MoreVertical, Lock } from 'lucide-react';

/** Title uses transform: scale() — fontSize stays constant at 32px */
const FONT_SIZE = 32;
const SCALE_END = 18 / 32; // 0.5625 — visually 18px at full collapse
const TITLE_LINE_HEIGHT = 1.15;

/** Layout height of the title (unchanged by transform) */
const TITLE_LAYOUT_HEIGHT = FONT_SIZE * TITLE_LINE_HEIGHT; // ~36.8px

/** Space freed below the title by scaling (transform-origin: left top) */
const TITLE_VISUAL_COLLAPSE = TITLE_LAYOUT_HEIGHT * (1 - SCALE_END); // ~16.1px

const PADDING_TOP = 6;
const DIVIDER_MT = 4;

/** How much the divider moves up: matches title visual collapse (gap stays constant) */
const DIVIDER_SHIFT = TITLE_VISUAL_COLLAPSE; // ~16.1px

/** Extra upward lift applied to all content (title, buttons, divider) */
const CONTENT_LIFT = 3;

/** Extra downward nudge for action buttons (closer to divider) */
const ACTIONS_OFFSET = 8;

/** Clip from bottom: freed space + content lift */
const CLIP_BOTTOM = DIVIDER_SHIFT + CONTENT_LIFT; // ~19.1px

/** Scroll distance (px) over which the title shrinks */
const SHRINK_DISTANCE = 200;

interface ListHeaderProps {
  /** List name */
  title: string;
  /** Hamburger menu click handler */
  onMenuClick?: () => void;
  /** List options (ellipsis) click handler */
  onOptionsClick?: () => void;
}

export function ListHeader({
  title,
  onMenuClick,
  onOptionsClick,
}: ListHeaderProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);

  // rAF-throttled scroll listener — compositor-friendly properties only
  useEffect(() => {
    const outerEl = outerRef.current;
    const titleEl = titleRef.current;
    const actionsEl = actionsRef.current;
    const dividerEl = dividerRef.current;
    if (!outerEl || !titleEl || !dividerEl) return;

    // Find the nearest scrollable ancestor (the <main> element)
    const scrollEl = outerEl.closest('[data-testid="app-shell-content"]');
    if (!scrollEl) return;

    let rafId = 0;

    const update = () => {
      const progress = Math.min(
        1,
        Math.max(0, scrollEl.scrollTop / SHRINK_DISTANCE)
      );
      const scale = 1 + (SCALE_END - 1) * progress;
      const lift = CONTENT_LIFT * progress;
      const shift = DIVIDER_SHIFT * progress + lift;
      const clip = CLIP_BOTTOM * progress;

      // Everything shifts up by the same lift amount;
      // divider also shifts by title collapse to close the gap
      titleEl.style.transform = `translateY(${-lift}px) scale(${scale})`;
      if (actionsEl)
        actionsEl.style.transform = `translateY(${ACTIONS_OFFSET - shift}px)`;
      dividerEl.style.transform = `translateY(${-shift}px)`;
      outerEl.style.clipPath = `inset(0 0 ${clip}px 0)`;
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    // Apply initial state synchronously
    update();

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  });

  return (
    <div
      ref={outerRef}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--color-bg)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
      data-testid="list-header"
    >
      <div
        style={{
          padding: `${PADDING_TOP}px var(--space-header-x) 0px`,
        }}
      >
        {/* Title row: title + actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <h1
            ref={titleRef}
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: `${FONT_SIZE}px`,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              lineHeight: TITLE_LINE_HEIGHT,
              color: 'var(--color-text-primary)',
              margin: 0,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              transformOrigin: 'left top',
              willChange: 'transform',
            }}
            data-testid="list-header-title"
          >
            {title}
          </h1>
          <div
            ref={actionsRef}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              flexShrink: 0,
              willChange: 'transform',
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
            marginTop: `${DIVIDER_MT}px`,
            marginLeft: 'calc(-1 * var(--space-header-x) + 4px)',
            marginRight: 'calc(-1 * var(--space-header-x) + 4px)',
            willChange: 'transform',
          }}
        />
      </div>
    </div>
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
        padding: '9px var(--space-header-x) 4px',
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
            <span style={{ fontSize: '9px', letterSpacing: '0.05em' }}>
              LOCKED
            </span>
          </span>
        )}
      </span>
      {sortControl && <div style={{ position: 'relative' }}>{sortControl}</div>}
    </div>
  );
}
