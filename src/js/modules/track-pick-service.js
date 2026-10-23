import { createKeyedTaskQueue } from '../utils/keyed-task-queue.js';
import { getListData, patchListItem } from './app-state.js';
import { getItemListId, rememberListRevision } from './list-revisions.js';
import { resolveTrackTitle } from '../utils/track-reference.js';

const enqueuePick = createKeyedTaskQueue();

export function createTrackPickService(deps = {}) {
  const { apiCall = async () => {} } = deps;
  const lastPicks = new Map();

  function normalizeTrackPicks(result = null) {
    return {
      primaryTrack: result?.primary_track || '',
      secondaryTrack: result?.secondary_track || '',
    };
  }

  function buildTrackPickRequest(trackName, currentPicks = {}) {
    const selectedPrimary = currentPicks.primaryTrack || null;
    const selectedSecondary = currentPicks.secondaryTrack || null;

    if (trackName === selectedPrimary) {
      return {
        method: 'DELETE',
        body: JSON.stringify({ trackIdentifier: trackName }),
      };
    }

    if (trackName === selectedSecondary) {
      return {
        method: 'POST',
        body: JSON.stringify({ trackIdentifier: trackName, priority: 1 }),
      };
    }

    return {
      method: 'POST',
      body: JSON.stringify({ trackIdentifier: trackName, priority: 2 }),
    };
  }

  async function persistPicks(listItemId, picks) {
    const result = await apiCall(
      `/api/track-picks/${encodeURIComponent(listItemId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          primary_track: picks.primaryTrack || null,
          secondary_track: picks.secondaryTrack || null,
        }),
      }
    );
    const normalized = normalizeTrackPicks(result);
    const listId = result?.listId || getItemListId(listItemId);
    rememberListRevision(listId, result?.revision);
    patchListItem(listId, listItemId, {
      primary_track: normalized.primaryTrack || null,
      secondary_track: normalized.secondaryTrack || null,
    });
    lastPicks.set(listItemId, normalized);
    return normalized;
  }

  function updateTrackPick(listItemId, trackName, currentPicks = {}) {
    return enqueuePick(listItemId, () => {
      const item = getListData(getItemListId(listItemId))?.find(
        (entry) => entry._id === listItemId
      );
      const current = item
        ? normalizeTrackPicks(item)
        : typeof currentPicks === 'function'
          ? currentPicks()
          : lastPicks.get(listItemId) || currentPicks;
      const picks = { ...current };
      if (trackName === resolveTrackTitle(current.primaryTrack, item?.tracks))
        picks.primaryTrack = '';
      else if (
        trackName === resolveTrackTitle(current.secondaryTrack, item?.tracks)
      ) {
        picks.primaryTrack = trackName;
        picks.secondaryTrack = current.primaryTrack || '';
      } else picks.secondaryTrack = trackName;
      return persistPicks(listItemId, picks);
    });
  }

  function setTrackPicks(listItemId, picks) {
    return enqueuePick(listItemId, () => persistPicks(listItemId, picks));
  }

  function clearTrackPicks(listItemId) {
    return setTrackPicks(listItemId, { primaryTrack: '', secondaryTrack: '' });
  }

  return {
    buildTrackPickRequest,
    updateTrackPick,
    clearTrackPicks,
    setTrackPicks,
  };
}
