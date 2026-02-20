/**
 * GroupActionSheet - Bottom sheet with actions for a group/collection.
 *
 * For collections: Rename, Delete (with force option for non-empty).
 * For year groups: Shows info text only (auto-managed).
 */

import { useState, useRef } from 'react';
import { Edit3, Trash2 } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import { updateGroup, deleteGroup } from '@/services/groups';
import type { Group } from '@/lib/types';

interface GroupActionSheetProps {
  open: boolean;
  onClose: () => void;
  group: Group | null;
  onUpdated?: () => void;
}

export function GroupActionSheet({
  open,
  onClose,
  group,
  onUpdated,
}: GroupActionSheetProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forceDeleteChecked, setForceDeleteChecked] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!group) return null;

  const isYearGroup = group.isYearGroup;
  const hasLists = group.listCount > 0;

  const handleStartRename = () => {
    setRenameValue(group.name);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleRenameSubmit = async () => {
    const name = renameValue.trim();
    if (!name) {
      showToast('Name cannot be empty', 'error');
      return;
    }
    if (name === group.name) {
      setIsRenaming(false);
      return;
    }
    try {
      await updateGroup(group._id, { name });
      showToast(`Renamed to "${name}"`, 'success');
      setIsRenaming(false);
      onClose();
      onUpdated?.();
    } catch {
      showToast('Error renaming collection', 'error');
    }
  };

  const handleDelete = () => {
    onClose();
    setForceDeleteChecked(false);
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await deleteGroup(group._id, hasLists);
      setConfirmDelete(false);
      showToast(`Deleted "${group.name}"`, 'success');
      onUpdated?.();
    } catch {
      showToast('Error deleting collection', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={group.name}>
        {isYearGroup ? (
          <div
            style={{
              padding: '12px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              lineHeight: '1.5',
            }}
          >
            Year groups are managed automatically. They are removed when empty.
          </div>
        ) : isRenaming ? (
          /* Inline rename form */
          <div style={{ padding: '8px 10px' }}>
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              maxLength={50}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '16px',
                color: 'var(--color-text-primary)',
                outline: 'none',
              }}
              data-testid="group-rename-input"
            />
            <div
              style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-end',
                marginTop: '8px',
              }}
            >
              <button
                type="button"
                onClick={() => setIsRenaming(false)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameSubmit}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  fontWeight: 500,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--color-gold)',
                  color: '#1A1A1F',
                  cursor: 'pointer',
                }}
                data-testid="group-rename-submit"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <ActionItem
              icon={<Edit3 size={16} />}
              label="Rename"
              onClick={handleStartRename}
            />
            <ActionItem
              icon={<Trash2 size={16} />}
              label="Delete Collection"
              destructive
              onClick={handleDelete}
            />
          </>
        )}
      </BottomSheet>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDelete}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(false)}
        title="Delete Collection"
        message={
          hasLists
            ? `The collection "${group.name}" contains ${group.listCount} list${group.listCount === 1 ? '' : 's'}.`
            : `Are you sure you want to delete "${group.name}"?`
        }
        warning={
          hasLists
            ? 'Deleting this collection will move the lists to "Uncategorized". This action cannot be undone.'
            : 'This action cannot be undone.'
        }
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete Collection'}
        confirmDisabled={isDeleting || (hasLists && !forceDeleteChecked)}
        destructive
      >
        {hasLists && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={forceDeleteChecked}
              onChange={(e) => setForceDeleteChecked(e.target.checked)}
              style={{ accentColor: 'var(--color-destructive)' }}
              data-testid="force-delete-checkbox"
            />
            I understand that {group.listCount} list
            {group.listCount === 1 ? '' : 's'} will be moved to
            &ldquo;Uncategorized&rdquo;
          </label>
        )}
      </ConfirmDialog>
    </>
  );
}
