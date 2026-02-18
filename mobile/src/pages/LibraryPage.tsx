/**
 * LibraryPage - Main album list view with navigation drawer.
 *
 * Features:
 * - Auto-selects the main list (or first available) on load
 * - Sort dropdown (custom, artist, title, year, genre, country)
 * - Album cards with lazy-loaded covers, rank badges, tag pills
 * - Year mismatch indicator (red release date)
 * - AI summary and recommendation badges on covers
 * - End-of-list footer
 * - Navigation drawer with grouped lists, list switching
 * - List action sheet (download, edit, toggle main, delete, etc.)
 * - Group action sheet (rename, delete collection)
 * - Create list / collection sheets
 * - Import from JSON file
 * - Album action sheet (edit, move, copy, remove)
 * - Full-screen album editor (cover, genres, tracks, comments)
 * - AI summary and recommendation info sheets
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { useDragStore } from '@/stores/drag-store';
import { useListsMetadata, useListAlbums, useGroups } from '@/hooks/useLists';
import {
  getAlbumCoverUrl,
  updateAlbumCountry,
  updateAlbumGenres,
  updateAlbumComment,
  updateAlbumComment2,
} from '@/services/albums';
import {
  updateListItems,
  getList,
  replaceListItems,
  reorderList,
} from '@/services/lists';
import { readImportFile, importList } from '@/services/import';
import { useDragAndDrop } from '@/features/drag-drop';
import { AppShell } from '@/components/layout/AppShell';
import { ListHeader } from '@/components/list/ListHeader';
import { ListFooter } from '@/components/list/ListFooter';
import { AlbumCard, type CardState } from '@/components/ui/AlbumCard';
import { CoverImage } from '@/components/album/CoverImage';
import { GhostCard } from '@/components/ui/GhostCard';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import {
  NavigationDrawer,
  DrawerNavItem,
} from '@/components/ui/NavigationDrawer';
import { GroupAccordion } from '@/components/list/GroupAccordion';
import { ListActionSheet } from '@/components/list/ListActionSheet';
import { GroupActionSheet } from '@/components/list/GroupActionSheet';
import { CollectionPickerSheet } from '@/components/list/CollectionPickerSheet';
import { CreateListSheet } from '@/components/list/CreateListSheet';
import { CreateCollectionSheet } from '@/components/list/CreateCollectionSheet';
import { EditListSheet } from '@/components/list/EditListSheet';
import { AlbumActionSheet } from '@/components/album/AlbumActionSheet';
import {
  AlbumEditForm,
  type AlbumEditUpdates,
} from '@/components/album/AlbumEditForm';
import { ListSelectionSheet } from '@/components/album/ListSelectionSheet';
import { SummarySheet } from '@/components/album/SummarySheet';
import { RecommendationInfoSheet } from '@/components/album/RecommendationInfoSheet';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import {
  ChevronDown,
  ListPlus,
  FolderPlus,
  FileUp,
  List as ListIcon,
  Star,
} from 'lucide-react';
import {
  isYearMismatch,
  buildAlbumTags,
  sortAlbums,
  debounce,
} from '@/lib/utils';
import { REORDER_DEBOUNCE_MS } from '@/lib/constants';
import type { Album, AlbumSortKey, ListMetadata, Group } from '@/lib/types';

const SORT_OPTIONS: DropdownItem[] = [
  { id: 'custom', label: 'Custom Order' },
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'year', label: 'Year' },
  { id: 'genre', label: 'Genre' },
  { id: 'country', label: 'Country' },
];

/** Find the best default list: prefer isMain, fallback to first by sortOrder. */
function pickDefaultList(lists: Record<string, ListMetadata>): string | null {
  const entries = Object.values(lists);
  if (entries.length === 0) return null;
  const main = entries.find((l) => l.isMain);
  if (main) return main._id;
  entries.sort((a, b) => a.sortOrder - b.sortOrder);
  return entries[0]?._id ?? null;
}

/**
 * Group lists by their group, sorted by group sortOrder.
 * Lists without a group go into an "Uncategorized" virtual group.
 */
function groupListsByGroup(
  listsMap: Record<string, ListMetadata>,
  groups: Group[]
): { group: Group | null; lists: ListMetadata[] }[] {
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  const assignedListIds = new Set<string>();

  const sections: { group: Group | null; lists: ListMetadata[] }[] = [];

  for (const group of sortedGroups) {
    const groupLists = Object.values(listsMap)
      .filter((l) => l.groupId === group._id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Skip empty year groups (they auto-delete, but filter just in case)
    if (group.isYearGroup && groupLists.length === 0) continue;

    sections.push({ group, lists: groupLists });
    groupLists.forEach((l) => assignedListIds.add(l._id));
  }

  // Orphaned / uncategorized lists
  const orphaned = Object.values(listsMap)
    .filter((l) => !assignedListIds.has(l._id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (orphaned.length > 0) {
    sections.push({ group: null, lists: orphaned });
  }

  return sections;
}

/** Determine if a list is inside a non-year (collection) group or orphaned. */
function isListInCollection(
  list: ListMetadata | null,
  groups: Group[]
): boolean {
  if (!list) return false;
  if (!list.groupId) return true; // orphaned = can move to collection
  const group = groups.find((g) => g._id === list.groupId);
  if (!group) return true; // group not found = treat as orphaned
  return !group.isYearGroup;
}

// ── Footer bar button style ──
const footerBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '8px 4px',
  fontFamily: 'var(--font-mono)',
  fontSize: '8px',
  letterSpacing: '0.04em',
  color: 'rgba(255,255,255,0.35)',
};

export function LibraryPage() {
  const activeListId = useAppStore((s) => s.activeListId);
  const setActiveListId = useAppStore((s) => s.setActiveListId);
  const setListsMetadata = useAppStore((s) => s.setListsMetadata);
  const isDrawerOpen = useAppStore((s) => s.isDrawerOpen);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);
  const user = useAppStore((s) => s.user);

  const queryClient = useQueryClient();

  const [sortKey, setSortKey] = useState<AlbumSortKey>('custom');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Sheet states
  const [listActionTarget, setListActionTarget] = useState<string | null>(null);
  const [groupActionTarget, setGroupActionTarget] = useState<Group | null>(
    null
  );
  const [collectionPickerTarget, setCollectionPickerTarget] = useState<
    string | null
  >(null);
  const [showCreateList, setShowCreateList] = useState(false);
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [editListTarget, setEditListTarget] = useState<string | null>(null);

  // Album action states
  const [albumActionTarget, setAlbumActionTarget] = useState<Album | null>(
    null
  );
  const [albumEditTarget, setAlbumEditTarget] = useState<Album | null>(null);
  const [moveAlbumTarget, setMoveAlbumTarget] = useState<Album | null>(null);
  const [copyAlbumTarget, setCopyAlbumTarget] = useState<Album | null>(null);
  const [removeAlbumTarget, setRemoveAlbumTarget] = useState<Album | null>(
    null
  );
  const [summaryTarget, setSummaryTarget] = useState<{
    albumId: string;
    albumName: string;
    artistName: string;
  } | null>(null);
  const [recommendationTarget, setRecommendationTarget] = useState<{
    albumName: string;
    artistName: string;
    recommendedBy: string | null;
    recommendedAt: string | null;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);

  // Fetch lists metadata
  const {
    data: listsMap,
    isLoading: listsLoading,
    error: listsError,
  } = useListsMetadata();

  // Fetch groups
  const { data: groups } = useGroups();

  // Sync lists metadata to store
  useEffect(() => {
    if (listsMap) {
      setListsMetadata(listsMap);
    }
  }, [listsMap, setListsMetadata]);

  // Auto-select default list
  useEffect(() => {
    if (listsMap && !activeListId) {
      const defaultId = pickDefaultList(listsMap);
      if (defaultId) setActiveListId(defaultId);
    }
  }, [listsMap, activeListId, setActiveListId]);

  // Get active list metadata
  const activeList = activeListId && listsMap ? listsMap[activeListId] : null;

  // Fetch albums for the active list
  const {
    data: albums,
    isLoading: albumsLoading,
    error: albumsError,
  } = useListAlbums(activeListId);

  // Resolve group name for eyebrow
  const groupName = useMemo(() => {
    if (!activeList?.groupId || !groups) return undefined;
    const group = groups.find((g) => g._id === activeList.groupId);
    return group?.name;
  }, [activeList, groups]);

  // Sort albums
  const sortedAlbums = useMemo(() => {
    if (!albums) return [];
    return sortAlbums(albums, sortKey);
  }, [albums, sortKey]);

  const sortTriggerRef = useRef<HTMLButtonElement>(null);

  // ── Drag-and-drop reordering ──
  const isDragging = useDragStore((s) => s.isDragging);
  const dragOrderedIds = useDragStore((s) => s.orderedIds);
  const dragIndex = useDragStore((s) => s.dragIndex);
  const dropIndex = useDragStore((s) => s.dropIndex);
  const ghostX = useDragStore((s) => s.ghostX);
  const ghostY = useDragStore((s) => s.ghostY);
  const ghostWidth = useDragStore((s) => s.ghostWidth);

  // Derive the displayed album order: during drag, use drag store order
  const displayAlbums = useMemo(() => {
    if (!isDragging || sortKey !== 'custom' || dragOrderedIds.length === 0) {
      return sortedAlbums;
    }
    // Reorder sortedAlbums based on dragOrderedIds
    const albumMap = new Map(sortedAlbums.map((a) => [a._id, a]));
    return dragOrderedIds
      .map((id) => albumMap.get(id))
      .filter((a): a is Album => a !== undefined);
  }, [isDragging, sortKey, dragOrderedIds, sortedAlbums]);

  // The album being dragged (for ghost card content)
  const draggedAlbum = useMemo(() => {
    if (dragIndex === null || !sortedAlbums[dragIndex]) return null;
    return sortedAlbums[dragIndex];
  }, [dragIndex, sortedAlbums]);

  // Debounced reorder save
  const debouncedReorder = useMemo(
    () =>
      debounce((listId: string, order: string[]) => {
        reorderList(listId, order).then(() => {
          queryClient.invalidateQueries({ queryKey: ['list-albums', listId] });
          queryClient.invalidateQueries({ queryKey: ['lists'] });
        });
      }, REORDER_DEBOUNCE_MS),
    [queryClient]
  );

  const handleReorder = useCallback(
    (newOrder: string[]) => {
      if (!activeListId) return;
      debouncedReorder(activeListId, newOrder);
    },
    [activeListId, debouncedReorder]
  );

  const { handlers: dragHandlers, registerCard } = useDragAndDrop({
    itemIds: useMemo(() => sortedAlbums.map((a) => a._id), [sortedAlbums]),
    onReorder: handleReorder,
    enabled: sortKey === 'custom',
    scrollContainerRef,
  });

  /** Get the card visual state for a given index during drag. */
  const getCardState = useCallback(
    (index: number): CardState => {
      if (!isDragging) return 'default';

      // Find the original dragged item's current index in the display order
      const draggedId =
        dragIndex !== null ? sortedAlbums[dragIndex]?._id : null;
      const currentId = displayAlbums[index]?._id;

      if (currentId === draggedId) return 'dragging';
      if (index === dropIndex) return 'drop-target';
      return 'dimmed';
    },
    [isDragging, dragIndex, dropIndex, sortedAlbums, displayAlbums]
  );

  const handleSortSelect = useCallback((id: string) => {
    setSortKey(id as AlbumSortKey);
    setSortDropdownOpen(false);
  }, []);

  const handleMenuClick = useCallback(() => {
    setDrawerOpen(true);
  }, [setDrawerOpen]);

  // ── List switching ──
  const handleSelectList = useCallback(
    (listId: string) => {
      setActiveListId(listId);
      setDrawerOpen(false);
      setSortKey('custom'); // Reset sort on list switch
    },
    [setActiveListId, setDrawerOpen]
  );

  // ── Invalidate queries helper ──
  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  }, [queryClient]);

  // ── List action handlers ──
  const handleListDeleted = useCallback(
    (deletedId: string) => {
      refreshData();
      if (activeListId === deletedId) {
        // Select next available list
        if (listsMap) {
          const remaining = Object.values(listsMap).filter(
            (l) => l._id !== deletedId
          );
          if (remaining.length > 0) {
            remaining.sort((a, b) => a.sortOrder - b.sortOrder);
            setActiveListId(remaining[0]!._id);
          } else {
            setActiveListId(null);
          }
        }
      }
    },
    [activeListId, listsMap, refreshData, setActiveListId]
  );

  const handleListCreated = useCallback(
    (listId: string) => {
      refreshData();
      setActiveListId(listId);
    },
    [refreshData, setActiveListId]
  );

  // ── Import handler ──
  const handleImportClick = useCallback(() => {
    setDrawerOpen(false);
    fileInputRef.current?.click();
  }, [setDrawerOpen]);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset the input so the same file can be selected again
      e.target.value = '';

      try {
        showToast('Importing...', 'info', 2000);
        const {
          name,
          albums: importAlbums,
          metadata,
        } = await readImportFile(file);
        const result = await importList(name, importAlbums, metadata);
        showToast(
          `Imported "${result.listName}" (${result.albumCount} albums)`,
          'success'
        );
        refreshData();
        setActiveListId(result.listId);
      } catch (err) {
        const msg =
          err instanceof SyntaxError
            ? 'Invalid JSON file'
            : 'Error importing list';
        showToast(msg, 'error');
      }
    },
    [refreshData, setActiveListId]
  );

  // ── Album action handlers ──

  const handleAlbumMenuClick = useCallback((album: Album) => {
    setAlbumActionTarget(album);
  }, []);

  const handleAlbumEdit = useCallback(
    async (updates: AlbumEditUpdates) => {
      if (!albumEditTarget || !activeListId) return;

      try {
        const album = albumEditTarget;

        // Save canonical fields (country, genres) via album API
        const promises: Promise<unknown>[] = [];

        if (updates.country !== album.country) {
          promises.push(updateAlbumCountry(album.album_id, updates.country));
        }
        if (
          updates.genre_1 !== album.genre_1 ||
          updates.genre_2 !== album.genre_2
        ) {
          promises.push(
            updateAlbumGenres(album.album_id, {
              genre_1: updates.genre_1,
              genre_2: updates.genre_2,
            })
          );
        }

        // Save per-list-item fields (comments) via list API
        // Use album_id (canonical identifier) — stable across PUT replacements
        // which regenerate all _id values
        if (updates.comments !== album.comments) {
          promises.push(
            updateAlbumComment(
              activeListId,
              album.album_id,
              updates.comments || null
            )
          );
        }
        if (updates.comments_2 !== album.comments_2) {
          promises.push(
            updateAlbumComment2(
              activeListId,
              album.album_id,
              updates.comments_2 || null
            )
          );
        }

        // Save list-level changes (artist, album, release_date, cover) via full replacement
        const albumData: Partial<Album> = {
          _id: album._id,
          album_id: album.album_id,
          artist: updates.artist,
          album: updates.album,
          release_date: updates.release_date,
        };
        if (updates.cover_image) {
          albumData.cover_image = updates.cover_image;
          albumData.cover_image_format = updates.cover_image_format;
        }

        // Run comment/genre/country updates first (they use album_id, which is stable),
        // then do the full list replacement (PUT regenerates all _id values)
        await Promise.all(promises);

        const currentAlbums = await getList(activeListId);
        const idx = currentAlbums.findIndex((a) => a._id === album._id);
        if (idx >= 0) {
          currentAlbums[idx] = { ...currentAlbums[idx]!, ...albumData };
          await replaceListItems(activeListId, currentAlbums);
        }

        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['lists'] });
        queryClient.invalidateQueries({
          queryKey: ['list-albums', activeListId],
        });
        showToast('Album updated', 'success');
      } catch {
        showToast('Failed to update album', 'error');
      }
    },
    [albumEditTarget, activeListId, queryClient]
  );

  const handleMoveAlbum = useCallback(
    async (targetListId: string) => {
      if (!moveAlbumTarget || !activeListId) return;

      try {
        // Add to target list first (strip list-specific _id)
        // This order ensures the album isn't lost if the second operation fails
        const { _id, ...rest } = moveAlbumTarget;
        await updateListItems(targetListId, { added: [rest] });

        // Then remove from source list using album_id (canonical identifier)
        // The API's removed array expects album_id, not list-item _id
        await updateListItems(activeListId, {
          removed: [moveAlbumTarget.album_id],
        });

        queryClient.invalidateQueries({ queryKey: ['lists'] });
        queryClient.invalidateQueries({
          queryKey: ['list-albums', activeListId],
        });
        queryClient.invalidateQueries({
          queryKey: ['list-albums', targetListId],
        });

        showToast('Album moved', 'success');
      } catch {
        showToast('Failed to move album', 'error');
      } finally {
        setMoveAlbumTarget(null);
      }
    },
    [moveAlbumTarget, activeListId, queryClient]
  );

  const handleCopyAlbum = useCallback(
    async (targetListId: string) => {
      if (!copyAlbumTarget) return;

      try {
        const { _id, ...rest } = copyAlbumTarget;
        const result = await updateListItems(targetListId, { added: [rest] });

        if (result.duplicates && result.duplicates.length > 0) {
          showToast('Album already exists in target list', 'info');
        } else {
          showToast('Album copied', 'success');
        }

        queryClient.invalidateQueries({ queryKey: ['lists'] });
        queryClient.invalidateQueries({
          queryKey: ['list-albums', targetListId],
        });
      } catch {
        showToast('Failed to copy album', 'error');
      } finally {
        setCopyAlbumTarget(null);
      }
    },
    [copyAlbumTarget, queryClient]
  );

  const handleRemoveAlbum = useCallback(async () => {
    if (!removeAlbumTarget || !activeListId) return;

    try {
      // The API's removed array expects album_id (canonical), not list-item _id
      await updateListItems(activeListId, {
        removed: [removeAlbumTarget.album_id],
      });

      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({
        queryKey: ['list-albums', activeListId],
      });

      showToast('Album removed', 'success');
    } catch {
      showToast('Failed to remove album', 'error');
    } finally {
      setRemoveAlbumTarget(null);
    }
  }, [removeAlbumTarget, activeListId, queryClient]);

  // ── Build grouped sections for drawer ──
  const drawerSections = useMemo(() => {
    if (!listsMap || !groups) return [];
    return groupListsByGroup(listsMap, groups);
  }, [listsMap, groups]);

  // ── Action sheet targets ──
  const listActionList =
    listActionTarget && listsMap ? (listsMap[listActionTarget] ?? null) : null;
  const editList =
    editListTarget && listsMap ? (listsMap[editListTarget] ?? null) : null;
  const collectionPickerList =
    collectionPickerTarget && listsMap
      ? (listsMap[collectionPickerTarget] ?? null)
      : null;

  // Loading state
  if (listsLoading) {
    return (
      <AppShell activeTab="library">
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading lists...
          </span>
        </div>
      </AppShell>
    );
  }

  // Error state
  if (listsError) {
    return (
      <AppShell activeTab="library">
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-destructive)',
            }}
          >
            Failed to load lists.
          </span>
        </div>
      </AppShell>
    );
  }

  // Empty state (no lists at all)
  if (!listsMap || Object.keys(listsMap).length === 0) {
    return (
      <AppShell activeTab="library">
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '24px',
              color: 'var(--color-text-primary)',
              marginBottom: '8px',
            }}
          >
            No Lists Yet
          </h1>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Create a list to get started.
          </span>
        </div>

        {/* Hidden file input for import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
      </AppShell>
    );
  }

  return (
    <>
      <AppShell activeTab="library" scrollRef={scrollContainerRef}>
        {/* Header */}
        <ListHeader
          eyebrow={groupName}
          title={activeList?.name ?? 'Library'}
          albumCount={activeList?.count}
          year={activeList?.year}
          onMenuClick={handleMenuClick}
          onOptionsClick={
            activeListId ? () => setListActionTarget(activeListId) : undefined
          }
        />

        {/* Sort bar */}
        <div
          style={{
            padding: '0 var(--space-list-x) 8px',
            display: 'flex',
            justifyContent: 'flex-end',
            position: 'relative',
          }}
        >
          <button
            ref={sortTriggerRef}
            type="button"
            onClick={() => setSortDropdownOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              letterSpacing: '0.04em',
              color: 'var(--color-text-secondary)',
            }}
            data-testid="sort-trigger"
          >
            {SORT_OPTIONS.find((o) => o.id === sortKey)?.label ?? 'Sort'}
            <ChevronDown size={12} />
          </button>
          <Dropdown
            open={sortDropdownOpen}
            onClose={() => setSortDropdownOpen(false)}
            items={SORT_OPTIONS}
            selectedId={sortKey}
            onSelect={handleSortSelect}
            sectionLabel="Sort by"
            anchorRef={sortTriggerRef}
          />
        </div>

        {/* Album list */}
        {albumsLoading ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
              }}
            >
              Loading albums...
            </span>
          </div>
        ) : albumsError ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--color-destructive)',
              }}
            >
              Failed to load albums.
            </span>
          </div>
        ) : displayAlbums.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
              }}
            >
              This list is empty.
            </span>
          </div>
        ) : (
          <div
            role="list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-card-gap-outer)',
              padding: `0 var(--space-list-x)`,
            }}
            data-testid="album-list"
            onTouchMove={dragHandlers.onTouchMove}
            onTouchEnd={dragHandlers.onTouchEnd}
          >
            {displayAlbums.map((album, index) => {
              const rank = sortKey === 'custom' ? index + 1 : undefined;
              const tags = buildAlbumTags(album);
              const yearMismatch = isYearMismatch(
                album.release_date,
                activeList?.year ?? null
              );

              // Add year mismatch tag if applicable
              if (yearMismatch && album.release_date) {
                const year = album.release_date.substring(0, 4);
                tags.push(year);
              }

              const cardState = getCardState(index);

              return (
                <div
                  key={album._id}
                  ref={(el) => registerCard(index, el)}
                  onTouchStart={(e) => dragHandlers.onTouchStart(index, e)}
                  style={{
                    transition: isDragging
                      ? 'transform 200ms ease, opacity 200ms ease'
                      : undefined,
                  }}
                >
                  <AlbumCard
                    rank={rank}
                    title={album.album}
                    artist={album.artist}
                    showRank={sortKey === 'custom'}
                    tags={tags}
                    cardState={cardState}
                    coverElement={
                      <CoverImage
                        src={
                          album.cover_image_url ||
                          (album.album_id
                            ? getAlbumCoverUrl(album.album_id)
                            : undefined)
                        }
                        alt={`${album.album} by ${album.artist}`}
                        rank={rank}
                        showRank={
                          sortKey === 'custom' && (activeList?.isMain ?? false)
                        }
                        hasSummary={!!album.summary}
                        hasRecommendation={!!album.recommended_by}
                        onSummaryClick={() =>
                          setSummaryTarget({
                            albumId: album.album_id,
                            albumName: album.album,
                            artistName: album.artist,
                          })
                        }
                        onRecommendationClick={() =>
                          setRecommendationTarget({
                            albumName: album.album,
                            artistName: album.artist,
                            recommendedBy: album.recommended_by,
                            recommendedAt: album.recommended_at,
                          })
                        }
                      />
                    }
                    onMenuClick={
                      isDragging ? undefined : () => handleAlbumMenuClick(album)
                    }
                    onClick={
                      isDragging
                        ? undefined
                        : () => {
                            // Tap on album card opens edit form
                            setAlbumEditTarget(album);
                          }
                    }
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        {displayAlbums.length > 0 && (
          <ListFooter albumCount={displayAlbums.length} />
        )}
      </AppShell>

      {/* ── Navigation Drawer ── */}
      <NavigationDrawer
        open={isDrawerOpen}
        onClose={() => setDrawerOpen(false)}
        header={
          <div style={{ paddingTop: '16px' }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '7px',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.25)',
                marginBottom: '4px',
              }}
            >
              LIBRARY
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '15px',
                letterSpacing: '-0.02em',
                color: 'var(--color-text-primary)',
              }}
            >
              My Lists
            </div>
          </div>
        }
      >
        {/* Grouped list items */}
        {drawerSections.map((section) => {
          const group = section.group;

          if (!group) {
            // Uncategorized lists (no group header)
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
                onClick={() => handleSelectList(list._id)}
              />
            ));
          }

          return (
            <GroupAccordion
              key={group._id}
              name={group.name}
              isYearGroup={group.isYearGroup}
              defaultExpanded={section.lists.some(
                (l) => l._id === activeListId
              )}
              onContextMenu={
                !group.isYearGroup
                  ? () => {
                      setDrawerOpen(false);
                      setGroupActionTarget(group);
                    }
                  : undefined
              }
            >
              {section.lists.map((list) => (
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
                  onClick={() => handleSelectList(list._id)}
                />
              ))}
            </GroupAccordion>
          );
        })}

        {/* Spacer to push footer to bottom */}
        <div style={{ flex: 1, minHeight: '16px' }} />

        {/* ── Sidebar Footer Actions ── */}
        <div
          style={{
            borderTop: '1px solid var(--color-divider)',
            padding: '8px 4px',
            display: 'flex',
            justifyContent: 'space-around',
          }}
          data-testid="drawer-footer"
        >
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              setShowCreateList(true);
            }}
            style={footerBtnStyle}
            data-testid="drawer-create-list"
          >
            <ListPlus size={14} />
            List
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawerOpen(false);
              setShowCreateCollection(true);
            }}
            style={footerBtnStyle}
            data-testid="drawer-create-collection"
          >
            <FolderPlus size={14} />
            Collection
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            style={footerBtnStyle}
            data-testid="drawer-import"
          >
            <FileUp size={14} />
            Import
          </button>
        </div>
      </NavigationDrawer>

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
        data-testid="import-file-input"
      />

      {/* ── Action Sheets ── */}

      {/* List action sheet */}
      <ListActionSheet
        open={listActionTarget !== null}
        onClose={() => setListActionTarget(null)}
        list={listActionList}
        user={user}
        isInCollection={isListInCollection(listActionList, groups ?? [])}
        onDeleted={handleListDeleted}
        onMainToggled={refreshData}
        onEditDetails={(id) => setEditListTarget(id)}
        onMoveToCollection={(id) => setCollectionPickerTarget(id)}
        onSendToService={() => {
          // TODO: Phase 8 — music service integration
          showToast('Music service integration coming soon', 'info');
        }}
      />

      {/* Group action sheet */}
      <GroupActionSheet
        open={groupActionTarget !== null}
        onClose={() => setGroupActionTarget(null)}
        group={groupActionTarget}
        onUpdated={refreshData}
      />

      {/* Collection picker sheet */}
      <CollectionPickerSheet
        open={collectionPickerTarget !== null}
        onClose={() => setCollectionPickerTarget(null)}
        listId={collectionPickerTarget}
        listName={collectionPickerList?.name ?? ''}
        currentGroupId={collectionPickerList?.groupId ?? null}
        groups={groups ?? []}
        onMoved={refreshData}
      />

      {/* Create list sheet */}
      <CreateListSheet
        open={showCreateList}
        onClose={() => setShowCreateList(false)}
        groups={groups ?? []}
        onCreated={handleListCreated}
      />

      {/* Create collection sheet */}
      <CreateCollectionSheet
        open={showCreateCollection}
        onClose={() => setShowCreateCollection(false)}
        onCreated={refreshData}
      />

      {/* Edit list sheet */}
      <EditListSheet
        open={editListTarget !== null}
        onClose={() => setEditListTarget(null)}
        list={editList}
        onUpdated={refreshData}
      />

      {/* ── Album Action Sheets ── */}

      {/* Album action sheet (three-dot menu) */}
      <AlbumActionSheet
        open={albumActionTarget !== null}
        onClose={() => setAlbumActionTarget(null)}
        album={albumActionTarget}
        listYear={activeList?.year ?? null}
        user={user}
        onEditDetails={() => {
          setAlbumEditTarget(albumActionTarget);
        }}
        onMoveToList={() => {
          setMoveAlbumTarget(albumActionTarget);
        }}
        onCopyToList={() => {
          setCopyAlbumTarget(albumActionTarget);
        }}
        onRemove={() => {
          setRemoveAlbumTarget(albumActionTarget);
        }}
        onPlayAlbum={() => {
          // TODO: Phase 8 — music integration
          showToast('Music playback coming soon', 'info');
        }}
        onRecommend={() => {
          // TODO: Phase 9 — recommendation flow
          showToast('Recommendation feature coming soon', 'info');
        }}
        onSimilarArtists={() => {
          // TODO: Phase 8 — Last.fm integration
          showToast('Similar artists coming soon', 'info');
        }}
      />

      {/* Album edit form (full-screen) */}
      <AlbumEditForm
        open={albumEditTarget !== null}
        onClose={() => setAlbumEditTarget(null)}
        album={albumEditTarget}
        listId={activeListId ?? ''}
        onSave={handleAlbumEdit}
      />

      {/* Move to list picker */}
      <ListSelectionSheet
        open={moveAlbumTarget !== null}
        onClose={() => setMoveAlbumTarget(null)}
        title="Move to List"
        albumName={moveAlbumTarget?.album ?? ''}
        artistName={moveAlbumTarget?.artist ?? ''}
        currentListId={activeListId}
        lists={listsMap ?? {}}
        groups={groups ?? []}
        onSelect={handleMoveAlbum}
      />

      {/* Copy to list picker */}
      <ListSelectionSheet
        open={copyAlbumTarget !== null}
        onClose={() => setCopyAlbumTarget(null)}
        title="Copy to List"
        albumName={copyAlbumTarget?.album ?? ''}
        artistName={copyAlbumTarget?.artist ?? ''}
        currentListId={activeListId}
        lists={listsMap ?? {}}
        groups={groups ?? []}
        onSelect={handleCopyAlbum}
      />

      {/* Remove confirmation */}
      <ConfirmDialog
        open={removeAlbumTarget !== null}
        onCancel={() => setRemoveAlbumTarget(null)}
        onConfirm={handleRemoveAlbum}
        title="Remove Album"
        message={
          removeAlbumTarget
            ? `Remove "${removeAlbumTarget.album}" by ${removeAlbumTarget.artist} from this list?`
            : ''
        }
        confirmLabel="Remove"
        destructive
      />

      {/* AI Summary sheet */}
      <SummarySheet
        open={summaryTarget !== null}
        onClose={() => setSummaryTarget(null)}
        albumId={summaryTarget?.albumId ?? null}
        albumName={summaryTarget?.albumName ?? ''}
        artistName={summaryTarget?.artistName ?? ''}
      />

      {/* Recommendation info sheet */}
      <RecommendationInfoSheet
        open={recommendationTarget !== null}
        onClose={() => setRecommendationTarget(null)}
        albumName={recommendationTarget?.albumName ?? ''}
        artistName={recommendationTarget?.artistName ?? ''}
        recommendedBy={recommendationTarget?.recommendedBy ?? null}
        recommendedAt={recommendationTarget?.recommendedAt ?? null}
      />

      {/* Ghost card for drag-and-drop */}
      <GhostCard
        visible={isDragging && draggedAlbum !== null}
        x={ghostX}
        y={ghostY}
        width={ghostWidth}
      >
        {draggedAlbum && (
          <AlbumCard
            title={draggedAlbum.album}
            artist={draggedAlbum.artist}
            showRank={false}
            tags={buildAlbumTags(draggedAlbum)}
            coverElement={
              <CoverImage
                src={
                  draggedAlbum.cover_image_url ||
                  (draggedAlbum.album_id
                    ? getAlbumCoverUrl(draggedAlbum.album_id)
                    : undefined)
                }
                alt={`${draggedAlbum.album} by ${draggedAlbum.artist}`}
              />
            }
          />
        )}
      </GhostCard>
    </>
  );
}
