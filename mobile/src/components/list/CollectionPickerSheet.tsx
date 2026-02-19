/**
 * CollectionPickerSheet - Bottom sheet for moving a list to a collection.
 *
 * Shows all non-year groups with a checkmark on the current one.
 * Tapping a different collection moves the list.
 */

import { useCallback, useState } from 'react';
import { Folder, Check } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import { showToast } from '@/components/ui/Toast';
import { moveList } from '@/services/lists';
import type { Group } from '@/lib/types';

interface CollectionPickerSheetProps {
  open: boolean;
  onClose: () => void;
  listId: string | null;
  listName: string;
  currentGroupId: string | null;
  groups: Group[];
  onMoved?: () => void;
}

export function CollectionPickerSheet({
  open,
  onClose,
  listId,
  listName,
  currentGroupId,
  groups,
  onMoved,
}: CollectionPickerSheetProps) {
  const [isMoving, setIsMoving] = useState(false);

  // Only show non-year groups (collections)
  const collections = groups.filter((g) => !g.isYearGroup);

  const handleSelect = useCallback(
    async (groupId: string) => {
      if (!listId || groupId === currentGroupId || isMoving) return;
      setIsMoving(true);
      try {
        await moveList(listId, { groupId });
        showToast(`Moved "${listName}" to collection`, 'success');
        onClose();
        onMoved?.();
      } catch {
        showToast('Error moving list', 'error');
      } finally {
        setIsMoving(false);
      }
    },
    [listId, listName, currentGroupId, isMoving, onClose, onMoved]
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Move to Collection">
      {collections.length === 0 ? (
        <div
          style={{
            padding: '16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
          }}
        >
          No collections available. Create one first.
        </div>
      ) : (
        collections.map((group) => {
          const isCurrent = group._id === currentGroupId;
          return (
            <ActionItem
              key={group._id}
              icon={
                isCurrent ? (
                  <Check size={16} style={{ color: 'var(--color-gold)' }} />
                ) : (
                  <Folder size={16} />
                )
              }
              label={group.name}
              disabled={isCurrent || isMoving}
              onClick={() => handleSelect(group._id)}
            />
          );
        })
      )}
    </BottomSheet>
  );
}
