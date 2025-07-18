const {
  headerComponent,
  asset,
  formatDateTime,
  formatDate,
} = require('./templates');
const { adjustColor, colorWithOpacity } = require('./color-utils');

// Reusable Settings Card Component
const settingsCard = (title, icon, children, className = '') => `
  <div class="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden ${className}">
    <div class="p-4 lg:p-6 border-b border-gray-800">
      <h3 class="text-lg lg:text-xl font-semibold text-white flex items-center">
        <i class="${icon} mr-3 text-gray-400"></i>
        ${title}
      </h3>
    </div>
    <div class="p-4 lg:p-6">
      ${children}
    </div>
  </div>
`;

// Reusable Form Field Component
const formField = (label, input, description = '') => `
  <div class="space-y-2">
    <label class="block text-sm font-medium text-gray-300">${label}</label>
    ${input}
    ${description ? `<p class="text-xs text-gray-500">${description}</p>` : ''}
  </div>
`;

// Reusable Button Component
const button = (
  text,
  onClick = '',
  className = 'bg-gray-700 hover:bg-gray-600',
  icon = ''
) => `
  <button 
    ${onClick ? `onclick="${onClick}"` : ''}
    class="px-4 py-2 ${className} text-white rounded-lg transition duration-200 font-medium flex items-center justify-center gap-2"
  >
    ${icon ? `<i class="${icon}"></i>` : ''}
    ${text}
  </button>
`;

// Reusable Input Component
const input = (
  type,
  id,
  value = '',
  placeholder = '',
  className = '',
  attributes = ''
) => `
  <input 
    type="${type}" 
    id="${id}"
    ${value ? `value="${value}"` : ''}
    ${placeholder ? `placeholder="${placeholder}"` : ''}
    class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200 ${className}"
    ${attributes}
  >
`;

// Account Information Section
const accountInfoSection = (user) =>
  settingsCard(
    'Account Information',
    'fas fa-user',
    `
    <div class="space-y-6">
      ${formField(
        'Email Address',
        `
          <div class="flex flex-col sm:flex-row gap-3">
            ${input('email', 'emailInput', user.email, '', 'flex-1', 'readonly')}
            <div class="flex gap-2">
              ${button('Edit', 'editEmail()', 'bg-gray-700 hover:bg-gray-600', 'fas fa-edit')}
              ${button('Save', 'saveEmail()', 'hidden bg-green-600 hover:bg-green-700', 'fas fa-check')}
              ${button('Cancel', 'cancelEmailEdit()', 'hidden bg-gray-700 hover:bg-gray-600', 'fas fa-times')}
            </div>
          </div>
        `
      )}
      
      ${formField(
        'Username',
        `
          <div class="flex flex-col sm:flex-row gap-3">
            ${input('text', 'usernameInput', user.username, '', 'flex-1', 'readonly')}
            <div class="flex gap-2">
              ${button('Edit', 'editUsername()', 'bg-gray-700 hover:bg-gray-600', 'fas fa-edit')}
              ${button('Save', 'saveUsername()', 'hidden bg-green-600 hover:bg-green-700', 'fas fa-check')}
              ${button('Cancel', 'cancelUsernameEdit()', 'hidden bg-gray-700 hover:bg-gray-600', 'fas fa-times')}
            </div>
          </div>
        `
      )}
      
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        ${formField(
          'Role',
          `
            <div class="flex items-center gap-2">
              <span class="text-white">${user.role === 'admin' ? 'Administrator' : 'User'}</span>
              ${user.role === 'admin' ? '<i class="fas fa-shield-alt text-yellow-500"></i>' : ''}
            </div>
          `
        )}
        
        ${formField(
          'Member Since',
          `<span class="text-white">${formatDate(user.createdAt, user.dateFormat)}</span>`
        )}
      </div>
    </div>
  `
  );

// Password Change Section
const passwordSection = (req) =>
  settingsCard(
    'Change Password',
    'fas fa-lock',
    `
    <form action="/settings/change-password" method="POST" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      
      ${formField(
        'Current Password',
        input(
          'password',
          'currentPassword',
          '',
          'Enter current password',
          '',
          'required'
        )
      )}
      
      ${formField(
        'New Password',
        input(
          'password',
          'newPassword',
          '',
          'Enter new password',
          '',
          'required minlength="8"'
        ),
        'Minimum 8 characters required'
      )}
      
      ${formField(
        'Confirm New Password',
        input(
          'password',
          'confirmPassword',
          '',
          'Confirm new password',
          '',
          'required minlength="8"'
        )
      )}
      
      <div class="pt-4">
        ${button('Update Password', '', 'w-full bg-red-600 hover:bg-red-700', 'fas fa-key')}
      </div>
    </form>
  `
  );

// Theme Settings Section
const themeSection = (user) =>
  settingsCard(
    'Theme & Appearance',
    'fas fa-palette',
    `
    <div class="space-y-6">
      ${formField(
        'Accent Color',
        `
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <input 
              type="color" 
              id="customAccentColor" 
              value="${user.accentColor || '#dc2626'}"
              class="h-12 w-20 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer hover:border-gray-600"
            >
            <div class="flex gap-2 flex-1">
              ${button('Apply', "updateAccentColor(document.getElementById('customAccentColor').value)", 'bg-gray-700 hover:bg-gray-600')}
              ${button('Reset', 'resetAccentColor()', 'bg-gray-800 hover:bg-gray-700 text-gray-400')}
            </div>
          </div>
        `,
        'Choose your preferred accent color for the interface'
      )}
      
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        ${formField(
          'Time Format',
          `
            <div class="flex gap-3">
              <select id="timeFormatSelect" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-red-600">
                <option value="24h" ${user.timeFormat !== '12h' ? 'selected' : ''}>24-hour</option>
                <option value="12h" ${user.timeFormat === '12h' ? 'selected' : ''}>12-hour</option>
              </select>
              ${button('Save', "updateTimeFormat(document.getElementById('timeFormatSelect').value)", 'bg-gray-700 hover:bg-gray-600')}
            </div>
          `
        )}
        
        ${formField(
          'Date Format',
          `
            <div class="flex gap-3">
              <select id="dateFormatSelect" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-red-600">
                <option value="MM/DD/YYYY" ${user.dateFormat !== 'DD/MM/YYYY' ? 'selected' : ''}>MM/DD/YYYY</option>
                <option value="DD/MM/YYYY" ${user.dateFormat === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY</option>
              </select>
              ${button('Save', "updateDateFormat(document.getElementById('dateFormatSelect').value)", 'bg-gray-700 hover:bg-gray-600')}
            </div>
          `
        )}
      </div>
    </div>
  `
  );

// Music Services Section
const musicServicesSection = (user, spotifyValid, tidalValid) =>
  settingsCard(
    'Music Services',
    'fas fa-music',
    `
    <div class="space-y-6">
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-gray-800 rounded-lg">
          <div class="flex items-center gap-3">
            <i class="fab fa-spotify text-green-500 text-xl"></i>
            <span class="text-white font-medium">Spotify</span>
          </div>
          <div class="flex items-center gap-3">
            ${
              user.spotifyAuth
                ? spotifyValid
                  ? `
                  <span class="text-green-500 text-sm">Connected</span>
                  <a href="/auth/spotify/disconnect" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
                    Disconnect
                  </a>
                `
                  : `
                  <span class="text-yellow-500 text-sm">Reconnect required</span>
                  <a href="/auth/spotify" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm transition duration-200">
                    Reconnect
                  </a>
                `
                : `
                <a href="/auth/spotify" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition duration-200">
                  Connect
                </a>
              `
            }
          </div>
        </div>
        
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-gray-800 rounded-lg">
          <div class="flex items-center gap-3">
            <i class="fas fa-wave-square text-blue-500 text-xl"></i>
            <span class="text-white font-medium">Tidal</span>
          </div>
          <div class="flex items-center gap-3">
            ${
              user.tidalAuth
                ? tidalValid
                  ? `
                  <span class="text-green-500 text-sm">Connected</span>
                  <a href="/auth/tidal/disconnect" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
                    Disconnect
                  </a>
                `
                  : `
                  <span class="text-yellow-500 text-sm">Reconnect required</span>
                  <a href="/auth/tidal" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm transition duration-200">
                    Reconnect
                  </a>
                `
                : `
                <a href="/auth/tidal" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition duration-200">
                  Connect
                </a>
              `
            }
          </div>
        </div>
      </div>
      
      ${formField(
        'Preferred Service',
        `
          <div class="flex gap-3">
            <select id="musicServiceSelect" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-red-600">
              <option value="" ${!user.musicService ? 'selected' : ''}>Ask each time</option>
              <option value="spotify" ${user.musicService === 'spotify' ? 'selected' : ''} ${!user.spotifyAuth ? 'disabled' : ''}>Spotify</option>
              <option value="tidal" ${user.musicService === 'tidal' ? 'selected' : ''} ${!user.tidalAuth ? 'disabled' : ''}>Tidal</option>
            </select>
            ${button('Save', "updateMusicService(document.getElementById('musicServiceSelect').value)", 'bg-gray-700 hover:bg-gray-600')}
          </div>
        `,
        'Choose your default music service for playlist creation'
      )}
    </div>
  `
  );

// Statistics Section
const statisticsSection = (userStats) =>
  settingsCard(
    'Your Statistics',
    'fas fa-chart-bar',
    `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-6">
      <div class="text-center">
        <div class="text-3xl font-bold text-white mb-1">${userStats.listCount}</div>
        <div class="text-sm text-gray-400">Total Lists</div>
      </div>
      <div class="text-center">
        <div class="text-3xl font-bold text-white mb-1">${userStats.totalAlbums}</div>
        <div class="text-sm text-gray-400">Total Albums</div>
      </div>
    </div>
  `
  );

// Admin Request Section
const adminRequestSection = (req) =>
  settingsCard(
    'Admin Access',
    'fas fa-shield-alt',
    `
    <form action="/settings/request-admin" method="POST" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      
      <p class="text-gray-400">
        Enter the admin code to gain administrator privileges.
      </p>
      
      ${formField(
        'Admin Code',
        input(
          'text',
          'adminCode',
          '',
          'Enter admin code...',
          '',
          'name="code" maxlength="8" required style="text-transform: uppercase;"'
        )
      )}
      
      <div class="pt-4">
        ${button('Request Admin Access', '', 'w-full bg-red-600 hover:bg-red-700', 'fas fa-key')}
      </div>
    </form>
  `
  );

// Admin Panel Section
const adminPanelSection = (stats, adminData) =>
  settingsCard(
    'Admin Panel',
    'fas fa-shield-alt text-yellow-500',
    `
    <!-- System Statistics -->
    <div class="mb-8">
      <h4 class="text-lg font-semibold text-white mb-4">System Statistics</h4>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div class="text-center p-4 bg-gray-800 rounded-lg">
          <div class="text-2xl font-bold text-white mb-1">${stats.totalUsers}</div>
          <div class="text-xs text-gray-400">Total Users</div>
        </div>
        <div class="text-center p-4 bg-gray-800 rounded-lg">
          <div class="text-2xl font-bold text-white mb-1">${stats.totalLists}</div>
          <div class="text-xs text-gray-400">Total Lists</div>
        </div>
        <div class="text-center p-4 bg-gray-800 rounded-lg">
          <div class="text-2xl font-bold text-white mb-1">${stats.totalAlbums}</div>
          <div class="text-xs text-gray-400">Total Albums</div>
        </div>
        <div class="text-center p-4 bg-gray-800 rounded-lg">
          <div class="text-2xl font-bold text-white mb-1">${stats.adminUsers}</div>
          <div class="text-xs text-gray-400">Admin Users</div>
        </div>
        <div class="text-center p-4 bg-gray-800 rounded-lg">
          <div class="text-2xl font-bold text-white mb-1">${stats.activeUsers}</div>
          <div class="text-xs text-gray-400">Active Users (7d)</div>
        </div>
      </div>
    </div>
    
    <!-- Admin Actions -->
    <div class="mb-8">
      <h4 class="text-lg font-semibold text-white mb-4">Admin Actions</h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        ${button('Export Users', "if(confirm('Export all users as CSV?')) window.location.href='/admin/export-users'", 'bg-gray-700 hover:bg-gray-600', 'fas fa-download')}
        ${button('Export Database', "if(confirm('Download database export as JSON?')) window.location.href='/admin/export'", 'bg-gray-700 hover:bg-gray-600', 'fas fa-file-export')}
        ${button('Backup Database', "if(confirm('Download complete database backup?')) window.location.href='/admin/backup'", 'bg-gray-700 hover:bg-gray-600', 'fas fa-database')}
        ${button('Restore Backup', 'showRestoreModal()', 'bg-gray-700 hover:bg-gray-600', 'fas fa-upload')}
        ${button('Clear Sessions', "if(confirm('Clear all active sessions? This will log out all users.')) clearSessions()", 'bg-red-700 hover:bg-red-600', 'fas fa-sign-out-alt')}
      </div>
    </div>
    
    <!-- User Management -->
    <div>
      <h4 class="text-lg font-semibold text-white mb-4">User Management</h4>
      <div class="overflow-x-auto">
        <div class="min-w-full">
          <div class="grid grid-cols-5 gap-4 p-4 bg-gray-800 rounded-t-lg text-sm font-medium text-gray-400">
            <div>User</div>
            <div>Lists</div>
            <div>Role</div>
            <div>Last Active</div>
            <div>Actions</div>
          </div>
          <div class="space-y-1">
            ${adminData.users
              .map(
                (u) => `
              <div class="grid grid-cols-5 gap-4 p-4 bg-gray-900 hover:bg-gray-800 transition-colors">
                <div>
                  <div class="text-sm text-white">${u.username}</div>
                  <div class="text-xs text-gray-500">${u.email}</div>
                </div>
                <div class="text-sm text-gray-300">${u.listCount}</div>
                <div>
                  ${
                    u.role === 'admin'
                      ? '<span class="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-1 rounded">Admin</span>'
                      : '<span class="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">User</span>'
                  }
                </div>
                <div class="text-sm text-gray-300">${u.lastActivity ? formatDateTime(u.lastActivity, false, 'MM/DD/YYYY') : '-'}</div>
                <div class="flex gap-2">
                  ${
                    u._id !== adminData.currentUserId
                      ? `
                    ${
                      u.role !== 'admin'
                        ? `
                      <button onclick="makeAdmin('${u._id}')" class="text-xs text-blue-400 hover:text-blue-300" title="Make Admin">
                        <i class="fas fa-user-shield"></i>
                      </button>
                    `
                        : `
                      <button onclick="revokeAdmin('${u._id}')" class="text-xs text-yellow-400 hover:text-yellow-300" title="Revoke Admin">
                        <i class="fas fa-user-times"></i>
                      </button>
                    `
                    }
                    <button onclick="viewUserLists('${u._id}')" class="text-xs text-gray-400 hover:text-gray-300" title="View Lists">
                      <i class="fas fa-list"></i>
                    </button>
                    <button onclick="deleteUser('${u._id}')" class="text-xs text-red-400 hover:text-red-300" title="Delete User">
                      <i class="fas fa-trash"></i>
                    </button>
                  `
                      : '<span class="text-xs text-gray-600">Current User</span>'
                  }
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    </div>
  `,
    'lg:col-span-full'
  );

// Flash Messages Component
const flashMessages = (flash) => `
  ${
    flash.error && flash.error.length
      ? `
    <div class="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg">
      <p class="text-red-400 flex items-center">
        <i class="fas fa-exclamation-circle mr-2"></i>
        ${flash.error[0]}
      </p>
    </div>
  `
      : ''
  }
  
  ${
    flash.success && flash.success.length
      ? `
    <div class="mb-6 p-4 bg-green-900/20 border border-green-800 rounded-lg">
      <p class="text-green-400 flex items-center">
        <i class="fas fa-check-circle mr-2"></i>
        ${flash.success[0]}
      </p>
    </div>
  `
      : ''
  }
`;

// Main Settings Template
const settingsTemplate = (req, options) => {
  const { user, userStats, stats, adminData, flash, spotifyValid, tidalValid } =
    options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Settings - SuShe Online</title>
  <link rel="icon" type="image/png" href="/og-image.png">
  <link rel="apple-touch-icon" href="/og-image.png">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link href="${asset('/styles/output.css')}" rel="stylesheet">
  <style>
    :root {
      --accent-color: ${user?.accentColor || '#dc2626'};
      --accent-hover: ${adjustColor(user?.accentColor || '#dc2626', -30)};
      --accent-light: ${adjustColor(user?.accentColor || '#dc2626', 40)};
      --accent-dark: ${adjustColor(user?.accentColor || '#dc2626', -50)};
      --accent-shadow: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.4)};
      --accent-glow: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.5)};
      --accent-subtle: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.1)};
    }
    
    /* Custom scrollbar - reused from main page */
    ::-webkit-scrollbar {
      width: 8px;
    }
    
    ::-webkit-scrollbar-track {
      background: #111827;
    }
    
    ::-webkit-scrollbar-thumb {
      background: #374151;
      border-radius: 4px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: #4b5563;
    }
    
    /* Firefox scrollbar */
    * {
      scrollbar-width: thin;
      scrollbar-color: #374151 #111827;
    }
    
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
    
    /* Mobile scrolling behavior - consistent with main page */
    @media (max-width: 1023px) {
      body {
        overscroll-behavior: none;
      }
    }
    
    /* iOS smooth scrolling optimization */
    .overflow-y-auto {
      -webkit-overflow-scrolling: touch;
    }
    
    /* Mobile-first responsive design */
    .settings-grid {
      display: grid;
      gap: 1.5rem;
      grid-template-columns: 1fr;
    }
    
    @media (min-width: 1024px) {
      .settings-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 2rem;
      }
    }
    
    /* Responsive form layouts */
    @media (max-width: 640px) {
      .mobile-stack > * {
        width: 100% !important;
      }
    }
    
    /* Toast styling */
    .toast {
      position: fixed;
      top: 1rem;
      right: 1rem;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      color: white;
      font-weight: 500;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      z-index: 1000;
    }
    
    .toast.show {
      transform: translateX(0);
    }
    
    .toast.success {
      background-color: #059669;
    }
    
    .toast.error {
      background-color: #dc2626;
    }
  </style>
</head>
<body class="bg-black text-gray-200 min-h-screen">
  <div class="min-h-screen flex flex-col overflow-hidden">
    ${headerComponent(user, 'settings')}
    
    <main class="flex-1 overflow-y-auto overflow-x-hidden">
      <div class="container mx-auto px-4 py-6 lg:py-8 max-w-7xl">
      <div class="mb-6 lg:mb-8">
        <h1 class="text-2xl lg:text-3xl font-bold text-white">Settings</h1>
        <p class="text-gray-400 mt-2">Manage your account preferences and system settings</p>
      </div>
      
      ${flashMessages(flash)}
      
      <div class="settings-grid">
        <!-- Account & Security Column -->
        <div class="space-y-6">
          ${accountInfoSection(user)}
          ${passwordSection(req)}
        </div>
        
        <!-- Preferences Column -->
        <div class="space-y-6">
          ${themeSection(user)}
          ${musicServicesSection(user, spotifyValid, tidalValid)}
          ${statisticsSection(userStats)}
          
          ${user.role !== 'admin' ? adminRequestSection(req) : ''}
        </div>
        
        <!-- Admin Panel (Full Width) -->
        ${user.role === 'admin' ? adminPanelSection(stats, { ...adminData, currentUserId: user._id }) : ''}
      </div>
      </div>
    </main>
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
            Select backup file (.dump)
          </label>
          <input 
            type="file" 
            name="backup"
            accept=".dump"
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
    let originalEmail = '${user.email}';
    function editEmail() {
      const input = document.getElementById('emailInput');
      const buttons = input.parentElement.querySelectorAll('button');
      
      input.removeAttribute('readonly');
      input.focus();
      input.select();
      
      buttons[0].classList.add('hidden'); // Edit
      buttons[1].classList.remove('hidden'); // Save
      buttons[2].classList.remove('hidden'); // Cancel
    }
    
    function cancelEmailEdit() {
      const input = document.getElementById('emailInput');
      const buttons = input.parentElement.querySelectorAll('button');
      
      input.value = originalEmail;
      input.setAttribute('readonly', true);
      
      buttons[0].classList.remove('hidden'); // Edit
      buttons[1].classList.add('hidden'); // Save
      buttons[2].classList.add('hidden'); // Cancel
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
          originalEmail = newEmail;
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
    let originalUsername = '${user.username}';
    function editUsername() {
      const input = document.getElementById('usernameInput');
      const buttons = input.parentElement.querySelectorAll('button');
      
      input.removeAttribute('readonly');
      input.focus();
      input.select();
      
      buttons[0].classList.add('hidden'); // Edit
      buttons[1].classList.remove('hidden'); // Save
      buttons[2].classList.remove('hidden'); // Cancel
    }
    
    function cancelUsernameEdit() {
      const input = document.getElementById('usernameInput');
      const buttons = input.parentElement.querySelectorAll('button');
      
      input.value = originalUsername;
      input.setAttribute('readonly', true);
      
      buttons[0].classList.remove('hidden'); // Edit
      buttons[1].classList.add('hidden'); // Save
      buttons[2].classList.add('hidden'); // Cancel
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
          originalUsername = newUsername;
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
    
    // Theme functions
    async function updateAccentColor(color) {
      try {
        if (!/^#[0-9A-F]{6}$/i.test(color)) {
          showToast('Invalid color format', 'error');
          return;
        }
        
        document.documentElement.style.setProperty('--accent-color', color);
        
        const response = await fetch('/settings/update-accent-color', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accentColor: color }),
          credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showToast('Theme color updated!');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.error || 'Error updating color', 'error');
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

    async function updateTimeFormat(format) {
      try {
        const response = await fetch('/settings/update-time-format', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeFormat: format }),
          credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
          showToast('Time format updated!');
          setTimeout(() => location.reload(), 500);
        } else {
          showToast(data.error || 'Error updating time format', 'error');
        }
      } catch (error) {
        console.error('Error updating time format:', error);
        showToast('Error updating time format', 'error');
      }
    }

    async function updateDateFormat(format) {
      try {
        const response = await fetch('/settings/update-date-format', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateFormat: format }),
          credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
          showToast('Date format updated!');
          setTimeout(() => location.reload(), 500);
        } else {
          showToast(data.error || 'Error updating date format', 'error');
        }
      } catch (error) {
        console.error('Error updating date format:', error);
        showToast('Error updating date format', 'error');
      }
    }

    async function updateMusicService(service) {
      try {
        const response = await fetch('/settings/update-music-service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ musicService: service }),
          credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
          showToast('Music service updated!');
          setTimeout(() => location.reload(), 500);
        } else {
          showToast(data.error || 'Error updating music service', 'error');
        }
      } catch (error) {
        console.error('Error updating music service:', error);
        showToast('Error updating music service', 'error');
      }
    }
    
    ${
      user.role === 'admin'
        ? `
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
    `
        : ''
    }
  </script>
</body>
</html>
  `;
};

module.exports = { settingsTemplate };
