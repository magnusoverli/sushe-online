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
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { useListsMetadata, useListAlbums, useGroups } from '@/hooks/useLists';
import { getAlbumCoverUrl } from '@/services/albums';
import { readImportFile, importList } from '@/services/import';
import { AppShell } from '@/components/layout/AppShell';
import { ListHeader } from '@/components/list/ListHeader';
import { ListFooter } from '@/components/list/ListFooter';
import { AlbumCard } from '@/components/ui/AlbumCard';
import { CoverImage } from '@/components/album/CoverImage';
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
import { showToast } from '@/components/ui/Toast';
import {
  ChevronDown,
  ListPlus,
  FolderPlus,
  FileUp,
  List as ListIcon,
  Star,
} from 'lucide-react';
import { isYearMismatch, buildAlbumTags, sortAlbums } from '@/lib/utils';
import type { AlbumSortKey, ListMetadata, Group } from '@/lib/types';

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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <AppShell activeTab="library">
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
      ) : sortedAlbums.length === 0 ? (
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
          {sortedAlbums.map((album, index) => {
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

            return (
              <AlbumCard
                key={album._id}
                rank={rank}
                title={album.album}
                artist={album.artist}
                showRank={sortKey === 'custom'}
                tags={tags}
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
                  />
                }
                onMenuClick={() => {
                  // Phase 6: open album action sheet
                }}
              />
            );
          })}
        </div>
      )}

      {/* Footer */}
      {sortedAlbums.length > 0 && (
        <ListFooter albumCount={sortedAlbums.length} />
      )}

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
    </AppShell>
  );
}
