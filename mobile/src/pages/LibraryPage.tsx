/**
 * LibraryPage - Main album list view.
 *
 * Fetches lists metadata, selects an active list, fetches its albums,
 * and renders them using AlbumCard + CoverImage within an AppShell.
 *
 * Features:
 * - Auto-selects the main list (or first available) on load
 * - Sort dropdown (custom, artist, title, year, genre, country)
 * - Album cards with lazy-loaded covers, rank badges, tag pills
 * - Year mismatch indicator (red release date)
 * - AI summary and recommendation badges on covers
 * - End-of-list footer
 * - Hamburger menu to open navigation drawer (Phase 5)
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { useListsMetadata, useListAlbums, useGroups } from '@/hooks/useLists';
import { getAlbumCoverUrl } from '@/services/albums';
import { AppShell } from '@/components/layout/AppShell';
import { ListHeader } from '@/components/list/ListHeader';
import { ListFooter } from '@/components/list/ListFooter';
import { AlbumCard } from '@/components/ui/AlbumCard';
import { CoverImage } from '@/components/album/CoverImage';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { ChevronDown } from 'lucide-react';
import { isYearMismatch, buildAlbumTags, sortAlbums } from '@/lib/utils';
import type { AlbumSortKey, ListMetadata } from '@/lib/types';

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

export function LibraryPage() {
  const activeListId = useAppStore((s) => s.activeListId);
  const setActiveListId = useAppStore((s) => s.setActiveListId);
  const setListsMetadata = useAppStore((s) => s.setListsMetadata);
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen);

  const [sortKey, setSortKey] = useState<AlbumSortKey>('custom');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  // Fetch lists metadata
  const {
    data: listsMap,
    isLoading: listsLoading,
    error: listsError,
  } = useListsMetadata();

  // Fetch groups for eyebrow text
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
    </AppShell>
  );
}
