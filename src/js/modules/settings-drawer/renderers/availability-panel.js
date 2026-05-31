/**
 * Settings drawer "Album Availability" admin panel markup.
 *
 * Extracted from the admin renderer to keep that file within its size budget.
 * Renders the coverage stat grid and the resolve/stop controls; the live
 * lifecycle is driven by the availability-actions handler.
 */

export function renderAvailabilityStatsGrid(stats) {
  if (!stats) {
    return '<div class="text-gray-500 text-sm">Availability stats unavailable.</div>';
  }
  return `
    <div class="grid grid-cols-3 gap-2">
      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
        <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
        <div class="text-xs text-gray-400 uppercase">Total Albums</div>
      </div>
      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
        <div class="font-bold text-green-400 text-lg">${stats.resolved || 0}</div>
        <div class="text-xs text-gray-400 uppercase">Resolved</div>
      </div>
      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
        <div class="font-bold text-yellow-400 text-lg">${stats.unresolved || 0}</div>
        <div class="text-xs text-gray-400 uppercase">Unresolved</div>
      </div>
    </div>
  `;
}

export function renderAvailabilityPanel(payload = {}) {
  return `
    <div class="settings-group">
      <h3 class="settings-group-title">Album Availability</h3>
      <div class="settings-group-content">
        <div id="availabilityStats" class="mb-4">
          ${renderAvailabilityStatsGrid(payload.stats)}
        </div>
        <div class="settings-row">
          <div class="settings-row-label">
            <label class="settings-label">Resolve Streaming Availability</label>
            <p class="settings-description">Resolve which streaming platforms carry each album via Odesli, MusicBrainz, and exact-UPC Deezer/iTunes lookups. Paced by external rate limits, so a full run can take a while. Already-resolved albums are skipped.</p>
          </div>
          <div class="flex gap-2">
            <button id="resolveAvailabilityBtn" class="settings-button">Resolve Missing</button>
            <button id="reresolveAvailabilityBtn" class="settings-button" title="Re-resolve all albums, including already-resolved ones (non-destructive)">Re-resolve All</button>
            <button id="stopAvailabilityBtn" class="settings-button settings-button-danger hidden">Stop</button>
          </div>
        </div>
        <div id="availabilityProgress" class="hidden mt-4">
          <div class="flex justify-between text-sm text-gray-400 mb-1">
            <span id="availabilityProgressLabel">Resolving...</span>
            <span id="availabilityProgressPercent">0%</span>
          </div>
          <div class="w-full bg-gray-700 rounded-full h-2.5">
            <div id="availabilityProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
          </div>
        </div>
        <div id="availabilityResult" class="hidden mt-4 p-3 bg-gray-800/50 rounded text-sm">
          <div id="availabilityResultText" class="text-gray-300"></div>
        </div>
      </div>
    </div>
  `;
}
