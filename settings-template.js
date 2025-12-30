const {
  headerComponent,
  asset,
  formatDateTime,
  formatDate,
} = require('./templates');
const { adjustColor, colorWithOpacity } = require('./color-utils');

// Country name to ISO code mapping (reverse of MusicBrainz COUNTRY_CODE_MAP)
const COUNTRY_NAME_TO_CODE = {
  'United States': 'US',
  'United Kingdom': 'GB',
  Canada: 'CA',
  Australia: 'AU',
  Germany: 'DE',
  France: 'FR',
  Japan: 'JP',
  Sweden: 'SE',
  Norway: 'NO',
  Finland: 'FI',
  Denmark: 'DK',
  Iceland: 'IS',
  Netherlands: 'NL',
  Belgium: 'BE',
  Italy: 'IT',
  Spain: 'ES',
  Portugal: 'PT',
  Brazil: 'BR',
  Mexico: 'MX',
  Argentina: 'AR',
  Poland: 'PL',
  'Czech Republic': 'CZ',
  Austria: 'AT',
  Switzerland: 'CH',
  Greece: 'GR',
  'South Korea': 'KR',
  China: 'CN',
  Taiwan: 'TW',
  'Hong Kong': 'HK',
  India: 'IN',
  Indonesia: 'ID',
  Thailand: 'TH',
  Philippines: 'PH',
  Vietnam: 'VN',
  Malaysia: 'MY',
  Singapore: 'SG',
  Russia: 'RU',
  Ukraine: 'UA',
  Ireland: 'IE',
  Scotland: 'GB', // Part of UK
  Wales: 'GB', // Part of UK
  'New Zealand': 'NZ',
  'South Africa': 'ZA',
  Nigeria: 'NG',
  Egypt: 'EG',
  Israel: 'IL',
  Turkey: 'TR',
  'United Arab Emirates': 'AE',
  'Saudi Arabia': 'SA',
  Chile: 'CL',
  Colombia: 'CO',
  Peru: 'PE',
  Venezuela: 'VE',
  Cuba: 'CU',
  'Puerto Rico': 'PR',
  Jamaica: 'JM',
  Hungary: 'HU',
  Romania: 'RO',
  Bulgaria: 'BG',
  Serbia: 'RS',
  Croatia: 'HR',
  Slovenia: 'SI',
  Slovakia: 'SK',
  Lithuania: 'LT',
  Latvia: 'LV',
  Estonia: 'EE',
  Luxembourg: 'LU',
  Europe: 'EU', // MusicBrainz special
  Worldwide: 'UN', // MusicBrainz special
};

// Convert country code to flag emoji using regional indicator symbols
const countryCodeToFlag = (code) => {
  if (!code || code.length !== 2) return '';
  const codePoints = code
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

// Get flag emoji for a country name
const getCountryFlag = (countryName) => {
  const code = COUNTRY_NAME_TO_CODE[countryName];
  return code ? countryCodeToFlag(code) : '';
};

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
const musicServicesSection = (
  user,
  spotifyValid,
  tidalValid,
  lastfmValid,
  lastfmUsername
) =>
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
                  <a href="/auth/spotify?force=true" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200" title="Re-login to update permissions">
                    Reauthorize
                  </a>
                  <a href="/auth/spotify/disconnect" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
                    Disconnect
                  </a>
                `
                  : `
                  <span class="text-yellow-500 text-sm">Reconnect required</span>
                  <a href="/auth/spotify?force=true" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm transition duration-200">
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
        
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-gray-800 rounded-lg">
          <div class="flex items-center gap-3">
            <i class="fab fa-lastfm text-red-500 text-xl"></i>
            <span class="text-white font-medium">Last.fm</span>
            ${lastfmValid && lastfmUsername ? `<span class="text-gray-400 text-sm">@${lastfmUsername}</span>` : ''}
          </div>
          <div class="flex items-center gap-3">
            ${
              lastfmValid
                ? `
                  <span class="text-green-500 text-sm">Connected</span>
                  <a href="/auth/lastfm/disconnect" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
                    Disconnect
                  </a>
                `
                : `
                <a href="/auth/lastfm" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
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
          <select id="musicServiceSelect" class="w-full bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-3 focus:outline-none focus:border-gray-500" onchange="updateMusicService(this.value)">
            <option value="" ${!user.musicService ? 'selected' : ''}>Ask each time</option>
            <option value="spotify" ${user.musicService === 'spotify' ? 'selected' : ''} ${!user.spotifyAuth ? 'disabled' : ''}>Spotify</option>
            <option value="tidal" ${user.musicService === 'tidal' ? 'selected' : ''} ${!user.tidalAuth ? 'disabled' : ''}>Tidal</option>
          </select>
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

// Helper to format relative time
const getRelativeTime = (date) => {
  if (!date) return 'Never';
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return formatDate(then);
};

// Stat card component for key metrics
const statCard = (value, label, icon, colorClass = 'text-accent-color') => `
  <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700/50 text-center">
    <div class="${colorClass} mb-2">
      <i class="${icon} text-xl"></i>
    </div>
    <div class="text-2xl font-bold text-white mb-1">${value}</div>
    <div class="text-xs text-gray-400 uppercase tracking-wide">${label}</div>
  </div>
`;

// Progress bar component for affinity scores with ranking
// Simple affinity list item - no progress bars or percentages (relative data isn't meaningful)
const affinityBar = (name, rank = null, sources = []) => {
  const sourceIcons = sources
    .map((s) => {
      if (s === 'spotify')
        return '<i class="fab fa-spotify text-green-500" title="Spotify"></i>';
      if (s === 'lastfm')
        return '<i class="fab fa-lastfm text-red-500" title="Last.fm"></i>';
      if (s === 'internal')
        return '<i class="fas fa-list text-gray-400" title="Your lists"></i>';
      return '';
    })
    .join('');

  return `
    <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
      ${rank !== null ? `<div class="w-6 text-sm font-medium text-gray-500">${rank}</div>` : ''}
      <div class="flex-1 text-sm text-gray-200 truncate font-medium" title="${name}">${name}</div>
      ${sources.length > 0 ? `<div class="flex gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">${sourceIcons}</div>` : ''}
    </div>
  `;
};

// Country bar component - sourced from user's lists only
const countryBar = (country, maxCount, rank) => {
  const count = country.count || 0;
  const percentage = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
  const flag = getCountryFlag(country.name);

  return `
    <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
      <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
      <div class="w-28 sm:w-36 text-sm text-gray-200 truncate font-medium flex items-center gap-2" title="${country.name}">${flag ? `<span>${flag}</span>` : ''}<span class="truncate">${country.name}</span></div>
      <div class="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-500 ease-out" style="width: ${percentage}%"></div>
      </div>
      <div class="w-14 text-right text-xs text-gray-500 tabular-nums">${count} artist${count !== 1 ? 's' : ''}</div>
    </div>
  `;
};

// Service artist bar - Spotify shows simple list, Last.fm shows progress bar with play counts
const serviceArtistBar = (
  name,
  value,
  maxValue,
  rank,
  service = 'spotify',
  country = null
) => {
  const countryDisplay = country
    ? `<span class="text-gray-500 text-xs" title="${country}">· ${country}</span>`
    : '';

  // Spotify: simple list without progress bar (no meaningful data to show)
  if (service === 'spotify') {
    return `
      <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
        <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-200 truncate font-medium" title="${name}">${name}</span>
            ${countryDisplay}
          </div>
        </div>
      </div>
    `;
  }

  // Last.fm: progress bar with play counts
  const percentage = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0;
  return `
    <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
      <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-200 truncate font-medium" title="${name}">${name}</span>
          ${countryDisplay}
        </div>
        <div class="h-2 bg-gray-800 rounded-full overflow-hidden mt-1">
          <div class="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-500 ease-out" style="width: ${percentage}%"></div>
        </div>
      </div>
      <div class="w-16 text-right text-xs text-gray-500 tabular-nums">${value.toLocaleString()}</div>
    </div>
  `;
};

// Track bar for Spotify top tracks - simple list without progress bar
const trackBar = (track, rank) => {
  return `
    <div class="flex items-center gap-3 py-2 group hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors">
      <div class="w-6 text-sm font-medium text-gray-500">${rank}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-200 truncate font-medium" title="${track.name}">${track.name}</span>
          <span class="text-gray-500 text-xs truncate" title="${track.artist}">· ${track.artist}</span>
        </div>
      </div>
    </div>
  `;
};

// Time range button component
const timeRangeButton = (label, range, service, isActive) => {
  const activeClass = isActive
    ? service === 'spotify'
      ? 'bg-green-600 text-white'
      : 'bg-red-600 text-white'
    : 'bg-gray-700 text-gray-300 hover:bg-gray-600';

  return `
    <button 
      onclick="setTimeRange('${service}', '${range}')"
      class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeClass}"
      data-service="${service}"
      data-range="${range}"
    >
      ${label}
    </button>
  `;
};

// Time range labels
const TIME_RANGE_LABELS = {
  short_term: '4 Weeks',
  medium_term: '6 Months',
  long_term: 'All Time',
  '7day': '7 Days',
  '1month': '1 Month',
  '3month': '3 Months',
  '6month': '6 Months',
  '12month': '1 Year',
  overall: 'All Time',
};

// Music Preferences Section
const musicPreferencesSection = (prefs, spotifyValid, lastfmValid) => {
  if (!prefs) {
    return settingsCard(
      'Music Preferences',
      'fas fa-headphones',
      `
      <div class="text-center py-12">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
          <i class="fas fa-music text-2xl text-gray-600"></i>
        </div>
        <p class="text-gray-300 font-medium mb-2">No preference data yet</p>
        <p class="text-sm text-gray-500 mb-6 max-w-md mx-auto">Add albums to your lists or connect Spotify/Last.fm to see your music taste analysis.</p>
        <button 
          onclick="syncPreferences()" 
          id="syncBtn"
          class="px-5 py-2.5 bg-accent-color hover:bg-accent-hover text-white rounded-lg transition duration-200 font-medium inline-flex items-center gap-2"
        >
          <i class="fas fa-sync-alt"></i>
          Sync Now
        </button>
      </div>
    `,
      'lg:col-span-2'
    );
  }

  const topGenres = (prefs.topGenres || []).slice(0, 8);
  const topArtists = (prefs.topArtists || []).slice(0, 8);
  const topCountries = (prefs.topCountries || []).slice(0, 6);
  const maxCountryCount = topCountries[0]?.count || 1;

  // Get artist country data from MusicBrainz cache
  const artistCountries = prefs.artistCountries || {};

  // Spotify data by time range
  const spotifyArtistsByRange = prefs.spotify?.topArtists || {};
  const spotifyTracksByRange = prefs.spotify?.topTracks || {};

  // Last.fm data by time range
  const lastfmArtistsByRange = prefs.lastfm?.topArtists || {};
  const lastfmScrobbles = prefs.lastfm?.totalScrobbles || 0;

  // Check which time ranges have data
  const spotifyRanges = ['short_term', 'medium_term', 'long_term'].filter(
    (r) => spotifyArtistsByRange[r]?.length > 0
  );
  const lastfmRanges = [
    '7day',
    '1month',
    '3month',
    '6month',
    '12month',
    'overall',
  ].filter((r) => lastfmArtistsByRange[r]?.length > 0);

  // Default to medium_term for Spotify, overall for Last.fm
  const defaultSpotifyRange = spotifyRanges.includes('medium_term')
    ? 'medium_term'
    : spotifyRanges[0] || 'medium_term';
  const defaultLastfmRange = lastfmRanges.includes('overall')
    ? 'overall'
    : lastfmRanges[0] || 'overall';

  // Count data sources
  const hasListData = prefs.totalAlbums > 0;
  const hasSpotifyData = spotifyValid && prefs.spotify?.syncedAt;
  const hasLastfmData = lastfmValid && prefs.lastfm?.syncedAt;
  const sourceCount = [hasListData, hasSpotifyData, hasLastfmData].filter(
    Boolean
  ).length;

  return settingsCard(
    'Music Preferences',
    'fas fa-headphones',
    `
    <div class="space-y-6">
      <!-- Header with sync button and quick stats -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-800">
        <div class="flex items-center gap-4">
          <div class="text-sm text-gray-400">
            <i class="fas fa-clock mr-1.5"></i>
            Updated ${getRelativeTime(prefs.updatedAt)}
          </div>
        </div>
        <button 
          onclick="syncPreferences()" 
          id="syncBtn"
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition duration-200 text-sm font-medium inline-flex items-center gap-2 border border-gray-700"
        >
          <i class="fas fa-sync-alt" id="syncIcon"></i>
          <span id="syncText">Sync Now</span>
        </button>
      </div>

      <!-- Quick Stats Row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${statCard(prefs.totalAlbums || 0, 'Albums', 'fas fa-compact-disc', 'text-accent-color')}
        ${statCard(topGenres.length, 'Genres', 'fas fa-tags', 'text-purple-400')}
        ${statCard(topArtists.length, 'Artists', 'fas fa-user-friends', 'text-blue-400')}
        ${statCard(sourceCount, 'Sources', 'fas fa-database', 'text-green-400')}
      </div>

      <!-- Main Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Top Genres -->
        ${
          topGenres.length > 0
            ? `
        <div class="bg-gray-800/30 rounded-xl p-4 border border-gray-800">
          <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
            <i class="fas fa-tags text-purple-400"></i>
            Top Genres
          </h4>
          <div class="space-y-0.5">
            ${topGenres.map((g, i) => affinityBar(g.name, i + 1, g.sources || [])).join('')}
          </div>
        </div>
        `
            : ''
        }

        <!-- Top Artists -->
        ${
          topArtists.length > 0
            ? `
        <div class="bg-gray-800/30 rounded-xl p-4 border border-gray-800">
          <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
            <i class="fas fa-user-friends text-blue-400"></i>
            Top Artists
          </h4>
          <div class="space-y-0.5">
            ${topArtists.map((a, i) => affinityBar(a.name, i + 1, a.sources || [])).join('')}
          </div>
        </div>
        `
            : ''
        }
      </div>

      <!-- Top Countries -->
      ${
        topCountries.length > 0
          ? `
      <div class="bg-gray-800/30 rounded-xl p-4 border border-gray-800">
        <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-4 flex items-center gap-2">
          <i class="fas fa-globe text-blue-400"></i>
          Top Countries
          <span class="text-xs font-normal text-gray-500 normal-case ml-auto">by artist count</span>
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          ${topCountries.map((c, i) => countryBar(c, maxCountryCount, i + 1)).join('')}
        </div>
      </div>
      `
          : ''
      }

      <!-- Connected Services -->
      ${
        (spotifyValid && spotifyRanges.length > 0) ||
        (lastfmValid && (lastfmRanges.length > 0 || lastfmScrobbles > 0))
          ? `
      <div class="space-y-6">
        <!-- Spotify Section -->
        ${
          spotifyValid && spotifyRanges.length > 0
            ? `
        <div class="bg-gray-800/30 rounded-xl p-4 border border-gray-800">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide flex items-center gap-2">
              <i class="fab fa-spotify text-green-500"></i>
              Spotify
              ${prefs.spotify?.syncedAt ? `<span class="text-xs font-normal text-gray-500 normal-case">${getRelativeTime(prefs.spotify.syncedAt)}</span>` : ''}
            </h4>
            <div class="flex gap-1.5" id="spotifyRangeButtons">
              ${spotifyRanges.map((r) => timeRangeButton(TIME_RANGE_LABELS[r], r, 'spotify', r === defaultSpotifyRange)).join('')}
            </div>
          </div>
          
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Spotify Artists -->
            <div>
              <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <i class="fas fa-user-friends"></i>
                Top Artists
              </h5>
              ${spotifyRanges
                .map(
                  (range) => `
                <div id="spotify-artists-${range}" class="space-y-0.5 ${range !== defaultSpotifyRange ? 'hidden' : ''}" data-service="spotify" data-type="artists" data-range="${range}" data-content="true">
                  ${(spotifyArtistsByRange[range] || [])
                    .slice(0, 8)
                    .map((a, i) => {
                      const country = artistCountries[a.name]?.country || null;
                      const maxRank = (spotifyArtistsByRange[range] || [])
                        .length;
                      return serviceArtistBar(
                        a.name,
                        maxRank - i,
                        maxRank,
                        i + 1,
                        'spotify',
                        country
                      );
                    })
                    .join('')}
                </div>
              `
                )
                .join('')}
            </div>
            
            <!-- Spotify Tracks -->
            <div>
              <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                <i class="fas fa-music"></i>
                Top Tracks
              </h5>
              ${spotifyRanges
                .map(
                  (range) => `
                <div id="spotify-tracks-${range}" class="space-y-0.5 ${range !== defaultSpotifyRange ? 'hidden' : ''}" data-service="spotify" data-type="tracks" data-range="${range}" data-content="true">
                  ${(spotifyTracksByRange[range] || [])
                    .slice(0, 8)
                    .map((t, i) => trackBar(t, i + 1))
                    .join('')}
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
        `
            : ''
        }

        <!-- Last.fm Section -->
        ${
          lastfmValid && (lastfmRanges.length > 0 || lastfmScrobbles > 0)
            ? `
        <div class="bg-gray-800/30 rounded-xl p-4 border border-gray-800">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h4 class="text-sm font-semibold text-white uppercase tracking-wide flex items-center gap-2">
              <i class="fab fa-lastfm text-red-500"></i>
              Last.fm
              ${prefs.lastfm?.syncedAt ? `<span class="text-xs font-normal text-gray-500 normal-case">${getRelativeTime(prefs.lastfm.syncedAt)}</span>` : ''}
              ${lastfmScrobbles > 0 ? `<span class="text-xs font-normal text-gray-500 normal-case">· ${lastfmScrobbles.toLocaleString()} scrobbles</span>` : ''}
            </h4>
            <div class="flex gap-1.5 flex-wrap" id="lastfmRangeButtons">
              ${lastfmRanges.map((r) => timeRangeButton(TIME_RANGE_LABELS[r], r, 'lastfm', r === defaultLastfmRange)).join('')}
            </div>
          </div>
          
          <div>
            <h5 class="text-xs text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
              <i class="fas fa-user-friends"></i>
              Top Artists
              <span class="text-gray-500 font-normal normal-case">(by play count)</span>
            </h5>
            ${lastfmRanges
              .map(
                (range) => `
              <div id="lastfm-artists-${range}" class="space-y-0.5 ${range !== defaultLastfmRange ? 'hidden' : ''}" data-service="lastfm" data-type="artists" data-range="${range}" data-content="true">
                ${(lastfmArtistsByRange[range] || [])
                  .slice(0, 8)
                  .map((a, i) => {
                    const country = artistCountries[a.name]?.country || null;
                    const maxPlaycount =
                      (lastfmArtistsByRange[range] || [])[0]?.playcount || 1;
                    return serviceArtistBar(
                      a.name,
                      a.playcount || 0,
                      maxPlaycount,
                      i + 1,
                      'lastfm',
                      country
                    );
                  })
                  .join('')}
              </div>
            `
              )
              .join('')}
          </div>
        </div>
        `
            : ''
        }
      </div>
      `
          : ''
      }

      <!-- Data Sources Footer -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-800">
        <div class="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span class="uppercase tracking-wide">Sources:</span>
          ${hasListData ? `<span class="flex items-center gap-1.5 text-gray-400"><i class="fas fa-list"></i> ${prefs.totalAlbums} albums</span>` : ''}
          ${hasSpotifyData ? `<span class="flex items-center gap-1.5 text-green-400"><i class="fab fa-spotify"></i> Connected</span>` : ''}
          ${hasLastfmData ? `<span class="flex items-center gap-1.5 text-red-400"><i class="fab fa-lastfm"></i> Connected</span>` : ''}
        </div>
      </div>
    </div>
  `,
    'lg:col-span-2'
  );
};

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

// Admin Events Dashboard Section
const adminEventsSection = () =>
  settingsCard(
    'Admin Actions Required',
    'fas fa-clipboard-list text-orange-500',
    `
    <div id="adminEventsContainer">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-400">Filter:</span>
          <select id="eventTypeFilter" class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white" onchange="loadAdminEvents()">
            <option value="">All Types</option>
            <option value="account_approval">Account Approvals</option>
          </select>
          <select id="eventPriorityFilter" class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white" onchange="loadAdminEvents()">
            <option value="">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <button onclick="loadAdminEvents()" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition flex items-center gap-2">
          <i class="fas fa-sync-alt"></i> Refresh
        </button>
      </div>
      
      <div id="adminEventsList" class="space-y-3">
        <div class="text-center py-8">
          <i class="fas fa-spinner fa-spin text-gray-500 text-xl"></i>
          <p class="text-gray-400 mt-2">Loading events...</p>
        </div>
      </div>
      
      <div id="noEventsMessage" class="hidden text-center py-8">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
          <i class="fas fa-check-circle text-2xl text-green-500"></i>
        </div>
        <p class="text-gray-300 font-medium">All caught up!</p>
        <p class="text-sm text-gray-500">No pending admin actions</p>
      </div>
      
      <div class="mt-4 pt-4 border-t border-gray-800">
        <button onclick="showEventHistory()" class="text-sm text-gray-400 hover:text-white transition flex items-center gap-2">
          <i class="fas fa-history"></i> View History
        </button>
      </div>
    </div>
  `,
    'lg:col-span-full'
  );

// Admin Notifications Section (integrations row style like Music Services)
const adminNotificationsSection = () =>
  settingsCard(
    'Admin Notifications',
    'fas fa-bell text-yellow-500',
    `
    <div class="space-y-4">
      <!-- Telegram Integration Row (like Spotify/Tidal/Last.fm) -->
      <div id="telegramIntegrationRow" class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-gray-800 rounded-lg">
        <div class="flex items-center gap-3">
          <i class="fab fa-telegram text-blue-400 text-xl"></i>
          <div>
            <span class="text-white font-medium">Telegram</span>
            <div id="telegramStatusText" class="text-sm text-gray-500">Checking status...</div>
          </div>
        </div>
        <div id="telegramActionButtons" class="flex items-center gap-3">
          <!-- Buttons populated by JS based on state -->
          <span class="text-gray-500 text-sm"><i class="fas fa-spinner fa-spin"></i></span>
        </div>
      </div>
      
      <p class="text-xs text-gray-500">
        <i class="fas fa-info-circle mr-1"></i>
        Receive instant notifications for admin events and take quick actions directly from Telegram.
      </p>
    </div>
  `,
    ''
  );

// Telegram Setup Modal (standalone, not in a settingsCard)
const telegramSetupModal = () => `
  <div id="telegramModal" class="hidden fixed inset-0 bg-black bg-opacity-70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto transform transition-all">
      <!-- Header -->
      <div class="p-6 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-semibold text-white flex items-center gap-3">
            <i class="fab fa-telegram text-blue-400"></i>
            Configure Telegram
          </h3>
          <button onclick="closeTelegramModal()" class="text-gray-400 hover:text-white transition-colors">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      
      <!-- Content -->
      <div class="p-6 space-y-6">
        <!-- Step 1: Bot Token -->
        <div id="telegramModalStep1" class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white">1</span>
            Create a Telegram Bot
          </h4>
          <ol class="text-sm text-gray-400 mb-4 space-y-1 list-decimal list-inside">
            <li>Open Telegram and message <a href="https://t.me/BotFather" target="_blank" class="text-blue-400 hover:underline">@BotFather</a></li>
            <li>Send <code class="bg-gray-800 px-1.5 py-0.5 rounded text-xs">/newbot</code> and follow the prompts</li>
            <li>Copy the bot token and paste it below</li>
          </ol>
          <div class="flex gap-2">
            <input 
              type="password" 
              id="telegramBotToken" 
              placeholder="Paste your bot token here..."
              class="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            >
            <button onclick="validateTelegramToken()" id="validateTokenBtn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center gap-2">
              <i class="fas fa-check"></i> Validate
            </button>
          </div>
          <div id="tokenValidationResult" class="mt-2 text-sm hidden"></div>
        </div>
        
        <!-- Step 2: Select Group -->
        <div id="telegramModalStep2" class="bg-gray-800/50 rounded-lg p-4 border border-gray-700 opacity-50 pointer-events-none">
          <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
            <span id="step2Badge" class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">2</span>
            Connect to Admin Group
          </h4>
          <p class="text-sm text-gray-400 mb-4">
            Add your bot to an admin-only group, then send any message in the group and click Detect.
          </p>
          <div class="flex gap-2 mb-3">
            <button onclick="detectTelegramGroups()" id="detectGroupsBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition flex items-center gap-2">
              <i class="fas fa-search"></i> Detect Groups
            </button>
          </div>
          <select id="telegramGroupSelect" class="w-full bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-2 focus:outline-none focus:border-gray-500 hidden">
            <option value="">Select a group...</option>
          </select>
          <div id="groupSelectResult" class="mt-2 text-sm hidden"></div>
        </div>
        
        <!-- Step 3: Select Topic (for forum groups) -->
        <div id="telegramModalStep3" class="bg-gray-800/50 rounded-lg p-4 border border-gray-700 opacity-50 pointer-events-none hidden">
          <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">3</span>
            Select Topic (Optional)
          </h4>
          <p class="text-sm text-gray-400 mb-4">
            This group has Topics enabled. Select a topic for notifications or use General.
          </p>
          <select id="telegramTopicSelect" class="w-full bg-gray-800 border border-gray-700 rounded-lg text-white px-4 py-2 focus:outline-none focus:border-gray-500">
            <option value="">General (default)</option>
          </select>
        </div>
        
        <!-- Step 4: Test & Save -->
        <div id="telegramModalStep4" class="bg-gray-800/50 rounded-lg p-4 border border-gray-700 opacity-50 pointer-events-none">
          <h4 class="text-sm font-semibold text-white uppercase tracking-wide mb-3 flex items-center gap-2">
            <span id="step4Badge" class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">4</span>
            Test & Activate
          </h4>
          <div id="telegramSaveResult" class="mb-3 text-sm hidden"></div>
          <div class="flex flex-wrap gap-2">
            <button onclick="sendTelegramTestFromModal()" id="telegramTestBtn" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition flex items-center gap-2">
              <i class="fas fa-paper-plane"></i> Send Test
            </button>
            <button onclick="saveTelegramConfig()" id="telegramSaveBtn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition flex items-center gap-2">
              <i class="fas fa-save"></i> Save & Enable
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

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
    
    <!-- Aggregate List Management -->
    <div class="mb-8">
      <h4 class="text-lg font-semibold text-white mb-4">
        <i class="fas fa-trophy mr-2 text-yellow-500"></i>Aggregate List (Album of the Year)
      </h4>
      <div id="aggregateListAdmin" class="space-y-4">
        <div class="text-center py-4">
          <i class="fas fa-spinner fa-spin text-gray-500"></i>
          <span class="text-gray-400 ml-2">Loading aggregate list data...</span>
        </div>
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
  const {
    user,
    userStats,
    stats,
    adminData,
    flash,
    spotifyValid,
    tidalValid,
    lastfmValid,
    lastfmUsername,
    musicPreferences,
  } = options;

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
      /* Push entire app below status bar/notch on iOS - top only */
      body {
        padding-top: constant(safe-area-inset-top); /* iOS 11.0-11.2 */
        padding-top: env(safe-area-inset-top); /* iOS 11.2+ */
        /* Bottom safe area handled by individual elements */
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
<body class="bg-gray-900 text-gray-200 overflow-hidden">
  <div class="h-screen flex flex-col">
    ${headerComponent(user, 'settings')}
    
    <main class="flex-1 overflow-y-auto overflow-x-hidden min-h-0 pt-4 lg:pt-6">
      <div class="container mx-auto px-2 lg:px-4 py-6 lg:py-8 max-w-7xl">
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
          ${musicServicesSection(user, spotifyValid, tidalValid, lastfmValid, lastfmUsername)}
          ${statisticsSection(userStats)}
          
          ${user.role !== 'admin' ? adminRequestSection(req) : ''}
        </div>
        
        <!-- Music Preferences (Full Width) -->
        <div class="lg:col-span-2">
          ${musicPreferencesSection(musicPreferences, spotifyValid, lastfmValid)}
        </div>
        
        <!-- Admin Events Dashboard (Admin Only, Full Width) -->
        ${user.role === 'admin' ? adminEventsSection() : ''}
        
        <!-- Admin Notifications (Admin Only) -->
        ${user.role === 'admin' ? adminNotificationsSection() : ''}
        
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
  
  <!-- Telegram Setup Modal -->
  ${user.role === 'admin' ? telegramSetupModal() : ''}
  
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

    // Sync music preferences
    async function syncPreferences() {
      const syncBtn = document.getElementById('syncBtn');
      const syncIcon = document.getElementById('syncIcon');
      const syncText = document.getElementById('syncText');
      
      if (!syncBtn || syncBtn.disabled) return;
      
      // Show loading state
      syncBtn.disabled = true;
      if (syncIcon) syncIcon.classList.add('fa-spin');
      if (syncText) syncText.textContent = 'Syncing...';
      
      try {
        const response = await fetch('/api/preferences/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin'
        });

        const data = await response.json();

        if (data.success) {
          showToast('Preferences synced successfully!');
          setTimeout(() => location.reload(), 1000);
        } else {
          showToast(data.message || 'Sync completed with some errors', 'error');
          setTimeout(() => location.reload(), 1500);
        }
      } catch (error) {
        console.error('Error syncing preferences:', error);
        showToast('Error syncing preferences', 'error');
        
        // Reset button state
        syncBtn.disabled = false;
        if (syncIcon) syncIcon.classList.remove('fa-spin');
        if (syncText) syncText.textContent = 'Sync Now';
      }
    }

    // Time range selector for Spotify/Last.fm data
    function setTimeRange(service, range) {
      // Update button states
      const buttonContainer = document.getElementById(service + 'RangeButtons');
      if (buttonContainer) {
        const buttons = buttonContainer.querySelectorAll('button');
        buttons.forEach(btn => {
          const btnRange = btn.getAttribute('data-range');
          const isActive = btnRange === range;
          const activeClass = service === 'spotify' ? 'bg-green-600 text-white' : 'bg-red-600 text-white';
          const inactiveClass = 'bg-gray-700 text-gray-300 hover:bg-gray-600';
          
          // Remove all state classes
          btn.classList.remove('bg-green-600', 'bg-red-600', 'bg-gray-700', 'text-white', 'text-gray-300', 'hover:bg-gray-600');
          
          // Add appropriate classes
          if (isActive) {
            activeClass.split(' ').forEach(c => btn.classList.add(c));
          } else {
            inactiveClass.split(' ').forEach(c => btn.classList.add(c));
          }
        });
      }
      
      // Show/hide data sections (only target elements with data-content attribute, not buttons)
      const allSections = document.querySelectorAll('[data-service="' + service + '"][data-content]');
      allSections.forEach(section => {
        const sectionRange = section.getAttribute('data-range');
        if (sectionRange === range) {
          section.classList.remove('hidden');
        } else {
          section.classList.add('hidden');
        }
      });
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
      
      // ============ AGGREGATE LIST FUNCTIONS ============
      
      // Load aggregate list admin panel data
      async function loadAggregateListAdmin() {
        const container = document.getElementById('aggregateListAdmin');
        if (!container) return;
        
        try {
          // Get years that have main lists
          const yearsRes = await fetch('/api/aggregate-list-years/with-main-lists', {
            credentials: 'same-origin'
          });
          
          if (!yearsRes.ok) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No main lists found. Users need to mark their lists as "main" for a specific year.</p>';
            return;
          }
          
          const yearsData = await yearsRes.json();
          const years = yearsData.years || [];
          
          if (years.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No main lists found. Users need to mark their lists as "main" for a specific year.</p>';
            return;
          }
          
          let html = '';
          
          for (const year of years) {
            try {
              // Get status
              const statusRes = await fetch(\`/api/aggregate-list/\${year}/status\`, {
                credentials: 'same-origin'
              });
              
              let status = { exists: false, revealed: false, confirmations: [], confirmationCount: 0, requiredConfirmations: 2 };
              if (statusRes.ok) {
                status = await statusRes.json();
              }
              
              // Get stats
              let stats = null;
              try {
                const statsRes = await fetch(\`/api/aggregate-list/\${year}/stats\`, {
                  credentials: 'same-origin'
                });
                if (statsRes.ok) {
                  const statsData = await statsRes.json();
                  stats = statsData.stats;
                }
              } catch (e) {}
              
              html += renderAggregateListYear(year, status, stats);
            } catch (e) {
              console.error(\`Error loading aggregate list for \${year}:\`, e);
            }
          }
          
          container.innerHTML = html || '<p class="text-gray-500 text-sm">No aggregate list data available.</p>';
        } catch (error) {
          console.error('Error loading aggregate list admin:', error);
          container.innerHTML = '<p class="text-red-400">Error loading aggregate list data</p>';
        }
      }
      
      function renderAggregateListYear(year, status, stats) {
        const isRevealed = status.revealed;
        const confirmCount = status.confirmationCount || 0;
        const required = status.requiredConfirmations || 2;
        
        let statusBadge = '';
        if (isRevealed) {
          statusBadge = '<span class="px-2 py-1 bg-green-900/50 text-green-400 text-xs rounded">Revealed</span>';
        } else if (confirmCount > 0) {
          statusBadge = \`<span class="px-2 py-1 bg-yellow-900/50 text-yellow-400 text-xs rounded">\${confirmCount}/\${required} Confirmations</span>\`;
        } else {
          statusBadge = '<span class="px-2 py-1 bg-gray-700 text-gray-400 text-xs rounded">Pending</span>';
        }
        
        let statsHtml = '';
        if (stats && !isRevealed) {
          statsHtml = \`
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-center text-sm">
              <div class="bg-gray-800 rounded p-2">
                <div class="font-bold text-white">\${stats.participantCount || 0}</div>
                <div class="text-xs text-gray-500">Contributors</div>
              </div>
              <div class="bg-gray-800 rounded p-2">
                <div class="font-bold text-white">\${stats.totalAlbums || 0}</div>
                <div class="text-xs text-gray-500">Albums</div>
              </div>
              <div class="bg-gray-800 rounded p-2">
                <div class="font-bold text-white">\${stats.albumsWith3PlusVoters || 0}</div>
                <div class="text-xs text-gray-500">3+ Votes</div>
              </div>
              <div class="bg-gray-800 rounded p-2">
                <div class="font-bold text-white">\${stats.albumsWith2Voters || 0}</div>
                <div class="text-xs text-gray-500">2 Votes</div>
              </div>
            </div>
          \`;
        }
        
        let confirmationsHtml = '';
        if (status.confirmations && status.confirmations.length > 0) {
          confirmationsHtml = '<div class="mt-2 text-sm">' +
            status.confirmations.map(c => 
              \`<span class="inline-flex items-center gap-1 text-green-400 mr-3"><i class="fas fa-check-circle"></i>\${c.username}</span>\`
            ).join('') +
          '</div>';
        }
        
        let actionsHtml = '';
        // Always show Manage Contributors button for admins (even after reveal for reference)
        actionsHtml += \`<button onclick="showContributorManager(\${year})" class="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm transition inline-flex items-center gap-2"><i class="fas fa-users"></i>Manage Contributors</button> \`;
        
        if (isRevealed) {
          actionsHtml += \`<a href="/aggregate-list/\${year}" class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm transition inline-flex items-center gap-2"><i class="fas fa-eye"></i>View List</a> \`;
          actionsHtml += \`<button onclick="resetRevealExperience(\${year})" class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm transition inline-flex items-center gap-2" title="Reset your reveal view status to experience the dramatic reveal again"><i class="fas fa-undo"></i>Reset Reveal</button>\`;
        } else {
          const hasConfirmed = status.confirmations && status.confirmations.some(c => c.username === '${user.username}');
          if (hasConfirmed) {
            actionsHtml += \`<button onclick="revokeAggregateListConfirm(\${year})" class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm transition inline-flex items-center gap-2"><i class="fas fa-times"></i>Revoke</button>\`;
          } else {
            actionsHtml += \`<button onclick="confirmAggregateListReveal(\${year})" class="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition inline-flex items-center gap-2"><i class="fas fa-check"></i>Confirm Reveal</button>\`;
          }
          actionsHtml += \` <a href="/aggregate-list/\${year}" class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm transition inline-flex items-center gap-2"><i class="fas fa-external-link-alt"></i>Open Page</a>\`;
        }
        
        return \`
          <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div class="flex items-center justify-between mb-2">
              <h5 class="text-lg font-bold text-white">\${year}</h5>
              \${statusBadge}
            </div>
            \${confirmationsHtml}
            \${statsHtml}
            <div class="mt-3 flex flex-wrap gap-2">
              \${actionsHtml}
            </div>
            <div id="contributors-\${year}" class="hidden mt-4 pt-4 border-t border-gray-700"></div>
          </div>
        \`;
      }
      
      async function confirmAggregateListReveal(year) {
        if (!confirm(\`Confirm reveal of Aggregate List \${year}? This action contributes to revealing the list to everyone.\`)) return;
        
        try {
          const response = await fetch(\`/api/aggregate-list/\${year}/confirm\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            if (data.revealed) {
              showToast(\`Aggregate List \${year} has been revealed!\`);
            } else {
              showToast('Confirmation added. Waiting for more confirmations.');
            }
            loadAggregateListAdmin();
          } else {
            showToast(data.error || 'Error confirming reveal', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error confirming reveal', 'error');
        }
      }
      
      async function revokeAggregateListConfirm(year) {
        if (!confirm('Revoke your confirmation?')) return;
        
        try {
          const response = await fetch(\`/api/aggregate-list/\${year}/confirm\`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Confirmation revoked');
            loadAggregateListAdmin();
          } else {
            showToast(data.error || 'Error revoking confirmation', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error revoking confirmation', 'error');
        }
      }
      
      // Reset reveal experience (for testing the dramatic fog reveal)
      async function resetRevealExperience(year) {
        if (!confirm(\`Reset your reveal experience for \${year}? You will see the dramatic burning reveal again when you visit the aggregate list page.\`)) return;
        
        try {
          const response = await fetch(\`/api/aggregate-list/\${year}/reset-seen\`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            if (data.deleted) {
              showToast(\`Reveal experience reset for \${year}. Visit the aggregate list page to see the dramatic reveal!\`);
            } else {
              showToast(\`No view record found for \${year} - you haven't seen the reveal yet.\`);
            }
          } else {
            showToast(data.error || 'Error resetting reveal experience', 'error');
          }
        } catch (error) {
          console.error('Error:', error);
          showToast('Error resetting reveal experience', 'error');
        }
      }
      
      // ============ CONTRIBUTOR MANAGEMENT ============
      
      async function showContributorManager(year) {
        const container = document.getElementById(\`contributors-\${year}\`);
        if (!container) return;
        
        // Toggle visibility
        if (!container.classList.contains('hidden')) {
          container.classList.add('hidden');
          return;
        }
        
        container.classList.remove('hidden');
        container.innerHTML = '<div class="text-center py-2"><i class="fas fa-spinner fa-spin text-gray-500"></i> Loading eligible users...</div>';
        
        try {
          const response = await fetch(\`/api/aggregate-list/\${year}/eligible-users\`, {
            credentials: 'same-origin'
          });
          
          if (!response.ok) {
            throw new Error('Failed to load eligible users');
          }
          
          const data = await response.json();
          const eligibleUsers = data.eligibleUsers || [];
          
          if (eligibleUsers.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No users have main lists for this year.</p>';
            return;
          }
          
          const contributorCount = eligibleUsers.filter(u => u.is_contributor).length;
          
          let html = \`
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm text-gray-400">
                <i class="fas fa-users mr-1"></i>
                <span id="contributor-count-\${year}">\${contributorCount}</span> of \${eligibleUsers.length} users selected as contributors
              </span>
              <div class="flex gap-2">
                <button onclick="selectAllContributors(\${year})" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">Select All</button>
                <button onclick="deselectAllContributors(\${year})" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">Deselect All</button>
              </div>
            </div>
            <div class="space-y-2 max-h-64 overflow-y-auto" id="user-list-\${year}">
          \`;
          
          for (const user of eligibleUsers) {
            const isChecked = user.is_contributor ? 'checked' : '';
            html += \`
              <label class="flex items-center gap-3 p-2 bg-gray-900 rounded cursor-pointer hover:bg-gray-800 transition">
                <input type="checkbox" 
                       class="contributor-checkbox w-5 h-5 rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 focus:ring-offset-gray-900"
                       data-year="\${year}" 
                       data-user-id="\${user.user_id}" 
                       \${isChecked}
                       onchange="toggleContributor(\${year}, '\${user.user_id}', this.checked)">
                <div class="flex-1">
                  <span class="text-white font-medium">\${user.username}</span>
                  <span class="text-gray-500 text-sm ml-2">(\${user.album_count} albums)</span>
                </div>
                <span class="text-xs text-gray-600">\${user.list_name}</span>
              </label>
            \`;
          }
          
          html += '</div>';
          container.innerHTML = html;
          
        } catch (error) {
          console.error('Error loading contributor manager:', error);
          container.innerHTML = '<p class="text-red-400 text-sm">Error loading users</p>';
        }
      }
      
      async function toggleContributor(year, userId, isContributor) {
        try {
          let response;
          if (isContributor) {
            response = await fetch(\`/api/aggregate-list/\${year}/contributors\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ userId })
            });
          } else {
            response = await fetch(\`/api/aggregate-list/\${year}/contributors/\${userId}\`, {
              method: 'DELETE',
              credentials: 'same-origin'
            });
          }
          
          const data = await response.json();
          
          if (data.success) {
            // Update the contributor count
            updateContributorCount(year);
            // Refresh the aggregate list stats
            loadAggregateListAdmin();
          } else {
            showToast(data.error || 'Error updating contributor', 'error');
            // Revert checkbox
            const checkbox = document.querySelector(\`input[data-year="\${year}"][data-user-id="\${userId}"]\`);
            if (checkbox) checkbox.checked = !isContributor;
          }
        } catch (error) {
          console.error('Error toggling contributor:', error);
          showToast('Error updating contributor', 'error');
          // Revert checkbox
          const checkbox = document.querySelector(\`input[data-year="\${year}"][data-user-id="\${userId}"]\`);
          if (checkbox) checkbox.checked = !isContributor;
        }
      }
      
      function updateContributorCount(year) {
        const checkboxes = document.querySelectorAll(\`input.contributor-checkbox[data-year="\${year}"]:checked\`);
        const countEl = document.getElementById(\`contributor-count-\${year}\`);
        if (countEl) {
          countEl.textContent = checkboxes.length;
        }
      }
      
      async function selectAllContributors(year) {
        const checkboxes = document.querySelectorAll(\`input.contributor-checkbox[data-year="\${year}"]\`);
        const userIds = Array.from(checkboxes).map(cb => cb.dataset.userId);
        
        try {
          const response = await fetch(\`/api/aggregate-list/\${year}/contributors\`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ userIds })
          });
          
          const data = await response.json();
          
          if (data.success) {
            checkboxes.forEach(cb => cb.checked = true);
            updateContributorCount(year);
            showToast(\`All \${userIds.length} users selected as contributors\`);
            loadAggregateListAdmin();
          } else {
            showToast(data.error || 'Error selecting all', 'error');
          }
        } catch (error) {
          console.error('Error selecting all:', error);
          showToast('Error selecting all contributors', 'error');
        }
      }
      
      async function deselectAllContributors(year) {
        try {
          const response = await fetch(\`/api/aggregate-list/\${year}/contributors\`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ userIds: [] })
          });
          
          const data = await response.json();
          
          if (data.success) {
            const checkboxes = document.querySelectorAll(\`input.contributor-checkbox[data-year="\${year}"]\`);
            checkboxes.forEach(cb => cb.checked = false);
            updateContributorCount(year);
            showToast('All contributors removed');
            loadAggregateListAdmin();
          } else {
            showToast(data.error || 'Error deselecting all', 'error');
          }
        } catch (error) {
          console.error('Error deselecting all:', error);
          showToast('Error deselecting all contributors', 'error');
        }
      }
      
      // Load aggregate list admin panel on page load
      loadAggregateListAdmin();
      
      // ============ ADMIN EVENTS FUNCTIONS ============
      
      async function loadAdminEvents() {
        const container = document.getElementById('adminEventsList');
        const noEventsMsg = document.getElementById('noEventsMessage');
        const typeFilter = document.getElementById('eventTypeFilter')?.value || '';
        const priorityFilter = document.getElementById('eventPriorityFilter')?.value || '';
        
        try {
          let url = '/api/admin/events?';
          if (typeFilter) url += \`type=\${typeFilter}&\`;
          if (priorityFilter) url += \`priority=\${priorityFilter}&\`;
          
          const response = await fetch(url, { credentials: 'same-origin' });
          const data = await response.json();
          
          if (!data.events || data.events.length === 0) {
            container.classList.add('hidden');
            noEventsMsg.classList.remove('hidden');
            return;
          }
          
          container.classList.remove('hidden');
          noEventsMsg.classList.add('hidden');
          
          container.innerHTML = data.events.map(event => renderAdminEvent(event)).join('');
        } catch (error) {
          console.error('Error loading admin events:', error);
          container.innerHTML = '<p class="text-red-400 text-center py-4">Error loading events</p>';
        }
      }
      
      function renderAdminEvent(event) {
        const priorityColors = {
          urgent: 'bg-red-900/50 border-red-700',
          high: 'bg-orange-900/30 border-orange-700',
          normal: 'bg-gray-800 border-gray-700',
          low: 'bg-gray-800/50 border-gray-700/50'
        };
        const priorityIcons = {
          urgent: 'text-red-500',
          high: 'text-orange-500',
          normal: 'text-yellow-500',
          low: 'text-gray-500'
        };
        
        const colorClass = priorityColors[event.priority] || priorityColors.normal;
        const iconClass = priorityIcons[event.priority] || priorityIcons.normal;
        const timeAgo = getRelativeTime(new Date(event.created_at));
        
        // Parse event data
        const eventData = typeof event.data === 'string' ? JSON.parse(event.data) : (event.data || {});
        
        // Build action buttons based on event type
        let actionButtons = '';
        if (event.event_type === 'account_approval') {
          actionButtons = \`
            <button onclick="executeEventAction('\${event.id}', 'approve')" class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition flex items-center gap-1">
              <i class="fas fa-check"></i> Approve
            </button>
            <button onclick="executeEventAction('\${event.id}', 'reject')" class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition flex items-center gap-1">
              <i class="fas fa-times"></i> Reject
            </button>
          \`;
        } else {
          actionButtons = \`
            <button onclick="executeEventAction('\${event.id}', 'dismiss')" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition flex items-center gap-1">
              <i class="fas fa-check"></i> Dismiss
            </button>
          \`;
        }
        
        return \`
          <div class="rounded-lg p-4 border \${colorClass}">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <i class="fas fa-circle text-xs \${iconClass}"></i>
                  <span class="text-xs text-gray-500 uppercase">\${event.priority}</span>
                  <span class="text-xs text-gray-600">•</span>
                  <span class="text-xs text-gray-500">\${event.event_type.replace('_', ' ')}</span>
                  <span class="text-xs text-gray-600">•</span>
                  <span class="text-xs text-gray-500">\${timeAgo}</span>
                </div>
                <h5 class="text-white font-medium mb-1">\${event.title}</h5>
                \${event.description ? \`<p class="text-sm text-gray-400">\${event.description}</p>\` : ''}
                \${eventData.username ? \`<p class="text-sm text-gray-500 mt-1">User: <span class="text-gray-300">\${eventData.username}</span></p>\` : ''}
                \${eventData.email ? \`<p class="text-sm text-gray-500">Email: <span class="text-gray-300">\${eventData.email}</span></p>\` : ''}
              </div>
              <div class="flex gap-2">
                \${actionButtons}
              </div>
            </div>
          </div>
        \`;
      }
      
      function getRelativeTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return \`\${diffMins}m ago\`;
        if (diffHours < 24) return \`\${diffHours}h ago\`;
        if (diffDays < 7) return \`\${diffDays}d ago\`;
        return date.toLocaleDateString();
      }
      
      async function executeEventAction(eventId, action) {
        try {
          const response = await fetch(\`/api/admin/events/\${eventId}/action/\${action}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast(data.message || 'Action completed');
            loadAdminEvents();
          } else {
            showToast(data.error || 'Error executing action', 'error');
          }
        } catch (error) {
          console.error('Error executing action:', error);
          showToast('Error executing action', 'error');
        }
      }
      
      async function showEventHistory() {
        // TODO: Implement event history modal
        showToast('Event history coming soon!');
      }
      
      // Load admin events on page load
      loadAdminEvents();
      
      // ============ TELEGRAM INTEGRATION FUNCTIONS ============
      
      let telegramBotInfo = null;
      let telegramSelectedGroup = null;
      let telegramConfigData = null;
      
      // Update the Telegram row in the Admin Notifications section
      function updateTelegramRow(data) {
        const statusText = document.getElementById('telegramStatusText');
        const actionButtons = document.getElementById('telegramActionButtons');
        
        if (!statusText || !actionButtons) return;
        
        if (data.configured && data.enabled) {
          telegramConfigData = data;
          const topicInfo = data.topicName ? \` → \${data.topicName}\` : '';
          statusText.innerHTML = \`<span class="text-green-500">Connected to \${data.chatTitle || 'Admin Group'}\${topicInfo}</span>\`;
          actionButtons.innerHTML = \`
            <span class="text-green-500 text-sm">Connected</span>
            <button onclick="sendTelegramTest()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
              Test
            </button>
            <button onclick="disconnectTelegram()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
              Disconnect
            </button>
          \`;
        } else {
          telegramConfigData = null;
          statusText.innerHTML = '<span class="text-gray-500">Not configured</span>';
          actionButtons.innerHTML = \`
            <button onclick="openTelegramModal()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
              Configure
            </button>
          \`;
        }
      }
      
      async function loadTelegramStatus() {
        try {
          const response = await fetch('/api/admin/telegram/status', { credentials: 'same-origin' });
          const data = await response.json();
          updateTelegramRow(data);
        } catch (error) {
          console.error('Error loading Telegram status:', error);
          const statusText = document.getElementById('telegramStatusText');
          const actionButtons = document.getElementById('telegramActionButtons');
          if (statusText) statusText.innerHTML = '<span class="text-red-400">Error loading status</span>';
          if (actionButtons) actionButtons.innerHTML = \`
            <button onclick="loadTelegramStatus()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition duration-200">
              Retry
            </button>
          \`;
        }
      }
      
      // Modal functions
      function openTelegramModal() {
        const modal = document.getElementById('telegramModal');
        if (modal) {
          modal.classList.remove('hidden');
          resetTelegramModalState();
        }
      }
      
      function closeTelegramModal() {
        const modal = document.getElementById('telegramModal');
        if (modal) modal.classList.add('hidden');
      }
      
      function resetTelegramModalState() {
        telegramBotInfo = null;
        telegramSelectedGroup = null;
        
        // Reset inputs
        const tokenInput = document.getElementById('telegramBotToken');
        if (tokenInput) tokenInput.value = '';
        
        const tokenResult = document.getElementById('tokenValidationResult');
        if (tokenResult) tokenResult.classList.add('hidden');
        
        const groupSelect = document.getElementById('telegramGroupSelect');
        if (groupSelect) {
          groupSelect.classList.add('hidden');
          groupSelect.innerHTML = '<option value="">Select a group...</option>';
        }
        
        const groupResult = document.getElementById('groupSelectResult');
        if (groupResult) groupResult.classList.add('hidden');
        
        const saveResult = document.getElementById('telegramSaveResult');
        if (saveResult) saveResult.classList.add('hidden');
        
        // Reset step states
        const step2 = document.getElementById('telegramModalStep2');
        const step3 = document.getElementById('telegramModalStep3');
        const step4 = document.getElementById('telegramModalStep4');
        
        if (step2) step2.classList.add('opacity-50', 'pointer-events-none');
        if (step3) {
          step3.classList.add('opacity-50', 'pointer-events-none', 'hidden');
        }
        if (step4) step4.classList.add('opacity-50', 'pointer-events-none');
      }
      
      async function validateTelegramToken() {
        const tokenInput = document.getElementById('telegramBotToken');
        const resultDiv = document.getElementById('tokenValidationResult');
        const token = tokenInput.value.trim();
        
        if (!token) {
          resultDiv.innerHTML = '<span class="text-red-400">Please enter a bot token</span>';
          resultDiv.classList.remove('hidden');
          return;
        }
        
        resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin text-gray-400"></i> Validating...';
        resultDiv.classList.remove('hidden');
        
        try {
          const response = await fetch('/api/admin/telegram/validate-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.valid) {
            telegramBotInfo = { token, ...data.bot };
            resultDiv.innerHTML = \`<span class="text-green-400"><i class="fas fa-check mr-1"></i> Valid - @\${data.bot.username}</span>\`;
            
            // Enable step 2
            const step2 = document.getElementById('telegramModalStep2');
            if (step2) {
              step2.classList.remove('opacity-50', 'pointer-events-none');
              const badge = document.getElementById('step2Badge');
              if (badge) badge.classList.replace('bg-gray-700', 'bg-blue-600');
            }
          } else {
            resultDiv.innerHTML = \`<span class="text-red-400"><i class="fas fa-times mr-1"></i> Invalid token: \${data.error || 'Unknown error'}</span>\`;
          }
        } catch (error) {
          console.error('Error validating token:', error);
          resultDiv.innerHTML = '<span class="text-red-400">Error validating token</span>';
        }
      }
      
      async function detectTelegramGroups() {
        if (!telegramBotInfo?.token) {
          showToast('Please validate your bot token first', 'error');
          return;
        }
        
        const selectEl = document.getElementById('telegramGroupSelect');
        const resultDiv = document.getElementById('groupSelectResult');
        
        resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin text-gray-400"></i> Detecting groups...';
        resultDiv.classList.remove('hidden');
        
        try {
          const response = await fetch('/api/admin/telegram/detect-groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: telegramBotInfo.token }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.groups && data.groups.length > 0) {
            selectEl.innerHTML = '<option value="">Select a group...</option>' +
              data.groups.map(g => \`<option value="\${g.id}" data-title="\${g.title}" data-forum="\${g.isForum}">\${g.title} (\${g.id})</option>\`).join('');
            selectEl.classList.remove('hidden');
            selectEl.onchange = onGroupSelected;
            resultDiv.innerHTML = \`<span class="text-green-400"><i class="fas fa-check mr-1"></i> Found \${data.groups.length} group(s)</span>\`;
          } else {
            resultDiv.innerHTML = '<span class="text-yellow-400"><i class="fas fa-exclamation-triangle mr-1"></i> No groups found. Add the bot to a group and send a message.</span>';
          }
        } catch (error) {
          console.error('Error detecting groups:', error);
          resultDiv.innerHTML = '<span class="text-red-400">Error detecting groups</span>';
        }
      }
      
      async function onGroupSelected() {
        const selectEl = document.getElementById('telegramGroupSelect');
        const selectedOption = selectEl.options[selectEl.selectedIndex];
        
        if (!selectedOption.value) {
          telegramSelectedGroup = null;
          return;
        }
        
        telegramSelectedGroup = {
          id: parseInt(selectedOption.value),
          title: selectedOption.dataset.title,
          isForum: selectedOption.dataset.forum === 'true'
        };
        
        const step3 = document.getElementById('telegramModalStep3');
        const step4 = document.getElementById('telegramModalStep4');
        
        if (telegramSelectedGroup.isForum) {
          if (step3) step3.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
          await loadGroupTopics();
        } else {
          if (step3) step3.classList.add('hidden');
        }
        
        if (step4) {
          step4.classList.remove('opacity-50', 'pointer-events-none');
          const badge = document.getElementById('step4Badge');
          if (badge) badge.classList.replace('bg-gray-700', 'bg-blue-600');
        }
      }
      
      async function loadGroupTopics() {
        if (!telegramBotInfo?.token || !telegramSelectedGroup) return;
        
        try {
          const response = await fetch('/api/admin/telegram/group-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              token: telegramBotInfo.token, 
              chatId: telegramSelectedGroup.id 
            }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.topics && data.topics.length > 0) {
            const selectEl = document.getElementById('telegramTopicSelect');
            if (selectEl) {
              selectEl.innerHTML = data.topics.map(t => 
                \`<option value="\${t.id || ''}">\${t.name}\${t.isGeneral ? ' (default)' : ''}</option>\`
              ).join('');
            }
          }
        } catch (error) {
          console.error('Error loading topics:', error);
        }
      }
      
      async function sendTelegramTest() {
        try {
          const response = await fetch('/api/admin/telegram/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Test message sent! Check your Telegram group.');
          } else {
            showToast(data.error || 'Failed to send test message', 'error');
          }
        } catch (error) {
          console.error('Error sending test:', error);
          showToast('Error sending test message', 'error');
        }
      }
      
      async function sendTelegramTestFromModal() {
        if (!telegramBotInfo?.token || !telegramSelectedGroup) {
          showToast('Please complete setup first', 'error');
          return;
        }
        
        const topicSelect = document.getElementById('telegramTopicSelect');
        const threadId = topicSelect?.value ? parseInt(topicSelect.value) : null;
        
        try {
          const response = await fetch('/api/admin/telegram/test-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: telegramBotInfo.token,
              chatId: telegramSelectedGroup.id,
              threadId: threadId
            }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Test message sent! Check your Telegram group.');
          } else {
            showToast(data.error || 'Failed to send test message', 'error');
          }
        } catch (error) {
          console.error('Error sending test:', error);
          showToast('Error sending test message', 'error');
        }
      }
      
      async function saveTelegramConfig() {
        if (!telegramBotInfo?.token || !telegramSelectedGroup) {
          showToast('Please complete all steps first', 'error');
          return;
        }
        
        const topicSelect = document.getElementById('telegramTopicSelect');
        const threadId = topicSelect?.value ? parseInt(topicSelect.value) : null;
        const topicName = topicSelect?.options[topicSelect.selectedIndex]?.text || null;
        
        const resultDiv = document.getElementById('telegramSaveResult');
        if (resultDiv) {
          resultDiv.innerHTML = '<i class="fas fa-spinner fa-spin text-gray-400"></i> Saving...';
          resultDiv.classList.remove('hidden');
        }
        
        try {
          const response = await fetch('/api/admin/telegram/save-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              botToken: telegramBotInfo.token,
              chatId: telegramSelectedGroup.id,
              threadId: threadId,
              chatTitle: telegramSelectedGroup.title,
              topicName: threadId ? topicName : null
            }),
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Telegram notifications enabled!');
            if (resultDiv) {
              resultDiv.innerHTML = '<span class="text-green-400"><i class="fas fa-check mr-1"></i> Saved successfully!</span>';
            }
            setTimeout(() => {
              closeTelegramModal();
              loadTelegramStatus();
            }, 1000);
          } else {
            if (resultDiv) {
              resultDiv.innerHTML = \`<span class="text-red-400"><i class="fas fa-times mr-1"></i> \${data.error}</span>\`;
            }
          }
        } catch (error) {
          console.error('Error saving config:', error);
          if (resultDiv) {
            resultDiv.innerHTML = '<span class="text-red-400">Error saving configuration</span>';
          }
        }
      }
      
      async function disconnectTelegram() {
        if (!confirm('Disconnect Telegram notifications?')) return;
        
        try {
          const response = await fetch('/api/admin/telegram/disconnect', {
            method: 'DELETE',
            credentials: 'same-origin'
          });
          
          const data = await response.json();
          
          if (data.success) {
            showToast('Telegram disconnected');
            telegramBotInfo = null;
            telegramSelectedGroup = null;
            telegramConfigData = null;
            loadTelegramStatus();
          } else {
            showToast(data.error || 'Error disconnecting', 'error');
          }
        } catch (error) {
          console.error('Error disconnecting:', error);
          showToast('Error disconnecting Telegram', 'error');
        }
      }
      
      // Load Telegram status on page load
      loadTelegramStatus();
    `
        : ''
    }
  </script>
</body>
</html>
  `;
};

module.exports = { settingsTemplate };
