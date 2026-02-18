/**
 * AlbumEditForm - Full-screen album editing form.
 *
 * Fields: cover art, artist, album, release date, country,
 * primary genre, secondary genre, comments, comments 2, track selection.
 *
 * Cover images are resized client-side to 512x512 max, JPEG 85%.
 * Genre fields use the searchable GenreSelect overlay.
 * Track picks save immediately via API (not batched with other fields).
 * Other fields save on form submission.
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ChangeEvent,
} from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GenreSelect } from './GenreSelect';
import { TrackSelector } from './TrackSelector';
import { COUNTRIES } from '@/lib/countries';
import { MAX_COVER_SIZE, COVER_RESIZE_PX } from '@/lib/constants';
import { getAlbumCoverUrl } from '@/services/albums';
import { showToast } from '@/components/ui/Toast';
import type { Album, Track } from '@/lib/types';

interface AlbumEditFormProps {
  open: boolean;
  onClose: () => void;
  album: Album | null;
  listId: string;
  onSave: (updates: AlbumEditUpdates) => Promise<void>;
}

export interface AlbumEditUpdates {
  artist: string;
  album: string;
  release_date: string;
  country: string;
  genre_1: string;
  genre_2: string;
  comments: string;
  comments_2: string;
  cover_image?: string;
  cover_image_format?: string;
}

const sheetEasing: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Normalize a date for the date input (YYYY-MM-DD). */
function normalizeDateForInput(dateStr: string): string {
  if (!dateStr) return '';
  // If already YYYY-MM-DD, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Try to parse and format
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString().split('T')[0]!;
  } catch {
    return dateStr;
  }
}

/** Resize image to max dimensions and convert to JPEG base64. */
async function resizeImage(
  file: File
): Promise<{ base64: string; format: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Scale down if needed
        if (width > COVER_RESIZE_PX || height > COVER_RESIZE_PX) {
          if (width > height) {
            height = Math.round((height * COVER_RESIZE_PX) / width);
            width = COVER_RESIZE_PX;
          } else {
            width = Math.round((width * COVER_RESIZE_PX) / height);
            height = COVER_RESIZE_PX;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        // Strip data:image/jpeg;base64, prefix
        const raw = base64.split(',')[1] ?? base64;
        resolve({ base64: raw, format: 'JPEG' });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Shared input style
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid var(--color-divider)',
  borderRadius: '10px',
  fontFamily: 'var(--font-mono)',
  fontSize: '16px',
  color: 'var(--color-text-primary)',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-text-secondary)',
  marginBottom: '6px',
  display: 'block',
};

export function AlbumEditForm({
  open,
  onClose,
  album,
  listId: _listId,
  onSave,
}: AlbumEditFormProps) {
  // Form state
  const [artist, setArtist] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [country, setCountry] = useState('');
  const [genre1, setGenre1] = useState('');
  const [genre2, setGenre2] = useState('');
  const [comments, setComments] = useState('');
  const [comments2, setComments2] = useState('');
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [pendingCover, setPendingCover] = useState<{
    base64: string;
    format: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Track state (managed separately, saved via TrackSelector)
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [primaryTrack, setPrimaryTrack] = useState<string | null>(null);
  const [secondaryTrack, setSecondaryTrack] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form when album changes
  useEffect(() => {
    if (album && open) {
      setArtist(album.artist || '');
      setAlbumName(album.album || '');
      setReleaseDate(normalizeDateForInput(album.release_date || ''));
      setCountry(album.country || '');
      setGenre1(album.genre_1 || '');
      // Clean legacy genre_2 values
      const g2 = album.genre_2 || '';
      setGenre2(g2 === 'Genre 2' || g2 === '-' ? '' : g2);
      setComments(album.comments || '');
      setComments2(album.comments_2 || '');
      setTracks(album.tracks || null);
      setPrimaryTrack(album.primary_track || null);
      setSecondaryTrack(album.secondary_track || null);
      setPendingCover(null);

      // Set cover preview from existing image
      if (album.cover_image_url) {
        setCoverPreview(album.cover_image_url);
      } else if (album.album_id) {
        setCoverPreview(getAlbumCoverUrl(album.album_id));
      } else {
        setCoverPreview(null);
      }
    }
  }, [album, open]);

  const handleCoverSelect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      if (file.size > MAX_COVER_SIZE) {
        showToast('Image too large (max 5MB)', 'error');
        return;
      }

      try {
        const result = await resizeImage(file);
        setPendingCover(result);
        setCoverPreview(`data:image/jpeg;base64,${result.base64}`);
      } catch {
        showToast('Failed to process image', 'error');
      }
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!artist.trim() || !albumName.trim()) {
      showToast('Artist and album name are required', 'error');
      return;
    }

    setSaving(true);
    try {
      const updates: AlbumEditUpdates = {
        artist: artist.trim(),
        album: albumName.trim(),
        release_date: releaseDate,
        country,
        genre_1: genre1,
        genre_2: genre2,
        comments,
        comments_2: comments2,
      };

      if (pendingCover) {
        updates.cover_image = pendingCover.base64;
        updates.cover_image_format = pendingCover.format;
      }

      await onSave(updates);
      onClose();
    } catch {
      showToast('Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  }, [
    artist,
    albumName,
    releaseDate,
    country,
    genre1,
    genre2,
    comments,
    comments2,
    pendingCover,
    onSave,
    onClose,
  ]);

  const handleTrackPickChanged = useCallback(
    (primary: string | null, secondary: string | null) => {
      setPrimaryTrack(primary);
      setSecondaryTrack(secondary);
    },
    []
  );

  const handleTracksLoaded = useCallback((newTracks: Track[]) => {
    setTracks(newTracks);
  }, []);

  return (
    <AnimatePresence>
      {open && album && (
        <motion.div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 500,
            background: 'var(--color-bg)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{
            type: 'tween',
            duration: 0.28,
            ease: sheetEasing,
          }}
          data-testid="album-edit-form"
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
              borderBottom: '1px solid var(--color-divider)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: 'var(--color-text-secondary)',
              }}
              aria-label="Close"
              data-testid="edit-close"
            >
              <X size={20} />
            </button>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '15px',
                color: 'var(--color-text-primary)',
              }}
            >
              Edit Album
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: saving ? 'default' : 'pointer',
                padding: '4px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 500,
                color: saving
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-destructive)',
              }}
              data-testid="edit-save"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          {/* Scrollable form */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: '16px',
              paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                maxWidth: '600px',
                margin: '0 auto',
              }}
            >
              {/* Cover Art */}
              <div>
                <label style={labelStyle}>Cover Art</label>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '16px' }}
                >
                  <div
                    style={{
                      width: '96px',
                      height: '96px',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      background: 'rgba(255,255,255,0.05)',
                      flexShrink: 0,
                    }}
                  >
                    {coverPreview && (
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '8px 16px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--color-divider)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '16px',
                      color: 'var(--color-text-primary)',
                    }}
                    data-testid="cover-upload-btn"
                  >
                    {coverPreview ? 'Change Image' : 'Add Image'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleCoverSelect}
                    data-testid="cover-file-input"
                  />
                </div>
              </div>

              {/* Artist */}
              <div>
                <label style={labelStyle}>Artist</label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Artist name"
                  style={inputStyle}
                  data-testid="edit-artist"
                />
              </div>

              {/* Album */}
              <div>
                <label style={labelStyle}>Album</label>
                <input
                  type="text"
                  value={albumName}
                  onChange={(e) => setAlbumName(e.target.value)}
                  placeholder="Album name"
                  style={inputStyle}
                  data-testid="edit-album"
                />
              </div>

              {/* Release Date */}
              <div>
                <label style={labelStyle}>Release Date</label>
                <input
                  type="date"
                  value={releaseDate}
                  onChange={(e) => setReleaseDate(e.target.value)}
                  style={inputStyle}
                  data-testid="edit-release-date"
                />
              </div>

              {/* Country */}
              <div>
                <label style={labelStyle}>Country</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  style={{
                    ...inputStyle,
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 16px center',
                    paddingRight: '40px',
                  }}
                  data-testid="edit-country"
                >
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Primary Genre */}
              <div>
                <label style={labelStyle}>Primary Genre</label>
                <GenreSelect
                  value={genre1}
                  onChange={setGenre1}
                  label="Primary Genre"
                  placeholder="Select primary genre"
                />
              </div>

              {/* Secondary Genre */}
              <div>
                <label style={labelStyle}>Secondary Genre</label>
                <GenreSelect
                  value={genre2}
                  onChange={setGenre2}
                  label="Secondary Genre"
                  placeholder="Select secondary genre"
                />
              </div>

              {/* Comments */}
              <div>
                <label style={labelStyle}>Comments</label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={3}
                  placeholder="Notes about this album..."
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    minHeight: '80px',
                  }}
                  data-testid="edit-comments"
                />
              </div>

              {/* Comments 2 */}
              <div>
                <label style={labelStyle}>Comments 2</label>
                <textarea
                  value={comments2}
                  onChange={(e) => setComments2(e.target.value)}
                  rows={3}
                  placeholder="Additional notes..."
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    minHeight: '80px',
                  }}
                  data-testid="edit-comments2"
                />
              </div>

              {/* Track Selection */}
              <div>
                <TrackSelector
                  listItemId={album._id}
                  artist={album.artist}
                  albumName={album.album}
                  tracks={tracks}
                  primaryTrack={primaryTrack}
                  secondaryTrack={secondaryTrack}
                  onTrackPickChanged={handleTrackPickChanged}
                  onTracksLoaded={handleTracksLoaded}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
