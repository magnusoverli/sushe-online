/**
 * SkeletonCard - Loading placeholder for album list items.
 *
 * Mirrors the AlbumCard layout with shimmer-animated placeholders
 * for cover art, title, artist, and tags.
 */

import type { CSSProperties } from 'react';

interface SkeletonCardProps {
  showRank?: boolean;
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-card-gap-inner, 12px)',
  padding: 'var(--space-card-y, 10px) var(--space-card-x, 12px)',
};

export function SkeletonCard({ showRank = true }: SkeletonCardProps) {
  return (
    <div style={cardStyle} data-testid="skeleton-card">
      {/* Rank placeholder */}
      {showRank && (
        <div
          className="skeleton skeleton-text-sm"
          style={{ width: '18px', flexShrink: 0 }}
        />
      )}

      {/* Cover placeholder */}
      <div className="skeleton skeleton-cover" style={{ flexShrink: 0 }} />

      {/* Text placeholders */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="skeleton skeleton-text"
          style={{ width: '70%', marginBottom: '6px' }}
        />
        <div
          className="skeleton skeleton-text-sm"
          style={{ width: '45%', marginBottom: '8px' }}
        />
        <div style={{ display: 'flex', gap: '6px' }}>
          <div className="skeleton skeleton-tag" />
          <div className="skeleton skeleton-tag" style={{ width: '36px' }} />
        </div>
      </div>
    </div>
  );
}

/** Multiple skeleton cards for list loading state. */
export function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <div data-testid="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
