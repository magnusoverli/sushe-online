/**
 * SummarySheet - Modal showing AI-generated album summary text.
 *
 * Displayed when tapping the robot icon badge on album covers.
 */

import { useEffect, useState, useCallback } from 'react';
import { Bot } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { getAlbumSummary } from '@/services/albums';

interface SummarySheetProps {
  open: boolean;
  onClose: () => void;
  albumId: string | null;
  albumName: string;
  artistName: string;
}

export function SummarySheet({
  open,
  onClose,
  albumId,
  albumName,
  artistName,
}: SummarySheetProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch summary when opened
  useEffect(() => {
    if (!open || !albumId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setSummary(null);

    getAlbumSummary(albumId)
      .then((result) => {
        if (!cancelled) {
          setSummary(result.summary || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load summary');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, albumId]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset state after animation
    setTimeout(() => {
      setSummary(null);
      setLoading(false);
      setError(null);
    }, 300);
  }, [onClose]);

  return (
    <BottomSheet open={open} onClose={handleClose} title="AI Summary">
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
              background: 'rgba(217, 119, 6, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Bot size={16} style={{ color: '#d97706' }} />
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

        {/* Content */}
        {loading && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
              padding: '24px 0',
            }}
          >
            Loading summary...
          </div>
        )}

        {error && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-destructive)',
              textAlign: 'center',
              padding: '24px 0',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && summary && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: 1.6,
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
            data-testid="summary-text"
          >
            {summary}
          </div>
        )}

        {!loading && !error && !summary && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
              padding: '24px 0',
            }}
          >
            No summary available.
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
