/**
 * AlbumActionSheet - Bottom sheet with album-level actions.
 *
 * Actions:
 * - Edit Details
 * - Play Album (with expandable device picker for Spotify, or open in Tidal)
 * - Move to List...
 * - Copy to List...
 * - Recommend (conditional: year-based lists only)
 * - Show Similar Artists (conditional: Last.fm connected)
 * - Remove from List (destructive)
 *
 * Service selection logic:
 * - Only Spotify connected → show Spotify device picker
 * - Only Tidal connected → open in Tidal directly
 * - Both connected + preference set → use preferred service
 * - Both connected + no preference → show ServiceChooserSheet
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
  ExternalLink,
  Lock,
  Search,
} from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ActionItem } from '@/components/ui/ActionItem';
import {
  getDevices,
  searchAlbum,
  playAlbum,
  type SpotifyDevice,
} from '@/services/spotify';
import { openInTidal } from '@/services/tidal';
import { getDeviceIcon } from '@/features/playback';
import { showToast } from '@/components/ui/Toast';
import {
  ServiceChooserSheet,
  type MusicServiceChoice,
} from './ServiceChooserSheet';
import type { Album, User } from '@/lib/types';

interface AlbumActionSheetProps {
  open: boolean;
  onClose: () => void;
  album: Album | null;
  listYear: number | null;
  user: User | null;
  /** When true, edit and remove actions are disabled */
  isListLocked?: boolean;
  onEditDetails: () => void;
  onMoveToList: () => void;
  onCopyToList: () => void;
  onRemove: () => void;
  onRecommend?: () => void;
  onSimilarArtists?: () => void;
  onReidentify?: () => void;
}

export function AlbumActionSheet({
  open,
  onClose,
  album,
  listYear,
  user,
  isListLocked = false,
  onEditDetails,
  onMoveToList,
  onCopyToList,
  onRemove,
  onRecommend,
  onSimilarArtists,
  onReidentify,
}: AlbumActionSheetProps) {
  const hasSpotify = !!user?.spotifyConnected;
  const hasTidal = !!user?.tidalConnected;
  const hasLastfm = !!user?.lastfmConnected;
  const hasAnyService = hasSpotify || hasTidal;
  const canRecommend = listYear != null;
  const isAdmin = user?.role === 'admin';
  const musicService = user?.musicService;

  // Device picker state (Spotify)
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);

  // Service chooser state
  const [showChooser, setShowChooser] = useState(false);

  // Reset state when sheet closes
  useEffect(() => {
    if (!open) {
      setShowDevices(false);
      setDevices([]);
      setDevicesLoading(false);
      setPlayLoading(false);
      setShowChooser(false);
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

  const handleOpenTidal = useCallback(() => {
    if (!album) return;
    openInTidal(album.artist, album.album);
    showToast('Opening in Tidal', 'success');
    onClose();
  }, [album, onClose]);

  const expandSpotifyDevices = useCallback(async () => {
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
  }, []);

  const handlePlayToggle = useCallback(async () => {
    if (!hasAnyService) return;

    // Determine which service to use
    const bothConnected = hasSpotify && hasTidal;
    const preferAsk = !musicService;

    // Both connected, no preference → show chooser
    if (bothConnected && preferAsk) {
      setShowChooser(true);
      return;
    }

    // Determine effective service
    let effectiveService: 'spotify' | 'tidal';
    if (bothConnected && musicService) {
      effectiveService = musicService as 'spotify' | 'tidal';
    } else if (hasSpotify) {
      effectiveService = 'spotify';
    } else {
      effectiveService = 'tidal';
    }

    if (effectiveService === 'tidal') {
      handleOpenTidal();
      return;
    }

    // Spotify: toggle device picker
    if (showDevices) {
      setShowDevices(false);
      return;
    }

    await expandSpotifyDevices();
  }, [
    hasAnyService,
    hasSpotify,
    hasTidal,
    musicService,
    showDevices,
    handleOpenTidal,
    expandSpotifyDevices,
  ]);

  const handleServiceChosen = useCallback(
    async (service: MusicServiceChoice) => {
      setShowChooser(false);
      if (service === 'tidal') {
        handleOpenTidal();
      } else {
        await expandSpotifyDevices();
      }
    },
    [handleOpenTidal, expandSpotifyDevices]
  );

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

  const sheetTitle = `${album.artist} \u2014 ${album.album}`;

  // Determine the play button label
  const getPlayLabel = (): string => {
    if (!hasAnyService) return 'Play Album';
    if (hasSpotify && hasTidal) return 'Play Album';
    if (hasTidal) return 'Open in Tidal';
    return 'Play Album';
  };

  // Show chevron only for Spotify device picker (not for Tidal-only)
  const showPlayChevron =
    hasSpotify && (!hasTidal || musicService === 'spotify');

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={sheetTitle}>
        <div style={{ padding: '0 4px 8px' }}>
          {/* Lock banner */}
          {isListLocked && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                marginBottom: '4px',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.04)',
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                letterSpacing: '0.04em',
                color: 'rgba(255,255,255,0.35)',
              }}
              data-testid="album-action-lock-banner"
            >
              <Lock size={10} style={{ flexShrink: 0 }} />
              This list is locked
            </div>
          )}

          {/* Edit Details */}
          <ActionItem
            icon={<Edit3 size={16} />}
            label="Edit Details"
            onClick={() => handleAction(onEditDetails)}
            disabled={isListLocked}
          />

          {/* Play Album */}
          {hasAnyService ? (
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
                {hasTidal && !hasSpotify ? (
                  <ExternalLink size={16} />
                ) : (
                  <Play size={16} />
                )}
              </div>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 400,
                  color: 'rgba(255,255,255,0.75)',
                  textAlign: 'left',
                }}
              >
                {getPlayLabel()}
              </div>
              {showPlayChevron &&
                (showDevices ? (
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
                ))}
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

          {/* Device picker (expandable, Spotify only) */}
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
                    fontSize: 11,
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
                    fontSize: 11,
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
                          fontSize: 12,
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
                          fontSize: 10,
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

          {/* Open in Tidal (shown when Spotify devices are expanded and Tidal is also connected) */}
          {showDevices && hasTidal && (
            <div style={{ padding: '0 12px 4px' }}>
              <button
                type="button"
                onClick={handleOpenTidal}
                data-testid="open-in-tidal"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '10px 8px',
                  background: 'rgba(0,255,255,0.05)',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <ExternalLink
                  size={14}
                  style={{ color: '#00FFFF', flexShrink: 0 }}
                />
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: '#00FFFF',
                  }}
                >
                  Open in Tidal
                </div>
              </button>
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

          {/* Re-identify Album (admin only) */}
          {isAdmin && (
            <ActionItem
              icon={<Search size={16} style={{ color: '#f59e0b' }} />}
              label="Re-identify Album"
              onClick={() => {
                if (onReidentify) {
                  handleAction(onReidentify);
                } else if (album) {
                  // Fallback: open MusicBrainz search
                  const q = encodeURIComponent(
                    `${album.artist} ${album.album}`
                  );
                  window.open(
                    `https://musicbrainz.org/search?query=${q}&type=release_group`,
                    '_blank'
                  );
                  onClose();
                }
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
            disabled={isListLocked}
          />
        </div>
      </BottomSheet>

      {/* Service chooser (when both connected, no preference) */}
      <ServiceChooserSheet
        open={showChooser}
        onClose={() => setShowChooser(false)}
        onSelect={handleServiceChosen}
      />
    </>
  );
}
