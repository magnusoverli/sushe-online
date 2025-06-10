// Import the header component and color utilities at the top of the file
const { headerComponent } = require('./templates');
const { adjustColor, colorWithOpacity } = require('./color-utils');

// Settings page template
const settingsTemplate = (req, options) => {
  const { user, userStats, stats, adminData, flash } = options;
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings - SuShe Online</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link href="/styles/output.css" rel="stylesheet">
  <style>
    /* CSS Custom Properties for theming */
    :root {
      --accent-color: ${user?.accentColor || '#dc2626'};
      --accent-hover: ${adjustColor(user?.accentColor || '#dc2626', -30)};
      --accent-light: ${adjustColor(user?.accentColor || '#dc2626', 40)};
      --accent-dark: ${adjustColor(user?.accentColor || '#dc2626', -50)};
      --accent-shadow: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.4)};
      --accent-glow: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.5)};
      --accent-subtle: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.1)};
    }
    
    /* Apply accent color throughout */
    .text-red-600, .text-red-500, .text-red-400 { 
      color: var(--accent-color) !important; 
    }
    .bg-red-600, .bg-red-500 { 
      background-color: var(--accent-color) !important; 
    }
    .hover\\:bg-red-700:hover, .hover\\:bg-red-600:hover { 
      background-color: var(--accent-hover) !important; 
    }
    .hover\\:text-red-500:hover, .hover\\:text-red-400:hover { 
      color: var(--accent-color) !important; 
    }
    .border-red-600, .border-red-500 { 
      border-color: var(--accent-color) !important; 
    }
    .focus\\:border-red-600:focus { 
      border-color: var(--accent-color) !important; 
    }
  </style>
</head>
<body class="bg-black text-gray-200">
  <div class="min-h-screen flex flex-col">
    ${headerComponent(user, 'settings')}
    
    <div class="flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full">
      <h1 class="text-3xl font-bold text-white mb-8">Settings</h1>
      
      <!-- Flash Messages -->
      ${flash.error && flash.error.length ? `
        <div class="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg">
          <p class="text-red-400 flex items-center">
            <i class="fas fa-exclamation-circle mr-2"></i>
            ${flash.error[0]}
          </p>
        </div>
      ` : ''}
      
      ${flash.success && flash.success.length ? `
        <div class="mb-6 p-4 bg-green-900/20 border border-green-800 rounded-lg">
          <p class="text-green-400 flex items-center">
            <i class="fas fa-check-circle mr-2"></i>
            ${flash.success[0]}
          </p>
        </div>
      ` : ''}
      
      <div class="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <!-- Personal Settings Section -->
        <div class="space-y-6">
          <h2 class="text-xl font-semibold text-gray-300 mb-4">Personal Settings</h2>
          
          <!-- Account Info -->
          <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 class="text-lg font-semibold text-white mb-4">
              <i class="fas fa-user mr-2 text-gray-400"></i>
              Account Information
            </h3>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Email</label>
                <div class="flex items-center gap-2">
                  <input 
                    type="email" 
                    id="emailInput"
                    value="${user.email}" 
                    class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white"
                    readonly
                  >
                  <button 
                    onclick="editEmail()"
                    id="editEmailBtn"
                    class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200"
                  >
                    <i class="fas fa-edit"></i>
                  </button>
                  <button 
                    onclick="saveEmail()"
                    id="saveEmailBtn"
                    class="hidden px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition duration-200"
                  >
                    <i class="fas fa-check"></i>
                  </button>
                  <button 
                    onclick="cancelEmailEdit()"
                    id="cancelEmailBtn"
                    class="hidden px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200"
                  >
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Username</label>
                <div class="flex items-center gap-2">
                  <input 
                    type="text" 
                    id="usernameInput"
                    value="${user.username}" 
                    class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white"
                    readonly
                  >
                  <button 
                    onclick="editUsername()"
                    id="editUsernameBtn"
                    class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200"
                  >
                    <i class="fas fa-edit"></i>
                  </button>
                  <button 
                    onclick="saveUsername()"
                    id="saveUsernameBtn"
                    class="hidden px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition duration-200"
                  >
                    <i class="fas fa-check"></i>
                  </button>
                  <button 
                    onclick="cancelUsernameEdit()"
                    id="cancelUsernameBtn"
                    class="hidden px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200"
                  >
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Role</label>
                <div class="flex items-center gap-2">
                  <span class="text-white">${user.role === 'admin' ? 'Administrator' : 'User'}</span>
                  ${user.role === 'admin' ? '<i class="fas fa-shield-alt text-yellow-500"></i>' : ''}
                </div>
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-1">Member Since</label>
                <span class="text-white">${new Date(user.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          
          <!-- Change Password -->
          <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
            <h3 class="text-lg font-semibold text-white mb-4">
              <i class="fas fa-lock mr-2 text-gray-400"></i>
              Change Password
            </h3>
            
            <form action="/settings/change-password" method="POST" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2" for="currentPassword">
                  Current Password
                </label>
                <input 
                  type="password" 
                  name="currentPassword" 
                  id="currentPassword"
                  class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600"
                  required
                >
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2" for="newPassword">
                  New Password
                </label>
                <input 
                  type="password" 
                  name="newPassword" 
                  id="newPassword"
                  class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600"
                  minlength="8"
                  required
                >
              </div>
              
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2" for="confirmPassword">
                  Confirm New Password
                </label>
                <input 
                  type="password" 
                  name="confirmPassword" 
                  id="confirmPassword"
                  class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600"
                  minlength="8"
                  required
                >
              </div>
              
              <button 
                type="submit"
                class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded transition duration-200"
              >
                Update Password
              </button>
            </form>
          </div>
          
        <!-- Accent Color Settings -->
        <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
        <h3 class="text-lg font-semibold text-white mb-4">
            <i class="fas fa-palette mr-2 text-gray-400"></i>
            Theme Color
        </h3>
        
        <p class="text-sm text-gray-400 mb-4">
            Choose your preferred accent color for the interface
        </p>
        
        <!-- Custom Color Picker -->
        <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <label class="text-sm text-gray-400">Color:</label>
            <input 
            type="color" 
            id="customAccentColor" 
            value="${user.accentColor || '#dc2626'}"
            class="h-10 w-20 bg-gray-800 border border-gray-700 rounded cursor-pointer hover:border-gray-600"
            >
            <button 
            onclick="updateAccentColor(document.getElementById('customAccentColor').value)"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition duration-200"
            >
            Apply
            </button>
            <button 
            onclick="resetAccentColor()"
            class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded transition duration-200"
            >
            Reset to Default
            </button>
        </div>
        </div>

        <!-- Music Service Integration -->
        <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
          <h3 class="text-lg font-semibold text-white mb-4">
            <i class="fas fa-music mr-2 text-gray-400"></i>
            Music Services
          </h3>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-white">Spotify</span>
              ${user.spotifyAuth ? `
                <span class="text-green-500 text-sm mr-2">Connected</span>
                <a href="/auth/spotify/disconnect" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">Disconnect</a>
              ` : `
                <a href="/auth/spotify" class="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm">Connect</a>
              `}
            </div>
            <div class="flex items-center justify-between">
              <span class="text-white">Tidal</span>
              ${user.tidalAuth ? `
                <span class="text-green-500 text-sm mr-2">Connected</span>
                <a href="/auth/tidal/disconnect" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm">Disconnect</a>
              ` : `
                <a href="/auth/tidal" class="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm">Connect</a>
              `}
            </div>
          </div>
        </div>

        <!-- Statistics & Admin Section -->
        <div class="space-y-6">
          <!-- Your Statistics -->
          <div>
            <h2 class="text-xl font-semibold text-gray-300 mb-4">Your Statistics</h2>
            <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <p class="text-gray-400 text-sm">Total Lists</p>
                  <p class="text-2xl font-bold text-white">${userStats.listCount}</p>
                </div>
                <div>
                  <p class="text-gray-400 text-sm">Total Albums</p>
                  <p class="text-2xl font-bold text-white">${userStats.totalAlbums}</p>
                </div>
              </div>
            </div>
          </div>
          
          ${user.role !== 'admin' ? `
            <!-- Request Admin Access -->
            <div>
              <h2 class="text-xl font-semibold text-gray-300 mb-4">Admin Access</h2>
              <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
                <p class="text-sm text-gray-400 mb-4">
                  Enter the admin code to gain administrator privileges.
                </p>
                <form action="/settings/request-admin" method="POST" class="space-y-4">
                  <div>
                    <input 
                      type="text" 
                      name="code" 
                      placeholder="Enter admin code..."
                      class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 uppercase"
                      maxlength="8"
                      required
                    >
                  </div>
                  <button 
                    type="submit"
                    class="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded transition duration-200"
                  >
                    Request Admin Access
                  </button>
                </form>
              </div>
            </div>
          ` : `
            <!-- Admin Panel -->
            <div>
              <h2 class="text-xl font-semibold text-gray-300 mb-4">
                <i class="fas fa-shield-alt text-yellow-500 mr-2"></i>
                Admin Panel
              </h2>
              
              <!-- System Stats -->
              <div class="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-6">
                <h3 class="text-lg font-semibold text-white mb-4">System Statistics</h3>
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  <div>
                    <p class="text-gray-400 text-sm">Total Users</p>
                    <p class="text-2xl font-bold text-white">${stats.totalUsers}</p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">Total Lists</p>
                    <p class="text-2xl font-bold text-white">${stats.totalLists}</p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">Total Albums</p>
                    <p class="text-2xl font-bold text-white">${stats.totalAlbums}</p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">Admin Users</p>
                    <p class="text-2xl font-bold text-white">${stats.adminUsers}</p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">Active Users (7d)</p>
                    <p class="text-2xl font-bold text-white">${stats.activeUsers}</p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">User Growth</p>
                    <p class="text-2xl font-bold ${stats.userGrowth >= 0 ? 'text-green-500' : 'text-red-500'}">
                      ${stats.userGrowth >= 0 ? '+' : ''}${stats.userGrowth}%
                    </p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">Database Size</p>
                    <p class="text-2xl font-bold text-white">${stats.dbSize}</p>
                  </div>
                  <div>
                    <p class="text-gray-400 text-sm">Active Sessions</p>
                    <p class="text-2xl font-bold text-white">${stats.activeSessions}</p>
                  </div>
                </div>
              </div>
              
              <!-- Top Genres -->
              ${stats.topGenres && stats.topGenres.length > 0 ? `
                <div class="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-6">
                  <h3 class="text-lg font-semibold text-white mb-4">Top Genres</h3>
                  <div class="space-y-2">
                    ${stats.topGenres.map((genre, index) => `
                      <div class="flex items-center justify-between">
                        <span class="text-gray-300">${index + 1}. ${genre.name}</span>
                        <span class="text-gray-500">${genre.count} albums</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              
              <!-- Admin Actions -->
              <div class="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-6">
                <h3 class="text-lg font-semibold text-white mb-4">Admin Actions</h3>
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  <button 
                    onclick="if(confirm('Export all users as CSV?')) window.location.href='/admin/export-users'"
                    class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 text-sm"
                  >
                    <i class="fas fa-download mr-2"></i>Export Users
                  </button>
                  <button 
                    onclick="if(confirm('Download complete database backup?')) window.location.href='/admin/backup'"
                    class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 text-sm"
                  >
                    <i class="fas fa-database mr-2"></i>Backup Database
                  </button>
                  <button 
                    onclick="showRestoreModal()"
                    class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 text-sm"
                  >
                    <i class="fas fa-upload mr-2"></i>Restore Backup
                  </button>
                  <button 
                    onclick="if(confirm('Clear all active sessions? This will log out all users.')) clearSessions()"
                    class="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded transition duration-200 text-sm"
                  >
                    <i class="fas fa-sign-out-alt mr-2"></i>Clear Sessions
                  </button>
                </div>
              </div>
              
              <!-- Recent Activity -->
              ${adminData?.recentActivity ? `
                <div class="bg-gray-900 rounded-lg p-6 border border-gray-800 mb-6">
                  <h3 class="text-lg font-semibold text-white mb-4">Recent Activity</h3>
                  <div class="space-y-3">
                    ${adminData.recentActivity.map(activity => `
                      <div class="flex items-center gap-3 text-sm">
                        <i class="fas ${activity.icon} text-${activity.color}-500"></i>
                        <span class="text-gray-300 flex-1">${activity.message}</span>
                        <span class="text-gray-500 text-xs">${activity.time}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              
              <!-- User Management -->
              <div class="bg-gray-900 rounded-lg p-6 border border-gray-800">
                <h3 class="text-lg font-semibold text-white mb-4">User Management</h3>
                <div class="overflow-x-auto">
                  <table class="w-full">
                    <thead>
                      <tr class="text-left border-b border-gray-800">
                        <th class="pb-2 text-sm font-medium text-gray-400">User</th>
                        <th class="pb-2 text-sm font-medium text-gray-400">Lists</th>
                        <th class="pb-2 text-sm font-medium text-gray-400">Role</th>
                        <th class="pb-2 text-sm font-medium text-gray-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-800">
                      ${adminData.users.map(u => `
                        <tr>
                          <td class="py-3">
                            <div>
                              <p class="text-sm text-white">${u.username}</p>
                              <p class="text-xs text-gray-500">${u.email}</p>
                            </div>
                          </td>
                          <td class="py-3">
                            <span class="text-sm text-gray-300">${u.listCount}</span>
                          </td>
                          <td class="py-3">
                            ${u.role === 'admin' ? 
                              '<span class="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-1 rounded">Admin</span>' : 
                              '<span class="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">User</span>'
                            }
                          </td>
                          <td class="py-3">
                            <div class="flex gap-2">
                              ${u._id !== user._id ? `
                                ${u.role !== 'admin' ? `
                                  <button 
                                    onclick="makeAdmin('${u._id}')"
                                    class="text-xs text-blue-400 hover:text-blue-300"
                                    title="Make Admin"
                                  >
                                    <i class="fas fa-user-shield"></i>
                                  </button>
                                ` : `
                                  <button 
                                    onclick="revokeAdmin('${u._id}')"
                                    class="text-xs text-yellow-400 hover:text-yellow-300"
                                    title="Revoke Admin"
                                  >
                                    <i class="fas fa-user-times"></i>
                                  </button>
                                `}
                                <button 
                                  onclick="viewUserLists('${u._id}')"
                                  class="text-xs text-gray-400 hover:text-gray-300"
                                  title="View Lists"
                                >
                                  <i class="fas fa-list"></i>
                                </button>
                                <button 
                                  onclick="deleteUser('${u._id}')"
                                  class="text-xs text-red-400 hover:text-red-300"
                                  title="Delete User"
                                >
                                  <i class="fas fa-trash"></i>
                                </button>
                              ` : '<span class="text-xs text-gray-600">Current User</span>'}
                            </div>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `}
        </div>
      </div>
    </div>
  </div>
  
  <!-- Restore Modal -->
  <div id="restoreModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Restore Database Backup</h3>
      </div>
      
      <form id="restoreForm" enctype="multipart/form-data" class="p-6">
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-400 mb-2">
            Select backup file (.json)
          </label>
          <input 
            type="file" 
            name="backup"
            accept=".json"
            required
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600"
          >
        </div>
        
        <div class="bg-yellow-900/20 border border-yellow-800 rounded p-3 mb-4">
          <p class="text-yellow-400 text-sm">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            Warning: This will replace all current data!
          </p>
        </div>
        
        <div class="flex gap-3 justify-end">
          <button 
            type="button"
            onclick="document.getElementById('restoreModal').classList.add('hidden')"
            class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200"
          >
            Cancel
          </button>
          <button 
            type="submit"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition duration-200"
          >
            Restore Backup
          </button>
        </div>
      </form>
    </div>
  </div>
  
  <!-- Toast container -->
  <div id="toast" class="toast"></div>
  
  <script>
    // Toast function
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast ' + type;
      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
    
    // Edit email functionality
    function editEmail() {
      const input = document.getElementById('emailInput');
      const editBtn = document.getElementById('editEmailBtn');
      const saveBtn = document.getElementById('saveEmailBtn');
      const cancelBtn = document.getElementById('cancelEmailBtn');
      
      input.removeAttribute('readonly');
      input.focus();
      input.select();
      
      editBtn.classList.add('hidden');
      saveBtn.classList.remove('hidden');
      cancelBtn.classList.remove('hidden');
    }
    
    function cancelEmailEdit() {
      const input = document.getElementById('emailInput');
      const editBtn = document.getElementById('editEmailBtn');
      const saveBtn = document.getElementById('saveEmailBtn');
      const cancelBtn = document.getElementById('cancelEmailBtn');
      
      input.value = '${user.email}';
      input.setAttribute('readonly', true);
      
      editBtn.classList.remove('hidden');
      saveBtn.classList.add('hidden');
      cancelBtn.classList.add('hidden');
    }
    
    async function saveEmail() {
      const input = document.getElementById('emailInput');
      const newEmail = input.value.trim();
      
      try {
        const response = await fetch('/settings/update-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: newEmail }),
          credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showToast('Email updated successfully');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || 'Error updating email', 'error');
          cancelEmailEdit();
        }
      } catch (error) {
        console.error('Error:', error);
        showToast('Error updating email', 'error');
        cancelEmailEdit();
      }
    }
    
    // Edit username functionality
    function editUsername() {
      const input = document.getElementById('usernameInput');
      const editBtn = document.getElementById('editUsernameBtn');
      const saveBtn = document.getElementById('saveUsernameBtn');
      const cancelBtn = document.getElementById('cancelUsernameBtn');
      
      input.removeAttribute('readonly');
      input.focus();
      input.select();
      
      editBtn.classList.add('hidden');
      saveBtn.classList.remove('hidden');
      cancelBtn.classList.remove('hidden');
    }
    
    function cancelUsernameEdit() {
      const input = document.getElementById('usernameInput');
      const editBtn = document.getElementById('editUsernameBtn');
      const saveBtn = document.getElementById('saveUsernameBtn');
      const cancelBtn = document.getElementById('cancelUsernameBtn');
      
      input.value = '${user.username}';
      input.setAttribute('readonly', true);
      
      editBtn.classList.remove('hidden');
      saveBtn.classList.add('hidden');
      cancelBtn.classList.add('hidden');
    }
    
    async function saveUsername() {
      const input = document.getElementById('usernameInput');
      const newUsername = input.value.trim();
      
      try {
        const response = await fetch('/settings/update-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: newUsername }),
          credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showToast('Username updated successfully');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || 'Error updating username', 'error');
          cancelUsernameEdit();
        }
      } catch (error) {
        console.error('Error:', error);
        showToast('Error updating username', 'error');
        cancelUsernameEdit();
      }
    }
    
    // Accent color functions
    async function updateAccentColor(color) {
      try {
        // Validate hex color
        if (!/^#[0-9A-F]{6}$/i.test(color)) {
          showToast('Invalid color format', 'error');
          return;
        }
        
        // Update CSS variables immediately for instant feedback
        document.documentElement.style.setProperty('--accent-color', color);
        document.documentElement.style.setProperty('--accent-hover', adjustColorJS(color, -30));
        document.documentElement.style.setProperty('--accent-light', adjustColorJS(color, 40));
        document.documentElement.style.setProperty('--accent-dark', adjustColorJS(color, -50));
        document.documentElement.style.setProperty('--accent-shadow', color + '66');
        document.documentElement.style.setProperty('--accent-glow', color + '80');
        document.documentElement.style.setProperty('--accent-subtle', color + '1A');
        
        // Send to server
        const response = await fetch('/settings/update-accent-color', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ accentColor: color }),
          credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showToast('Theme color updated!');
          // Reload the page to fully apply the new color
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || 'Error updating color', 'error');
          // Revert the color if server update failed
          location.reload();
        }
      } catch (error) {
        console.error('Error updating accent color:', error);
        showToast('Error updating color', 'error');
        location.reload();
      }
    }
    
    function resetAccentColor() {
      updateAccentColor('#dc2626');
    }
    
    // Client-side color adjustment function
    function adjustColorJS(color, amount) {
      const num = parseInt(color.replace("#", ""), 16);
      const amt = Math.round(2.55 * amount);
      const R = (num >> 16) + amt;
      const G = (num >> 8 & 0x00FF) + amt;
      const B = (num & 0x0000FF) + amt;
      return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255))
        .toString(16).slice(1);
    }
    
    ${user.role === 'admin' ? `
      // Admin functions
      async function makeAdmin(userId) {
        if (!confirm('Grant admin privileges to this user?')) return;
        
        try {
          const response = await fetch('/admin/make-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Admin privileges granted');
            setTimeout(() => location.reload(), 1000);
          } else {
            showToast(data.error || 'Error granting admin', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error granting admin', 'error');
        }
      }
      
      async function revokeAdmin(userId) {
        if (!confirm('Revoke admin privileges from this user?')) return;
        
        try {
          const response = await fetch('/admin/revoke-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Admin privileges revoked');
            setTimeout(() => location.reload(), 1000);
          } else {
            showToast(data.error || 'Error revoking admin', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error revoking admin', 'error');
        }
      }
      
      async function deleteUser(userId) {
        if (!confirm('Permanently delete this user and all their data?')) return;
        
        try {
          const response = await fetch('/admin/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('User deleted successfully');
            setTimeout(() => location.reload(), 1000);
          } else {
            showToast(data.error || 'Error deleting user', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error deleting user', 'error');
        }
      }
      
      async function viewUserLists(userId) {
        try {
          const response = await fetch(\`/admin/user-lists/\${userId}\`, {
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.lists) {
            const listInfo = data.lists.map(list => 
              \`• \${list.name}: \${list.albumCount} albums\`
            ).join('\\n');
            
            alert(\`User's Lists:\\n\\n\${listInfo || 'No lists found'}\`);
          } else {
            showToast('Error fetching user lists', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error fetching user lists', 'error');
        }
      }
      
      async function clearSessions() {
        try {
          const response = await fetch('/admin/clear-sessions', {
            method: 'POST',
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('All sessions cleared');
            setTimeout(() => window.location.href = '/login', 2000);
          } else {
            showToast('Error clearing sessions', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error clearing sessions', 'error');
        }
      }
      
      function showRestoreModal() {
        document.getElementById('restoreModal').classList.remove('hidden');
      }
      
      // Handle restore form submission
      document.getElementById('restoreForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!confirm('This will replace ALL current data. Are you absolutely sure?')) {
          return;
        }
        
        const formData = new FormData(e.target);
        
        try {
          const response = await fetch('/admin/restore', {
            method: 'POST',
            body: formData,
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Database restored successfully');
            setTimeout(() => window.location.href = '/login', 2000);
          } else {
            showToast(data.error || 'Error restoring database', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error restoring database', 'error');
        }
        
        document.getElementById('restoreModal').classList.add('hidden');
      });
    ` : ''}
  </script>
</body>
</html>
  `;
};

module.exports = { settingsTemplate };