import { escapeHtml } from '../../html-utils.js';

/**
 * Settings drawer admin renderer.
 *
 * Keeps admin category markup separate from drawer orchestration.
 */

export function createSettingsAdminRenderer() {
  function renderAdminCategory(data) {
    if (!data.hasData) {
      return `
        <div class="space-y-6">
          <div class="settings-group">
            <h3 class="settings-group-title">Admin Panel</h3>
            <div class="settings-group-content">
              <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                  <i class="fas fa-spinner fa-spin text-2xl text-gray-600"></i>
                </div>
                <p class="text-gray-300 font-medium mb-2">Loading admin data...</p>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const events = data.events || {
      pending: [],
      counts: { total: 0, byType: {}, byPriority: {} },
    };
    const telegram = data.telegram || { configured: false };
    const telegramRecs = data.telegramRecs || {
      configured: false,
      recommendationsEnabled: false,
    };
    const users = data.users || [];
    const aggregateLists = data.aggregateLists || [];
    const summaryStatsPayload = data.summaryStats || {};
    const imageStatsPayload = data.imageStats || {};

    const summaryStatsHtml = summaryStatsPayload.stats
      ? `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-white text-lg">${summaryStatsPayload.stats.totalAlbums || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Total Albums</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-green-400 text-lg">${summaryStatsPayload.stats.withSummary || 0}</div>
            <div class="text-xs text-gray-400 uppercase">With Summary</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-yellow-400 text-lg">${summaryStatsPayload.stats.attemptedNoSummary || 0}</div>
            <div class="text-xs text-gray-400 uppercase">No Summary Found</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-blue-400 text-lg">${summaryStatsPayload.stats.neverAttempted || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Never Attempted</div>
          </div>
        </div>
      `
      : '<div class="text-gray-500 text-sm">Summary stats unavailable.</div>';

    const imageStatsHtml = imageStatsPayload.stats
      ? `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-white text-lg">${imageStatsPayload.stats.totalAlbums || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Total Albums</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-green-400 text-lg">${imageStatsPayload.stats.withImage || 0}</div>
            <div class="text-xs text-gray-400 uppercase">With Image</div>
          </div>
          <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
            <div class="font-bold text-yellow-400 text-lg">${imageStatsPayload.stats.withoutImage || 0}</div>
            <div class="text-xs text-gray-400 uppercase">Without Image</div>
          </div>
        </div>
        <div class="text-xs text-gray-500 mt-2">
          Avg size: ${imageStatsPayload.stats.avgSizeKb || 0} KB | Min: ${imageStatsPayload.stats.minSizeKb || 0} KB | Max: ${imageStatsPayload.stats.maxSizeKb || 0} KB
        </div>
      `
      : '<div class="text-gray-500 text-sm">Image stats unavailable.</div>';

    const cleanupPreview = data.catalogCleanupPreview || {
      minAgeDays: 90,
      orphanAlbums: 0,
      userAlbumStatsReferences: 0,
      distinctPairReferences: 0,
      sampleAlbums: [],
    };

    const cleanupSampleHtml = Array.isArray(cleanupPreview.sampleAlbums)
      ? cleanupPreview.sampleAlbums
          .map((album) => {
            const albumId = album.album_id || '(null album_id)';
            return `<li class="text-xs text-gray-500 truncate">${escapeHtml(album.artist || '(unknown artist)')} - ${escapeHtml(album.album || '(unknown album)')} <span class="text-gray-600">[${escapeHtml(albumId)}]</span></li>`;
          })
          .join('')
      : '';

    const formatRelativeTime = (dateString) => {
      if (!dateString) return 'Unknown';
      try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60)
          return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24)
          return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7)
          return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        return date.toLocaleDateString();
      } catch (_e) {
        return 'Unknown';
      }
    };

    const getPriorityBadge = (priority) => {
      const colors = {
        urgent: 'bg-red-900/50 text-red-400 border-red-600/30',
        high: 'bg-orange-900/50 text-orange-400 border-orange-600/30',
        normal: 'bg-blue-900/50 text-blue-400 border-blue-600/30',
        low: 'bg-gray-800 text-gray-400 border-gray-700',
      };
      return colors[priority] || colors.normal;
    };

    return `
      <div class="space-y-6">
        <!-- Aggregate List Management -->
        ${
          aggregateLists.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">
            <i class="fas fa-trophy mr-2 text-yellow-500"></i>
            Aggregate Lists
          </h3>
          <div class="settings-group-content">
            <div class="space-y-4">
              ${aggregateLists
                .map((item) => {
                  const year = item.year;
                  const status = item.status || {};
                  const stats = item.stats;
                  const isRevealed = status.revealed || false;
                  const confirmCount = status.confirmationCount || 0;
                  const required = status.requiredConfirmations || 2;
                  const confirmations = status.confirmations || [];
                  const currentUser = window.currentUser;
                  const hasConfirmed = confirmations.some(
                    (c) => c.username === currentUser?.username
                  );

                  let statusBadge = '';
                  if (isRevealed) {
                    statusBadge =
                      '<span class="px-2 py-1 bg-green-900/50 text-green-400 text-xs rounded-sm border border-green-600/30">Revealed</span>';
                  } else if (confirmCount > 0) {
                    statusBadge = `<span class="px-2 py-1 bg-yellow-900/50 text-yellow-400 text-xs rounded-sm border border-yellow-600/30">${confirmCount}/${required} Confirmations</span>`;
                  }

                  let confirmationsHtml = '';
                  if (confirmations.length > 0) {
                    confirmationsHtml = `
                    <div class="mt-2 flex flex-wrap gap-2">
                      ${confirmations
                        .map(
                          (c) => `
                        <span class="inline-flex items-center gap-1 px-2 py-1 bg-green-900/20 text-green-400 text-xs rounded-sm border border-green-600/20">
                          <i class="fas fa-check-circle"></i>${c.username || 'Unknown'}
                        </span>
                      `
                        )
                        .join('')}
                    </div>
                  `;
                  }

                  let statsHtml = '';
                  if (!isRevealed && stats) {
                    statsHtml = `
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3" id="aggregate-year-stats-${year}">
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.participantCount || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">Contributors</div>
                      </div>
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.totalAlbums || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">Albums</div>
                      </div>
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.albumsWith3PlusVoters || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">3+ Votes</div>
                      </div>
                      <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                        <div class="font-bold text-white text-lg">${stats.albumsWith2Voters || 0}</div>
                        <div class="text-xs text-gray-400 uppercase">2 Votes</div>
                      </div>
                    </div>
                  `;
                  }

                  let actionsHtml = '';

                  const isLocked = status.locked || false;
                  actionsHtml += `
                  <button class="settings-button aggregate-toggle-lock" data-year="${year}" data-locked="${isLocked}">
                    <i class="fas fa-${isLocked ? 'unlock' : 'lock'} mr-2"></i>${isLocked ? 'Unlock' : 'Lock'} Year
                  </button>`;

                  const isRecLocked = item.recStatus?.locked || false;
                  actionsHtml += `
                  <button class="settings-button recommendation-toggle-lock" data-year="${year}" data-locked="${isRecLocked}">
                    <i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-${isRecLocked ? 'unlock' : 'lock'} mr-1"></i>${isRecLocked ? 'Unlock' : 'Lock'} Recommendations
                  </button>`;

                  if (isRecLocked) {
                    actionsHtml += `<button class="settings-button opacity-50 cursor-not-allowed" disabled data-year="${year}" title="Unlock recommendations to manage recommenders">
                    <i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-user-check mr-1"></i>Manage Recommenders
                    <i class="fas fa-lock text-yellow-500 ml-2 text-xs"></i>
                  </button>`;
                  } else {
                    actionsHtml += `<button class="settings-button recommendation-manage-access" data-year="${year}">
                    <i class="fas fa-thumbs-up mr-2 text-blue-400"></i><i class="fas fa-user-check mr-1"></i>Manage Recommenders
                  </button>`;
                  }

                  if (isLocked) {
                    actionsHtml += `<button class="settings-button opacity-50 cursor-not-allowed" disabled data-year="${year}" title="Unlock the year to manage contributors">
                    <i class="fas fa-users mr-2"></i>Manage Contributors
                    <i class="fas fa-lock text-yellow-500 ml-2 text-xs"></i>
                  </button>`;
                  } else {
                    actionsHtml += `<button class="settings-button aggregate-manage-contributors" data-year="${year}">
                    <i class="fas fa-users mr-2"></i>Manage Contributors
                  </button>`;
                  }

                  if (isRevealed) {
                    actionsHtml += `
                    <a href="/aggregate-list/${year}" class="settings-button" target="_blank">
                      <i class="fas fa-eye mr-2"></i>View List
                    </a>
                    <button class="settings-button aggregate-reset-reveal" data-year="${year}">
                      <i class="fas fa-undo mr-2"></i>Reset Reveal
                    </button>
                  `;
                  } else {
                    if (hasConfirmed) {
                      actionsHtml += `
                      <button class="settings-button aggregate-revoke-confirm" data-year="${year}">
                        <i class="fas fa-times mr-2"></i>Revoke
                      </button>
                    `;
                    } else {
                      actionsHtml += `
                      <button class="settings-button settings-button-danger aggregate-confirm-reveal" data-year="${year}">
                        <i class="fas fa-check mr-2"></i>Confirm Reveal
                      </button>
                    `;
                    }
                    actionsHtml += `
                    <a href="/aggregate-list/${year}" class="settings-button" target="_blank">
                      <i class="fas fa-external-link-alt mr-2"></i>Open Page
                    </a>
                  `;
                  }

                  actionsHtml += `
                  <button class="settings-button aggregate-recompute" data-year="${year}">
                    <i class="fas fa-sync-alt mr-2"></i>Recompute
                  </button>
                  <button class="settings-button aggregate-audit" data-year="${year}">
                    <i class="fas fa-search mr-2"></i>Audit Data
                  </button>
                `;

                  return `
                  <div class="bg-gray-800/50 rounded-lg overflow-hidden aggregate-year-item" data-year="${year}">
                    <button
                      class="w-full flex items-center justify-between p-4 hover:bg-gray-700/30 transition-colors duration-200 cursor-pointer aggregate-year-toggle focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded-t-lg"
                      data-year="${year}"
                      aria-expanded="false"
                      aria-controls="aggregate-year-content-${year}"
                    >
                      <div class="flex items-center gap-3">
                        <i class="fas fa-chevron-right text-gray-400 aggregate-year-chevron transition-transform duration-300 ease-in-out text-sm" style="transform: rotate(0deg);" aria-hidden="true"></i>
                        <h5 class="text-lg font-bold text-white">${year}</h5>
                        ${isLocked ? '<i class="fas fa-lock text-yellow-500 ml-2" title="Year is locked"></i>' : ''}
                      </div>
                      ${statusBadge}
                    </button>
                    <div
                      id="aggregate-year-content-${year}"
                      class="aggregate-year-content hidden overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out"
                      style="max-height: 0; opacity: 0;"
                    >
                      <div class="px-4 pb-4 pt-0 space-y-3">
                        ${confirmationsHtml}
                        ${statsHtml}
                        <div class="flex flex-wrap gap-2">
                          ${actionsHtml}
                        </div>
                      </div>
                    </div>
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `
            : `
        <div class="settings-group">
          <h3 class="settings-group-title">
            <i class="fas fa-trophy mr-2 text-yellow-500"></i>
            Aggregate Lists
          </h3>
          <div class="settings-group-content">
            <p class="text-gray-400 text-sm">No main lists found. Users need to mark their lists as "main" for a specific year.</p>
          </div>
        </div>
        `
        }

        <!-- Album Summaries -->
        <div class="settings-group">
          <h3 class="settings-group-title">Album Summaries</h3>
          <div class="settings-group-content">
            <div id="albumSummaryStats" class="mb-4">
              ${summaryStatsHtml}
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Fetch Album Summaries</label>
                <p class="settings-description">Fetch album descriptions from Claude AI for all albums without summaries</p>
              </div>
              <div class="flex gap-2">
                <button id="fetchAlbumSummariesBtn" class="settings-button">Fetch Missing</button>
                <button id="regenerateAllSummariesBtn" class="settings-button" title="Regenerate all summaries (including existing ones)">Regenerate All</button>
                <button id="stopAlbumSummariesBtn" class="settings-button settings-button-danger hidden">Stop</button>
              </div>
            </div>
            <div id="albumSummaryProgress" class="hidden mt-4">
              <div class="w-full bg-gray-700 rounded-full h-2.5 mb-2">
                <div id="albumSummaryProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
              <div id="albumSummaryProgressText" class="text-sm text-gray-400"></div>
            </div>
          </div>
        </div>

        <!-- Album Images -->
        <div class="settings-group">
          <h3 class="settings-group-title">Album Images</h3>
          <div class="settings-group-content">
            <div id="albumImageStats" class="mb-4">
              ${imageStatsHtml}
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Refetch Album Images</label>
                <p class="settings-description">Re-download cover art from external sources (Cover Art Archive, iTunes) and process at 512x512 quality. Skips albums with 512x512+ images or >= 100KB.</p>
              </div>
              <div class="flex gap-2">
                <button id="refetchAlbumImagesBtn" class="settings-button">Refetch Images</button>
                <button id="stopRefetchImagesBtn" class="settings-button settings-button-danger hidden">Stop</button>
              </div>
            </div>
            <div id="imageRefetchProgress" class="hidden mt-4">
              <div class="flex justify-between text-sm text-gray-400 mb-1">
                <span id="imageRefetchProgressLabel">Processing...</span>
                <span id="imageRefetchProgressPercent">0%</span>
              </div>
              <div class="w-full bg-gray-700 rounded-full h-2.5">
                <div id="imageRefetchProgressBar" class="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div>
              </div>
            </div>
            <div id="imageRefetchResult" class="hidden mt-4 p-3 bg-gray-800/50 rounded text-sm">
              <div id="imageRefetchResultText" class="text-gray-300"></div>
            </div>
          </div>
        </div>

        <!-- Catalog Cleanup -->
        <div class="settings-group">
          <h3 class="settings-group-title">Catalog Cleanup</h3>
          <div class="settings-group-content">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                <div id="catalogCleanupOrphanCount" class="font-bold text-white text-lg">${cleanupPreview.orphanAlbums || 0}</div>
                <div class="text-xs text-gray-400 uppercase">Orphan Albums</div>
              </div>
              <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                <div id="catalogCleanupStatsRefCount" class="font-bold text-yellow-400 text-lg">${cleanupPreview.userAlbumStatsReferences || 0}</div>
                <div class="text-xs text-gray-400 uppercase">Stats refs to null</div>
              </div>
              <div class="bg-gray-800/50 rounded-sm p-2 text-center border border-gray-700/50">
                <div id="catalogCleanupDistinctPairCount" class="font-bold text-blue-400 text-lg">${cleanupPreview.distinctPairReferences || 0}</div>
                <div class="text-xs text-gray-400 uppercase">Distinct pairs</div>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Remove Orphan Albums</label>
                <p class="settings-description">Deletes albums that are not referenced by lists, recommendations, service mappings, or artist alias source links. User album stats references are preserved by nulling album_id.</p>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <label for="catalogCleanupMinAgeDays" class="text-xs text-gray-400 whitespace-nowrap">Min age (days):</label>
                <input id="catalogCleanupMinAgeDays" type="number" min="0" max="3650" value="${cleanupPreview.minAgeDays || 90}" class="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600 w-24" />
                <button id="catalogCleanupPreviewBtn" class="settings-button">Preview</button>
                <button id="catalogCleanupExecuteBtn" class="settings-button settings-button-danger">Delete Safe Orphans</button>
              </div>
            </div>
            <div id="catalogCleanupStatus" class="text-xs text-gray-400 mt-2">Preview generated at ${formatRelativeTime(cleanupPreview.generatedAt)}</div>
            <div id="catalogCleanupSampleContainer">
              ${
                cleanupSampleHtml
                  ? `<div class="mt-2"><div class="text-xs text-gray-400 mb-1">Sample candidates:</div><ul id="catalogCleanupSampleList" class="space-y-1">${cleanupSampleHtml}</ul></div>`
                  : '<div class="mt-2 text-xs text-gray-500" id="catalogCleanupSampleList">No candidate sample available.</div>'
              }
            </div>
          </div>
        </div>

        <!-- Duplicate Album Scanner -->
        <div class="settings-group">
          <h3 class="settings-group-title">Duplicate Album Scanner</h3>
          <div class="settings-group-content">
            <div class="space-y-3">
              <div>
                <label class="settings-label">Scan for Duplicates</label>
                <p class="settings-description">Find and review albums that may be duplicates based on fuzzy matching</p>
                <p class="text-xs text-gray-500 mt-1">Lower values = more matches (more false positives). All matches require human review.</p>
              </div>
              <div class="flex items-center gap-3 flex-wrap">
                <div class="flex items-center gap-2">
                  <label for="duplicateThreshold" class="text-xs text-gray-400 whitespace-nowrap">Sensitivity:</label>
                  <select id="duplicateThreshold" class="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600">
                    <option value="0.03">Very High (0.03)</option>
                    <option value="0.15" selected>High (0.15)</option>
                    <option value="0.30">Medium (0.30)</option>
                  </select>
                </div>
                <button id="scanDuplicatesBtn" class="settings-button">Scan & Review</button>
              </div>
            </div>
            <div id="duplicateScanStatus" class="hidden mt-3 text-sm text-gray-400"></div>
            <div class="space-y-3 mt-4 pt-4 border-t border-gray-700/50">
              <div>
                <label class="settings-label">Manual Album Reconciliation</label>
                <p class="settings-description">Review manually-added albums that may match existing canonical albums</p>
                <p class="text-xs text-gray-500 mt-1">Lower values = more matches (more false positives). All matches require human review.</p>
              </div>
              <div class="flex items-center gap-3 flex-wrap">
                <div class="flex items-center gap-2">
                  <label for="manualAlbumThreshold" class="text-xs text-gray-400 whitespace-nowrap">Sensitivity:</label>
                  <select id="manualAlbumThreshold" class="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600">
                    <option value="0.03">Very High (0.03)</option>
                    <option value="0.15" selected>High (0.15)</option>
                    <option value="0.30">Medium (0.30)</option>
                  </select>
                </div>
                <button id="auditManualAlbumsBtn" class="settings-button">Audit Manual Albums</button>
              </div>
            </div>
            <div id="manualAlbumAuditStatus" class="hidden mt-3 text-sm text-gray-400"></div>
          </div>
        </div>

        <!-- User Management -->
        ${
          users.length > 0
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">User Management</h3>
          <div class="settings-group-content">
            <div class="space-y-2">
              ${users
                .map((user) => {
                  const isCurrentUser = user._id === window.currentUser?._id;
                  return `
                  <div class="flex flex-col bg-gray-800/50 rounded-sm p-3 gap-3">
                    <div class="wrap-break-word">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-white font-medium">${user.username || user.email}</span>
                        ${
                          user.role === 'admin'
                            ? '<span class="px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded-sm border border-yellow-600/30">Admin</span>'
                            : ''
                        }
                        ${isCurrentUser ? '<span class="text-xs text-gray-500">(You)</span>' : ''}
                      </div>
                      <p class="settings-description wrap-break-word">
                        ${user.listCount || 0} lists • ${user.email || 'No email'}
                      </p>
                    </div>
                    ${
                      !isCurrentUser
                        ? `
                      <div class="flex flex-wrap gap-2">
                        ${
                          user.role !== 'admin'
                            ? `<button class="settings-button admin-grant-admin" data-user-id="${user._id}" title="Grant Admin">Grant Admin</button>`
                            : `<button class="settings-button settings-button-danger admin-revoke-admin" data-user-id="${user._id}" title="Revoke Admin">Revoke Admin</button>`
                        }
                        <button class="settings-button admin-view-lists" data-user-id="${user._id}" title="View Lists">View Lists</button>
                        <button class="settings-button settings-button-danger admin-delete-user" data-user-id="${user._id}" title="Delete User">Delete</button>
                      </div>
                    `
                        : ''
                    }
                  </div>
                `;
                })
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        <!-- Admin Events Dashboard -->
        <div class="settings-group">
          <h3 class="settings-group-title">Pending Events</h3>
          <div class="settings-group-content">
            ${
              events.pending.length === 0
                ? `
              <div class="text-center py-8">
                <i class="fas fa-check-circle text-3xl text-gray-600 mb-2"></i>
                <p class="text-gray-400">No pending events</p>
              </div>
            `
                : `
              <div class="space-y-3">
                ${events.pending
                  .map(
                    (event) => `
                   <div class="bg-gray-800/50 rounded-lg p-4" data-event-id="${event.id}" data-event-data="${escapeHtml(JSON.stringify(event))}">
                    <div class="flex items-start justify-between mb-2">
                      <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                          <h4 class="text-white font-semibold">${event.title || 'Untitled Event'}</h4>
                          <span class="px-2 py-0.5 text-xs rounded-sm border ${getPriorityBadge(event.priority || 'normal')}">
                            ${(event.priority || 'normal').toUpperCase()}
                          </span>
                        </div>
                        <p class="text-sm text-gray-400">${event.description || ''}</p>
                        <p class="text-xs text-gray-500 mt-1">${formatRelativeTime(event.created_at)}</p>
                      </div>
                    </div>
                    ${
                      event.actions && event.actions.length > 0
                        ? `
                      <div class="flex gap-2 mt-3">
                        ${event.actions
                          .map(
                            (action) => `
                          <button
                            class="settings-button admin-event-action"
                            data-event-id="${event.id}"
                            data-action="${action.id}"
                          >
                            ${action.label}
                          </button>
                        `
                          )
                          .join('')}
                      </div>
                    `
                        : ''
                    }
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
            }
          </div>
        </div>

        <!-- Telegram Notifications -->
        <div class="settings-group">
          <h3 class="settings-group-title">Telegram Notifications</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Status</label>
                <p class="settings-description">
                  ${
                    telegram.configured
                      ? `Connected to ${telegram.chatTitle || 'Telegram group'}${telegram.topicName ? ` (${telegram.topicName})` : ''}`
                      : 'Not configured'
                  }
                </p>
              </div>
              <div class="settings-row-control">
                ${
                  telegram.configured
                    ? `<button id="disconnectTelegramBtn" class="settings-button settings-button-danger">Disconnect</button>`
                    : `<button id="configureTelegramBtn" class="settings-button">Configure</button>`
                }
              </div>
            </div>
            ${
              telegram.configured
                ? `
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Recommendation Notifications</label>
                <p class="settings-description">
                  ${
                    telegramRecs.recommendationsEnabled
                      ? 'New recommendations are posted to Telegram'
                      : 'Enable to post new recommendations to Telegram'
                  }
                </p>
              </div>
              <div class="settings-row-control flex gap-2">
                <button id="toggleTelegramRecsBtn" class="settings-button ${telegramRecs.recommendationsEnabled ? 'settings-button-danger' : ''}">
                  ${telegramRecs.recommendationsEnabled ? 'Disable' : 'Enable'}
                </button>
                ${
                  telegramRecs.recommendationsEnabled
                    ? `<button id="testTelegramRecsBtn" class="settings-button">Test</button>`
                    : ''
                }
              </div>
            </div>
            `
                : ''
            }
          </div>
        </div>

        <!-- Database Management -->
        <div class="settings-group">
          <h3 class="settings-group-title">Database Management</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Backup Database</label>
                <p class="settings-description">Download a backup of the entire database</p>
              </div>
              <a href="/admin/backup" class="settings-button" download>Download Backup</a>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Restore Database</label>
                <p class="settings-description">Restore from a backup file (destructive operation)</p>
              </div>
              <button id="restoreDatabaseBtn" class="settings-button settings-button-danger">Restore Backup</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return {
    renderAdminCategory,
  };
}
