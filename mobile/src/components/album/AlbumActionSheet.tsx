/**
 * AlbumActionSheet - Bottom sheet with album-level actions.
 *
 * Actions:
 * - Edit Details
 * - Play Album (expandable, grayed if no music service)
 * - Move to List...
 * - Copy to List...
 * - Recommend (conditional: year-based lists only)
 * - Show Similar Artists (conditional: Last.fm connected)
 * - Remove from List (destructive)
 */

import { useCallback } from 'react';
import {
  Edit3,
  ArrowRight,
  Copy,
  ThumbsUp,
  Users,
  Trash2,
  Play,
} from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import type { Album, User } from '@/lib/types';

interface AlbumActionSheetProps {
  open: boolean;
  onClose: () => void;
  album: Album | null;
  listYear: number | null;
  user: User | null;
  onEditDetails: () => void;
  onMoveToList: () => void;
  onCopyToList: () => void;
  onRemove: () => void;
  onPlayAlbum?: () => void;
  onRecommend?: () => void;
  onSimilarArtists?: () => void;
}

export function AlbumActionSheet({
  open,
  onClose,
  album,
  listYear,
  user,
  onEditDetails,
  onMoveToList,
  onCopyToList,
  onRemove,
  onPlayAlbum,
  onRecommend,
  onSimilarArtists,
}: AlbumActionSheetProps) {
  const hasMusicService = !!(user?.spotifyConnected || user?.tidalConnected);
  const hasLastfm = !!user?.lastfmConnected;
  const canRecommend = listYear != null;

  const handleAction = useCallback(
    (action: () => void) => {
      onClose();
      // Small delay for sheet close animation
      setTimeout(action, 200);
    },
    [onClose]
  );

  if (!album) return null;

  const subtitle = `${album.artist} — ${album.album}`;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Album"
      subtitle={subtitle}
    >
      <div style={{ padding: '0 4px 8px' }}>
        {/* Edit Details */}
        <ActionItem
          icon={<Edit3 size={16} />}
          label="Edit Details"
          subtitle="Cover, genres, comments, tracks"
          onClick={() => handleAction(onEditDetails)}
        />

        {/* Play Album */}
        <ActionItem
          icon={<Play size={16} />}
          label="Play Album"
          onClick={() => {
            if (hasMusicService && onPlayAlbum) {
              handleAction(onPlayAlbum);
            }
          }}
          style={!hasMusicService ? { opacity: 0.4 } : undefined}
        />

        {/* Move to List */}
        <ActionItem
          icon={<ArrowRight size={16} />}
          label="Move to List..."
          onClick={() => handleAction(onMoveToList)}
          hasChevron
        />

        {/* Copy to List */}
        <ActionItem
          icon={<Copy size={16} />}
          label="Copy to List..."
          onClick={() => handleAction(onCopyToList)}
          hasChevron
        />

        {/* Recommend (conditional) */}
        {canRecommend && (
          <ActionItem
            icon={<ThumbsUp size={16} style={{ color: '#60a5fa' }} />}
            label="Recommend"
            onClick={() => {
              if (onRecommend) handleAction(onRecommend);
            }}
          />
        )}

        {/* Similar Artists (conditional) */}
        {hasLastfm && (
          <ActionItem
            icon={<Users size={16} style={{ color: '#a78bfa' }} />}
            label="Similar Artists"
            onClick={() => {
              if (onSimilarArtists) handleAction(onSimilarArtists);
            }}
          />
        )}

        {/* Divider */}
        <div
          style={{
            height: '1px',
            background: 'var(--color-divider)',
            margin: '4px 16px',
          }}
        />

        {/* Remove from List (destructive) */}
        <ActionItem
          icon={<Trash2 size={16} />}
          label="Remove from List"
          variant="destructive"
          onClick={() => handleAction(onRemove)}
        />
      </div>
    </BottomSheet>
  );
}
