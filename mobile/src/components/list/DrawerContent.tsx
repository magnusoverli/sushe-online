/**
 * DrawerContent - Renders the grouped list items inside the NavigationDrawer
 * with drag-and-drop reordering support for both groups and lists within groups.
 *
 * Reordering:
 * - Long-press a group header to drag-reorder groups
 * - Long-press a list item within a group to drag-reorder lists within that group
 * - Calls the appropriate API on drop
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DrawerNavItem } from '@/components/ui/NavigationDrawer';
import { GroupAccordion } from '@/components/list/GroupAccordion';
import { reorderGroups, reorderListsInGroup } from '@/services/groups';
import { showToast } from '@/components/ui/Toast';
import { Star, List as ListIcon, ThumbsUp } from 'lucide-react';
import type { ListMetadata, Group } from '@/lib/types';
import { useRecommendationYears } from '@/hooks/useRecommendations';
import { useLockedYears } from '@/hooks/useYearLock';

/** Movement threshold (px) to cancel long-press. */
const MOVE_CANCEL_THRESHOLD = 8;

/** Long-press duration to start drag (ms). */
const DRAWER_LONG_PRESS_MS = 300;

/** Haptic vibration duration (ms). */
const HAPTIC_MS = 30;

interface DrawerSection {
  group: Group | null;
  lists: ListMetadata[];
}

interface DrawerContentProps {
  sections: DrawerSection[];
  activeListId: string | null;
  lockedYears: Set<number>;
  onSelectList: (listId: string) => void;
  onGroupContextMenu: (group: Group) => void;
  onCloseDrawer: () => void;
  /** Currently viewed recommendation year (for active state). */
  activeRecommendationYear?: number | null;
  /** Called when a recommendation year is tapped. */
  onSelectRecommendationYear?: (year: number) => void;
  /** Incremented each time the drawer opens to reset accordion state. */
  resetKey?: number;
}

type DragMode = 'none' | 'group' | 'list';

interface DragState {
  mode: DragMode;
  /** For group drag: the group's _id. For list drag: the list's _id. */
  dragId: string | null;
  /** Index of the dragged item within its container. */
  dragIndex: number | null;
  /** Current drop target index. */
  dropIndex: number | null;
  /** For list drag: the groupId containing the lists. */
  groupId: string | null;
}

const initialDragState: DragState = {
  mode: 'none',
  dragId: null,
  dragIndex: null,
  dropIndex: null,
  groupId: null,
};

export function DrawerContent({
  sections,
  activeListId,
  lockedYears,
  onSelectList,
  onGroupContextMenu,
  onCloseDrawer,
  activeRecommendationYear,
  onSelectRecommendationYear,
  resetKey = 0,
}: DrawerContentProps) {
  const queryClient = useQueryClient();
  const [dragState, setDragState] = useState<DragState>(initialDragState);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  // Refs for group header elements (for group reordering)
  const groupRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  // Refs for list item elements within a group (for list reordering)
  const listRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  // Track which group's lists are being dragged, and their ordered IDs
  const dragGroupListIds = useRef<string[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // ── Group drag handlers ──

  const registerGroupRef = useCallback(
    (groupId: string, el: HTMLElement | null) => {
      groupRefs.current.set(groupId, el);
    },
    []
  );

  const registerListRef = useCallback(
    (listId: string, el: HTMLElement | null) => {
      listRefs.current.set(listId, el);
    },
    []
  );

  const findGroupDropIndex = useCallback(
    (touchY: number): number | null => {
      // Only consider sections that have a group (not uncategorized)
      const groupSections = sections.filter((s) => s.group !== null);
      for (let i = 0; i < groupSections.length; i++) {
        const el = groupRefs.current.get(groupSections[i]!.group!._id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (touchY < midY) return i;
      }
      return groupSections.length > 0 ? groupSections.length - 1 : null;
    },
    [sections]
  );

  const findListDropIndex = useCallback((touchY: number): number | null => {
    const ids = dragGroupListIds.current;
    for (let i = 0; i < ids.length; i++) {
      const el = listRefs.current.get(ids[i]!);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (touchY < midY) return i;
    }
    return ids.length > 0 ? ids.length - 1 : null;
  }, []);

  // Unified touch handlers

  const handleGroupTouchStart = useCallback(
    (groupIndex: number, groupId: string, e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      touchStartPos.current = { x: touch.clientX, y: touch.clientY };

      longPressTimer.current = setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(HAPTIC_MS);
        setDragState({
          mode: 'group',
          dragId: groupId,
          dragIndex: groupIndex,
          dropIndex: groupIndex,
          groupId: null,
        });
      }, DRAWER_LONG_PRESS_MS);
    },
    []
  );

  const handleListTouchStart = useCallback(
    (
      listIndex: number,
      listId: string,
      groupId: string,
      groupLists: ListMetadata[],
      e: React.TouchEvent
    ) => {
      const touch = e.touches[0];
      if (!touch) return;

      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      dragGroupListIds.current = groupLists.map((l) => l._id);

      longPressTimer.current = setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(HAPTIC_MS);
        setDragState({
          mode: 'list',
          dragId: listId,
          dragIndex: listIndex,
          dropIndex: listIndex,
          groupId,
        });
      }, DRAWER_LONG_PRESS_MS);
    },
    []
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      if (dragState.mode === 'none') {
        // Check if we should cancel the long-press
        if (touchStartPos.current) {
          const dx = touch.clientX - touchStartPos.current.x;
          const dy = touch.clientY - touchStartPos.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_THRESHOLD) {
            cancelLongPress();
          }
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (dragState.mode === 'group') {
        const newDropIndex = findGroupDropIndex(touch.clientY);
        if (newDropIndex !== null && newDropIndex !== dragState.dropIndex) {
          setDragState((prev) => ({ ...prev, dropIndex: newDropIndex }));
        }
      } else if (dragState.mode === 'list') {
        const newDropIndex = findListDropIndex(touch.clientY);
        if (newDropIndex !== null && newDropIndex !== dragState.dropIndex) {
          setDragState((prev) => ({ ...prev, dropIndex: newDropIndex }));
        }
      }
    },
    [
      dragState.mode,
      dragState.dropIndex,
      cancelLongPress,
      findGroupDropIndex,
      findListDropIndex,
    ]
  );

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();

    if (dragState.mode === 'none') {
      touchStartPos.current = null;
      return;
    }

    const { mode, dragIndex, dropIndex, groupId } = dragState;

    // Reset state immediately
    setDragState(initialDragState);
    touchStartPos.current = null;

    if (dragIndex === null || dropIndex === null || dragIndex === dropIndex) {
      return;
    }

    if (mode === 'group') {
      // Reorder groups
      const groupSections = sections.filter((s) => s.group !== null);
      const groupIds = groupSections.map((s) => s.group!._id);
      const newOrder = moveItem(groupIds, dragIndex, dropIndex);

      // Optimistically update the cache
      queryClient.setQueryData<Group[]>(['groups'], (old) => {
        if (!old) return old;
        return newOrder.map((id, i) => {
          const g = old.find((g) => g._id === id);
          return g ? { ...g, sortOrder: i } : g!;
        });
      });

      reorderGroups(newOrder)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['groups'] });
        })
        .catch(() => {
          queryClient.invalidateQueries({ queryKey: ['groups'] });
          showToast('Failed to reorder groups', 'error');
        });
    } else if (mode === 'list' && groupId) {
      // Reorder lists within a group
      const listIds = dragGroupListIds.current;
      const newOrder = moveItem(listIds, dragIndex, dropIndex);

      // Optimistically update the cache
      queryClient.setQueryData<Record<string, ListMetadata>>(
        ['lists', 'metadata'],
        (old) => {
          if (!old) return old;
          const updated = { ...old };
          newOrder.forEach((id, i) => {
            if (updated[id]) {
              updated[id] = { ...updated[id], sortOrder: i };
            }
          });
          return updated;
        }
      );

      reorderListsInGroup(groupId, newOrder)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
        })
        .catch(() => {
          queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
          showToast('Failed to reorder lists', 'error');
        });
    }
  }, [dragState, sections, queryClient, cancelLongPress]);

  // Helper to determine the visual drag state for a group
  const getGroupDragState = useCallback(
    (
      groupId: string,
      groupIndex: number
    ): 'default' | 'dragging' | 'drop-target' => {
      if (dragState.mode !== 'group') return 'default';
      if (dragState.dragId === groupId) return 'dragging';
      if (dragState.dropIndex === groupIndex && dragState.dragId !== groupId) {
        return 'drop-target';
      }
      return 'default';
    },
    [dragState]
  );

  // Helper to determine the visual drag state for a list item
  const getListDragState = useCallback(
    (
      listId: string,
      listIndex: number,
      parentGroupId: string
    ): 'default' | 'dragging' | 'drop-target' => {
      if (dragState.mode !== 'list' || dragState.groupId !== parentGroupId)
        return 'default';
      if (dragState.dragId === listId) return 'dragging';
      if (dragState.dropIndex === listIndex && dragState.dragId !== listId) {
        return 'drop-target';
      }
      return 'default';
    },
    [dragState]
  );

  // Fetch recommendation years for the sidebar
  const { data: recYearsData } = useRecommendationYears();
  const { lockedYears: recLockedYears } = useLockedYears();
  const recYears = useMemo(() => {
    if (!recYearsData?.years) return [];
    return [...recYearsData.years].sort((a, b) => b - a);
  }, [recYearsData]);

  // Build a set of rec years that have a matching year group, and collect orphans
  const recYearSet = useMemo(() => new Set(recYears), [recYears]);
  const yearGroupNames = useMemo(
    () =>
      new Set(
        sections.filter((s) => s.group?.isYearGroup).map((s) => s.group!.name)
      ),
    [sections]
  );
  const orphanRecYears = useMemo(
    () => recYears.filter((y) => !yearGroupNames.has(String(y))),
    [recYears, yearGroupNames]
  );

  // Track group index across sections (only those with a group)
  let groupIndex = 0;

  return (
    <div
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      data-testid="drawer-content"
    >
      {sections.map((section) => {
        const group = section.group;

        if (!group) {
          // Uncategorized lists (no group header) — no drag reordering
          return section.lists.map((list) => (
            <DrawerNavItem
              key={list._id}
              label={list.name}
              count={list.count}
              icon={
                list.isMain ? (
                  <Star size={12} style={{ color: 'var(--color-gold)' }} />
                ) : (
                  <ListIcon size={12} />
                )
              }
              isActive={list._id === activeListId}
              isLocked={
                list.isMain && list.year != null && lockedYears.has(list.year)
              }
              onClick={() => onSelectList(list._id)}
            />
          ));
        }

        const currentGroupIndex = groupIndex;
        groupIndex++;

        const gDragState = getGroupDragState(group._id, currentGroupIndex);

        // Check if this year group has a matching recommendation
        const groupYear = group.isYearGroup ? parseInt(group.name, 10) : NaN;
        const hasRec =
          !isNaN(groupYear) &&
          recYearSet.has(groupYear) &&
          onSelectRecommendationYear;

        // Expand if active list is in this group OR active rec year matches
        const isRecActiveInGroup =
          !isNaN(groupYear) && activeRecommendationYear === groupYear;
        const shouldExpand =
          section.lists.some((l) => l._id === activeListId) ||
          isRecActiveInGroup;

        return (
          <div
            key={`${group._id}-${resetKey}`}
            ref={(el) => registerGroupRef(group._id, el)}
            onTouchStart={(e) =>
              handleGroupTouchStart(currentGroupIndex, group._id, e)
            }
          >
            <GroupAccordion
              name={group.name}
              isYearGroup={group.isYearGroup}
              defaultExpanded={shouldExpand}
              dragState={gDragState}
              showDragHandle={
                dragState.mode === 'none' || dragState.mode === 'group'
              }
              onContextMenu={
                !group.isYearGroup
                  ? () => {
                      onCloseDrawer();
                      onGroupContextMenu(group);
                    }
                  : undefined
              }
            >
              {section.lists.map((list, listIdx) => {
                const lDragState = getListDragState(
                  list._id,
                  listIdx,
                  group._id
                );

                return (
                  <div
                    key={list._id}
                    ref={(el) => registerListRef(list._id, el)}
                    onTouchStart={(e) => {
                      // Only start list drag if not already in group drag mode
                      if (dragState.mode === 'group') return;
                      e.stopPropagation();
                      handleListTouchStart(
                        listIdx,
                        list._id,
                        group._id,
                        section.lists,
                        e
                      );
                    }}
                  >
                    <DrawerNavItem
                      label={list.name}
                      count={list.count}
                      icon={
                        list.isMain ? (
                          <Star
                            size={12}
                            style={{ color: 'var(--color-gold)' }}
                          />
                        ) : (
                          <ListIcon size={12} />
                        )
                      }
                      isActive={list._id === activeListId}
                      isLocked={
                        list.isMain &&
                        list.year != null &&
                        lockedYears.has(list.year)
                      }
                      dragState={lDragState}
                      showDragHandle={
                        dragState.mode === 'none' || dragState.mode === 'list'
                      }
                      onClick={() => onSelectList(list._id)}
                    />
                  </div>
                );
              })}

              {/* Recommendation item inside this year group */}
              {hasRec && (
                <DrawerNavItem
                  label={`${groupYear} Recs`}
                  icon={
                    <ThumbsUp
                      size={12}
                      style={{
                        color: isRecActiveInGroup
                          ? 'var(--color-gold)'
                          : '#60a5fa',
                      }}
                    />
                  }
                  isActive={isRecActiveInGroup}
                  isLocked={recLockedYears.has(groupYear)}
                  showDragHandle={
                    dragState.mode === 'none' || dragState.mode === 'list'
                  }
                  onClick={() => onSelectRecommendationYear!(groupYear)}
                />
              )}
            </GroupAccordion>
          </div>
        );
      })}

      {/* ── Orphan recommendation years (no matching year group) ── */}
      {orphanRecYears.length > 0 && onSelectRecommendationYear && (
        <div data-testid="drawer-recommendations-section">
          <div
            style={{
              padding: '12px 10px 4px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              fontWeight: 400,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'var(--color-text-label)',
            }}
          >
            Recommendations
          </div>

          {orphanRecYears.map((year) => {
            const isActive = activeRecommendationYear === year;
            const isYearLocked = recLockedYears.has(year);

            return (
              <DrawerNavItem
                key={`rec-${year}`}
                label={`${year} Recs`}
                icon={
                  <ThumbsUp
                    size={12}
                    style={{
                      color: isActive ? 'var(--color-gold)' : '#60a5fa',
                    }}
                  />
                }
                isActive={isActive}
                isLocked={isYearLocked}
                onClick={() => onSelectRecommendationYear(year)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Reorder an array by moving an item from one index to another. */
function moveItem<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...arr];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item!);
  return result;
}
