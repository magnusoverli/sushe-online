export function createTrackPickService(deps = {}) {
  const { apiCall = async () => {} } = deps;

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

  async function updateTrackPick(listItemId, trackName, currentPicks = {}) {
    const request = buildTrackPickRequest(trackName, currentPicks);
    const result = await apiCall(`/api/track-picks/${listItemId}`, request);
    return normalizeTrackPicks(result);
  }

  async function clearTrackPicks(listItemId) {
    const result = await apiCall(`/api/track-picks/${listItemId}`, {
      method: 'DELETE',
    });

    return normalizeTrackPicks(result);
  }

  return {
    buildTrackPickRequest,
    updateTrackPick,
    clearTrackPicks,
  };
}
