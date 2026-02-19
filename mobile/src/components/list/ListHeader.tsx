/**
 * ListHeader - Section header for the album list view.
 *
 * Design spec:
 * - Title: DM Serif Display 32px, #F0ECE4, letter-spacing -0.01em
 * - Metadata: DM Mono 10px, rgba(255,255,255,0.20)
 * - Divider: 1px solid rgba(255,255,255,0.05)
 * - Padding: 28px horizontal, 24px top, 16px bottom
 */

import type { ReactNode } from 'react';
import { MoreVertical, Lock } from 'lucide-react';

interface ListHeaderProps {
  /** List name */
  title: string;
  /** Album count */
  albumCount?: number;
  /** List year */
  year?: number | null;
  /** Whether this list is locked (year locked + main list) */
  isLocked?: boolean;
  /** Hamburger menu click handler */
  onMenuClick?: () => void;
  /** List options (ellipsis) click handler */
  onOptionsClick?: () => void;
  /** Optional sort control rendered right-aligned on the metadata row */
  sortControl?: ReactNode;
}

export function ListHeader({
  title,
  albumCount,
  year,
  isLocked = false,
  onMenuClick,
  onOptionsClick,
  sortControl,
}: ListHeaderProps) {
  const metaParts: string[] = [];
  if (albumCount != null) {
    metaParts.push(`${albumCount} album${albumCount !== 1 ? 's' : ''}`);
  }
  if (year) {
    metaParts.push(String(year));
  }

  return (
    <header
      style={{
        padding: '6px var(--space-header-x) 16px',
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
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '32px',
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

      {/* Metadata + sort row */}
      {(metaParts.length > 0 || isLocked || sortControl) && (
        <div
          style={{
            marginTop: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 0',
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
          {sortControl && (
            <div style={{ position: 'relative' }}>{sortControl}</div>
          )}
        </div>
      )}

      {/* Divider */}
      <div
        style={{
          height: '1px',
          background: 'var(--color-divider)',
          marginTop: '16px',
        }}
      />
    </header>
  );
}
