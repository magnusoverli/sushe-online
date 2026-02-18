/**
 * AdminTab - Admin panel: events, user management, duplicate scanner, album audit.
 *
 * Mobile version of admin tools:
 * - Pending event approvals
 * - User management
 * - Duplicate album scanner (fuzzy matching)
 * - Manual album reconciliation/audit
 */

import { useState, useCallback } from 'react';
import {
  useAdminStats,
  useAdminEvents,
  useExecuteEventAction,
  useMakeAdmin,
  useRevokeAdmin,
  useDeleteUser,
  useScanDuplicates,
  useMergeAlbums,
  useMarkDistinct,
  useAuditManualAlbums,
  useMergeManualAlbum,
  useRecommendationYearsAdmin,
  useLockedRecommendationYears,
  useLockRecommendationYear,
  useUnlockRecommendationYear,
  useTelegramStatus,
  useTelegramRecsStatus,
  useSendTelegramTest,
  useToggleTelegramRecs,
  useDisconnectTelegram,
  useAggregateYears,
  useAggregateStatus,
  useAggregateStats,
  useConfirmAggregateReveal,
  useRevokeAggregateConfirmation,
  useRecomputeAggregate,
  useLockAggregateYear,
  useUnlockAggregateYear,
} from '@/hooks/useSettings';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type {
  AdminUserInfo,
  DuplicatePair,
  AuditManualAlbum,
} from '@/lib/types';
import {
  sectionStyle,
  sectionTitleStyle,
  buttonStyle,
  buttonDestructiveStyle,
  fieldRowStyle,
  fieldLabelStyle,
  fieldValueStyle,
} from './shared-styles';

// ── Shared sub-styles ──

const monoSmall = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8px',
  color: 'rgba(255,255,255,0.35)',
} as const;

const selectStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: '8.5px',
  padding: '4px 6px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--color-text-primary)',
  appearance: 'auto' as const,
};

const cardStyle = {
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '8px',
  padding: '10px',
  border: '1px solid rgba(255,255,255,0.06)',
};

const smallButtonBase = {
  ...buttonStyle,
  padding: '4px 10px',
  fontSize: '7.5px',
};

const SENSITIVITY_OPTIONS = [
  { value: '0.03', label: 'Very High (0.03)' },
  { value: '0.15', label: 'High (0.15)' },
  { value: '0.30', label: 'Medium (0.30)' },
] as const;

// ── Duplicate Scanner Section ──

function DuplicateScanner() {
  const [threshold, setThreshold] = useState('0.15');
  const scanMutation = useScanDuplicates();
  const mergeMutation = useMergeAlbums();
  const distinctMutation = useMarkDistinct();
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [scanSummary, setScanSummary] = useState('');
  const [resolvedCount, setResolvedCount] = useState(0);

  const handleScan = useCallback(() => {
    setPairs([]);
    setScanSummary('');
    setResolvedCount(0);
    scanMutation.mutate(parseFloat(threshold), {
      onSuccess: (data) => {
        setPairs(data.pairs);
        if (data.pairs.length === 0) {
          setScanSummary(
            `No duplicates found (${data.totalAlbums} albums, ${data.excludedPairs} marked distinct)`
          );
        } else {
          setScanSummary(
            `Found ${data.potentialDuplicates} potential duplicates`
          );
        }
      },
    });
  }, [threshold, scanMutation]);

  const handleMerge = useCallback(
    (pair: DuplicatePair, keepIndex: 0 | 1) => {
      const keep = keepIndex === 0 ? pair.album1 : pair.album2;
      const remove = keepIndex === 0 ? pair.album2 : pair.album1;
      mergeMutation.mutate(
        { keepAlbumId: keep.album_id, deleteAlbumId: remove.album_id },
        {
          onSuccess: () => {
            setPairs((prev) => prev.filter((p) => p !== pair));
            setResolvedCount((c) => c + 1);
          },
        }
      );
    },
    [mergeMutation]
  );

  const handleDistinct = useCallback(
    (pair: DuplicatePair) => {
      distinctMutation.mutate(
        {
          albumId1: pair.album1.album_id,
          albumId2: pair.album2.album_id,
        },
        {
          onSuccess: () => {
            setPairs((prev) => prev.filter((p) => p !== pair));
            setResolvedCount((c) => c + 1);
          },
        }
      );
    },
    [distinctMutation]
  );

  const handleSkip = useCallback((pair: DuplicatePair) => {
    setPairs((prev) => prev.filter((p) => p !== pair));
  }, []);

  const isBusy =
    scanMutation.isPending ||
    mergeMutation.isPending ||
    distinctMutation.isPending;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Duplicate Scanner</div>
      <div
        style={{
          ...monoSmall,
          marginBottom: '8px',
        }}
      >
        Find albums that may be duplicates based on fuzzy matching
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <label style={{ ...monoSmall, whiteSpace: 'nowrap' }}>
          Sensitivity:
        </label>
        <select
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          style={selectStyle}
        >
          {SENSITIVITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={buttonStyle}
          onClick={handleScan}
          disabled={isBusy}
        >
          {scanMutation.isPending ? 'Scanning...' : 'Scan'}
        </button>
      </div>

      {/* Status line */}
      {scanSummary && (
        <div
          style={{
            ...monoSmall,
            color:
              pairs.length > 0 ? 'var(--color-gold)' : 'rgba(76,175,80,0.85)',
            marginBottom: '8px',
          }}
        >
          {scanSummary}
          {resolvedCount > 0 && ` (${resolvedCount} resolved)`}
        </div>
      )}

      {/* Results */}
      {pairs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {pairs.map((pair, idx) => (
            <DuplicatePairCard
              key={`${pair.album1.album_id}-${pair.album2.album_id}-${idx}`}
              pair={pair}
              onMerge={handleMerge}
              onDistinct={handleDistinct}
              onSkip={handleSkip}
              disabled={isBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DuplicatePairCard({
  pair,
  onMerge,
  onDistinct,
  onSkip,
  disabled,
}: {
  pair: DuplicatePair;
  onMerge: (pair: DuplicatePair, keepIndex: 0 | 1) => void;
  onDistinct: (pair: DuplicatePair) => void;
  onSkip: (pair: DuplicatePair) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={cardStyle}>
      {/* Summary row - tappable to expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8.5px',
                color: 'rgba(255,255,255,0.75)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {pair.album1.artist} - {pair.album1.album}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '7.5px',
                color: 'rgba(255,255,255,0.40)',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              vs {pair.album2.artist} - {pair.album2.album}
            </div>
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '7px',
              padding: '2px 6px',
              borderRadius: '4px',
              background:
                pair.confidence >= 80
                  ? 'rgba(224,92,92,0.15)'
                  : pair.confidence >= 50
                    ? 'rgba(232,200,122,0.15)'
                    : 'rgba(255,255,255,0.05)',
              color:
                pair.confidence >= 80
                  ? 'var(--color-destructive)'
                  : pair.confidence >= 50
                    ? 'var(--color-gold)'
                    : 'rgba(255,255,255,0.50)',
              marginLeft: '6px',
              flexShrink: 0,
            }}
          >
            {pair.confidence}%
          </span>
        </div>
      </button>

      {/* Expanded detail + actions */}
      {expanded && (
        <div
          style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* Album 1 details */}
          <AlbumDetail label="A" info={pair.album1} />
          {/* Album 2 details */}
          <AlbumDetail label="B" info={pair.album2} />

          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '7px',
              color: 'rgba(255,255,255,0.30)',
              marginBottom: '6px',
            }}
          >
            Artist match: {pair.artistScore}% / Album match: {pair.albumScore}%
          </div>

          {/* Action buttons */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              style={{
                ...smallButtonBase,
                background: 'rgba(76,175,80,0.15)',
                color: '#4CAF50',
              }}
              onClick={() => onMerge(pair, 0)}
              disabled={disabled}
            >
              Keep A
            </button>
            <button
              type="button"
              style={{
                ...smallButtonBase,
                background: 'rgba(76,175,80,0.15)',
                color: '#4CAF50',
              }}
              onClick={() => onMerge(pair, 1)}
              disabled={disabled}
            >
              Keep B
            </button>
            <button
              type="button"
              style={{
                ...smallButtonBase,
                background: 'rgba(66,133,244,0.15)',
                color: '#4285F4',
              }}
              onClick={() => onDistinct(pair)}
              disabled={disabled}
            >
              Different
            </button>
            <button
              type="button"
              style={smallButtonBase}
              onClick={() => onSkip(pair)}
              disabled={disabled}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlbumDetail({
  label,
  info,
}: {
  label: string;
  info: DuplicatePair['album1'];
}) {
  return (
    <div style={{ marginBottom: '6px' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '7px',
          color: 'rgba(255,255,255,0.25)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '2px',
        }}
      >
        Album {label}
      </div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>Artist</span>
        <span style={fieldValueStyle}>{info.artist}</span>
      </div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>Album</span>
        <span style={fieldValueStyle}>{info.album}</span>
      </div>
      {info.release_date && (
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Released</span>
          <span style={fieldValueStyle}>{info.release_date}</span>
        </div>
      )}
      {(info.genre_1 || info.genre_2) && (
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Genre</span>
          <span style={fieldValueStyle}>
            {[info.genre_1, info.genre_2].filter(Boolean).join(', ')}
          </span>
        </div>
      )}
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>Tracks</span>
        <span style={fieldValueStyle}>{info.trackCount ?? 'N/A'}</span>
      </div>
    </div>
  );
}

// ── Manual Album Audit Section ──

function ManualAlbumAudit() {
  const [threshold, setThreshold] = useState('0.15');
  const auditMutation = useAuditManualAlbums();
  const reconcileMutation = useMergeManualAlbum();
  const distinctMutation = useMarkDistinct();
  const [albums, setAlbums] = useState<AuditManualAlbum[]>([]);
  const [auditSummary, setAuditSummary] = useState('');
  const [resolvedCount, setResolvedCount] = useState(0);

  const handleAudit = useCallback(() => {
    setAlbums([]);
    setAuditSummary('');
    setResolvedCount(0);
    auditMutation.mutate(parseFloat(threshold), {
      onSuccess: (data) => {
        // Only show albums that have matches
        const withMatches = data.manualAlbums.filter(
          (a) => a.matches.length > 0
        );
        setAlbums(withMatches);

        const issueCount = data.totalIntegrityIssues;
        if (withMatches.length === 0 && issueCount === 0) {
          setAuditSummary(
            `No manual albums need review (${data.totalManual} checked)`
          );
        } else {
          const parts: string[] = [];
          if (issueCount > 0) {
            parts.push(
              `${issueCount} integrity issue${issueCount !== 1 ? 's' : ''}`
            );
          }
          if (withMatches.length > 0) {
            parts.push(
              `${withMatches.length} album${withMatches.length !== 1 ? 's' : ''} to review`
            );
          }
          setAuditSummary(`Found ${parts.join(' and ')}`);
        }
      },
    });
  }, [threshold, auditMutation]);

  const handleReconcile = useCallback(
    (album: AuditManualAlbum, canonicalAlbumId: string) => {
      reconcileMutation.mutate(
        { manualAlbumId: album.manualId, canonicalAlbumId },
        {
          onSuccess: () => {
            setAlbums((prev) => prev.filter((a) => a !== album));
            setResolvedCount((c) => c + 1);
          },
        }
      );
    },
    [reconcileMutation]
  );

  const handleSkipAlbum = useCallback(
    (album: AuditManualAlbum, canonicalAlbumId: string) => {
      // Mark the manual album and this specific match as distinct so it won't show again
      distinctMutation.mutate(
        { albumId1: album.manualId, albumId2: canonicalAlbumId },
        {
          onSuccess: () => {
            // Remove this match from the album; if no matches left, remove album entirely
            setAlbums((prev) =>
              prev
                .map((a) => {
                  if (a !== album) return a;
                  return {
                    ...a,
                    matches: a.matches.filter(
                      (m) => m.albumId !== canonicalAlbumId
                    ),
                  };
                })
                .filter((a) => a.matches.length > 0)
            );
            setResolvedCount((c) => c + 1);
          },
        }
      );
    },
    [distinctMutation]
  );

  const isBusy =
    auditMutation.isPending ||
    reconcileMutation.isPending ||
    distinctMutation.isPending;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Manual Album Audit</div>
      <div
        style={{
          ...monoSmall,
          marginBottom: '8px',
        }}
      >
        Review manually-added albums that may match canonical albums
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <label style={{ ...monoSmall, whiteSpace: 'nowrap' }}>
          Sensitivity:
        </label>
        <select
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          style={selectStyle}
        >
          {SENSITIVITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={buttonStyle}
          onClick={handleAudit}
          disabled={isBusy}
        >
          {auditMutation.isPending ? 'Auditing...' : 'Audit'}
        </button>
      </div>

      {/* Status line */}
      {auditSummary && (
        <div
          style={{
            ...monoSmall,
            color:
              albums.length > 0 ? 'var(--color-gold)' : 'rgba(76,175,80,0.85)',
            marginBottom: '8px',
          }}
        >
          {auditSummary}
          {resolvedCount > 0 && ` (${resolvedCount} resolved)`}
        </div>
      )}

      {/* Results */}
      {albums.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {albums.map((album) => (
            <AuditAlbumCard
              key={album.manualId}
              album={album}
              onReconcile={handleReconcile}
              onSkip={handleSkipAlbum}
              disabled={isBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AuditAlbumCard({
  album,
  onReconcile,
  onSkip,
  disabled,
}: {
  album: AuditManualAlbum;
  onReconcile: (album: AuditManualAlbum, canonicalId: string) => void;
  onSkip: (album: AuditManualAlbum, canonicalId: string) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={cardStyle}>
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8.5px',
                color: 'rgba(255,255,255,0.75)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {album.artist} - {album.album}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '7px',
                color: 'rgba(255,255,255,0.35)',
                marginTop: '2px',
              }}
            >
              {album.matches.length} match
              {album.matches.length !== 1 ? 'es' : ''}
              {album.usedIn.length > 0 &&
                ` / in ${album.usedIn.length} list${album.usedIn.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '6.5px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(232,200,122,0.15)',
              color: 'var(--color-gold)',
              flexShrink: 0,
              marginLeft: '6px',
            }}
          >
            manual
          </span>
        </div>
      </button>

      {/* Expanded: show matches */}
      {expanded && (
        <div
          style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* Usage info */}
          {album.usedIn.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '7px',
                  color: 'rgba(255,255,255,0.25)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '2px',
                }}
              >
                Used in
              </div>
              {album.usedIn.map((usage) => (
                <div
                  key={`${usage.listId}-${usage.userId}`}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '7.5px',
                    color: 'rgba(255,255,255,0.50)',
                  }}
                >
                  {usage.listName}
                  {usage.year ? ` (${usage.year})` : ''} - {usage.username}
                </div>
              ))}
            </div>
          )}

          {/* Matches */}
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '7px',
              color: 'rgba(255,255,255,0.25)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '4px',
            }}
          >
            Potential matches
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {album.matches.map((match) => (
              <div
                key={match.albumId}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '6px',
                  padding: '8px',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '8px',
                        color: 'rgba(255,255,255,0.70)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {match.artist} - {match.album}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '7px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background:
                        match.confidence >= 80
                          ? 'rgba(76,175,80,0.15)'
                          : match.confidence >= 50
                            ? 'rgba(232,200,122,0.15)'
                            : 'rgba(255,255,255,0.05)',
                      color:
                        match.confidence >= 80
                          ? '#4CAF50'
                          : match.confidence >= 50
                            ? 'var(--color-gold)'
                            : 'rgba(255,255,255,0.50)',
                      marginLeft: '6px',
                      flexShrink: 0,
                    }}
                  >
                    {match.confidence}%
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: '4px',
                  }}
                >
                  <button
                    type="button"
                    style={{
                      ...smallButtonBase,
                      background: 'rgba(76,175,80,0.15)',
                      color: '#4CAF50',
                    }}
                    onClick={() => onReconcile(album, match.albumId)}
                    disabled={disabled}
                  >
                    Match
                  </button>
                  <button
                    type="button"
                    style={smallButtonBase}
                    onClick={() => onSkip(album, match.albumId)}
                    disabled={disabled}
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recommendation Lock Section ──

function RecommendationLocks() {
  const { data: yearsData, isLoading: yearsLoading } =
    useRecommendationYearsAdmin();
  const { data: lockedData, isLoading: lockedLoading } =
    useLockedRecommendationYears();
  const lockMutation = useLockRecommendationYear();
  const unlockMutation = useUnlockRecommendationYear();

  const years = yearsData?.years ?? [];
  const lockedYears = new Set(lockedData?.years ?? []);
  const isLoading = yearsLoading || lockedLoading;
  const isBusy = lockMutation.isPending || unlockMutation.isPending;

  const handleToggle = useCallback(
    (year: number, currentlyLocked: boolean) => {
      if (currentlyLocked) {
        unlockMutation.mutate(year);
      } else {
        lockMutation.mutate(year);
      }
    },
    [lockMutation, unlockMutation]
  );

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Recommendation Locks</div>
      <div style={{ ...monoSmall, marginBottom: '8px' }}>
        Lock/unlock recommendations per year
      </div>
      {isLoading ? (
        <div style={monoSmall}>Loading...</div>
      ) : years.length === 0 ? (
        <div style={monoSmall}>No years with recommendations</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {years.map((year) => {
            const locked = lockedYears.has(year);
            return (
              <div
                key={year}
                style={{
                  ...cardStyle,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8.5px',
                    color: 'rgba(255,255,255,0.75)',
                  }}
                >
                  {year}
                </span>
                <button
                  type="button"
                  style={{
                    ...smallButtonBase,
                    background: locked
                      ? 'rgba(224,92,92,0.15)'
                      : 'rgba(76,175,80,0.15)',
                    color: locked ? 'var(--color-destructive)' : '#4CAF50',
                  }}
                  onClick={() => handleToggle(year, locked)}
                  disabled={isBusy}
                  data-testid={`rec-lock-${year}`}
                >
                  {locked ? 'Unlock' : 'Lock'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Telegram Configuration Section ──

function TelegramConfig() {
  const { data: status, isLoading: statusLoading } = useTelegramStatus();
  const { data: recsStatus, isLoading: recsLoading } = useTelegramRecsStatus();
  const testMutation = useSendTelegramTest();
  const toggleRecsMutation = useToggleTelegramRecs();
  const disconnectMutation = useDisconnectTelegram();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const isLoading = statusLoading || recsLoading;
  const configured = status?.configured ?? false;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Telegram</div>
      {isLoading ? (
        <div style={monoSmall}>Loading...</div>
      ) : !configured ? (
        <div style={monoSmall}>
          Not configured. Set up Telegram bot from the desktop admin panel.
        </div>
      ) : (
        <>
          {/* Status */}
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Status</span>
            <span
              style={{
                ...fieldValueStyle,
                color: status?.enabled ? '#4CAF50' : 'var(--color-destructive)',
              }}
            >
              {status?.enabled ? 'Connected' : 'Disabled'}
            </span>
          </div>
          {status?.chatTitle && (
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Group</span>
              <span style={fieldValueStyle}>
                {status.chatTitle}
                {status.topicName ? ` (${status.topicName})` : ''}
              </span>
            </div>
          )}

          {/* Recommendation notifications toggle */}
          <div
            style={{
              ...fieldRowStyle,
              marginTop: '8px',
              paddingTop: '8px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <span style={fieldLabelStyle}>Rec notifications</span>
            <button
              type="button"
              style={{
                ...smallButtonBase,
                background: recsStatus?.recommendationsEnabled
                  ? 'rgba(224,92,92,0.15)'
                  : 'rgba(76,175,80,0.15)',
                color: recsStatus?.recommendationsEnabled
                  ? 'var(--color-destructive)'
                  : '#4CAF50',
              }}
              onClick={() =>
                toggleRecsMutation.mutate(!recsStatus?.recommendationsEnabled)
              }
              disabled={toggleRecsMutation.isPending}
            >
              {recsStatus?.recommendationsEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              marginTop: '10px',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              style={smallButtonBase}
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? 'Sending...' : 'Test Notification'}
            </button>
            <button
              type="button"
              style={{
                ...smallButtonBase,
                background: 'rgba(224,92,92,0.15)',
                color: 'var(--color-destructive)',
              }}
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnectMutation.isPending}
            >
              Disconnect
            </button>
          </div>

          <ConfirmDialog
            open={confirmDisconnect}
            onConfirm={() => {
              disconnectMutation.mutate();
              setConfirmDisconnect(false);
            }}
            onCancel={() => setConfirmDisconnect(false)}
            title="Disconnect Telegram"
            message="This will remove the Telegram bot configuration. Notifications will stop."
            confirmLabel="Disconnect"
            destructive
          />
        </>
      )}
    </div>
  );
}

// ── Aggregate Lists Section ──

function AggregateListPanel({ year }: { year: number }) {
  const { data: status, isLoading: statusLoading } = useAggregateStatus(year);
  const { data: stats, isLoading: statsLoading } = useAggregateStats(year);
  const confirmMutation = useConfirmAggregateReveal();
  const revokeMutation = useRevokeAggregateConfirmation();
  const recomputeMutation = useRecomputeAggregate();
  const lockMutation = useLockAggregateYear();
  const unlockMutation = useUnlockAggregateYear();
  const lockRecMutation = useLockRecommendationYear();
  const unlockRecMutation = useUnlockRecommendationYear();
  const { data: lockedRecData } = useLockedRecommendationYears();

  const [expanded, setExpanded] = useState(false);

  const isLoading = statusLoading || statsLoading;
  const isBusy =
    confirmMutation.isPending ||
    revokeMutation.isPending ||
    recomputeMutation.isPending ||
    lockMutation.isPending ||
    unlockMutation.isPending ||
    lockRecMutation.isPending ||
    unlockRecMutation.isPending;

  const recLocked = new Set(lockedRecData?.years ?? []).has(year);

  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              fontWeight: 500,
              color: 'rgba(255,255,255,0.80)',
            }}
          >
            {year}
          </span>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {status?.revealed && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '6.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(76,175,80,0.15)',
                  color: '#4CAF50',
                }}
              >
                revealed
              </span>
            )}
            {status?.locked && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '6.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(224,92,92,0.15)',
                  color: 'var(--color-destructive)',
                }}
              >
                locked
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {isLoading ? (
            <div style={monoSmall}>Loading...</div>
          ) : (
            <>
              {/* Stats */}
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Confirmations</span>
                <span style={fieldValueStyle}>
                  {status?.confirmations ?? 0} /{' '}
                  {status?.requiredConfirmations ?? '?'}
                </span>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Albums</span>
                <span style={fieldValueStyle}>{stats?.totalAlbums ?? 0}</span>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Contributors</span>
                <span style={fieldValueStyle}>
                  {stats?.totalContributors ?? 0}
                </span>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Votes</span>
                <span style={fieldValueStyle}>{stats?.totalVotes ?? 0}</span>
              </div>

              {/* Actions */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                  marginTop: '8px',
                }}
              >
                {!status?.revealed && (
                  <button
                    type="button"
                    style={{
                      ...smallButtonBase,
                      background: 'rgba(224,92,92,0.15)',
                      color: 'var(--color-destructive)',
                    }}
                    onClick={() => confirmMutation.mutate(year)}
                    disabled={isBusy}
                  >
                    Confirm Reveal
                  </button>
                )}
                {!status?.revealed && (status?.confirmations ?? 0) > 0 && (
                  <button
                    type="button"
                    style={smallButtonBase}
                    onClick={() => revokeMutation.mutate(year)}
                    disabled={isBusy}
                  >
                    Revoke Confirm
                  </button>
                )}
                <a
                  href={`/aggregate-list/${year}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    ...smallButtonBase,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  View List
                </a>
                <button
                  type="button"
                  style={{
                    ...smallButtonBase,
                    background: status?.locked
                      ? 'rgba(76,175,80,0.15)'
                      : 'rgba(224,92,92,0.15)',
                    color: status?.locked
                      ? '#4CAF50'
                      : 'var(--color-destructive)',
                  }}
                  onClick={() =>
                    status?.locked
                      ? unlockMutation.mutate(year)
                      : lockMutation.mutate(year)
                  }
                  disabled={isBusy}
                >
                  {status?.locked ? 'Unlock Year' : 'Lock Year'}
                </button>
                <button
                  type="button"
                  style={{
                    ...smallButtonBase,
                    background: recLocked
                      ? 'rgba(76,175,80,0.15)'
                      : 'rgba(224,92,92,0.15)',
                    color: recLocked ? '#4CAF50' : 'var(--color-destructive)',
                  }}
                  onClick={() =>
                    recLocked
                      ? unlockRecMutation.mutate(year)
                      : lockRecMutation.mutate(year)
                  }
                  disabled={isBusy}
                >
                  {recLocked ? 'Unlock Recs' : 'Lock Recs'}
                </button>
                <button
                  type="button"
                  style={smallButtonBase}
                  onClick={() => recomputeMutation.mutate(year)}
                  disabled={isBusy}
                >
                  {recomputeMutation.isPending ? 'Recomputing...' : 'Recompute'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AggregateLists() {
  const { data: yearsData, isLoading } = useAggregateYears();
  const years = yearsData?.years ?? [];

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Aggregate Lists</div>
      <div style={{ ...monoSmall, marginBottom: '8px' }}>
        Per-year aggregate list management
      </div>
      {isLoading ? (
        <div style={monoSmall}>Loading...</div>
      ) : years.length === 0 ? (
        <div style={monoSmall}>No years with main lists</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {years.map((year) => (
            <AggregateListPanel key={year} year={year} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main AdminTab ──

export function AdminTab() {
  const { data: adminStats, isLoading: statsLoading } = useAdminStats();
  const { data: eventsData, isLoading: eventsLoading } = useAdminEvents();
  const eventAction = useExecuteEventAction();
  const makeAdminMutation = useMakeAdmin();
  const revokeAdminMutation = useRevokeAdmin();
  const deleteUserMutation = useDeleteUser();

  const [selectedUser, setSelectedUser] = useState<AdminUserInfo | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    action: string;
    user: AdminUserInfo;
  } | null>(null);

  const handleEventAction = useCallback(
    (eventId: string, action: string) => {
      eventAction.mutate({ eventId, action });
    },
    [eventAction]
  );

  const handleUserAction = useCallback(
    (action: string, user: AdminUserInfo) => {
      setConfirmAction({ action, user });
    },
    []
  );

  const executeUserAction = useCallback(() => {
    if (!confirmAction) return;
    const { action, user } = confirmAction;
    switch (action) {
      case 'make-admin':
        makeAdminMutation.mutate(user._id);
        break;
      case 'revoke-admin':
        revokeAdminMutation.mutate(user._id);
        break;
      case 'delete':
        deleteUserMutation.mutate(user._id);
        break;
    }
    setConfirmAction(null);
    setSelectedUser(null);
  }, [
    confirmAction,
    makeAdminMutation,
    revokeAdminMutation,
    deleteUserMutation,
  ]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div style={{ padding: '16px 18px' }}>
      {/* Pending events */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Pending Events</div>
        {eventsLoading ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
            }}
          >
            Loading events...
          </div>
        ) : eventsData?.events && eventsData.events.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {eventsData.events.map((event) => (
              <div
                key={event.id}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: '8px',
                  padding: '10px',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '6px',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '8.5px',
                        color: 'rgba(255,255,255,0.75)',
                      }}
                    >
                      {event.event_type.replace(/_/g, ' ')}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '7px',
                        color: 'rgba(255,255,255,0.35)',
                        marginTop: '2px',
                      }}
                    >
                      {formatDate(event.created_at)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '6.5px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background:
                        event.priority === 'high'
                          ? 'rgba(224,92,92,0.15)'
                          : event.priority === 'medium'
                            ? 'rgba(232,200,122,0.15)'
                            : 'rgba(255,255,255,0.05)',
                      color:
                        event.priority === 'high'
                          ? 'var(--color-destructive)'
                          : event.priority === 'medium'
                            ? 'var(--color-gold)'
                            : 'rgba(255,255,255,0.50)',
                    }}
                  >
                    {event.priority}
                  </span>
                </div>

                {/* Event data summary */}
                {event.data &&
                  typeof event.data === 'object' &&
                  typeof (event.data as Record<string, unknown>).username ===
                    'string' && (
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '7.5px',
                        color: 'rgba(255,255,255,0.50)',
                        marginBottom: '6px',
                      }}
                    >
                      {String((event.data as Record<string, unknown>).username)}
                      {(event.data as Record<string, unknown>).email
                        ? ` (${String((event.data as Record<string, unknown>).email)})`
                        : ''}
                    </div>
                  )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      padding: '4px 10px',
                      fontSize: '7.5px',
                      background: 'rgba(76,175,80,0.15)',
                      color: '#4CAF50',
                    }}
                    onClick={() => handleEventAction(event.id, 'approve')}
                    disabled={eventAction.isPending}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      padding: '4px 10px',
                      fontSize: '7.5px',
                      background: 'rgba(224,92,92,0.15)',
                      color: 'var(--color-destructive)',
                    }}
                    onClick={() => handleEventAction(event.id, 'reject')}
                    disabled={eventAction.isPending}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
              padding: '8px 0',
            }}
          >
            No pending events
          </div>
        )}
      </div>

      {/* User management */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>User Management</div>
        {statsLoading ? (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.35)',
            }}
          >
            Loading users...
          </div>
        ) : adminStats?.users ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {adminStats.users.map((u) => (
              <button
                key={u._id}
                type="button"
                onClick={() =>
                  setSelectedUser(selectedUser?._id === u._id ? null : u)
                }
                style={{
                  background:
                    selectedUser?._id === u._id
                      ? 'rgba(255,255,255,0.05)'
                      : 'transparent',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between' }}
                >
                  <div>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '8.5px',
                        color: 'rgba(255,255,255,0.75)',
                      }}
                    >
                      {u.username}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '7px',
                        color: 'rgba(255,255,255,0.30)',
                        marginLeft: '6px',
                      }}
                    >
                      {u.email}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '7px',
                      color:
                        u.role === 'admin'
                          ? 'var(--color-gold)'
                          : 'rgba(255,255,255,0.30)',
                    }}
                  >
                    {u.role === 'admin' ? 'Admin' : 'User'}
                  </span>
                </div>

                {/* Expanded actions */}
                {selectedUser?._id === u._id && (
                  <div
                    style={{
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={fieldRowStyle}>
                      <span style={fieldLabelStyle}>Lists</span>
                      <span style={fieldValueStyle}>{u.listCount}</span>
                    </div>
                    <div style={fieldRowStyle}>
                      <span style={fieldLabelStyle}>Last active</span>
                      <span style={fieldValueStyle}>
                        {formatDate(u.lastActivity)}
                      </span>
                    </div>
                    <div style={fieldRowStyle}>
                      <span style={fieldLabelStyle}>Joined</span>
                      <span style={fieldValueStyle}>
                        {formatDate(u.createdAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '6px',
                        marginTop: '8px',
                      }}
                    >
                      {u.role === 'admin' ? (
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            padding: '4px 10px',
                            fontSize: '7.5px',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUserAction('revoke-admin', u);
                          }}
                        >
                          Revoke Admin
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            padding: '4px 10px',
                            fontSize: '7.5px',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUserAction('make-admin', u);
                          }}
                        >
                          Make Admin
                        </button>
                      )}
                      <button
                        type="button"
                        style={{
                          ...buttonDestructiveStyle,
                          padding: '4px 10px',
                          fontSize: '7.5px',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUserAction('delete', u);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Recommendation Locks */}
      <RecommendationLocks />

      {/* Telegram Configuration */}
      <TelegramConfig />

      {/* Aggregate Lists */}
      <AggregateLists />

      {/* Duplicate Album Scanner */}
      <DuplicateScanner />

      {/* Manual Album Audit */}
      <ManualAlbumAudit />

      <ConfirmDialog
        open={confirmAction !== null}
        onConfirm={executeUserAction}
        onCancel={() => setConfirmAction(null)}
        title={
          confirmAction?.action === 'delete'
            ? 'Delete User'
            : confirmAction?.action === 'make-admin'
              ? 'Grant Admin'
              : 'Revoke Admin'
        }
        message={
          confirmAction?.action === 'delete'
            ? `Delete user "${confirmAction.user.username}" and all their data? This cannot be undone.`
            : confirmAction?.action === 'make-admin'
              ? `Grant admin privileges to "${confirmAction?.user.username}"?`
              : `Revoke admin privileges from "${confirmAction?.user.username}"?`
        }
        confirmLabel={confirmAction?.action === 'delete' ? 'Delete' : 'Confirm'}
        destructive={confirmAction?.action === 'delete'}
      />
    </div>
  );
}
