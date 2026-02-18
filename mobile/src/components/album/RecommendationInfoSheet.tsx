/**
 * RecommendationInfoSheet - Modal showing who recommended an album and when.
 *
 * Displayed when tapping the thumbs-up badge on album covers.
 */

import { ThumbsUp } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';

interface RecommendationInfoSheetProps {
  open: boolean;
  onClose: () => void;
  albumName: string;
  artistName: string;
  recommendedBy: string | null;
  recommendedAt: string | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown date';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function RecommendationInfoSheet({
  open,
  onClose,
  albumName,
  artistName,
  recommendedBy,
  recommendedAt,
}: RecommendationInfoSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Recommendation">
      <div style={{ padding: '0 20px 24px' }}>
        {/* Album info header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(96, 165, 250, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ThumbsUp size={16} style={{ color: '#60a5fa' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '14px',
                color: 'var(--color-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {albumName}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {artistName}
            </div>
          </div>
        </div>

        {/* Recommendation info */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            lineHeight: 1.6,
            color: 'var(--color-text-secondary)',
          }}
          data-testid="recommendation-info"
        >
          {recommendedBy ? (
            <>
              Recommended by{' '}
              <span style={{ color: '#60a5fa', fontWeight: 500 }}>
                {recommendedBy}
              </span>
              {recommendedAt && <> on {formatDate(recommendedAt)}</>}
            </>
          ) : (
            'No recommendation info available.'
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
