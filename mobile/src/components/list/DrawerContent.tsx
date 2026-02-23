/**
 * DrawerContent - Renders the grouped list items inside the NavigationDrawer
 * with drag-and-drop reordering support for both groups and lists within groups.
 *
 * Uses @dnd-kit for all drag interactions (same library as SortableAlbumList)
 * to ensure consistent cross-platform behaviour on both iOS and Android.
 *
 * Reordering:
 * - Long-press a group header to drag-reorder groups
 * - Long-press a list item within a group to drag-reorder lists within that group
 * - Calls the appropriate API on drop
 */

import {
  type ReactNode,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DrawerNavItem } from '@/components/ui/NavigationDrawer';
import { GroupAccordion } from '@/components/list/GroupAccordion';
import { reorderGroups, reorderListsInGroup } from '@/services/groups';
import { showToast } from '@/components/ui/Toast';
import { Star, List as ListIcon, ThumbsUp } from 'lucide-react';
import type { ListMetadata, Group } from '@/lib/types';
import { useRecommendationYears } from '@/hooks/useRecommendations';
import { useLockedYears } from '@/hooks/useYearLock';

/** Haptic vibration duration (ms). */
const HAPTIC_MS = 30;

// ── Sortable ID helpers ──
// Prefixes ensure group and list IDs never collide inside the shared DndContext.

const GROUP_PREFIX = 'g:';
const LIST_PREFIX = 'l:';

function toGroupSortId(groupId: string) {
  return `${GROUP_PREFIX}${groupId}`;
}
function toListSortId(listId: string) {
  return `${LIST_PREFIX}${listId}`;
}
function fromSortId(sortId: string): { type: 'group' | 'list'; id: string } {
  if (sortId.startsWith(GROUP_PREFIX)) {
    return { type: 'group', id: sortId.slice(GROUP_PREFIX.length) };
  }
  return { type: 'list', id: sortId.slice(LIST_PREFIX.length) };
}

// ── Sortable wrapper components ──

interface SortableGroupSectionProps {
  id: string;
  group: Group;
  defaultExpanded: boolean;
  dragMode: 'none' | 'group' | 'list';
  onContextMenu?: () => void;
  children: ReactNode;
}

/** Wraps a group accordion in a dnd-kit sortable item. Passes listeners to
 *  the GroupAccordion header so only header touches activate group drag. */
function SortableGroupSection({
  id,
  group,
  defaultExpanded,
  dragMode,
  onContextMenu,
  children,
}: SortableGroupSectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: 'none',
    willChange: isDragging ? 'transform' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <GroupAccordion
        name={group.name}
        isYearGroup={group.isYearGroup}
        defaultExpanded={defaultExpanded}
        isDragging={isDragging}
        showDragHandle={dragMode === 'none' || dragMode === 'group'}
        dragHandleProps={listeners}
        onContextMenu={onContextMenu}
      >
        {children}
      </GroupAccordion>
    </div>
  );
}

interface SortableListItemProps {
  id: string;
  list: ListMetadata;
  isActive: boolean;
  isLocked: boolean;
  dragMode: 'none' | 'group' | 'list';
  onClick: () => void;
}

/** Wraps a DrawerNavItem in a dnd-kit sortable item. The entire wrapper
 *  acts as the drag handle (listeners spread on the outer div). */
function SortableListItem({
  id,
  list,
  isActive,
  isLocked,
  dragMode,
  onClick,
}: SortableListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: 'none',
    willChange: isDragging ? 'transform' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DrawerNavItem
        label={list.name}
        count={list.count}
        icon={
          list.isMain ? (
            <Star size={12} style={{ color: 'var(--color-gold)' }} />
          ) : (
            <ListIcon size={12} />
          )
        }
        isActive={isActive}
        isLocked={isLocked}
        isDragging={isDragging}
        showDragHandle={dragMode === 'none' || dragMode === 'list'}
        onClick={onClick}
      />
    </div>
  );
}

// ── Main component ──

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

  // ── dnd-kit sensor (same config as SortableAlbumList) ──

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 300, tolerance: 10 },
  });
  const sensors = useSensors(touchSensor);

  // ── Derived data from sections ──

  const groupedSections = useMemo(
    () => sections.filter((s) => s.group !== null),
    [sections]
  );

  const sectionByGroupId = useMemo(() => {
    const map = new Map<string, DrawerSection>();
    for (const s of groupedSections) {
      if (s.group) map.set(s.group._id, s);
    }
    return map;
  }, [groupedSections]);

  // ── Local order state (updated live during drag via onDragOver) ──

  const [localGroupOrder, setLocalGroupOrder] = useState<string[]>(() =>
    groupedSections.map((s) => s.group!._id)
  );
  const [localListOrders, setLocalListOrders] = useState<
    Record<string, string[]>
  >(() => {
    const orders: Record<string, string[]> = {};
    for (const s of groupedSections) {
      if (s.group) orders[s.group._id] = s.lists.map((l) => l._id);
    }
    return orders;
  });

  // Sync from props when sections change (e.g. after API response)
  useEffect(() => {
    setLocalGroupOrder(groupedSections.map((s) => s.group!._id));
    const orders: Record<string, string[]> = {};
    for (const s of groupedSections) {
      if (s.group) orders[s.group._id] = s.lists.map((l) => l._id);
    }
    setLocalListOrders(orders);
  }, [groupedSections]);

  // Track active drag mode for visual cues (grip icon visibility)
  const [dragMode, setDragMode] = useState<'none' | 'group' | 'list'>('none');

  // Sortable IDs for the group SortableContext
  const groupSortIds = useMemo(
    () => localGroupOrder.map(toGroupSortId),
    [localGroupOrder]
  );

  // ── dnd-kit event handlers ──

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { type } = fromSortId(String(event.active.id));
    setDragMode(type);
    if (navigator.vibrate) navigator.vibrate(HAPTIC_MS);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeInfo = fromSortId(String(active.id));
    const overInfo = fromSortId(String(over.id));

    if (activeInfo.type === 'group' && overInfo.type === 'group') {
      setLocalGroupOrder((prev) => {
        const oldIdx = prev.indexOf(activeInfo.id);
        const newIdx = prev.indexOf(overInfo.id);
        if (oldIdx === -1 || newIdx === -1) return prev;
        return arrayMove(prev, oldIdx, newIdx);
      });
    } else if (activeInfo.type === 'list' && overInfo.type === 'list') {
      setLocalListOrders((prev) => {
        for (const [groupId, listIds] of Object.entries(prev)) {
          const oldIdx = listIds.indexOf(activeInfo.id);
          const newIdx = listIds.indexOf(overInfo.id);
          if (oldIdx !== -1 && newIdx !== -1) {
            return {
              ...prev,
              [groupId]: arrayMove(listIds, oldIdx, newIdx),
            };
          }
        }
        return prev;
      });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragMode('none');

      const { active, over } = event;
      const activeInfo = fromSortId(String(active.id));

      if (activeInfo.type === 'group') {
        // Persist group reorder (localGroupOrder already reflects final state)
        const originalOrder = groupedSections.map((s) => s.group!._id);
        if (localGroupOrder.join() === originalOrder.join()) return;

        queryClient.setQueryData<Group[]>(['groups'], (old) => {
          if (!old) return old;
          return localGroupOrder.map((id, i) => {
            const g = old.find((og) => og._id === id);
            return g ? { ...g, sortOrder: i } : g!;
          });
        });

        reorderGroups(localGroupOrder)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
          })
          .catch(() => {
            queryClient.invalidateQueries({ queryKey: ['groups'] });
            showToast('Failed to reorder groups', 'error');
          });
      } else if (activeInfo.type === 'list') {
        if (!over) return;

        // Find which group this list belongs to
        for (const [groupId, listIds] of Object.entries(localListOrders)) {
          if (!listIds.includes(activeInfo.id)) continue;

          const section = sectionByGroupId.get(groupId);
          if (!section) break;
          const originalOrder = section.lists.map((l) => l._id);
          if (listIds.join() === originalOrder.join()) break;

          queryClient.setQueryData<Record<string, ListMetadata>>(
            ['lists', 'metadata'],
            (old) => {
              if (!old) return old;
              const updated = { ...old };
              listIds.forEach((id, i) => {
                if (updated[id]) {
                  updated[id] = { ...updated[id], sortOrder: i };
                }
              });
              return updated;
            }
          );

          reorderListsInGroup(groupId, listIds)
            .then(() => {
              queryClient.invalidateQueries({
                queryKey: ['lists', 'metadata'],
              });
            })
            .catch(() => {
              queryClient.invalidateQueries({
                queryKey: ['lists', 'metadata'],
              });
              showToast('Failed to reorder lists', 'error');
            });
          break;
        }
      }
    },
    [
      groupedSections,
      localGroupOrder,
      localListOrders,
      sectionByGroupId,
      queryClient,
    ]
  );

  const handleDragCancel = useCallback(() => {
    setDragMode('none');
    // Revert to prop order
    setLocalGroupOrder(groupedSections.map((s) => s.group!._id));
    const orders: Record<string, string[]> = {};
    for (const s of groupedSections) {
      if (s.group) orders[s.group._id] = s.lists.map((l) => l._id);
    }
    setLocalListOrders(orders);
  }, [groupedSections]);

  // ── Recommendation years ──

  const { data: recYearsData } = useRecommendationYears();
  const { lockedYears: recLockedYears } = useLockedYears();
  const recYears = useMemo(() => {
    if (!recYearsData?.years) return [];
    return [...recYearsData.years].sort((a, b) => b - a);
  }, [recYearsData]);

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

  // ── Render ──

  return (
    <div data-testid="drawer-content">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Uncategorized lists (no group header, not sortable) */}
        {sections
          .filter((s) => s.group === null)
          .flatMap((section) =>
            section.lists.map((list) => (
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
            ))
          )}

        {/* Grouped sections — sortable */}
        <SortableContext
          items={groupSortIds}
          strategy={verticalListSortingStrategy}
        >
          {localGroupOrder.map((groupId) => {
            const section = sectionByGroupId.get(groupId);
            if (!section?.group) return null;

            const group = section.group;
            const listIds = localListOrders[groupId] ?? [];
            const listSortIds = listIds.map(toListSortId);

            const groupYear = group.isYearGroup
              ? parseInt(group.name, 10)
              : NaN;
            const hasRec =
              !isNaN(groupYear) &&
              recYearSet.has(groupYear) &&
              !!onSelectRecommendationYear;
            const isRecActiveInGroup =
              !isNaN(groupYear) && activeRecommendationYear === groupYear;
            const shouldExpand =
              section.lists.some((l) => l._id === activeListId) ||
              isRecActiveInGroup;

            return (
              <SortableGroupSection
                key={`${groupId}-${resetKey}`}
                id={toGroupSortId(groupId)}
                group={group}
                defaultExpanded={shouldExpand}
                dragMode={dragMode}
                onContextMenu={
                  !group.isYearGroup
                    ? () => {
                        onCloseDrawer();
                        onGroupContextMenu(group);
                      }
                    : undefined
                }
              >
                {/* List items within this group — sortable */}
                <SortableContext
                  items={listSortIds}
                  strategy={verticalListSortingStrategy}
                >
                  {listIds.map((listId) => {
                    const list = section.lists.find((l) => l._id === listId);
                    if (!list) return null;

                    return (
                      <SortableListItem
                        key={listId}
                        id={toListSortId(listId)}
                        list={list}
                        isActive={list._id === activeListId}
                        isLocked={
                          list.isMain &&
                          list.year != null &&
                          lockedYears.has(list.year)
                        }
                        dragMode={dragMode}
                        onClick={() => onSelectList(list._id)}
                      />
                    );
                  })}
                </SortableContext>

                {/* Recommendation item inside this year group (not sortable) */}
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
                    showDragHandle={dragMode === 'none' || dragMode === 'list'}
                    onClick={() => onSelectRecommendationYear!(groupYear)}
                  />
                )}
              </SortableGroupSection>
            );
          })}
        </SortableContext>
      </DndContext>

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
