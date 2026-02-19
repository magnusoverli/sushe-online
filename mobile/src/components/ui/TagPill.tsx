/**
 * TagPill - Metadata tag pill (year, genre, track count, etc.)
 *
 * Spec (page 3, 5):
 * - DM Mono 9px, +0.1em, uppercase
 * - Border: 1px rgba(255,255,255,0.08), radius 4px
 * - Padding: 2px 5px
 * - Color: rgba(255,255,255,0.2)
 */

import type { CSSProperties, ReactNode } from 'react';

interface TagPillProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const pillStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '9px',
  fontWeight: 400,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border-tag)',
  borderRadius: 'var(--radius-tag)',
  padding: '2px 3px',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
};

export function TagPill({ children, className, style }: TagPillProps) {
  return (
    <span
      className={className}
      style={{ ...pillStyle, ...style }}
      data-testid="tag-pill"
    >
      {children}
    </span>
  );
}
