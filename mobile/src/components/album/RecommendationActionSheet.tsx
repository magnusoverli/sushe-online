/**
 * RecommendationActionSheet - Bottom sheet with actions for a recommendation.
 *
 * Actions:
 * - Add to List... (opens ListSelectionSheet)
 * - View Reasoning (opens RecommendationInfoSheet - existing)
 * - Edit Reasoning (if current user is the recommender, year not locked)
 * - Remove (if current user is recommender or admin, year not locked)
 */

import { useState, useCallback, useEffect } from 'react';
import { Plus, MessageCircle, Edit3, Trash2, Lock, Loader } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  useEditReasoning,
  useRemoveRecommendation,
} from '@/hooks/useRecommendations';
import { getAlbumCoverUrl } from '@/services/albums';
import type { Recommendation, User } from '@/lib/types';

interface RecommendationActionSheetProps {
  open: boolean;
  onClose: () => void;
  recommendation: Recommendation | null;
  year: number;
  locked: boolean;
  user: User | null;
  onAddToList: (rec: Recommendation) => void;
  onViewReasoning: (rec: Recommendation) => void;
}

const MAX_REASONING_LENGTH = 500;

export function RecommendationActionSheet({
  open,
  onClose,
  recommendation: rec,
  year,
  locked,
  user,
  onAddToList,
  onViewReasoning,
}: RecommendationActionSheetProps) {
  const isOwner = !!user && !!rec && user._id === rec.recommender_id;
  const isAdmin = user?.role === 'admin';
  const canEdit = isOwner && !locked;
  const canRemove = (isOwner || isAdmin) && !locked;
  const hasReasoning = !!rec?.reasoning?.trim();

  // Edit reasoning state
  const [editMode, setEditMode] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const editMutation = useEditReasoning();
  const removeMutation = useRemoveRecommendation();

  // Confirm remove dialog
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Reset state when sheet closes
  useEffect(() => {
    if (!open) {
      setEditMode(false);
      setReasoning('');
      setConfirmRemove(false);
    }
  }, [open]);

  const handleAction = useCallback(
    (action: () => void) => {
      onClose();
      setTimeout(action, 200);
    },
    [onClose]
  );

  const handleAddToList = useCallback(() => {
    if (!rec) return;
    handleAction(() => onAddToList(rec));
  }, [rec, handleAction, onAddToList]);

  const handleViewReasoning = useCallback(() => {
    if (!rec) return;
    handleAction(() => onViewReasoning(rec));
  }, [rec, handleAction, onViewReasoning]);

  const handleStartEdit = useCallback(() => {
    if (!rec) return;
    setReasoning(rec.reasoning?.trim() || '');
    setEditMode(true);
  }, [rec]);

  const handleSaveReasoning = useCallback(async () => {
    if (!rec) return;
    try {
      await editMutation.mutateAsync({
        year,
        albumId: rec.album_id,
        reasoning: reasoning.trim(),
      });
      onClose();
    } catch {
      // Error handled by the mutation hook
    }
  }, [rec, year, reasoning, editMutation, onClose]);

  const handleRemove = useCallback(async () => {
    if (!rec) return;
    setConfirmRemove(false);
    try {
      await removeMutation.mutateAsync({
        year,
        albumId: rec.album_id,
      });
      onClose();
    } catch {
      // Error handled by the mutation hook
    }
  }, [rec, year, removeMutation, onClose]);

  if (!rec) return null;

  const subtitle = `${rec.artist} \u2014 ${rec.album}`;
  const charCount = reasoning.length;
  const isOverLimit = charCount > MAX_REASONING_LENGTH;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Recommendation"
        subtitle={subtitle}
        titleIcon={
          rec?.album_id ? (
            <img
              src={getAlbumCoverUrl(rec.album_id)}
              alt=""
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
          ) : undefined
        }
      >
        <div style={{ padding: '0 4px 8px' }}>
          {/* Lock banner */}
          {locked && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                marginBottom: '4px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.04)',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                letterSpacing: '0.04em',
                color: 'rgba(255,255,255,0.35)',
              }}
              data-testid="rec-action-lock-banner"
            >
              <Lock size={12} style={{ flexShrink: 0 }} />
              Recommendations for {year} are locked
            </div>
          )}

          {editMode ? (
            /* ── Edit reasoning form ── */
            <div style={{ padding: '4px 10px 8px' }}>
              <label
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.2em',
                  color: 'var(--color-text-label)',
                  display: 'block',
                  marginBottom: '6px',
                }}
              >
                Edit reasoning
              </label>
              <textarea
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                placeholder="Share your reasoning..."
                maxLength={MAX_REASONING_LENGTH + 50}
                style={{
                  width: '100%',
                  minHeight: '100px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: isOverLimit
                    ? '1px solid var(--color-destructive)'
                    : '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '16px',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
                data-testid="rec-edit-textarea"
              />
              <div
                style={{
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: isOverLimit
                    ? 'var(--color-destructive)'
                    : 'rgba(255,255,255,0.25)',
                  marginBottom: '12px',
                }}
              >
                {charCount}/{MAX_REASONING_LENGTH}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.10)',
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.50)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                  data-testid="rec-edit-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveReasoning}
                  disabled={isOverLimit || editMutation.isPending}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isOverLimit
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(96,165,250,0.20)',
                    color: isOverLimit ? 'rgba(255,255,255,0.25)' : '#60a5fa',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: isOverLimit ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  data-testid="rec-edit-save"
                >
                  {editMutation.isPending ? (
                    <>
                      <Loader
                        size={12}
                        style={{ animation: 'spin 1s linear infinite' }}
                      />
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* ── Standard actions ── */
            <>
              {/* Add to List */}
              <ActionItem
                icon={<Plus size={16} />}
                label="Add to List..."
                onClick={handleAddToList}
                hasChevron
              />

              {/* View Reasoning */}
              {hasReasoning && (
                <ActionItem
                  icon={
                    <MessageCircle size={16} style={{ color: '#a78bfa' }} />
                  }
                  label="View Reasoning"
                  onClick={handleViewReasoning}
                />
              )}

              {/* Edit Reasoning */}
              {canEdit && (
                <ActionItem
                  icon={<Edit3 size={16} style={{ color: '#60a5fa' }} />}
                  label={hasReasoning ? 'Edit Reasoning' : 'Add Reasoning'}
                  onClick={handleStartEdit}
                />
              )}

              {/* Divider + Remove */}
              {canRemove && (
                <>
                  <div
                    style={{
                      height: '1px',
                      background: 'var(--color-divider)',
                      margin: '4px 16px',
                    }}
                  />
                  <ActionItem
                    icon={<Trash2 size={16} />}
                    label="Remove Recommendation"
                    variant="destructive"
                    onClick={() => setConfirmRemove(true)}
                  />
                </>
              )}
            </>
          )}
        </div>
      </BottomSheet>

      {/* Remove confirmation */}
      <ConfirmDialog
        open={confirmRemove}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={handleRemove}
        title="Remove Recommendation"
        message={
          rec
            ? `Remove "${rec.album}" by ${rec.artist} from ${year} recommendations?`
            : ''
        }
        confirmLabel="Remove"
        destructive
      />
    </>
  );
}
