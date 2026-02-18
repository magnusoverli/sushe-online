/**
 * ListHeader - Section header for the album list view.
 *
 * Design spec:
 * - Eyebrow: DM Mono 9px caps, rgba(255,255,255,0.25), letter-spacing +0.08em
 * - Title: DM Serif Display 32px, #F0ECE4, letter-spacing -0.01em
 * - Metadata: DM Mono 10px, rgba(255,255,255,0.20)
 * - Divider: 1px solid rgba(255,255,255,0.05)
 * - Padding: 28px horizontal, 24px top, 16px bottom
 */

interface ListHeaderProps {
  /** Eyebrow text (e.g. group name or "COLLECTION") */
  eyebrow?: string;
  /** List name */
  title: string;
  /** Album count */
  albumCount?: number;
  /** List year */
  year?: number | null;
  /** Hamburger menu click handler */
  onMenuClick?: () => void;
}

export function ListHeader({
  eyebrow,
  title,
  albumCount,
  year,
  onMenuClick,
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
        padding: '24px var(--space-header-x) 16px',
      }}
      data-testid="list-header"
    >
      {/* Top row: eyebrow + hamburger */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        {eyebrow && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              fontWeight: 400,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-label)',
            }}
            data-testid="list-header-eyebrow"
          >
            {eyebrow}
          </span>
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

      {/* Title */}
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '32px',
          fontWeight: 400,
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
          color: 'var(--color-text-primary)',
          margin: 0,
        }}
        data-testid="list-header-title"
      >
        {title}
      </h1>

      {/* Metadata row */}
      {metaParts.length > 0 && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 400,
            letterSpacing: '0.02em',
            color: 'var(--color-text-muted)',
            marginTop: '6px',
            display: 'block',
          }}
          data-testid="list-header-meta"
        >
          {metaParts.join(' · ')}
        </span>
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
