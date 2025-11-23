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
    class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200 ${className}"
    ${attributes}
  >
`;

// Reusable User Avatar Component
const userAvatar = (username, size = 'w-12 h-12', textSize = 'text-lg') => `
  <div class="${size} rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
    <span class="text-white font-bold ${textSize}">
      ${username.substring(0, 2).toUpperCase()}
    </span>
  </div>
`;

// Reusable User Card Component
const userCard = (user, actions = '', isCurrentUser = false) => `
  <div class="bg-gray-800 rounded-lg p-4 sm:p-5 border border-gray-700 hover:border-gray-600 transition-colors">
    <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <!-- User Info -->
      <div class="flex items-center gap-4 flex-1 min-w-0 w-full sm:w-auto">
        ${userAvatar(user.username)}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <h5 class="text-white font-semibold truncate">${user.username}</h5>
            ${
              user.role === 'admin'
                ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-900/50 text-yellow-400 text-xs rounded border border-yellow-600/30"><i class="fas fa-shield-alt"></i>Admin</span>'
                : ''
            }
          </div>
          <p class="text-sm text-gray-400 truncate">${user.email}</p>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
            <span><i class="fas fa-list mr-1"></i>${user.listCount} lists</span>
            <span><i class="fas fa-clock mr-1"></i>${user.lastActivity ? formatDateTime(user.lastActivity, false, 'MM/DD/YYYY') : 'Never active'}</span>
          </div>
        </div>
      </div>
      
      <!-- Actions -->
      <div class="flex flex-wrap sm:flex-nowrap gap-2 w-full sm:w-auto">
        ${
          isCurrentUser
            ? '<span class="text-xs text-gray-500 px-3 py-1 bg-gray-700/50 rounded min-h-[44px] flex items-center justify-center">You</span>'
            : actions
        }
      </div>
    </div>
  </div>
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
        ${button('Update Password', '', 'w-full bg-gray-700 hover:bg-gray-600', 'fas fa-key')}
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
              <select id="timeFormatSelect" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-gray-500">
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
              <select id="dateFormatSelect" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-gray-500">
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
                <a href="/auth/spotify" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
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
                <a href="/auth/tidal" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
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
            <select id="musicServiceSelect" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-gray-500">
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
        ${button('Request Admin Access', '', 'w-full bg-gray-700 hover:bg-gray-600', 'fas fa-key')}
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
        <!-- Total Users -->
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
          <div class="text-blue-400 mb-2">
            <i class="fas fa-users text-2xl"></i>
          </div>
          <div class="text-3xl font-bold text-white mb-1">${stats.totalUsers}</div>
          <div class="text-xs text-gray-400 uppercase">Total Users</div>
        </div>
        
        <!-- Total Lists -->
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
          <div class="text-purple-400 mb-2">
            <i class="fas fa-list-ul text-2xl"></i>
          </div>
          <div class="text-3xl font-bold text-white mb-1">${stats.totalLists}</div>
          <div class="text-xs text-gray-400 uppercase">Total Lists</div>
        </div>
        
        <!-- Unique Albums -->
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
          <div class="text-green-400 mb-2">
            <i class="fas fa-compact-disc text-2xl"></i>
          </div>
          <div class="text-3xl font-bold text-white mb-1">${stats.totalAlbums}</div>
          <div class="text-xs text-gray-400 uppercase">Unique Albums</div>
        </div>
        
        <!-- Admin Users -->
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
          <div class="text-yellow-400 mb-2">
            <i class="fas fa-shield-alt text-2xl"></i>
          </div>
          <div class="text-3xl font-bold text-white mb-1">${stats.adminUsers}</div>
          <div class="text-xs text-gray-400 uppercase">Admins</div>
        </div>
        
        <!-- Active Users -->
        <div class="bg-gray-800 rounded-lg p-4 border border-gray-700 text-center">
          <div class="text-red-400 mb-2">
            <i class="fas fa-user-check text-2xl"></i>
          </div>
          <div class="text-3xl font-bold text-white mb-1">${stats.activeUsers}</div>
          <div class="text-xs text-gray-400 uppercase">Active (7d)</div>
        </div>
      </div>
    </div>
    
    <!-- Database Management -->
    <div class="mb-8">
      <h4 class="text-lg font-semibold text-white mb-4">Database Management</h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${button('Backup Database', "if(confirm('Download complete database backup?')) window.location.href='/admin/backup'", 'bg-gray-700 hover:bg-gray-600', 'fas fa-database')}
        ${button('Restore Backup', 'showRestoreModal()', 'bg-gray-700 hover:bg-gray-600', 'fas fa-upload')}
      </div>
    </div>
    
    <!-- User Management -->
    <div>
      <h4 class="text-lg font-semibold text-white mb-4">User Management</h4>
      
      <div class="space-y-3">
        ${adminData.users
          .map((u) => {
            const isCurrentUser = u._id === adminData.currentUserId;
            const actions = `
              ${
                u.role !== 'admin'
                  ? `<button onclick="makeAdmin('${u._id}')" class="min-h-[44px] min-w-[44px] p-3 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors flex items-center justify-center" title="Grant Admin"><i class="fas fa-user-shield"></i></button>`
                  : `<button onclick="revokeAdmin('${u._id}')" class="min-h-[44px] min-w-[44px] p-3 rounded bg-yellow-600 hover:bg-yellow-700 text-white transition-colors flex items-center justify-center" title="Revoke Admin"><i class="fas fa-user-times"></i></button>`
              }
              <button onclick="viewUserLists('${u._id}')" class="min-h-[44px] min-w-[44px] p-3 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors flex items-center justify-center" title="View Lists"><i class="fas fa-list"></i></button>
              <button onclick="deleteUser('${u._id}')" class="min-h-[44px] min-w-[44px] p-3 rounded bg-red-600 hover:bg-red-700 text-white transition-colors flex items-center justify-center" title="Delete User"><i class="fas fa-trash-alt"></i></button>
            `;
            return userCard(u, actions, isCurrentUser);
          })
          .join('')}
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
    <div class="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg flash-message" data-flash="error">
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
    <div class="mb-6 p-4 bg-green-900/20 border border-green-800 rounded-lg flash-message" data-flash="success">
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
      --accent-subtle: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.2)};
      --accent-subtle-strong: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.3)};
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
    .hover\\:text-red-500:hover, .hover\\:text-red-400:hover { 
      color: var(--accent-color) !important; 
    }
    .border-red-600, .border-red-500 { 
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
      top: 5rem;
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
<body class="bg-black text-gray-200 overflow-hidden">
  <div class="h-screen flex flex-col">
    ${headerComponent(user, 'settings')}
    
    <main class="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
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
  <div id="restoreModal" class="hidden fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-lg transform transition-all">
      <!-- Header -->
      <div class="p-6 border-b border-gray-800">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-white flex items-center gap-3">
            <i class="fas fa-upload text-red-500"></i>
            Restore Database
          </h3>
          <button 
            id="closeRestoreModal"
            onclick="closeRestoreModal()"
            class="text-gray-400 hover:text-white transition-colors"
          >
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      
      <!-- Content -->
      <div id="restoreContent" class="p-6">
        <!-- File Selection Phase -->
        <form id="restoreForm" enctype="multipart/form-data">
          <div class="space-y-6">
            <!-- File Input -->
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-3">
                Select Backup File
              </label>
              <div class="relative">
                <input 
                  type="file" 
                  id="backupFileInput"
                  name="backup"
                  accept=".dump"
                  required
                  class="w-full px-4 py-3 bg-gray-800 border-2 border-gray-700 rounded-lg text-white 
                         file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 
                         file:text-sm file:font-semibold file:bg-gray-700 file:text-white 
                         hover:file:bg-gray-600 file:transition-colors file:cursor-pointer
                         focus:outline-none focus:border-gray-500 transition-colors cursor-pointer"
                >
              </div>
              <p class="text-xs text-gray-500 mt-2">
                <i class="fas fa-info-circle mr-1"></i>
                PostgreSQL custom format (.dump) files only
              </p>
            </div>
            
            <!-- Warning Box -->
            <div class="bg-gradient-to-r from-yellow-900/20 to-red-900/20 border-2 border-yellow-700/50 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <i class="fas fa-exclamation-triangle text-yellow-400 text-xl mt-0.5"></i>
                <div class="flex-1">
                  <h4 class="text-yellow-400 font-semibold mb-1">Destructive Operation</h4>
                  <p class="text-gray-300 text-sm leading-relaxed">
                    This will permanently replace all current data with the backup contents. 
                    The server will restart automatically to complete the restore.
                  </p>
                </div>
              </div>
            </div>
            
            <!-- Action Buttons -->
            <div class="flex gap-3 justify-end pt-2">
              <button 
                type="button"
                onclick="closeRestoreModal()"
                class="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg 
                       transition-colors duration-200 font-medium flex items-center gap-2 whitespace-nowrap"
              >
                <i class="fas fa-times"></i>
                Cancel
              </button>
              <button 
                type="submit"
                id="restoreButton"
                class="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg 
                       transition-colors duration-200 font-semibold flex items-center gap-2 whitespace-nowrap"
              >
                <i class="fas fa-upload"></i>
                Restore Database
              </button>
            </div>
          </div>
        </form>
      </div>
      
      <!-- Progress Phase (Initially Hidden) -->
      <div id="restoreProgress" class="hidden p-6">
        <div class="space-y-6">
          <!-- Progress Steps -->
          <div class="space-y-4">
            <!-- Step 1: Upload -->
            <div id="step-upload" class="flex items-start gap-4">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center">
                <i class="fas fa-spinner fa-spin text-gray-400 text-sm"></i>
              </div>
              <div class="flex-1">
                <div class="text-white font-medium">Uploading backup file</div>
                <div class="text-gray-400 text-sm mt-1">Transferring file to server...</div>
              </div>
            </div>
            
            <!-- Step 2: Validate -->
            <div id="step-validate" class="flex items-start gap-4 opacity-50">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center">
                <i class="fas fa-circle text-gray-600 text-xs"></i>
              </div>
              <div class="flex-1">
                <div class="text-white font-medium">Validating backup</div>
                <div class="text-gray-400 text-sm mt-1">Checking file integrity...</div>
              </div>
            </div>
            
            <!-- Step 3: Restore -->
            <div id="step-restore" class="flex items-start gap-4 opacity-50">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center">
                <i class="fas fa-circle text-gray-600 text-xs"></i>
              </div>
              <div class="flex-1">
                <div class="text-white font-medium">Restoring database</div>
                <div class="text-gray-400 text-sm mt-1">Replacing current data...</div>
              </div>
            </div>
            
            <!-- Step 4: Restart -->
            <div id="step-restart" class="flex items-start gap-4 opacity-50">
              <div class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center">
                <i class="fas fa-circle text-gray-600 text-xs"></i>
              </div>
              <div class="flex-1">
                <div class="text-white font-medium">Restarting server</div>
                <div class="text-gray-400 text-sm mt-1">Clearing cache and reconnecting...</div>
              </div>
            </div>
          </div>
          
          <!-- Progress Bar -->
          <div class="bg-gray-800 rounded-full h-2 overflow-hidden">
            <div id="progressBar" class="bg-gradient-to-r from-red-600 to-red-500 h-full transition-all duration-500 ease-out" style="width: 0%"></div>
          </div>
          
          <!-- Status Message -->
          <div id="statusMessage" class="text-center text-gray-300 text-sm">
            Please wait while the restore operation completes...
          </div>
        </div>
      </div>
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
      
      function showRestoreModal() {
        document.getElementById('restoreModal').classList.remove('hidden');
        // Reset modal to initial state
        document.getElementById('restoreContent').classList.remove('hidden');
        document.getElementById('restoreProgress').classList.add('hidden');
        document.getElementById('closeRestoreModal').disabled = false;
      }
      
      function closeRestoreModal() {
        document.getElementById('restoreModal').classList.add('hidden');
      }
      
      function updateProgressStep(stepId, state) {
        const step = document.getElementById(stepId);
        const icon = step.querySelector('i');
        const circle = step.querySelector('div');
        
        step.classList.remove('opacity-50');
        
        if (state === 'active') {
          icon.className = 'fas fa-spinner fa-spin text-red-500 text-sm';
          circle.className = 'flex-shrink-0 w-8 h-8 rounded-full bg-red-900/30 border-2 border-red-600 flex items-center justify-center';
        } else if (state === 'complete') {
          icon.className = 'fas fa-check text-green-400 text-sm';
          circle.className = 'flex-shrink-0 w-8 h-8 rounded-full bg-green-900/30 border-2 border-green-600 flex items-center justify-center';
        } else if (state === 'error') {
          icon.className = 'fas fa-times text-red-400 text-sm';
          circle.className = 'flex-shrink-0 w-8 h-8 rounded-full bg-red-900/50 border-2 border-red-500 flex items-center justify-center';
        }
      }
      
      function updateProgress(percent, message) {
        document.getElementById('progressBar').style.width = percent + '%';
        if (message) {
          document.getElementById('statusMessage').textContent = message;
        }
      }
      
      // Handle restore form submission
      document.getElementById('restoreForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const restoreStartTime = Date.now();
        const restoreId = 'restore_' + restoreStartTime;
        
        console.log(\`[\${restoreId}] === CLIENT: RESTORE STARTED ===\`, {
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
        });
        
        const formData = new FormData(e.target);
        const file = formData.get('backup');
        
        console.log(\`[\${restoreId}] File selected\`, {
          name: file.name,
          size: file.size,
          sizeMB: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
          type: file.type,
        });
        
        // Switch to progress view
        document.getElementById('restoreContent').classList.add('hidden');
        document.getElementById('restoreProgress').classList.remove('hidden');
        document.getElementById('closeRestoreModal').disabled = true;
        
        // Helper function to wait for server restart
        const waitForServerRestart = () => {
          console.log(\`[\${restoreId}] Waiting for server restart...\`);
          updateProgressStep('step-restart', 'active');
          updateProgress(80, 'Server is restarting...');
          
          setTimeout(() => {
            updateProgress(85, 'Waiting for server to come back online...');
            
            let pingCount = 0;
            const checkServer = setInterval(async () => {
              pingCount++;
              console.log(\`[\${restoreId}] Ping #\${pingCount} - checking if server is back...\`);
              
              try {
                const ping = await fetch('/health', { method: 'HEAD' });
                if (ping.ok) {
                  clearInterval(checkServer);
                  console.log(\`[\${restoreId}] Server is back online after \${pingCount} pings!\`);
                  updateProgress(100, 'Server is back online! Redirecting...');
                  updateProgressStep('step-restart', 'complete');
                  
                  // Clear all localStorage cache to ensure fresh data after restore
                  try {
                    localStorage.removeItem('lists_cache');
                    localStorage.removeItem('lists_cache_timestamp');
                    localStorage.removeItem('lastSelectedList');
                    localStorage.clear(); // Clear everything to be safe
                  } catch (e) {
                    console.warn('Failed to clear localStorage:', e);
                  }
                  
                  setTimeout(() => {
                    window.location.href = '/login';
                  }, 1000);
                }
              } catch (e) {
                console.log(\`[\${restoreId}] Ping #\${pingCount} - server still down:\`, e.message);
              }
            }, 1000);
          }, 2000);
        };
        
        try {
          // Step 1: Upload (0-25%)
          updateProgressStep('step-upload', 'active');
          updateProgress(10, 'Uploading backup file to server...');
          
          const fetchStartTime = Date.now();
          console.log(\`[\${restoreId}] Starting fetch request...\`, {
            url: '/admin/restore',
            method: 'POST',
          });
          
          let response;
          try {
            response = await fetch('/admin/restore', {
              method: 'POST',
              body: formData,
              credentials: 'same-origin'
            });
            
            const fetchDuration = Date.now() - fetchStartTime;
            console.log(\`[\${restoreId}] Fetch completed\`, {
              duration: fetchDuration + 'ms',
              status: response.status,
              statusText: response.statusText,
              ok: response.ok,
              headers: {
                contentType: response.headers.get('content-type'),
                contentLength: response.headers.get('content-length'),
              },
            });
          } catch (fetchError) {
            const fetchDuration = Date.now() - fetchStartTime;
            console.error(\`[\${restoreId}] Fetch failed after \${fetchDuration}ms\`, fetchError);
            throw new Error('Failed to upload backup file: ' + fetchError.message);
          }
          
          updateProgress(25, 'Upload complete');
          updateProgressStep('step-upload', 'complete');
          
          // Step 2: Validate (25-50%)
          updateProgressStep('step-validate', 'active');
          updateProgress(35, 'Validating backup file format...');
          
          // Try to parse JSON, but handle the case where server restarts during parsing
          let data;
          const jsonParseStart = Date.now();
          console.log(\`[\${restoreId}] Starting to parse response.json()...\`);
          
          // Set up a timeout detector
          let timeoutWarningShown = false;
          const timeoutWarning = setTimeout(() => {
            const elapsed = Date.now() - jsonParseStart;
            console.warn(\`[\${restoreId}] ⚠️  response.json() is taking a long time! Elapsed: \${elapsed}ms\`);
            timeoutWarningShown = true;
          }, 5000); // Warn after 5 seconds
          
          // Set up interval to log how long we've been waiting
          const waitLogger = setInterval(() => {
            const elapsed = Date.now() - jsonParseStart;
            console.log(\`[\${restoreId}] Still waiting for response.json()... Elapsed: \${elapsed}ms\`);
          }, 10000); // Log every 10 seconds
          
          try {
            data = await response.json();
            clearTimeout(timeoutWarning);
            clearInterval(waitLogger);
            
            const jsonParseDuration = Date.now() - jsonParseStart;
            console.log(\`[\${restoreId}] Successfully parsed JSON response\`, {
              duration: jsonParseDuration + 'ms',
              data: data,
            });
          } catch (jsonError) {
            clearTimeout(timeoutWarning);
            clearInterval(waitLogger);
            
            const jsonParseDuration = Date.now() - jsonParseStart;
            console.error(\`[\${restoreId}] Failed to parse JSON after \${jsonParseDuration}ms\`, {
              error: jsonError.message,
              errorName: jsonError.name,
              responseOk: response.ok,
              responseStatus: response.status,
            });
            
            // If JSON parsing fails AND response status was OK, server likely restarted
            // This means restore succeeded (server only restarts on success)
            if (response.ok) {
              console.log(\`[\${restoreId}] Server restarted during response - restore likely succeeded\`);
              updateProgress(50, 'Backup validated successfully');
              updateProgressStep('step-validate', 'complete');
              
              // Step 3: Restore
              updateProgressStep('step-restore', 'active');
              updateProgress(60, 'Restoring database from backup...');
              updateProgress(75, 'Database restored successfully');
              updateProgressStep('step-restore', 'complete');
              
              // Step 4: Wait for restart
              waitForServerRestart();
              return;
            } else {
              // Actual error - response was not OK
              throw new Error('Failed to parse server response');
            }
          }
          
          // Check if restore failed (response was parsed successfully)
          if (!data.success) {
            console.error(\`[\${restoreId}] Server reported failure\`, data);
            updateProgressStep('step-validate', 'error');
            updateProgress(50, data.error || 'Validation failed');
            setTimeout(() => {
              closeRestoreModal();
              document.getElementById('closeRestoreModal').disabled = false;
            }, 3000);
            return;
          }
          
          // Success response received
          console.log(\`[\${restoreId}] Server reported success, proceeding...\`);
          updateProgress(50, 'Backup validated successfully');
          updateProgressStep('step-validate', 'complete');
          
          // Step 3: Restore (50-75%)
          updateProgressStep('step-restore', 'active');
          updateProgress(60, 'Restoring database from backup...');
          updateProgress(75, 'Database restored successfully');
          updateProgressStep('step-restore', 'complete');
          
          // Step 4: Wait for server restart
          waitForServerRestart();
          
        } catch (error) {
          const totalDuration = Date.now() - restoreStartTime;
          console.error(\`[\${restoreId}] Restore error after \${totalDuration}ms\`, {
            error: error.message,
            stack: error.stack,
          });
          updateProgressStep('step-upload', 'error');
          updateProgress(0, 'Error: ' + error.message);
          setTimeout(() => {
            closeRestoreModal();
            document.getElementById('closeRestoreModal').disabled = false;
          }, 3000);
        }
        
        console.log(\`[\${restoreId}] === CLIENT: RESTORE FLOW COMPLETED ===\`);
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
