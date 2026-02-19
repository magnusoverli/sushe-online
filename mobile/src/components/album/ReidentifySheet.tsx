/**
 * ReidentifySheet - Bottom sheet for re-identifying an album via MusicBrainz.
 *
 * Flow:
 * 1. Opens and immediately searches MusicBrainz for release group candidates
 * 2. Displays candidates as selectable cards with cover art, metadata, and type badges
 * 3. Admin selects a different release group and applies
 * 4. Backend updates album_id and tracks across all references
 *
 * Admin-only feature.
 */

import { useState, useCallback, useEffect } from 'react';
import { Loader, Disc, Check } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { showToast } from '@/components/ui/Toast';
import {
  reidentifySearch,
  reidentifyApply,
  type ReidentifyCandidate,
} from '@/services/albums';
import type { Album } from '@/lib/types';

interface ReidentifySheetProps {
  open: boolean;
  onClose: () => void;
  album: Album | null;
  /** Called after successful re-identification so the parent can refresh data */
  onApplied: () => void;
}

export function ReidentifySheet({
  open,
  onClose,
  album,
  onApplied,
}: ReidentifySheetProps) {
  const [candidates, setCandidates] = useState<ReidentifyCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Search on open
  useEffect(() => {
    if (!open || !album) return;

    setCandidates([]);
    setError(null);
    setSelectedId(null);
    setApplying(false);
    setLoading(true);

    let cancelled = false;

    reidentifySearch(album.artist, album.album, album.album_id)
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.candidates);
        // Pre-select the current one
        const current = result.candidates.find((c) => c.isCurrent);
        if (current) setSelectedId(current.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Search failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, album]);

  const handleApply = useCallback(async () => {
    if (!album || !selectedId || applying) return;

    // Don't apply if it's already the current one
    if (selectedId === album.album_id) {
      showToast('Already the current release group', 'info');
      return;
    }

    setApplying(true);
    try {
      const result = await reidentifyApply({
        currentAlbumId: album.album_id,
        newAlbumId: selectedId,
        artist: album.artist,
        album: album.album,
      });

      if (result.changed) {
        showToast(result.message, 'success');
        onApplied();
        onClose();
      } else {
        showToast(result.message, 'info');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to apply',
        'error'
      );
    } finally {
      setApplying(false);
    }
  }, [album, selectedId, applying, onApplied, onClose]);

  const hasNewSelection = selectedId != null && selectedId !== album?.album_id;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      zIndex={450}
      title="Re-identify Album"
      subtitle={album ? `${album.artist} \u2014 ${album.album}` : undefined}
    >
      <div style={{ padding: '0 4px 8px' }}>
        {/* Loading state */}
        {loading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              padding: '32px 16px',
            }}
          >
            <Loader
              size={20}
              style={{
                color: 'var(--color-text-secondary)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
              }}
            >
              Searching MusicBrainz...
            </span>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-destructive)',
            }}
          >
            {error}
          </div>
        )}

        {/* Candidates list */}
        {!loading && !error && candidates.length > 0 && (
          <>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-text-secondary)',
                padding: '4px 8px 8px',
              }}
            >
              {candidates.length} release group
              {candidates.length !== 1 ? 's' : ''} found
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  selected={selectedId === candidate.id}
                  onSelect={() => setSelectedId(candidate.id)}
                />
              ))}
            </div>

            {/* Action button: adapts label based on selection state */}
            <div style={{ padding: '12px 0 4px' }}>
              {hasNewSelection ? (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '10px',
                    border: 'none',
                    background: applying
                      ? 'rgba(255,255,255,0.05)'
                      : 'var(--color-gold)',
                    color: applying ? 'var(--color-text-secondary)' : '#1A1A1F',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: applying ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                  data-testid="reidentify-apply"
                >
                  {applying && (
                    <Loader
                      size={14}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                  )}
                  {applying ? 'Applying...' : 'Apply Selection'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.10)',
                    background: 'transparent',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  data-testid="reidentify-close"
                >
                  Close
                </button>
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !error && candidates.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
            }}
          >
            No candidates found on MusicBrainz.
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Candidate Card ──

function CandidateCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: ReidentifyCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const typeBadge = [candidate.type, ...candidate.secondaryTypes]
    .filter(Boolean)
    .join(' + ');

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        padding: '10px',
        borderRadius: '10px',
        border: selected
          ? '1px solid var(--color-gold)'
          : '1px solid rgba(255,255,255,0.06)',
        background: selected ? 'rgba(232,200,122,0.06)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 150ms ease, background 150ms ease',
      }}
      data-testid={`candidate-${candidate.id}`}
    >
      {/* Cover art */}
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '6px',
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.05)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {candidate.coverUrl ? (
          <img
            src={candidate.coverUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <Disc size={20} style={{ color: 'rgba(255,255,255,0.15)' }} />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '2px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {candidate.title}
          </span>
          {candidate.isCurrent && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: '#1A1A1F',
                background: 'var(--color-gold)',
                padding: '2px 6px',
                borderRadius: '4px',
                flexShrink: 0,
              }}
            >
              Current
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: '2px',
          }}
        >
          {candidate.artist}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>{typeBadge}</span>
          {candidate.trackCount != null && (
            <span>{candidate.trackCount} tracks</span>
          )}
          {candidate.releaseDate && <span>{candidate.releaseDate}</span>}
        </div>
      </div>

      {/* Selection indicator */}
      <div
        style={{
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          border: selected
            ? '2px solid var(--color-gold)'
            : '2px solid rgba(255,255,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'border-color 150ms ease',
        }}
      >
        {selected && <Check size={12} style={{ color: 'var(--color-gold)' }} />}
      </div>
    </button>
  );
}
