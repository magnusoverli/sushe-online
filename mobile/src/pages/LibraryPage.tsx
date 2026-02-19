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
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { useDragStore } from '@/stores/drag-store';
import { usePlaybackStore } from '@/stores/playback-store';
import {
  useListsMetadata,
  useListAlbums,
  useGroups,
  useSetupStatus,
} from '@/hooks/useLists';
import { useYearLock, useLockedYears } from '@/hooks/useYearLock';
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
import {
  readImportFile,
  importList,
  generateUniqueName,
  type ImportMetadata,
} from '@/services/import';
import { useDragAndDrop } from '@/features/drag-drop';
import {
  usePlaybackPolling,
  isAlbumMatchingPlayback,
} from '@/features/playback';
import { AppShell } from '@/components/layout/AppShell';
import { ListHeader } from '@/components/list/ListHeader';
import { ListFooter } from '@/components/list/ListFooter';
import { AlbumCard, type CardState } from '@/components/ui/AlbumCard';
import { SkeletonList } from '@/components/ui/SkeletonCard';
import { CoverImage } from '@/components/album/CoverImage';
import { GhostCard } from '@/components/ui/GhostCard';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { NavigationDrawer } from '@/components/ui/NavigationDrawer';
import { DrawerContent } from '@/components/list/DrawerContent';
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
import { SimilarArtistsSheet } from '@/components/album/SimilarArtistsSheet';
import { RecommendAlbumSheet } from '@/components/album/RecommendAlbumSheet';
import { RecommendationCard } from '@/components/album/RecommendationCard';
import { RecommendationActionSheet } from '@/components/album/RecommendationActionSheet';
import {
  ServiceChooserSheet,
  type MusicServiceChoice,
} from '@/components/album/ServiceChooserSheet';
import { SetupWizardSheet } from '@/components/list/SetupWizardSheet';
import { SettingsDrawer } from '@/features/settings';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { showToast } from '@/components/ui/Toast';
import {
  ChevronDown,
  ListPlus,
  FolderPlus,
  FileUp,
  ArrowLeft,
} from 'lucide-react';
import {
  isYearMismatch,
  buildAlbumTags,
  sortAlbums,
  debounce,
} from '@/lib/utils';
import { REORDER_DEBOUNCE_MS } from '@/lib/constants';
import { useRecommendationsForYear } from '@/hooks/useRecommendations';
import { useListPlaycounts } from '@/hooks/useListPlaycounts';
import { syncPlaylistToSpotify } from '@/services/spotify';
import { syncPlaylistToTidal } from '@/services/tidal';
import { updateListItems as addToListItems } from '@/services/lists';
import type {
  Album,
  AlbumSortKey,
  ListMetadata,
  Group,
  Recommendation,
} from '@/lib/types';

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

  const [similarArtistTarget, setSimilarArtistTarget] = useState<string | null>(
    null
  );
  const [recommendAlbumTarget, setRecommendAlbumTarget] =
    useState<Album | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Import conflict resolution state ──
  const [importConflict, setImportConflict] = useState<{
    name: string;
    albums: Partial<Album>[];
    metadata: ImportMetadata | null;
  } | null>(null);

  // ── Playlist sync (Send to Service) state ──
  const [playlistSyncListId, setPlaylistSyncListId] = useState<string | null>(
    null
  );
  const [showPlaylistServiceChooser, setShowPlaylistServiceChooser] =
    useState(false);

  // ── Recommendation browsing state ──
  const recommendationYear = useAppStore((s) => s.recommendationYear);
  const setRecommendationYear = useAppStore((s) => s.setRecommendationYear);
  const viewingRecommendations = recommendationYear !== null;

  const { data: recsData, isLoading: recsLoading } =
    useRecommendationsForYear(recommendationYear);

  // Recommendation action sheet state
  const [recActionTarget, setRecActionTarget] = useState<Recommendation | null>(
    null
  );
  // Recommendation "add to list" target
  const [recAddToListTarget, setRecAddToListTarget] =
    useState<Recommendation | null>(null);
  // Recommendation "view reasoning" target (reuses RecommendationInfoSheet)
  const [recReasoningTarget, setRecReasoningTarget] =
    useState<Recommendation | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);

  // ── Spotify playback polling ──
  usePlaybackPolling({
    spotifyConnected: !!user?.spotifyConnected,
    lastfmConnected: !!user?.lastfmConnected,
  });

  // ── Last.fm playcounts ──
  const { playcounts } = useListPlaycounts(
    activeListId,
    !!user?.lastfmConnected
  );

  // Playback state for now-playing matching
  const playbackAlbumName = usePlaybackStore((s) => s.albumName);
  const playbackArtistName = usePlaybackStore((s) => s.artistName);
  const playbackIsPlaying = usePlaybackStore((s) => s.isPlaying);

  // Fetch lists metadata
  const {
    data: listsMap,
    isLoading: listsLoading,
    error: listsError,
  } = useListsMetadata();

  // Fetch groups
  const { data: groups } = useGroups();

  // Setup wizard
  const setupWizardSnoozed = useAppStore((s) => s.setupWizardSnoozed);
  const setSetupWizardSnoozed = useAppStore((s) => s.setSetupWizardSnoozed);
  const { data: setupStatus } = useSetupStatus(
    !!listsMap && !setupWizardSnoozed
  );
  const showSetupWizard = !!setupStatus?.needsSetup && !setupWizardSnoozed;

  // Sync lists metadata to store
  useEffect(() => {
    if (listsMap) {
      setListsMetadata(listsMap);
    }
  }, [listsMap, setListsMetadata]);

  // Auto-select default list (or validate persisted selection still exists)
  useEffect(() => {
    if (!listsMap) return;
    // If no active list, or the persisted list no longer exists, pick a default
    if (!activeListId || !listsMap[activeListId]) {
      const defaultId = pickDefaultList(listsMap);
      if (defaultId) setActiveListId(defaultId);
    }
  }, [listsMap, activeListId, setActiveListId]);

  // Get active list metadata
  const activeList = activeListId && listsMap ? listsMap[activeListId] : null;

  // Year lock: check if the active list's year is locked
  const { isLocked: isYearLocked } = useYearLock(activeList?.year ?? null);
  const isListLocked = isYearLocked && activeList?.isMain === true;

  // All locked years (for drawer lock icons)
  const { lockedYears } = useLockedYears();

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
  // ghostX/ghostY/ghostWidth are subscribed inside GhostCard directly,
  // so LibraryPage doesn't re-render on every pixel of ghost movement.

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
          queryClient.invalidateQueries({
            queryKey: ['lists', listId, 'albums'],
          });
          queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
        });
      }, REORDER_DEBOUNCE_MS),
    [queryClient]
  );

  // Build a lookup from _id to album_id for the reorder API.
  // The drag-and-drop system tracks items by _id (for React keys and DOM refs),
  // but the reorder API expects album_id (canonical identifier) in its order array.
  const idToAlbumId = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of sortedAlbums) {
      map.set(a._id, a.album_id);
    }
    return map;
  }, [sortedAlbums]);

  const handleReorderWithAlbumIds = useCallback(
    (newOrder: string[]) => {
      // newOrder contains _id values from the drag system.
      // Convert to album_id values for the API, keep _id order for cache update.
      const albumIdOrder = newOrder
        .map((id) => idToAlbumId.get(id))
        .filter((aid): aid is string => aid !== undefined);

      if (!activeListId || albumIdOrder.length === 0) return;

      // Optimistically update the query cache so the list doesn't snap back
      // to the old order when isDragging flips to false.
      queryClient.setQueryData<Album[]>(
        ['lists', activeListId, 'albums'],
        (oldAlbums) => {
          if (!oldAlbums) return oldAlbums;
          const albumMap = new Map(oldAlbums.map((a) => [a._id, a]));
          return newOrder
            .map((id) => albumMap.get(id))
            .filter((a): a is Album => a !== undefined);
        }
      );

      debouncedReorder(activeListId, albumIdOrder);
    },
    [activeListId, debouncedReorder, queryClient, idToAlbumId]
  );

  const { handlers: dragHandlers, registerCard } = useDragAndDrop({
    itemIds: useMemo(() => sortedAlbums.map((a) => a._id), [sortedAlbums]),
    onReorder: handleReorderWithAlbumIds,
    enabled: sortKey === 'custom' && !isListLocked,
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

  /** Check if a given album matches the currently playing track. */
  const checkNowPlaying = useCallback(
    (album: Album): boolean => {
      if (!playbackIsPlaying || !playbackAlbumName || !playbackArtistName) {
        return false;
      }
      return isAlbumMatchingPlayback(
        album.album,
        album.artist,
        playbackAlbumName,
        playbackArtistName
      );
    },
    [playbackIsPlaying, playbackAlbumName, playbackArtistName]
  );

  /** Whether ANY album in the current list matches the now-playing track. */
  const showNowPlaying = useMemo(() => {
    if (!playbackIsPlaying || !displayAlbums.length) return false;
    return displayAlbums.some(checkNowPlaying);
  }, [playbackIsPlaying, displayAlbums, checkNowPlaying]);

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
      setRecommendationYear(null); // Exit recommendation mode
      setActiveListId(listId);
      setDrawerOpen(false);
      setSortKey('custom'); // Reset sort on list switch
    },
    [setActiveListId, setDrawerOpen, setRecommendationYear]
  );

  // ── Recommendation year selection ──
  const handleSelectRecommendationYear = useCallback(
    (year: number) => {
      setRecommendationYear(year);
      setDrawerOpen(false);
    },
    [setRecommendationYear, setDrawerOpen]
  );

  const handleExitRecommendations = useCallback(() => {
    setRecommendationYear(null);
  }, [setRecommendationYear]);

  // ── Recommendation "Add to List" handler ──
  const handleRecAddToList = useCallback(
    async (targetListId: string) => {
      if (!recAddToListTarget) return;
      const rec = recAddToListTarget;
      try {
        const result = await addToListItems(targetListId, {
          added: [
            {
              album_id: rec.album_id,
              artist: rec.artist,
              album: rec.album,
              release_date: rec.release_date || null,
              country: rec.country || null,
              genre_1: rec.genre_1 || null,
              genre_2: rec.genre_2 || null,
            } as Partial<Album>,
          ],
        });
        if (result.duplicates && result.duplicates.length > 0) {
          showToast('Album already exists in target list', 'info');
        } else {
          showToast(`Added "${rec.album}" to list`, 'success');
        }
        queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
        queryClient.invalidateQueries({
          queryKey: ['lists', targetListId, 'albums'],
        });
      } catch {
        showToast('Failed to add album to list', 'error');
      } finally {
        setRecAddToListTarget(null);
      }
    },
    [recAddToListTarget, queryClient]
  );

  // ── Invalidate queries helper ──
  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
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
        const {
          name,
          albums: importAlbums,
          metadata,
        } = await readImportFile(file);

        // Check for naming conflict
        const existingNames = new Set(
          Object.values(listsMap ?? {}).map((l) => l.name)
        );
        if (existingNames.has(name)) {
          // Show conflict dialog
          setImportConflict({ name, albums: importAlbums, metadata });
          return;
        }

        showToast('Importing...', 'info', 2000);
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
    [refreshData, setActiveListId, listsMap]
  );

  const handleImportConflict = useCallback(
    async (resolution: 'overwrite' | 'rename' | 'cancel') => {
      if (!importConflict) return;
      setImportConflict(null);

      if (resolution === 'cancel') return;

      try {
        let finalName = importConflict.name;

        if (resolution === 'rename') {
          const existingNames = new Set(
            Object.values(listsMap ?? {}).map((l) => l.name)
          );
          finalName = generateUniqueName(importConflict.name, existingNames);
        } else if (resolution === 'overwrite') {
          // Find and replace the existing list's items
          const existing = Object.values(listsMap ?? {}).find(
            (l) => l.name === importConflict.name
          );
          if (existing) {
            showToast('Overwriting...', 'info', 2000);
            await replaceListItems(
              existing._id,
              importConflict.albums as Album[]
            );
            showToast(
              `Overwrote "${existing.name}" (${importConflict.albums.length} albums)`,
              'success'
            );
            refreshData();
            setActiveListId(existing._id);
            return;
          }
        }

        showToast('Importing...', 'info', 2000);
        const result = await importList(
          finalName,
          importConflict.albums,
          importConflict.metadata
        );
        showToast(
          `Imported "${result.listName}" (${result.albumCount} albums)`,
          'success'
        );
        refreshData();
        setActiveListId(result.listId);
      } catch {
        showToast('Error importing list', 'error');
      }
    },
    [importConflict, listsMap, refreshData, setActiveListId]
  );

  // ── Send to Service handler ──
  const handleSendToService = useCallback(
    async (listId: string, service?: MusicServiceChoice) => {
      const hasSpotify = user?.spotifyConnected;
      const hasTidal = user?.tidalConnected;

      if (!hasSpotify && !hasTidal) {
        showToast('No music service connected', 'error');
        return;
      }

      // Determine target service
      let target: MusicServiceChoice | undefined = service;

      if (!target) {
        if (hasSpotify && !hasTidal) {
          target = 'spotify';
        } else if (hasTidal && !hasSpotify) {
          target = 'tidal';
        } else if (user?.musicService === 'spotify') {
          target = 'spotify';
        } else if (user?.musicService === 'tidal') {
          target = 'tidal';
        } else {
          // Both connected, no preference — show chooser
          setPlaylistSyncListId(listId);
          setShowPlaylistServiceChooser(true);
          return;
        }
      }

      showToast('Creating playlist...', 'info', 3000);

      try {
        const result =
          target === 'spotify'
            ? await syncPlaylistToSpotify(listId)
            : await syncPlaylistToTidal(listId);

        const serviceName = target === 'spotify' ? 'Spotify' : 'Tidal';
        showToast(
          result.playlistName
            ? `Sent "${result.playlistName}" to ${serviceName}`
            : `Playlist sent to ${serviceName}`,
          'success'
        );
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to create playlist';
        showToast(msg, 'error');
      }
    },
    [user]
  );

  const handlePlaylistServiceChosen = useCallback(
    (service: MusicServiceChoice) => {
      setShowPlaylistServiceChooser(false);
      if (playlistSyncListId) {
        handleSendToService(playlistSyncListId, service);
      }
      setPlaylistSyncListId(null);
    },
    [playlistSyncListId, handleSendToService]
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
        queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
        queryClient.invalidateQueries({
          queryKey: ['lists', activeListId, 'albums'],
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
      if (!albumActionTarget || !activeListId) return;

      try {
        // Add to target list first (strip list-specific _id)
        // This order ensures the album isn't lost if the second operation fails
        const { _id, ...rest } = albumActionTarget;
        await updateListItems(targetListId, { added: [rest] });

        // Then remove from source list using album_id (canonical identifier)
        // The API's removed array expects album_id, not list-item _id
        await updateListItems(activeListId, {
          removed: [albumActionTarget.album_id],
        });

        queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
        queryClient.invalidateQueries({
          queryKey: ['lists', activeListId, 'albums'],
        });
        queryClient.invalidateQueries({
          queryKey: ['lists', targetListId, 'albums'],
        });

        showToast('Album moved', 'success');
      } catch {
        showToast('Failed to move album', 'error');
      }
    },
    [albumActionTarget, activeListId, queryClient]
  );

  const handleCopyAlbum = useCallback(
    async (targetListId: string) => {
      if (!albumActionTarget) return;

      try {
        const { _id, ...rest } = albumActionTarget;
        const result = await updateListItems(targetListId, { added: [rest] });

        if (result.duplicates && result.duplicates.length > 0) {
          showToast('Album already exists in target list', 'info');
        } else {
          showToast('Album copied', 'success');
        }

        queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
        queryClient.invalidateQueries({
          queryKey: ['lists', targetListId, 'albums'],
        });
      } catch {
        showToast('Failed to copy album', 'error');
      }
    },
    [albumActionTarget, queryClient]
  );

  const handleRemoveAlbum = useCallback(async () => {
    if (!removeAlbumTarget || !activeListId) return;

    try {
      // The API's removed array expects album_id (canonical), not list-item _id
      await updateListItems(activeListId, {
        removed: [removeAlbumTarget.album_id],
      });

      queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
      queryClient.invalidateQueries({
        queryKey: ['lists', activeListId, 'albums'],
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
      <AppShell
        activeTab="library"
        scrollRef={scrollContainerRef}
        showNowPlaying={showNowPlaying}
        onSettingsClick={() => setSettingsOpen(true)}
      >
        {viewingRecommendations ? (
          /* ── Recommendation browsing view ── */
          <>
            {/* Recommendation header */}
            <header
              style={{
                padding: '24px var(--space-header-x) 16px',
              }}
              data-testid="rec-view-header"
            >
              {/* Top row: back button + menu */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}
              >
                <button
                  type="button"
                  onClick={handleExitRecommendations}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'transparent',
                    border: 'none',
                    padding: '4px 0',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-secondary)',
                  }}
                  data-testid="rec-back-button"
                >
                  <ArrowLeft size={14} />
                  Back to lists
                </button>
                <button
                  type="button"
                  onClick={handleMenuClick}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '6px',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label="Open navigation"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <line x1="3" y1="5" x2="17" y2="5" />
                    <line x1="3" y1="10" x2="17" y2="10" />
                    <line x1="3" y1="15" x2="17" y2="15" />
                  </svg>
                </button>
              </div>

              {/* Title */}
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '32px',
                  fontWeight: 400,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.15,
                  color: 'var(--color-text-primary)',
                  margin: 0,
                }}
                data-testid="rec-view-title"
              >
                {recommendationYear} Recommendations
              </h1>

              {/* Metadata */}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 400,
                  letterSpacing: '0.02em',
                  color: 'var(--color-text-muted)',
                  marginTop: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {recsData
                  ? `${recsData.recommendations.length} recommendation${recsData.recommendations.length !== 1 ? 's' : ''}`
                  : ''}
                {recsData?.locked && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      opacity: 0.6,
                    }}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span style={{ fontSize: '8px', letterSpacing: '0.06em' }}>
                      LOCKED
                    </span>
                  </span>
                )}
              </span>

              {/* Divider */}
              <div
                style={{
                  height: '1px',
                  background: 'var(--color-divider)',
                  marginTop: '16px',
                }}
              />
            </header>

            {/* Recommendation list */}
            {recsLoading ? (
              <div style={{ padding: '0 var(--space-list-x)' }}>
                <SkeletonList count={6} />
              </div>
            ) : !recsData || recsData.recommendations.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  No recommendations yet for {recommendationYear}.
                </span>
              </div>
            ) : (
              <div
                role="list"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-card-gap-outer)',
                  padding: '0 var(--space-list-x)',
                }}
                data-testid="recommendation-list"
              >
                {recsData.recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec._id}
                    recommendation={rec}
                    onMenuClick={(r) => setRecActionTarget(r)}
                    onReasoningClick={(r) => setRecReasoningTarget(r)}
                  />
                ))}
              </div>
            )}

            {/* Footer */}
            {recsData && recsData.recommendations.length > 0 && (
              <ListFooter albumCount={recsData.recommendations.length} />
            )}
          </>
        ) : (
          /* ── Normal album list view ── */
          <>
            {/* Header */}
            <ListHeader
              eyebrow={groupName}
              title={activeList?.name ?? 'Library'}
              albumCount={activeList?.count}
              year={activeList?.year}
              isLocked={isListLocked}
              onMenuClick={handleMenuClick}
              onOptionsClick={
                activeListId
                  ? () => setListActionTarget(activeListId)
                  : undefined
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
              <div style={{ padding: '0 var(--space-list-x)' }}>
                <SkeletonList count={8} />
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
                  const albumIsNowPlaying = checkNowPlaying(album);

                  return (
                    <motion.div
                      key={album._id}
                      onTouchStart={(e) => dragHandlers.onTouchStart(index, e)}
                      layout
                      transition={{
                        layout: isDragging
                          ? { type: 'spring', stiffness: 600, damping: 50 }
                          : { duration: 0 },
                      }}
                    >
                      <AlbumCard
                        ref={(el) => registerCard(index, el)}
                        rank={rank}
                        title={album.album}
                        artist={album.artist}
                        showRank={sortKey === 'custom'}
                        rankVisible={activeList?.isMain ?? false}
                        tags={tags}
                        playcount={playcounts[album._id]}
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
                            hasSummary={!!album.summary}
                            hasRecommendation={!!album.recommended_by}
                            isNowPlaying={albumIsNowPlaying}
                            onPlay={
                              user?.spotifyConnected
                                ? () => handleAlbumMenuClick(album)
                                : undefined
                            }
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
                          isDragging
                            ? undefined
                            : () => handleAlbumMenuClick(album)
                        }
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            {displayAlbums.length > 0 && (
              <ListFooter albumCount={displayAlbums.length} />
            )}
          </>
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
        {/* Grouped list items with drag-and-drop reordering */}
        <DrawerContent
          sections={drawerSections}
          activeListId={viewingRecommendations ? null : activeListId}
          lockedYears={lockedYears}
          onSelectList={handleSelectList}
          onGroupContextMenu={(group) => setGroupActionTarget(group)}
          onCloseDrawer={() => setDrawerOpen(false)}
          activeRecommendationYear={recommendationYear}
          onSelectRecommendationYear={handleSelectRecommendationYear}
        />

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
        onSendToService={(listId) => handleSendToService(listId)}
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
        isListLocked={isListLocked}
        onEditDetails={() => {
          setAlbumEditTarget(albumActionTarget);
        }}
        lists={listsMap ?? {}}
        groups={groups ?? []}
        currentListId={activeListId}
        onMoveToList={handleMoveAlbum}
        onCopyToList={handleCopyAlbum}
        onRemove={() => {
          setRemoveAlbumTarget(albumActionTarget);
        }}
        onRecommend={() => {
          setRecommendAlbumTarget(albumActionTarget);
        }}
        onSimilarArtists={() => {
          if (albumActionTarget) {
            setSimilarArtistTarget(albumActionTarget.artist);
          }
        }}
        onReidentified={() => {
          queryClient.invalidateQueries({ queryKey: ['lists', 'metadata'] });
          if (activeListId) {
            queryClient.invalidateQueries({
              queryKey: ['lists', activeListId, 'albums'],
            });
          }
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

      {/* Import conflict resolution */}
      <ConfirmDialog
        open={importConflict !== null}
        onCancel={() => handleImportConflict('cancel')}
        onConfirm={() => handleImportConflict('overwrite')}
        title="List Already Exists"
        message={`A list named "${importConflict?.name ?? ''}" already exists. What would you like to do?`}
        confirmLabel="Overwrite"
        destructive
      >
        <button
          type="button"
          onClick={() => handleImportConflict('rename')}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            padding: '8px 16px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.05)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            width: '100%',
            textAlign: 'center',
            marginBottom: '4px',
          }}
        >
          Import as New (Rename)
        </button>
      </ConfirmDialog>

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

      {/* Similar artists sheet */}
      <SimilarArtistsSheet
        open={similarArtistTarget !== null}
        onClose={() => setSimilarArtistTarget(null)}
        artistName={similarArtistTarget ?? ''}
      />

      {/* Recommend album sheet */}
      <RecommendAlbumSheet
        open={recommendAlbumTarget !== null}
        onClose={() => setRecommendAlbumTarget(null)}
        album={recommendAlbumTarget}
        year={activeList?.year ?? null}
      />

      {/* ── Recommendation Browsing Sheets ── */}

      {/* Recommendation action sheet (three-dot menu on rec cards) */}
      <RecommendationActionSheet
        open={recActionTarget !== null}
        onClose={() => setRecActionTarget(null)}
        recommendation={recActionTarget}
        year={recommendationYear ?? 0}
        locked={recsData?.locked ?? false}
        user={user}
        onAddToList={(rec) => {
          setRecActionTarget(null);
          setRecAddToListTarget(rec);
        }}
        onViewReasoning={(rec) => {
          setRecActionTarget(null);
          setRecReasoningTarget(rec);
        }}
      />

      {/* Add recommendation to list picker */}
      <ListSelectionSheet
        open={recAddToListTarget !== null}
        onClose={() => setRecAddToListTarget(null)}
        title="Add to List"
        albumName={recAddToListTarget?.album ?? ''}
        artistName={recAddToListTarget?.artist ?? ''}
        currentListId={null}
        lists={listsMap ?? {}}
        groups={groups ?? []}
        onSelect={handleRecAddToList}
      />

      {/* Recommendation reasoning sheet (from rec card tap or action sheet) */}
      {recReasoningTarget && (
        <RecommendationInfoSheet
          open={recReasoningTarget !== null}
          onClose={() => setRecReasoningTarget(null)}
          albumName={recReasoningTarget.album}
          artistName={recReasoningTarget.artist}
          recommendedBy={recReasoningTarget.recommended_by}
          recommendedAt={recReasoningTarget.created_at}
        />
      )}

      {/* Setup wizard */}
      {setupStatus && (
        <SetupWizardSheet
          open={showSetupWizard}
          onClose={() => setSetupWizardSnoozed(true)}
          setupStatus={setupStatus}
          onSaved={() => {
            setSetupWizardSnoozed(true);
            refreshData();
          }}
          onSnoozed={() => setSetupWizardSnoozed(true)}
        />
      )}

      {/* Playlist sync service chooser */}
      <ServiceChooserSheet
        open={showPlaylistServiceChooser}
        onClose={() => {
          setShowPlaylistServiceChooser(false);
          setPlaylistSyncListId(null);
        }}
        onSelect={handlePlaylistServiceChosen}
      />

      {/* Settings drawer */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Ghost card for drag-and-drop */}
      <GhostCard visible={isDragging && draggedAlbum !== null}>
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
