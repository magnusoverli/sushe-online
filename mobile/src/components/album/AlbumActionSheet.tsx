/**
 * AlbumActionSheet - Bottom sheet with album-level actions.
 *
 * Actions:
 * - Edit Details
 * - Play Album (with expandable device picker)
 * - Move to List...
 * - Copy to List...
 * - Recommend (conditional: year-based lists only)
 * - Show Similar Artists (conditional: Last.fm connected)
 * - Remove from List (destructive)
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Edit3,
  ArrowRight,
  Copy,
  ThumbsUp,
  Users,
  Trash2,
  Play,
  ChevronDown,
  ChevronUp,
  Loader,
} from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import {
  getDevices,
  searchAlbum,
  playAlbum,
  type SpotifyDevice,
} from '@/services/spotify';
import { getDeviceIcon } from '@/features/playback';
import { showToast } from '@/components/ui/Toast';
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
  onRecommend,
  onSimilarArtists,
}: AlbumActionSheetProps) {
  const hasSpotify = !!user?.spotifyConnected;
  const hasLastfm = !!user?.lastfmConnected;
  const canRecommend = listYear != null;

  // Device picker state
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);

  // Reset device state when sheet closes
  useEffect(() => {
    if (!open) {
      setShowDevices(false);
      setDevices([]);
      setDevicesLoading(false);
      setPlayLoading(false);
    }
  }, [open]);

  const handleAction = useCallback(
    (action: () => void) => {
      onClose();
      // Small delay for sheet close animation
      setTimeout(action, 200);
    },
    [onClose]
  );

  const handlePlayToggle = useCallback(async () => {
    if (!hasSpotify) return;

    if (showDevices) {
      setShowDevices(false);
      return;
    }

    // Expand device picker and fetch devices
    setShowDevices(true);
    setDevicesLoading(true);
    try {
      const result = await getDevices();
      setDevices(result.devices ?? []);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, [hasSpotify, showDevices]);

  const handlePlayOnDevice = useCallback(
    async (deviceId: string, deviceName: string) => {
      if (!album || playLoading) return;

      setPlayLoading(true);
      try {
        // Search for the album on Spotify first
        const searchResult = await searchAlbum(album.artist, album.album);
        if (!searchResult?.id) {
          showToast('Album not found on Spotify', 'error');
          return;
        }

        // Play on selected device
        await playAlbum(searchResult.id, deviceId);
        showToast(`Playing on ${deviceName}`, 'success');
        onClose();
      } catch {
        showToast('Failed to play album', 'error');
      } finally {
        setPlayLoading(false);
      }
    },
    [album, playLoading, onClose]
  );

  if (!album) return null;

  const subtitle = `${album.artist} \u2014 ${album.album}`;

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
        {hasSpotify ? (
          <button
            type="button"
            onClick={handlePlayToggle}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              borderRadius: 10,
              cursor: 'pointer',
              transition: 'background 150ms ease',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              width: '100%',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
            }}
            data-testid="play-album-action"
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.50)',
              }}
            >
              <Play size={16} />
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: '8.5px',
                fontWeight: 400,
                color: 'rgba(255,255,255,0.75)',
                textAlign: 'left',
              }}
            >
              Play Album
            </div>
            {showDevices ? (
              <ChevronUp
                size={14}
                style={{
                  color: 'rgba(255,255,255,0.30)',
                  flexShrink: 0,
                }}
              />
            ) : (
              <ChevronDown
                size={14}
                style={{
                  color: 'rgba(255,255,255,0.30)',
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        ) : (
          <ActionItem
            icon={<Play size={16} />}
            label="Play Album"
            onClick={() => {}}
            style={{ opacity: 0.4 }}
            disabled
          />
        )}

        {/* Device picker (expandable) */}
        {showDevices && (
          <div
            style={{
              padding: '0 12px 8px',
            }}
            data-testid="device-picker"
          >
            {devicesLoading && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 4px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-secondary)',
                }}
              >
                <Loader
                  size={12}
                  style={{
                    animation: 'spin 1s linear infinite',
                  }}
                />
                Loading devices...
              </div>
            )}

            {!devicesLoading && devices.length === 0 && (
              <div
                style={{
                  padding: '12px 4px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-secondary)',
                }}
              >
                No devices found. Open Spotify on a device.
              </div>
            )}

            {!devicesLoading &&
              devices.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => handlePlayOnDevice(device.id, device.name)}
                  disabled={playLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 8px',
                    background: device.is_active
                      ? 'rgba(30,215,96,0.08)'
                      : 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    cursor: playLoading ? 'wait' : 'pointer',
                    textAlign: 'left',
                    opacity: playLoading ? 0.5 : 1,
                  }}
                  data-testid="device-item"
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>
                    {getDeviceIcon(device.type)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: device.is_active
                          ? '#1ed760'
                          : 'var(--color-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {device.name}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        color: 'var(--color-text-secondary)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {device.type.toLowerCase()}
                      {device.is_active ? ' \u2022 Active' : ''}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        )}

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
