import { patchAlbumCopies } from './app-state.js';
import { applyCoverUpdate } from '../utils/album-api.js';
import { liveAlbumPatches } from './realtime-album-patches.js';

const METADATA_FIELDS = [
  'artist',
  'album',
  'release_date',
  'country',
  'genre_1',
  'genre_2',
];
const COMMENT_ROUTES = { comments: 'comment', comments_2: 'comment2' };

// A draft owns only fields the user changed. Committed steps update its base so
// retrying an artwork failure never replays or rolls back successful metadata.
export function createAlbumEditSession({
  album,
  listId,
  getListData,
  setListData,
  apiCall,
  trackPickService,
  publishAlbum = patchAlbumCopies,
}) {
  const base = { ...album };
  const findItem = () =>
    getListData(listId)?.find((item) =>
      base._id ? item._id === base._id : item.album_id === base.album_id
    );

  function apply(patch, global = false, requestGeneration) {
    const items = getListData(listId);
    if (!items || !findItem())
      throw new Error('Album was removed while editing');
    const accepted = global
      ? publishAlbum(base.album_id, patch, requestGeneration) || patch
      : patch;
    const latest = getListData(listId) || items;
    setListData(
      listId,
      latest.map((item) =>
        (base._id ? item._id === base._id : item.album_id === base.album_id)
          ? { ...item, ...accepted }
          : item
      ),
      false
    );
    Object.assign(base, patch);
  }

  async function save(values, cover = null) {
    const current = findItem();
    if (!current) throw new Error('Album was removed while editing');
    const changes = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => (base[key] ?? '') !== (value ?? '')
      )
    );
    for (const [key, value] of Object.entries(changes)) {
      if (
        (current[key] ?? '') !== (base[key] ?? '') &&
        (current[key] ?? '') !== (value ?? '')
      ) {
        throw new Error(
          'This field changed while you were editing. Reopen the editor to reconcile your changes.'
        );
      }
    }
    const metadata = Object.fromEntries(
      Object.entries(changes).filter(([key]) => METADATA_FIELDS.includes(key))
    );
    if (Object.keys(metadata).length) {
      const requestGeneration = liveAlbumPatches.generation;
      await apiCall('/api/albums/batch-update', {
        method: 'PATCH',
        body: JSON.stringify({
          updates: [{ albumId: base.album_id, ...metadata }],
        }),
      });
      apply(metadata, true, requestGeneration);
    }
    for (const [field, route] of Object.entries(COMMENT_ROUTES)) {
      if (!Object.hasOwn(changes, field)) continue;
      await apiCall(
        `/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(base.album_id)}/${route}`,
        { method: 'PATCH', body: JSON.stringify({ comment: changes[field] }) }
      );
      apply({ [field]: changes[field] });
    }
    if (Object.hasOwn(changes, 'primary_track')) {
      const latest = findItem();
      const picks = await trackPickService.setTrackPicks(latest._id, {
        primaryTrack: changes.primary_track || '',
        secondaryTrack: latest.secondary_track || '',
      });
      apply({
        primary_track: picks.primaryTrack || null,
        secondary_track: picks.secondaryTrack || null,
      });
    }
    if (cover) {
      const requestGeneration = liveAlbumPatches.generation;
      const result = await apiCall(
        `/api/albums/${encodeURIComponent(base.album_id)}/cover`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            cover_image: cover.base64,
            cover_image_format: cover.format,
          }),
        }
      );
      const updated = applyCoverUpdate(findItem(), result);
      const patch = Object.fromEntries(
        Object.entries(updated).filter(([key]) => key.startsWith('cover_'))
      );
      apply(patch, true, requestGeneration);
    }
    return findItem();
  }

  return { save, findItem };
}
