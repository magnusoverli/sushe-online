/**
 * Core settings drawer renderers.
 *
 * Includes account, integrations, visual, and stats category renderers.
 */

export function createSettingsCoreRenderers(deps = {}) {
  const categoryData = deps.categoryData || {};
  const getToggleableColumns = deps.getToggleableColumns || (() => []);
  const isColumnVisible = deps.isColumnVisible || (() => true);

  function renderAccountCategory(data) {
    const accountState = categoryData.account || {};
    const isEditingUsername = accountState.editingUsername || false;
    const isEditingEmail = accountState.editingEmail || false;
    const usernameValue = isEditingUsername
      ? accountState.tempUsername || data.username || ''
      : data.username || '';
    const emailValue = isEditingEmail
      ? accountState.tempEmail || data.email || ''
      : data.email || '';

    let memberSince = 'Unknown';
    if (data.createdAt) {
      try {
        const date = new Date(data.createdAt);
        const dateFormat = window.currentUser?.dateFormat || 'MM/DD/YYYY';
        if (dateFormat === 'DD/MM/YYYY') {
          memberSince = date.toLocaleDateString('en-GB');
        } else {
          memberSince = date.toLocaleDateString('en-US');
        }
      } catch (_e) {
        memberSince = 'Unknown';
      }
    }

    const roleDisplay =
      data.role === 'admin'
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded-sm border border-yellow-600/30"><i class="fas fa-shield-alt"></i>Administrator</span>'
        : 'User';

    const isAdmin = data.role === 'admin';

    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Account Information</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Email</label>
                ${
                  isEditingEmail
                    ? `<input type="email" id="emailInput" value="${emailValue}" class="settings-input" />`
                    : `<p class="settings-description">${data.email || 'Not set'}</p>`
                }
              </div>
              <div class="settings-row-control">
                ${
                  isEditingEmail
                    ? `<button id="saveEmailBtn" class="settings-button">Save</button>
                     <button id="cancelEmailBtn" class="settings-button ml-2">Cancel</button>`
                    : `<button id="changeEmailBtn" class="settings-button">Change</button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Username</label>
                ${
                  isEditingUsername
                    ? `<input type="text" id="usernameInput" value="${usernameValue}" class="settings-input" maxlength="30" />`
                    : `<p class="settings-description">${data.username || 'Not set'}</p>`
                }
              </div>
              <div class="settings-row-control">
                ${
                  isEditingUsername
                    ? `<button id="saveUsernameBtn" class="settings-button">Save</button>
                     <button id="cancelUsernameBtn" class="settings-button ml-2">Cancel</button>`
                    : `<button id="editUsernameBtn" class="settings-button">Edit</button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Role</label>
                <p class="settings-description">${roleDisplay}</p>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Member Since</label>
                <p class="settings-description">${memberSince}</p>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Password</label>
                <p class="settings-description">Last changed: Never</p>
              </div>
              <button id="changePasswordBtn" class="settings-button">
                Change Password
              </button>
            </div>
          </div>
        </div>
        ${
          !isAdmin
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">Admin Access</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Request Admin Access</label>
                <p class="settings-description">Enter the admin code to request administrator privileges</p>
              </div>
              <div class="settings-row-control">
                <input type="text" id="adminCodeInput" class="settings-input" placeholder="Admin code" maxlength="8" style="text-transform: uppercase; width: 150px;" />
                <button id="requestAdminBtn" class="settings-button ml-2">Submit</button>
              </div>
            </div>
          </div>
        </div>
        `
            : ''
        }
      </div>
    `;
  }

  function renderIntegrationsCategory(data) {
    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Music Services</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Spotify</label>
                <p class="settings-description">Connect to sync your listening data</p>
              </div>
              <div class="settings-row-control">
                ${
                  data.spotify?.connected
                    ? `<span class="settings-badge connected">Connected</span>
                     <button id="reauthorizeSpotifyBtn" class="settings-button ml-3" title="Re-login to update permissions">
                       Reauthorize
                     </button>
                     <button id="disconnectSpotifyBtn" class="settings-button settings-button-danger ml-2">
                       Disconnect
                     </button>`
                    : `<button id="connectSpotifyBtn" class="settings-button">
                       Connect
                     </button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Tidal</label>
                <p class="settings-description">Connect to sync your listening data</p>
              </div>
              <div class="settings-row-control">
                ${
                  data.tidal?.connected
                    ? `<span class="settings-badge connected">Connected</span>
                     <button id="disconnectTidalBtn" class="settings-button settings-button-danger ml-3">
                       Disconnect
                     </button>`
                    : `<button id="connectTidalBtn" class="settings-button">
                       Connect
                     </button>`
                }
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Last.fm</label>
                <p class="settings-description">Connect to sync your scrobbles</p>
              </div>
              <div class="settings-row-control">
                ${
                  data.lastfm?.connected
                    ? `<span class="settings-badge connected">Connected</span>
                     <button id="disconnectLastfmBtn" class="settings-button settings-button-danger ml-3">
                       Disconnect
                     </button>`
                    : `<button id="connectLastfmBtn" class="settings-button">
                       Connect
                     </button>`
                }
              </div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group-title">Preferred Service</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="musicServiceSelect">Default Music Service</label>
                <p class="settings-description">Choose your default music service for playback and playlist creation</p>
              </div>
              <div class="settings-row-control">
                <select id="musicServiceSelect" class="settings-select">
                  <option value="" ${!data.musicService ? 'selected' : ''}>Ask each time</option>
                  <option value="spotify" ${data.musicService === 'spotify' ? 'selected' : ''} ${!data.spotifyAuth ? 'disabled' : ''}>Spotify</option>
                  <option value="tidal" ${data.musicService === 'tidal' ? 'selected' : ''} ${!data.tidalAuth ? 'disabled' : ''}>Tidal</option>
                  <option value="qobuz" ${data.musicService === 'qobuz' ? 'selected' : ''}>Qobuz</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderVisualCategory(data) {
    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Appearance</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="accentColor">Accent Color</label>
                <p class="settings-description">Choose your preferred accent color</p>
              </div>
              <div class="settings-row-control">
                <input
                  type="color"
                  id="accentColor"
                  value="${data.accentColor || '#dc2626'}"
                  class="settings-color-input"
                />
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="timeFormatSelect">Time Format</label>
                <p class="settings-description">Choose how times are displayed</p>
              </div>
              <div class="settings-row-control">
                <select id="timeFormatSelect" class="settings-select">
                  <option value="24h" ${data.timeFormat === '12h' ? '' : 'selected'}>24-hour</option>
                  <option value="12h" ${data.timeFormat === '12h' ? 'selected' : ''}>12-hour</option>
                </select>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label" for="dateFormatSelect">Date Format</label>
                <p class="settings-description">Choose how dates are displayed</p>
              </div>
              <div class="settings-row-control">
                <select id="dateFormatSelect" class="settings-select">
                  <option value="MM/DD/YYYY" ${data.dateFormat === 'DD/MM/YYYY' ? '' : 'selected'}>MM/DD/YYYY</option>
                  <option value="DD/MM/YYYY" ${data.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <h3 class="settings-group-title">Grid Columns</h3>
          <div class="settings-group-content">
            <div class="settings-row" style="flex-direction: column; align-items: stretch; gap: 0.5rem;">
              <div class="settings-row-label">
                <label class="settings-label">Visible Columns</label>
                <p class="settings-description">Choose which columns to show in the desktop album grid</p>
              </div>
              <div class="flex flex-wrap gap-2 mt-1" id="columnVisibilityToggles">
                ${getToggleableColumns()
                  .map(
                    (col) => `
                  <label class="flex items-center gap-2 px-3 py-1.5 bg-gray-900/50 rounded-sm cursor-pointer hover:bg-gray-800/50 transition border border-gray-700/50">
                    <input type="checkbox" data-settings-column-id="${col.id}"
                      ${isColumnVisible(col.id) ? 'checked' : ''}
                      class="w-3.5 h-3.5 rounded-sm border-gray-600 bg-gray-900 cursor-pointer accent-[var(--accent-color)]" />
                    <span class="text-sm text-gray-300">${col.label}</span>
                  </label>`
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderStatsCategory(data) {
    return `
      <div class="space-y-6">
        <div class="settings-group">
          <h3 class="settings-group-title">Statistics</h3>
          <div class="settings-group-content">
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Lists</label>
                <p class="settings-description">Total number of lists</p>
              </div>
              <div class="settings-row-control">
                <span class="settings-stat-value">${data.listCount || 0}</span>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <label class="settings-label">Total Albums</label>
                <p class="settings-description">Albums in your lists</p>
              </div>
              <div class="settings-row-control">
                <span class="settings-stat-value">${data.totalAlbums || 0}</span>
              </div>
            </div>
            ${
              data.totalScrobbles > 0
                ? `<div class="settings-row">
                  <div class="settings-row-label">
                    <label class="settings-label">Total Scrobbles</label>
                    <p class="settings-description">From Last.fm</p>
                  </div>
                  <div class="settings-row-control">
                    <span class="settings-stat-value">${data.totalScrobbles.toLocaleString()}</span>
                  </div>
                </div>`
                : ''
            }
          </div>
        </div>
        ${
          data.systemStats
            ? `
        <div class="settings-group">
          <h3 class="settings-group-title">System Statistics</h3>
          <div class="settings-group-content">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div class="preferences-stat-card">
                <div class="text-blue-400 mb-2">
                  <i class="fas fa-users text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.totalUsers || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Users</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-purple-400 mb-2">
                  <i class="fas fa-list text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.totalLists || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Lists</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-green-400 mb-2">
                  <i class="fas fa-compact-disc text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.totalAlbums || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Albums</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-yellow-400 mb-2">
                  <i class="fas fa-shield-alt text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.adminUsers || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Admins</div>
              </div>
              <div class="preferences-stat-card">
                <div class="text-red-400 mb-2">
                  <i class="fas fa-user-check text-xl"></i>
                </div>
                <div class="text-2xl font-bold text-white mb-1">${data.systemStats.activeUsers || 0}</div>
                <div class="text-xs text-gray-400 uppercase tracking-wide">Active (7d)</div>
              </div>
            </div>
          </div>
        </div>
        `
            : ''
        }
      </div>
    `;
  }

  return {
    renderAccountCategory,
    renderIntegrationsCategory,
    renderVisualCategory,
    renderStatsCategory,
  };
}
