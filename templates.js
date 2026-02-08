const { adjustColor, colorWithOpacity } = require('./color-utils');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
// Use a timestamp-based asset version to avoid browser caching issues
const assetVersion = process.env.ASSET_VERSION || Date.now().toString();
const asset = (p) => `${p}?v=${assetVersion}`;

// HTML escape function to prevent XSS in server-rendered templates
const escapeHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Safe JSON serialization for embedding in <script> tags
// Escapes </script> and <!-- sequences to prevent XSS breakout
const safeJsonStringify = (obj) => {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
};

const formatDate = (date, format = 'MM/DD/YYYY') => {
  if (!date) return '';
  const locale = format === 'DD/MM/YYYY' ? 'en-GB' : 'en-US';
  return new Date(date).toLocaleDateString(locale);
};

const formatDateTime = (date, hour12, format = 'MM/DD/YYYY') => {
  if (!date) return '';
  const locale = format === 'DD/MM/YYYY' ? 'en-GB' : 'en-US';
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  };
  return new Date(date).toLocaleString(locale, options);
};

const viewsDir = path.join(__dirname, 'views');
// Precompile EJS templates for caching
const layoutTemplateFn = ejs.compile(
  fs.readFileSync(path.join(viewsDir, 'layout.ejs'), 'utf8'),
  { filename: 'layout.ejs', cache: true }
);
const loginSnippetFn = ejs.compile(
  fs.readFileSync(path.join(viewsDir, 'login.ejs'), 'utf8'),
  { filename: 'login.ejs', cache: true }
);

// Shared header component
const headerComponent = (user, activeSection = 'home') => `
  <header class="bg-gray-900 z-50 border-b border-gray-700/50">
    <div class="relative flex items-center justify-between h-12 lg:h-14 px-3 lg:px-0">
      <!-- Mobile menu button -->
      <div class="flex items-center gap-2 lg:w-72 lg:justify-center lg:gap-0">
        ${
          activeSection === 'home'
            ? `
        <button onclick="toggleMobileMenu()" class="lg:hidden p-2 -m-2 text-gray-400 active:text-white touch-target">
          <i class="fas fa-bars text-lg"></i>
        </button>
        `
            : `
        <a href="/" class="lg:hidden p-2 -m-2 text-gray-400 active:text-white touch-target">
          <i class="fas fa-arrow-left text-lg"></i>
        </a>
        `
        }
        <a href="/" class="hidden lg:inline text-xl lg:text-2xl font-bold text-red-600 hover:text-red-500 transition duration-200">SuShe</a>
      </div>
      
      <!-- Current list name (mobile only) -->
      <span id="mobileCurrentListName" class="lg:hidden absolute left-1/2 -translate-x-1/2 text-base text-gray-300 font-medium truncate max-w-[60%] hidden"></span>
      
      <!-- User menu -->
      <div class="flex items-center pr-0.5 lg:pr-1">
        <button onclick="window.openAboutModal && window.openAboutModal()" class="p-2 -m-2 flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target" title="About" id="aboutButton">
          <i class="fas fa-info-circle text-lg"></i>
        </button>
        <button onclick="window.openSettingsDrawer && window.openSettingsDrawer()" class="p-2 -m-2 flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target ml-3 lg:ml-4" title="Settings" id="newSettingsButton">
          <i class="fas fa-sliders-h text-lg"></i>
        </button>
        <a href="/logout" class="p-2 -m-2 flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target ml-3 lg:ml-4" title="Logout">
          <i class="fas fa-sign-out-alt text-lg"></i>
        </a>
      </div>
    </div>
  </header>
`;

// Base HTML template rendered with EJS
const htmlTemplate = (content, title = 'SuShe Auth', user = null) =>
  layoutTemplateFn({
    content,
    title,
    user,
    asset,
    adjustColor,
    colorWithOpacity,
  });

// Registration form template - Updated with flash parameter
const registerTemplate = (req, flash) =>
  htmlTemplate(
    `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">Join SuShe Online</h1>
    </div>
    
    <form method="post" action="/register" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
          Email Address
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="email" 
          id="email"
          type="email" 
          placeholder="your@email.com" 
          required 
          autocomplete="email"
        />
      </div>
      
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="username">
          Username
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="username" 
          id="username"
          type="text" 
          placeholder="Choose a username" 
          required 
          autocomplete="username"
          minlength="3"
          maxlength="30"
        />
      </div>
      
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
          Password
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="password" 
          id="password"
          type="password" 
          placeholder="••••••••" 
          required 
          autocomplete="new-password"
          minlength="8"
        />
      </div>
      
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="confirmPassword">
          Confirm Password
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="confirmPassword" 
          id="confirmPassword"
          type="password" 
          placeholder="••••••••" 
          required 
          autocomplete="new-password"
          minlength="8"
        />
      </div>
      
      <button 
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-sm transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Create Account
      </button>
    </form>
    
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center flash-message" data-flash="error">${escapeHtml(flash.error[0])}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        Already have an account? 
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
`,
    'Join SuShe Online',
    null
  );

// Login form template rendered with EJS
const loginTemplate = (req, flash) =>
  loginSnippetFn({ req, flash, csrfToken: req.csrfToken() });

// Forgot password template - Updated with flash parameter
const forgotPasswordTemplate = (req, flash) => `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">Forgot password</h1>
    </div>
    
    <form method="post" action="/forgot" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="email">
          Email Address
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="email" 
          id="email"
          type="email" 
          placeholder="your@email.com" 
          required 
        />
      </div>
      <button 
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-sm transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset password
      </button>
    </form>
    
    ${flash.info && flash.info.length ? `<p class="text-blue-400 text-sm mt-4 text-center flash-message" data-flash="info">${escapeHtml(flash.info[0])}</p>` : ''}
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center flash-message" data-flash="error">${escapeHtml(flash.error[0])}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
`;

// Reset password template
const resetPasswordTemplate = (token, csrfToken = '') => `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">Reset Your Password</h1>
      <p class="text-gray-400 text-sm">Create a new password for your account</p>
    </div>
    
    <form method="post" action="/reset/${token}" class="space-y-6">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
          New Password
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden transition duration-200"
          name="password" 
          id="password"
          type="password" 
          placeholder="••••••••" 
          required 
          minlength="8"
        />
      </div>
      <button 
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-sm transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset Password
      </button>
    </form>
  </div>
`;

// Invalid token template
const invalidTokenTemplate = () => `
  <div class="bg-gray-900/90 backdrop-blur-xs border border-gray-800 rounded-lg p-8 shadow-2xl">
    <p class="text-red-500 text-center mb-4">This password reset link has expired or is invalid</p>
    <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request a new reset link</a>
  </div>
`;

// Component: Import Conflict Modal
const importConflictModalComponent = () => `
  <div id="importConflictModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">List Already Exists</h3>
        <p class="text-sm text-gray-400 mt-1">A list named "<span id="conflictListName" class="text-gray-300"></span>" already exists.</p>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6 space-y-4">
        <p class="text-gray-300 text-sm mb-4">What would you like to do?</p>
        
        <div class="space-y-3">
          <button 
            id="importOverwriteBtn"
            class="w-full text-left p-4 bg-gray-800 hover:bg-gray-700 rounded-sm border border-gray-700 hover:border-red-600 transition-colors group"
          >
            <div class="font-semibold text-white group-hover:text-red-500">Overwrite Existing List</div>
            <div class="text-xs text-gray-400 mt-1">Replace the current list with the imported one</div>
          </button>
          
          <button 
            id="importRenameBtn"
            class="w-full text-left p-4 bg-gray-800 hover:bg-gray-700 rounded-sm border border-gray-700 hover:border-red-600 transition-colors group"
          >
            <div class="font-semibold text-white group-hover:text-red-500">Rename Import</div>
            <div class="text-xs text-gray-400 mt-1">Save with a different name</div>
          </button>
          
          <button 
            id="importMergeBtn"
            class="w-full text-left p-4 bg-gray-800 hover:bg-gray-700 rounded-sm border border-gray-700 hover:border-red-600 transition-colors group"
          >
            <div class="font-semibold text-white group-hover:text-red-500">Merge Lists</div>
            <div class="text-xs text-gray-400 mt-1">Add imported albums to the existing list</div>
          </button>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800">
        <button 
          id="importCancelBtn" 
          class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel Import
        </button>
      </div>
    </div>
  </div>
  
  <!-- Rename Import Modal -->
  <div id="importRenameModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">Choose New Name</h3>
        <p class="text-sm text-gray-400 mt-1">Original name: <span id="originalImportName" class="text-gray-300"></span></p>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6">
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="importNewName">
          New List Name
        </label>
        <input 
          type="text" 
          id="importNewName" 
          placeholder="Enter new name..." 
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
          maxlength="50"
        >
        <p class="text-xs text-gray-500 mt-2">Choose a unique name for the imported list</p>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="cancelImportRenameBtn" 
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmImportRenameBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition duration-200 font-semibold"
        >
          Import with New Name
        </button>
      </div>
    </div>
  </div>
`;

// Component: Context Menus
const contextMenusComponent = () => `
  <!-- Context Menu for Lists -->
  <div id="contextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50">
    <button id="downloadListOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-download mr-2 w-4 text-center"></i>Download List...</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <button id="renameListOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-edit mr-2 w-4 text-center"></i>Edit Details
    </button>
    <button id="toggleMainOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-star mr-2 w-4 text-center"></i><span id="toggleMainText">Set as Main</span>
    </button>
    <button id="updatePlaylistOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-paper-plane mr-2 w-4 text-center"></i><span id="updatePlaylistText">Send to Music Service</span>
    </button>
    <button id="moveListOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-folder-open mr-2 w-4 text-center"></i>Move to Collection</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <button id="deleteListOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-trash mr-2 w-4 text-center"></i>Delete List
    </button>
  </div>
  
  <!-- Context Menu for Albums -->
  <div id="albumContextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50">
    <button id="editAlbumOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-edit mr-2 w-4 text-center"></i>Edit Details
    </button>
    <button id="playAlbumOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-play mr-2 w-4 text-center"></i>Play Album</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <button id="moveAlbumOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-arrow-right mr-2 w-4 text-center"></i>Move to List</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <button id="copyAlbumOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-copy mr-2 w-4 text-center"></i>Copy to List</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <!-- Recommend option (shown only for year-based lists) -->
    <button id="recommendAlbumOption" class="hidden w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-blue-400 transition-colors whitespace-nowrap">
      <i class="fas fa-thumbs-up mr-2 w-4 text-center text-blue-400"></i>Recommend
    </button>
    <!-- Last.fm Discovery Options (shown only when connected) -->
    <div id="lastfmMenuDivider" class="hidden context-menu-divider"></div>
    <button id="similarArtistsOption" class="hidden w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-users mr-2 w-4 text-center text-purple-400"></i>Show Similar Artists
    </button>
    <!-- Admin-only option to re-identify album from MusicBrainz -->
    <div id="adminMenuDivider" class="hidden context-menu-divider"></div>
    <button id="reidentifyAlbumOption" class="hidden w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-yellow-400 transition-colors whitespace-nowrap">
      <i class="fas fa-sync-alt mr-2 w-4 text-center text-yellow-400"></i>Re-identify Album
    </button>
    <div class="context-menu-divider"></div>
    <button id="removeAlbumOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-times mr-2 w-4 text-center"></i>Remove from List
    </button>
  </div>
  
  <!-- Submenu for Move to List - Years -->
  <div id="albumMoveSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-36">
    <!-- Populated dynamically with years -->
  </div>
  
  <!-- Submenu for Move to List - Lists within a year -->
  <div id="albumMoveListsSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-36">
    <!-- Populated dynamically with lists for selected year -->
  </div>
  
  <!-- Submenu for Copy to List -->
  <div id="albumCopySubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-36">
    <!-- Populated dynamically with available lists -->
  </div>
  
  <!-- Submenu for Play Album (Spotify Connect devices) -->
  <div id="playAlbumSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-44">
    <!-- Populated dynamically with devices -->
  </div>
  
  <!-- Submenu for Download List -->
  <div id="downloadListSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 min-w-44">
    <!-- Populated dynamically -->
  </div>
  
  <!-- Submenu for Move List to Collection -->
  <div id="moveListSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-44">
    <!-- Populated dynamically with collections -->
  </div>
  
  <!-- Context Menu for Recommendation Albums -->
  <div id="recommendationContextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50">
    <button id="playRecommendationOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-play mr-2 w-4 text-center"></i>Play Album</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <button id="addToListOption" class="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap relative">
      <span><i class="fas fa-plus mr-2 w-4 text-center"></i>Add to List...</span>
      <i class="fas fa-chevron-right text-xs text-gray-500 ml-4"></i>
    </button>
    <div class="recommendation-owner-divider hidden context-menu-divider"></div>
    <button id="editReasoningOption" class="hidden w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-edit mr-2 w-4 text-center"></i>Edit Reasoning
    </button>
    <div class="recommendation-admin-divider hidden context-menu-divider"></div>
    <button id="removeRecommendationOption" class="hidden w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-times mr-2 w-4 text-center"></i>Remove from Recommendations
    </button>
  </div>
  
  <!-- Submenu for Add to List - Years -->
  <div id="recommendationAddSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-36">
    <!-- Populated dynamically with years -->
  </div>
  
  <!-- Submenu for Add to List - Lists within a year -->
  <div id="recommendationAddListsSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-36">
    <!-- Populated dynamically with lists for selected year -->
  </div>
  
  <!-- Context Menu for Categories (Groups) -->
  <div id="categoryContextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50">
    <button id="renameCategoryOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-edit mr-2 w-4 text-center"></i>Rename
    </button>
    <button id="deleteCategoryOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-trash mr-2 w-4 text-center"></i>Delete
    </button>
  </div>
`;

// Component: Create List Modal
const createListModalComponent = () => `
  <div id="createListModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">Create New List</h3>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6 space-y-4">
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newListName">
            List Name <span class="text-red-500">*</span>
          </label>
          <input 
            type="text" 
            id="newListName" 
            placeholder="Enter list name..." 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
            maxlength="50"
          >
          <p class="text-xs text-gray-500 mt-2">Give your list a unique name</p>
        </div>
        
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newListCategory">
            Category <span class="text-red-500">*</span>
          </label>
          <select 
            id="newListCategory" 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white focus:outline-hidden focus:border-gray-500 transition duration-200 cursor-pointer"
          >
            <option value="" disabled selected>Select a category...</option>
            <!-- Options populated dynamically by JavaScript -->
          </select>
          <p class="text-xs text-gray-500 mt-2">Choose a year or collection for this list</p>
        </div>
        
        <!-- Dynamic input for new year (hidden by default) -->
        <div id="newYearInputContainer" class="hidden">
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newYearInput">
            New Year
          </label>
          <input 
            type="number" 
            id="newYearInput" 
            placeholder="e.g. 2025" 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
            min="1000"
            max="9999"
          >
        </div>
        
        <!-- Dynamic input for new collection (hidden by default) -->
        <div id="newCollectionInputContainer" class="hidden">
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newCollectionInput">
            Collection Name
          </label>
          <input 
            type="text" 
            id="newCollectionInput" 
            placeholder="e.g. Favorites, To Review..." 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
            maxlength="50"
          >
        </div>
        
        <p id="createCategoryError" class="text-xs text-red-500 hidden"></p>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="cancelCreateBtn" 
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmCreateBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition duration-200 font-semibold"
        >
          Create List
        </button>
      </div>
    </div>
  </div>
`;

// Component: Create Collection Modal
const createCollectionModalComponent = () => `
  <div id="createCollectionModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">Create Collection</h3>
        <p class="text-sm text-gray-400 mt-1">Collections let you organize lists without a year</p>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6 space-y-4">
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newCollectionName">
            Collection Name <span class="text-red-500">*</span>
          </label>
          <input 
            type="text" 
            id="newCollectionName" 
            placeholder="e.g. Favorites, To Review, Throwbacks..." 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
            maxlength="50"
          >
          <p class="text-xs text-gray-500 mt-2">Give your collection a unique name (cannot be a year)</p>
          <p id="createCollectionError" class="text-xs text-red-500 mt-1 hidden"></p>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="cancelCreateCollectionBtn" 
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmCreateCollectionBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition duration-200 font-semibold"
        >
          Create Collection
        </button>
      </div>
    </div>
  </div>
`;

// Component: Edit List Details Modal (formerly Rename List Modal)
const renameListModalComponent = () => `
  <div id="renameListModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">Edit List Details</h3>
        <p class="text-sm text-gray-400 mt-1">Editing: <span id="currentListName" class="text-gray-300"></span></p>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6 space-y-4">
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newListNameInput">
            List Name
          </label>
          <input 
            type="text" 
            id="newListNameInput" 
            placeholder="Enter new name..." 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
            maxlength="50"
          >
          <p class="text-xs text-gray-500 mt-2">Enter a new unique name for this list</p>
        </div>
        
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="editListYear">
            Year
          </label>
          <input 
            type="number" 
            id="editListYear" 
            placeholder="e.g. 2025 (optional)" 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-sm text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
            min="1000"
            max="9999"
          >
          <p class="text-xs text-gray-500 mt-2">Year this list represents (leave empty to remove)</p>
          <p id="editYearError" class="text-xs text-red-500 mt-1 hidden"></p>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="cancelRenameBtn" 
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmRenameBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition duration-200 font-semibold"
        >
          Save Changes
        </button>
      </div>
    </div>
  </div>
`;

// Component: Add Album Modal - Consolidated Version
const addAlbumModalComponent = () => `
  <div id="addAlbumModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center lg:p-4">
    <div class="bg-gray-900 border border-gray-800 lg:rounded-lg shadow-2xl w-full h-full lg:h-auto lg:max-w-4xl lg:max-h-[90vh] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <!-- Unified Header -->
      <div class="flex items-center justify-between p-4 lg:p-6 border-b border-gray-800">
        <button id="closeModalBtn" class="lg:hidden p-2 -m-2 text-gray-400 hover:text-white">
          <i class="fas fa-arrow-left text-xl"></i>
        </button>
        <h3 class="text-lg lg:text-2xl font-semibold lg:font-bold text-white flex-1 lg:flex-none text-center lg:text-left">
          Add Album
        </h3>
        <button id="closeModalBtnDesktop" class="hidden lg:block text-gray-400 hover:text-white transition duration-200">
          <i class="fas fa-times text-xl"></i>
        </button>
        <div class="lg:hidden w-10"></div>
      </div>
      
      <!-- Unified Content -->
      <div class="flex-1 overflow-hidden flex flex-col">
        <!-- Search Section -->
        <div id="searchSection" class="p-4 lg:p-6 border-b border-gray-800">
          <div class="max-w-2xl mx-auto space-y-3">
            <!-- Search mode toggle -->
            <div class="flex justify-center">
              <div class="inline-flex bg-gray-800 rounded-lg p-1">
                <button class="search-mode-btn px-4 py-2 text-sm font-medium rounded-md transition-colors active" data-mode="artist">
                  <i class="fas fa-user mr-2"></i>Artist
                </button>
                <button class="search-mode-btn px-4 py-2 text-sm font-medium rounded-md transition-colors" data-mode="album">
                  <i class="fas fa-compact-disc mr-2"></i>Album
                </button>
              </div>
            </div>
            
            <div class="flex flex-col lg:flex-row gap-3">
              <input 
                type="text" 
                id="artistSearchInput" 
                placeholder="Search for an artist..." 
                class="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
              >
              <button 
                id="searchArtistBtn" 
                class="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg transition duration-200 font-semibold whitespace-nowrap"
              >
                <i class="fas fa-search mr-2"></i>Search
              </button>
            </div>
            
            <button id="manualEntryBtn" class="w-full text-gray-400 hover:text-red-500 text-sm transition-colors py-2">
              Can't find your album? Add it manually →
            </button>
          </div>
        </div>
        
        <!-- Results Section -->
        <div class="flex-1 overflow-y-auto">
          <!-- Artist Results -->
          <div id="artistResults" class="hidden p-4 lg:p-6">
            <div class="max-w-4xl mx-auto">
              <h4 class="text-base lg:text-lg font-semibold text-gray-300 mb-3 lg:mb-4">Select an Artist</h4>
              <div id="artistList" class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <!-- Artist results will be populated here -->
              </div>
            </div>
          </div>
          
          <!-- Album Results -->
          <div id="albumResults" class="hidden">
            <div class="sticky top-0 bg-gray-900 p-4 lg:p-6 border-b border-gray-800 z-10 backdrop-blur-xs bg-opacity-95">
              <div class="max-w-4xl mx-auto">
                <button id="backToArtists" class="text-gray-400 hover:text-white flex items-center gap-2 transition-colors">
                  <i class="fas fa-arrow-left"></i>
                  <span>Back to artists</span>
                </button>
              </div>
            </div>
            
            <div class="p-4 lg:p-6">
              <div class="max-w-4xl mx-auto">
                <h4 class="text-base lg:text-lg font-semibold text-gray-300 mb-3 lg:mb-4">Select an Album</h4>
                <div id="albumList" class="grid grid-cols-2 lg:space-y-3 gap-3 lg:gap-0 lg:block">
                  <!-- Album results will be populated here -->
                </div>
              </div>
            </div>
          </div>
          
          <!-- Manual Entry Form -->
          <div id="manualEntryForm" class="hidden p-4 lg:p-6">
            <div class="max-w-2xl mx-auto">
              <div class="mb-4 lg:mb-6">
                <button id="backToSearch" class="text-gray-400 hover:text-white flex items-center gap-2 transition-colors">
                  <i class="fas fa-arrow-left"></i>
                  <span>Back to search</span>
                </button>
              </div>
              
              <h4 class="text-base lg:text-lg font-semibold text-gray-300 mb-4 lg:mb-6">Add Album Manually</h4>
              
              <form id="manualAlbumForm" class="space-y-4">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <!-- Artist Name -->
                  <div>
                    <label class="block text-gray-400 text-sm font-medium mb-2" for="manualArtist">
                      Artist Name <span class="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      id="manualArtist" 
                      name="artist"
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
                      placeholder="Enter artist name"
                      required
                    >
                  </div>
                  
                  <!-- Album Title -->
                  <div>
                    <label class="block text-gray-400 text-sm font-medium mb-2" for="manualAlbum">
                      Album Title <span class="text-red-500">*</span>
                    </label>
                    <input 
                      type="text" 
                      id="manualAlbum" 
                      name="album"
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
                      placeholder="Enter album title"
                      required
                    >
                  </div>
                  
                  <!-- Release Date -->
                  <div>
                    <label class="block text-gray-400 text-sm font-medium mb-2" for="manualReleaseDate">
                      Release Date
                    </label>
                    <input 
                      type="date" 
                      id="manualReleaseDate" 
                      name="release_date"
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200"
                    >
                  </div>
                  
                  <!-- Country -->
                  <div>
                    <label class="block text-gray-400 text-sm font-medium mb-2" for="manualCountry">
                      Country
                    </label>
                    <select 
                      id="manualCountry" 
                      name="country"
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-hidden focus:border-gray-500 transition duration-200"
                    >
                      <option value="">Select a country...</option>
                    </select>
                  </div>
                </div>
                
                <!-- Cover Art Upload -->
                <div>
                  <label class="block text-gray-400 text-sm font-medium mb-2">
                    Cover Art
                  </label>
                  <div class="flex items-start gap-4">
                    <div id="coverPreview" class="w-20 h-20 lg:w-32 lg:h-32 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700 shrink-0">
                      <i class="fas fa-image text-2xl text-gray-600 lg:hidden"></i>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600 hidden lg:block">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                        <polyline points="21 15 16 10 5 21"></polyline>
                      </svg>
                    </div>
                    <div class="flex-1">
                      <input 
                        type="file" 
                        id="manualCoverArt" 
                        name="cover_art"
                        accept="image/*"
                        class="hidden"
                      >
                      <button 
                        type="button"
                        onclick="document.getElementById('manualCoverArt').click()"
                        class="w-full lg:w-auto px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition duration-200"
                      >
                        <i class="fas fa-camera lg:fas lg:fa-upload mr-2"></i>Choose Image
                      </button>
                      <p class="text-xs text-gray-500 mt-1 lg:mt-2">Max 5MB</p>
                    </div>
                  </div>
                </div>
                
                <!-- Submit Buttons -->
                <div class="flex gap-3 justify-end pt-4 pb-safe">
                  <button 
                    type="button"
                    id="cancelManualEntry" 
                    class="flex-1 lg:flex-none px-4 lg:px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition duration-200"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    class="flex-1 lg:flex-none px-6 lg:px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition duration-200 font-semibold"
                  >
                    Add Album
                  </button>
                </div>
              </form>
            </div>
          </div>
          
          <!-- Loading State -->
          <div id="searchLoading" class="hidden text-center py-20">
            <div class="inline-block animate-spin rounded-full h-10 w-10 lg:h-12 lg:w-12 border-b-2 border-red-600"></div>
            <p class="text-gray-400 mt-4">Searching...</p>
          </div>
          
          <!-- Empty State -->
          <div id="searchEmpty" class="text-center py-20 text-gray-500 px-4">
            <i class="fas fa-search text-4xl lg:text-5xl mb-4 opacity-50"></i>
            <p class="text-base lg:text-lg">Search for an artist or album to add to your list</p>
            <p class="text-sm mt-2">Or add an album manually</p>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

// Component: Confirmation Modal
const confirmationModalComponent = () => `
  <div id="confirmationModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md transform transition-all">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 id="confirmationTitle" class="text-xl font-bold text-white">Confirm Action</h3>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6">
        <p id="confirmationMessage" class="text-gray-300"></p>
        <p id="confirmationSubMessage" class="text-sm text-gray-500 mt-2"></p>
        
        <!-- Optional checkbox for additional confirmation -->
        <div id="confirmationCheckboxContainer" class="hidden mt-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input 
              type="checkbox" 
              id="confirmationCheckbox" 
              class="mt-1 w-4 h-4 text-red-600 bg-gray-800 border-gray-600 rounded focus:ring-red-500 focus:ring-2"
            />
            <span id="confirmationCheckboxLabel" class="text-sm text-gray-400 select-none"></span>
          </label>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="confirmationCancelBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmationConfirmBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-sm transition duration-200 font-semibold"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
`;

// Component: Recommendation Reasoning Modal
const recommendReasoningModalComponent = () => `
  <div id="recommendReasoningModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md transform transition-all">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Why do you recommend this album?</h3>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6">
        <!-- Album info display -->
        <div class="flex items-center gap-4 mb-4 p-3 bg-gray-800 rounded-lg">
          <div id="reasoningAlbumCover" class="w-12 h-12 bg-gray-700 rounded-sm flex items-center justify-center">
            <i class="fas fa-compact-disc text-gray-500"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p id="reasoningAlbumTitle" class="text-white font-medium truncate"></p>
            <p id="reasoningArtistName" class="text-gray-400 text-sm truncate"></p>
          </div>
        </div>
        
        <!-- Reasoning textarea -->
        <div>
          <label class="block text-gray-400 text-sm font-medium mb-2" for="reasoningText">
            Your reasoning <span class="text-red-500">*</span>
          </label>
          <textarea 
            id="reasoningText" 
            rows="4"
            maxlength="500"
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-hidden focus:border-gray-500 transition duration-200 resize-none"
            placeholder="Tell others why they should listen to this album..."
          ></textarea>
          <div class="flex justify-between mt-2">
            <p id="reasoningError" class="text-red-400 text-sm hidden">Reasoning is required</p>
            <p class="text-gray-500 text-xs ml-auto">
              <span id="reasoningCharCount">0</span> / 500
            </p>
          </div>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="reasoningCancelBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="reasoningSubmitBtn" 
          class="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-sm transition duration-200 font-semibold"
        >
          Recommend
        </button>
      </div>
    </div>
  </div>
`;

// Component: View Reasoning Modal (read-only, small)
const viewReasoningModalComponent = () => `
  <div id="viewReasoningModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-sm transform transition-all">
      <!-- Modal Header -->
      <div class="p-4 border-b border-gray-800 flex items-center gap-3">
        <div id="viewReasoningAlbumCover" class="w-10 h-10 bg-gray-700 rounded-sm flex items-center justify-center overflow-hidden flex-shrink-0">
          <i class="fas fa-compact-disc text-gray-500"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p id="viewReasoningAlbumTitle" class="text-white font-medium truncate text-sm"></p>
          <p id="viewReasoningArtistName" class="text-gray-400 text-xs truncate"></p>
        </div>
        <button id="viewReasoningCloseBtn" class="text-gray-400 hover:text-white p-1">
          <i class="fas fa-times"></i>
        </button>
      </div>
      
      <!-- Modal Content -->
      <div class="p-4">
        <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">
          <i class="fas fa-user mr-1"></i><span id="viewReasoningRecommender"></span>'s reasoning:
        </p>
        <p id="viewReasoningText" class="text-gray-300 text-sm leading-relaxed"></p>
      </div>
    </div>
  </div>
`;

// Component: Service Select Modal
const serviceSelectModalComponent = () => `
  <div id="serviceSelectModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-sm">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Choose Service</h3>
      </div>

      <!-- Modal Content -->
      <div class="p-6 space-y-3">
        <button id="serviceSpotifyBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200 flex items-center justify-center">
          <i class="fab fa-spotify mr-2"></i>Spotify
        </button>
        <button id="serviceTidalBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200 flex items-center justify-center">
          <i class="fas fa-wave-square mr-2"></i>Tidal
        </button>
      </div>

      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800">
        <button id="serviceCancelBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200">Cancel</button>
      </div>
    </div>
  </div>
`;

// Component: Settings Drawer
const settingsDrawerComponent = (user) => `
  <!-- Settings Drawer -->
  <div id="settingsDrawer" class="settings-drawer">
    <!-- Backdrop -->
    <div class="settings-drawer-backdrop"></div>
    
    <!-- Drawer Panel -->
    <div class="settings-drawer-panel">
      <!-- Header -->
      <div class="settings-drawer-header">
        <h2 class="settings-drawer-title">Settings</h2>
        <button class="settings-drawer-close" aria-label="Close settings">
          <i class="fas fa-times"></i>
        </button>
      </div>
      
      <!-- Content Area -->
      <div class="settings-drawer-content">
        <!-- Category Navigation (Left) -->
        <nav class="settings-drawer-nav">
          <button data-category="account" class="settings-nav-item active">Account</button>
          <button data-category="integrations" class="settings-nav-item">Integrations</button>
          <button data-category="visual" class="settings-nav-item">Visual</button>
          <button data-category="preferences" class="settings-nav-item">Preferences</button>
          <button data-category="stats" class="settings-nav-item">Stats</button>
          ${user?.role === 'admin' ? '<button data-category="admin" class="settings-nav-item">Admin</button>' : ''}
        </nav>
        
        <!-- Category Content (Right) -->
        <div class="settings-drawer-main">
          <div id="settingsCategoryContent">
            <!-- Content loaded dynamically -->
          </div>
        </div>
        
        <!-- Bottom Action Bar (mobile only) -->
        <div id="settingsActionBar" class="settings-action-bar lg:hidden"></div>
      </div>
    </div>
  </div>
`;

// Component: List Setup Wizard Modal
const listSetupWizardComponent = () => `
  <div id="listSetupWizard" class="hidden fixed inset-0 bg-black bg-opacity-70 z-60 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-700 shrink-0">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-red-600/20 flex items-center justify-center">
            <i class="fas fa-list-check text-red-500"></i>
          </div>
          <div>
            <h3 class="text-xl font-bold text-white">Complete Your Lists</h3>
            <p class="text-sm text-gray-400">Set years and designate your main lists</p>
          </div>
        </div>
      </div>
      
      <!-- Modal Content - Scrollable -->
      <div class="p-6 overflow-y-auto flex-1" id="listSetupContent">
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
          <p>Loading your lists...</p>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-4 border-t border-gray-700 shrink-0 flex gap-3 justify-between">
        <button id="listSetupDismiss" class="px-4 py-2 text-gray-400 hover:text-gray-300 transition text-sm">
          Remind me later
        </button>
        <button id="listSetupSave" class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-sm transition font-medium disabled:opacity-50 disabled:cursor-not-allowed" disabled>
          <i class="fas fa-check mr-2"></i>Save Changes
        </button>
      </div>
    </div>
  </div>
`;

// Component: Release Selection Modal (Admin only - for re-identifying albums)
const releaseSelectionModalComponent = () => `
  <div id="releaseSelectionModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800 flex-shrink-0">
        <h3 class="text-xl font-bold text-white">Select Correct Release</h3>
        <p id="releaseSelectionSubtitle" class="text-sm text-gray-400 mt-1"></p>
      </div>
      
      <!-- Modal Content - Scrollable -->
      <div id="releaseSelectionContent" class="p-4 overflow-y-auto flex-1">
        <!-- Loading state -->
        <div id="releaseSelectionLoading" class="flex items-center justify-center py-8">
          <i class="fas fa-spinner fa-spin text-2xl text-gray-500"></i>
          <span class="ml-3 text-gray-400">Searching MusicBrainz...</span>
        </div>
        <!-- Candidates will be inserted here -->
        <div id="releaseSelectionCandidates" class="hidden space-y-3"></div>
        <!-- Error state -->
        <div id="releaseSelectionError" class="hidden text-center py-8">
          <i class="fas fa-exclamation-circle text-2xl text-red-500"></i>
          <p class="mt-2 text-gray-400"></p>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-4 border-t border-gray-800 flex gap-3 justify-end flex-shrink-0">
        <button 
          id="releaseSelectionCancelBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-sm transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="releaseSelectionConfirmBtn" 
          class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-sm transition duration-200 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          disabled
        >
          Apply Selection
        </button>
      </div>
    </div>
  </div>
`;

// Component: Modal Portal - contains all modals for proper z-index stacking above settings drawer
const modalPortalComponent = () => `
  <div id="modalPortal">
    ${createListModalComponent()}
    ${createCollectionModalComponent()}
    ${renameListModalComponent()}
    ${addAlbumModalComponent()}
    ${importConflictModalComponent()}
    ${serviceSelectModalComponent()}
    ${confirmationModalComponent()}
    ${recommendReasoningModalComponent()}
    ${viewReasoningModalComponent()}
    ${listSetupWizardComponent()}
    ${releaseSelectionModalComponent()}
  </div>
`;

// Main Spotify template - Consolidated version
const spotifyTemplate = (user, csrfToken = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta property="og:title" content="SuShe Online">
  <meta property="og:description" content="SuShe Online is a web app for managing album lists.">
  <meta property="og:image" content="/og-image.png">
  <title>SuShe Online</title>
  <link rel="icon" type="image/png" href="/og-image.png">
  <link rel="apple-touch-icon" href="/og-image.png">
  <link rel="manifest" href="/manifest.json">
  <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link href="${asset('/styles/output.css')}" rel="stylesheet">
  <link href="${asset('/styles/spotify-app.css')}" rel="stylesheet">
  <script defer src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
  <style>
    /* CSS Custom Properties for theming */
    :root {
      --accent-color: ${user?.accentColor || '#dc2626'};
      --accent-hover: ${adjustColor(user?.accentColor || '#dc2626', -30)};
      --accent-light: ${adjustColor(user?.accentColor || '#dc2626', 40)};
      --accent-dark: ${adjustColor(user?.accentColor || '#dc2626', -50)};
      --accent-shadow: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.4)};
      --accent-glow: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.5)};
      --accent-subtle: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.2)};
      --accent-subtle-strong: ${colorWithOpacity(user?.accentColor || '#dc2626', 0.3)};
      --sidebar-transition-duration: 200ms;
    }
    
    /* Apply accent color to text and borders only, not buttons */
    .text-red-600, .text-red-500, .text-red-400 { 
      color: var(--accent-color) !important; 
    }
    .hover\\:text-red-500:hover, .hover\\:text-red-400:hover { 
      color: var(--accent-color) !important; 
    }
    .border-red-600, .border-red-500 { 
      border-color: var(--accent-color) !important; 
    }
    
    /* Responsive layout system */
    .app-layout {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
      height: 100dvh;
    }
    
    .main-content {
      display: grid;
      grid-template-columns: 0 1fr; /* Mobile: no sidebar */
      overflow: hidden;
    }
    
    @media (min-width: 1024px) {
      .main-content {
        grid-template-columns: 18rem 1fr; /* Desktop: 288px sidebar */
      }
    }
    
    /* Responsive utilities */
    @media (max-width: 1023px) {
      .desktop-only { display: none !important; }
      .mobile-hidden { display: none !important; }
    }
    
    @media (min-width: 1024px) {
      .mobile-only { display: none !important; }
      .desktop-hidden { display: none !important; }
    }
    
    /* Sidebar responsive behavior */
    .sidebar {
      width: 0;
      overflow: hidden;
      border-right: none; /* Hide border on mobile */
    }
    
    @media (min-width: 1024px) {
      .sidebar {
        width: 18rem;
        overflow: visible;
        border-right: 1px solid #1f2937; /* Restore border on desktop */
      }
    }
    
    /* FAB styling */
    #addAlbumFAB {
      box-shadow: 0 4px 12px 0 rgba(0, 0, 0, 0.4),
                  0 2px 4px 0 rgba(0, 0, 0, 0.2);
      bottom: 1.5rem;
    }
    
    #addAlbumFAB:active {
      box-shadow: 0 2px 6px 0 rgba(0, 0, 0, 0.4);
    }
    
    /* Ensure FAB positioning is consistent across all mobile devices */
    @media (max-width: 1023px) {
      #addAlbumFAB {
        bottom: 1.5rem;
      }
    }
    
    /* Album container responsive padding */
    #albumContainer {
      padding-bottom: calc(1rem + env(safe-area-inset-bottom));
    }

    @media (max-width: 1023px) {
      #albumContainer {
        padding-bottom: calc(6rem + env(safe-area-inset-bottom)); /* Space for FAB + safe area on mobile */
      }
    }
    
    /* Safe areas for iOS */
    .safe-area-bottom {
      padding-bottom: env(safe-area-inset-bottom);
    }
    
    /* Additional iPhone-specific fixes */
    @media (max-width: 1023px) {
      /* Push entire app below status bar/notch on iOS - top only */
      body {
        padding-top: 0;
        /* Bottom safe area handled by individual elements (now-playing bar, FAB) */
      }
      
      /* Full viewport height with safe-area padding */
      .app-layout {
        height: 100vh;
        height: 100dvh;
        min-height: 100vh;
        padding-top: constant(safe-area-inset-top); /* iOS 11.0-11.2 */
        padding-top: env(safe-area-inset-top, 0px); /* iOS 11.2+ */
      }
    }
    
    /* Sortable enhancements */
    .sortable-ghost {
      opacity: 0.4;
    }
    
    .sortable-drag {
      opacity: 0.9 !important;
      transform: scale(0.95);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
      z-index: 9999;
    }
    
    .sortable-chosen {
      background-color: rgba(55, 65, 81, 0.5);
    }
    
    /* Touch optimization */
    @media (max-width: 1023px) {
      .touch-target {
        min-height: 44px;
      }
      
      body {
        overscroll-behavior: none;
        -webkit-user-select: none;
        user-select: none;
      }
    }
  </style>
</head>
<body class="bg-gray-900 text-gray-200">
  <div class="app-layout">
    ${headerComponent(user, 'home')}
    
    <!-- Main Content Area -->
    <div class="main-content">
    <!-- Sidebar (responsive) -->
    <aside id="sidebar" class="sidebar bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-300">
      <!-- Sidebar Toggle Button -->
      <div class="flex items-center justify-between p-4">
        <div class="flex items-center gap-2">
          <h2 class="sidebar-title text-lg font-bold text-white transition-opacity duration-300">Lists</h2>
        </div>
        <button 
          id="sidebarToggle" 
          class="p-2 hover:bg-gray-800 rounded-sm transition-colors"
          title="Toggle sidebar"
        >
          <i class="fas fa-chevron-left text-gray-400 transition-transform duration-300"></i>
        </button>
      </div>
      
      <nav class="flex-1 overflow-y-auto p-4 flex flex-col min-h-0">
        <div class="flex-1 overflow-y-auto">
          <ul id="listNav" class="space-y-1">
            <!-- Lists will be populated here -->
          </ul>
        </div>
        
        <div class="mt-4 pt-4 border-t border-gray-800 shrink-0">
          <button id="createListBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-sm text-sm transition duration-200 flex items-center">
            <i class="fas fa-plus mr-2"></i><span>Create List</span>
          </button>
          <button id="createCollectionBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-sm text-sm transition duration-200 mt-2 flex items-center">
            <i class="fas fa-folder-plus mr-2"></i><span>Create Collection</span>
          </button>
          <button id="importBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-sm text-sm transition duration-200 mt-2 flex items-center">
            <i class="fas fa-file-import mr-2"></i><span>Import List</span>
          </button>
          <input type="file" id="fileInput" accept=".json" style="display: none;">
        </div>
      </nav>
      
      <!-- Spotify Miniplayer (Desktop only) -->
      <div id="spotifyMiniplayer" class="spotify-miniplayer shrink-0 border-t border-gray-800 p-3 hidden">
        <!-- Not Connected State -->
        <div id="miniplayerNotConnected" class="text-center py-3">
          <a href="#" 
             onclick="window.openSettingsDrawer && window.openSettingsDrawer(); return false;"
             class="inline-flex items-center gap-2 px-4 py-2 bg-[#1DB954] hover:bg-[#1ed760] text-white text-sm font-medium rounded-full transition-all hover:scale-105 shadow-lg shadow-[#1DB954]/20">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Log in with Spotify
          </a>
          <p class="text-[10px] text-gray-600 mt-2">Control playback from here</p>
        </div>
        
        <!-- Premium Required State -->
        <div id="miniplayerPremiumRequired" class="text-center py-2 hidden">
          <p class="text-xs text-gray-500">Premium required for playback</p>
        </div>
        
        <!-- Inactive State (connected but not playing) -->
        <div id="miniplayerInactive" class="text-center py-3 hidden">
          <div class="flex items-center justify-center gap-2 text-gray-500 mb-1">
            <svg class="w-4 h-4 text-[#1DB954]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            <span class="text-xs font-medium">Connected</span>
          </div>
          <p class="text-xs text-gray-500">No active playback</p>
          <p class="text-[10px] text-gray-600 mt-1">Start playing on Spotify</p>
        </div>
        
        <!-- Active Player State -->
        <div id="miniplayerActive" class="hidden">
          <!-- Track Info -->
          <div class="flex items-center gap-3 mb-1">
            <div id="miniplayerArt" class="w-20 h-20 bg-gray-800 rounded-md shrink-0 overflow-hidden">
              <img src="" alt="" class="w-full h-full object-cover hidden">
            </div>
            <div class="flex-1 min-w-0">
              <p id="miniplayerTrack" class="text-sm font-medium text-white truncate">No track</p>
              <p id="miniplayerArtist" class="text-xs text-gray-400 truncate">—</p>
            </div>
          </div>
          
          <!-- Progress Bar -->
          <div>
            <input id="miniplayerProgress" type="range" min="0" max="1000" value="0"
              class="miniplayer-progress w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer">
            <div class="flex justify-between text-[10px] text-gray-300 mt-1">
              <span id="miniplayerTimeElapsed">0:00</span>
              <span id="miniplayerTimeTotal">0:00</span>
            </div>
          </div>
          
          <!-- Controls Row -->
          <div class="flex items-center justify-center">
            <!-- Playback Controls -->
<div class="flex items-center justify-between w-[200px]">
              <button id="miniplayerPrev" class="px-2 py-1.5 text-gray-400 hover:text-white transition-colors" title="Previous">
                <i class="fas fa-step-backward text-sm"></i>
              </button>
              <button id="miniplayerPlayPause" class="px-3.5 py-2 bg-white text-gray-900 rounded-full hover:scale-105 transition-transform" title="Play/Pause">
                <i class="fas fa-play text-sm"></i>
              </button>
              <button id="miniplayerNext" class="px-2 py-1.5 text-gray-400 hover:text-white transition-colors" title="Next">
                <i class="fas fa-step-forward text-sm"></i>
              </button>
            </div>
          </div>
          
          <!-- Volume Control Row -->
          <div id="miniplayerVolumeRow" class="flex items-center justify-center mt-5 mb-5">
            <div class="relative flex items-center">
              <button id="miniplayerMute" class="absolute right-full mr-[7px] p-1.5 text-gray-400 hover:text-white transition-colors" title="Mute">
                <i class="fas fa-volume-up text-xs"></i>
              </button>
              <input id="miniplayerVolume" type="range" min="0" max="100" value="50" 
                class="w-[210px] h-1 bg-gray-700 rounded-full appearance-none cursor-pointer">
            </div>
          </div>
          
          <!-- Current Device Indicator with Device Picker -->
          <div id="miniplayerCurrentDevice" class="mt-4 pt-4 border-t-2 border-gray-700/50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)] flex items-center justify-center">
            <div class="relative">
              <button id="miniplayerDeviceBtn" class="h-5 flex items-center text-[13px] text-gray-500 hover:text-gray-300 transition-colors cursor-pointer" title="Change device">
                <i class="fas fa-broadcast-tower mr-1.5 text-green-500"></i>
                <span id="miniplayerDeviceName">Listening on...</span>
                <i class="fas fa-chevron-down ml-1.5 text-[10px]"></i>
              </button>
              
              <!-- Device Dropdown -->
              <div id="miniplayerDeviceDropdown" class="hidden absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
                <div class="p-2 border-b border-gray-700">
                  <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Connect to a device</span>
                </div>
                <div id="miniplayerDeviceList" class="max-h-48 overflow-y-auto py-1">
                  <!-- Device items populated dynamically -->
                  <div class="text-center py-4 text-gray-500 text-xs">
                    <i class="fas fa-spinner fa-spin mr-1"></i> Loading devices...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Loading State -->
        <div id="miniplayerLoading" class="hidden text-center py-3">
          <i class="fas fa-spinner fa-spin text-gray-400"></i>
        </div>
      </div>
      
      <!-- Tidal Widget (Desktop only) -->
      <div id="tidalWidget" class="tidal-widget shrink-0 border-t border-gray-800 p-3 hidden">
        <!-- Not Connected State -->
        <div id="tidalWidgetNotConnected" class="text-center py-3">
          <a href="#" 
             onclick="window.openSettingsDrawer && window.openSettingsDrawer(); return false;"
             class="inline-flex items-center gap-2 px-4 py-2 bg-[#000000] hover:bg-[#1a1a1a] text-white text-sm font-medium rounded-full transition-all hover:scale-105 shadow-lg border border-gray-700">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l-4.004 4.004L4.004 20.008 8.008 16.004 12.012 20.008 16.016 16.004 12.012 12l4.004-4.004L12.012 3.992zM16.042 7.996l3.979-3.979L24 7.996l-3.979 4.004 3.979 4.004-3.979 3.979-3.979-3.979L12.038 16.008 16.042 12l-4.004-4.004L16.042 7.996z"/>
            </svg>
            Connect Tidal
          </a>
          <p class="text-[10px] text-gray-600 mt-2">Open albums in Tidal</p>
        </div>
        
        <!-- Connected State -->
        <div id="tidalWidgetConnected" class="text-center py-3 hidden">
          <div class="flex items-center justify-center gap-2 text-gray-400 mb-2">
            <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l-4.004 4.004L4.004 20.008 8.008 16.004 12.012 20.008 16.016 16.004 12.012 12l4.004-4.004L12.012 3.992zM16.042 7.996l3.979-3.979L24 7.996l-3.979 4.004 3.979 4.004-3.979 3.979-3.979-3.979L12.038 16.008 16.042 12l-4.004-4.004L16.042 7.996z"/>
            </svg>
            <span class="text-xs font-medium text-white">Tidal Connected</span>
          </div>
          <p class="text-xs text-gray-500">Right-click albums to open in Tidal</p>
        </div>
      </div>
    </aside>
      
      <!-- Album Display Area -->
      <main class="flex-1 overflow-hidden flex flex-col">
        <div id="albumContainer" class="flex-1 overflow-y-auto flex flex-col min-h-0">
          <!-- Albums will be displayed here -->
          <div class="text-center text-gray-500 mt-20">
            <p class="text-xl mb-2">No list selected</p>
            <p class="text-sm">Create or import a list to get started</p>
          </div>
        </div>
      </main>
    </div>
    
    <!-- Mobile Menu Drawer -->
    <div id="mobileMenu" class="mobile-only fixed inset-0 z-50 pointer-events-none" style="visibility: hidden;">
      <!-- Backdrop -->
      <div id="mobileMenuBackdrop" class="absolute inset-0 bg-black opacity-0 transition-opacity" style="transition-duration: var(--sidebar-transition-duration);" onclick="toggleMobileMenu()"></div>
      
      <!-- Drawer -->
      <div id="mobileMenuDrawer" class="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-gray-900 border-r border-gray-800 overflow-hidden flex flex-col transition-transform" style="transition-duration: var(--sidebar-transition-duration); transform: translateX(-100%);">
        <!-- Header -->
        <div class="p-4 border-b border-gray-800" style="padding-top: calc(1rem + env(safe-area-inset-top, 0px))">
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-bold text-white">Lists</h2>
            <button onclick="toggleMobileMenu()" class="p-2 -m-2 text-gray-400 hover:text-white">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>
        
        <!-- Lists -->
        <div class="flex-1 overflow-y-auto p-4">
          <ul id="mobileListNav" class="space-y-1">
            <!-- Mobile list items will be populated here -->
          </ul>
        </div>
        
        <!-- Footer Actions -->
        <div class="p-4 border-t border-gray-800 space-y-2" style="padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));">
          <button onclick="document.getElementById('createListBtn').click(); toggleMobileMenu();" 
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-sm text-sm transition duration-200 flex items-center">
            <i class="fas fa-plus mr-2"></i>Create List
          </button>
          <button onclick="document.getElementById('createCollectionBtn').click(); toggleMobileMenu();" 
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-sm text-sm transition duration-200 flex items-center">
            <i class="fas fa-folder-plus mr-2"></i>Create Collection
          </button>
          <button onclick="document.getElementById('importBtn').click(); toggleMobileMenu();" 
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded-sm text-sm transition duration-200 flex items-center">
            <i class="fas fa-file-import mr-2"></i>Import List
          </button>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Floating Action Button -->
  <button
    id="addAlbumFAB"
    class="fixed bottom-6 right-6 w-14 h-14 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-lg flex items-center justify-center transform hover:scale-110 active:scale-95 z-9999"
    style="display: none; touch-action: manipulation; pointer-events: auto; transition: opacity var(--sidebar-transition-duration), transform 200ms, bottom 300ms ease;"
  >
    <i class="fas fa-plus text-xl"></i>
  </button>
  
  <!-- Mobile Floating Now Playing Bar -->
  <div id="mobileNowPlaying" class="mobile-now-playing">
    <!-- Progress bar at top -->
    <div id="mobileNowPlayingProgress" class="mobile-now-playing-progress">
      <div id="mobileNowPlayingProgressFill" class="mobile-now-playing-progress-fill"></div>
    </div>
    <!-- Main content -->
    <a href="spotify:" class="mobile-now-playing-content">
      <div id="mobileNowPlayingArt" class="mobile-now-playing-art">
        <svg class="w-6 h-6 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </div>
      <div class="mobile-now-playing-info">
        <p id="mobileNowPlayingTrack" class="mobile-now-playing-track">Not Playing</p>
        <p id="mobileNowPlayingArtist" class="mobile-now-playing-artist">—</p>
        <p id="mobileNowPlayingDevice" class="mobile-now-playing-device">
          <i class="fas fa-broadcast-tower"></i>
          <span>—</span>
        </p>
      </div>
    </a>
  </div>
  
  <!-- Toast container -->
  <div id="toast" class="toast"></div>
  
  <!-- Modals -->
  ${contextMenusComponent()}
  ${settingsDrawerComponent(user)}

  <!-- About Modal -->
  <div id="aboutModal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 safe-area-modal">
    <div class="bg-gray-900 border border-gray-700/50 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
      <div id="aboutModalContent" class="flex flex-col overflow-hidden flex-1 min-h-0">
        <!-- Content rendered by about-modal.js -->
      </div>
    </div>
  </div>

  ${modalPortalComponent()}
  
  <script>
    // Global state - must be set before bundle.js loads
    window.currentUser = ${safeJsonStringify(user)};
    window.lastSelectedList = ${safeJsonStringify(user.lastSelectedList || null)};
    window.csrfToken = ${safeJsonStringify(csrfToken)};
  </script>
  
  <script type="module" src="${asset('/js/bundle.js')}"></script>

  <script>

    function updateViewportHeight() {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', \`\${vh}px\`);
    }

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    
    // Mobile menu toggle
    function toggleMobileMenu() {
      const menu = document.getElementById('mobileMenu');
      const backdrop = document.getElementById('mobileMenuBackdrop');
      const drawer = document.getElementById('mobileMenuDrawer');
      const fab = document.getElementById('addAlbumFAB');
      const nowPlaying = document.getElementById('mobileNowPlaying');
      const isOpen = menu.dataset.open === 'true';
      
      if (isOpen) {
        // Closing
        menu.dataset.open = 'false';
        backdrop.style.opacity = '0';
        drawer.style.transform = 'translateX(-100%)';
        if (fab) {
          fab.style.opacity = '1';
          fab.style.pointerEvents = 'auto';
        }
        if (nowPlaying) {
          nowPlaying.style.opacity = '';
          nowPlaying.style.pointerEvents = '';
        }
        // Hide after transition completes
        setTimeout(() => {
          if (menu.dataset.open === 'false') {
            menu.style.visibility = 'hidden';
            menu.classList.add('pointer-events-none');
          }
        }, 200); // Match --sidebar-transition-duration
      } else {
        // Opening
        menu.dataset.open = 'true';
        menu.style.visibility = 'visible';
        menu.classList.remove('pointer-events-none');
        // Trigger reflow to ensure transition runs
        void drawer.offsetWidth;
        backdrop.style.opacity = '0.5';
        drawer.style.transform = 'translateX(0)';
        if (fab) {
          fab.style.opacity = '0';
          fab.style.pointerEvents = 'none';
        }
        if (nowPlaying) {
          nowPlaying.style.opacity = '0';
          nowPlaying.style.pointerEvents = 'none';
        }
      }
    }

    // Backwards compatibility for old toggle handler
    function toggleMobileLists() {
      toggleMobileMenu();
    }
    
    // Initialize the app
    document.addEventListener('DOMContentLoaded', () => {
      // Override selectList to handle responsive behavior
      const originalSelectList = window.selectList;
      window.selectList = async function(listId) {
        await originalSelectList(listId);
        
        // Show/hide FAB
        const fab = document.getElementById('addAlbumFAB');
        if (fab) {
          fab.style.display = listId ? 'flex' : 'none';
        }
      };
      
      // Mobile list menu is now handled by showMobileListMenu in app.js
      // Desktop right-click is handled by contextmenu handlers in app.js (createListButton)
    });

    // Re-render layout when viewport crosses the mobile breakpoint
    let lastIsMobile = window.innerWidth < 1024;
    window.addEventListener('resize', () => {
      const isMobile = window.innerWidth < 1024;
      if (isMobile !== lastIsMobile) {
        lastIsMobile = isMobile;
        if (typeof updateListNav === 'function') updateListNav();
        // currentListId is the current list ID (lists are now keyed by ID)
        if (typeof currentListId !== 'undefined' && currentListId && typeof lists !== 'undefined' && lists[currentListId]) {
          const listData = lists[currentListId]._data || lists[currentListId];
          if (listData && Array.isArray(listData)) {
            displayAlbums(listData);
          }
        }
      }
    });
  </script>
</body>
</html>
`;

// Aggregate List template - collaborative album of the year page
const aggregateListTemplate = (user, year) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#000000">
  <meta property="og:title" content="AOTY ${year} - SuShe Online">
  <meta property="og:description" content="Album of the Year ${year}">
  <meta property="og:image" content="/og-image.png">
  <title>AOTY ${year} - SuShe Online</title>
  <link rel="icon" type="image/png" href="/og-image.png">
  <link rel="apple-touch-icon" href="/og-image.png">
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
    }
    
    .text-red-600, .text-red-500 { color: var(--accent-color) !important; }
    .border-red-600 { border-color: var(--accent-color) !important; }
    .bg-red-600 { background-color: var(--accent-color) !important; }
    .hover\\:bg-red-700:hover { background-color: var(--accent-hover) !important; }
    
    .metal-title {
      font-family: 'Cinzel', serif;
      text-shadow: 0 0 20px var(--accent-glow);
    }
    
    .album-card {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .album-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
    }
    
    .position-badge {
      width: 3rem;
      height: 3rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      border-radius: 50%;
      border: 2px solid;
    }
    
    .position-badge.gold { border-color: #fbbf24; box-shadow: 0 0 12px rgba(251, 191, 36, 0.6); }
    .position-badge.silver { border-color: #9ca3af; box-shadow: 0 0 12px rgba(156, 163, 175, 0.6); }
    .position-badge.bronze { border-color: #d97706; box-shadow: 0 0 12px rgba(217, 119, 6, 0.6); }
    
    .voter-chip {
      display: inline-flex;
      align-items: center;
      padding: 0.125rem 0.375rem;
      background: #374151;
      border-radius: 9999px;
      font-size: 0.65rem;
      margin: 0.0625rem;
      white-space: nowrap;
    }
    
    /* Compact card layout */
    .album-card-compact {
      position: relative;
    }
    
    .album-card-compact .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
    }
    
    .album-card-compact .card-title-area {
      flex: 1;
      min-width: 0;
    }
    
    .album-card-compact .card-voters {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      max-width: 45%;
      gap: 0.125rem;
    }
    
    .album-card-compact .card-stats {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: #9ca3af;
      margin-top: 0.25rem;
    }
    
    .album-card-compact .card-stats .stat-divider {
      color: #4b5563;
    }
    
    .album-card-compact .card-stats .points {
      color: var(--accent-color);
      font-weight: 600;
    }
    
    .confirmation-card {
      background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
      border: 1px solid #374151;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .animate-fade-in {
      animation: fadeIn 0.5s ease-out forwards;
    }
    
    .reveal-pending {
      filter: blur(0);
      background: repeating-linear-gradient(
        45deg,
        #1f2937,
        #1f2937 10px,
        #111827 10px,
        #111827 20px
      );
    }
    
    /* ============ BURNING REVEAL STYLES ============ */
    
    /* Album card wrapper for reveal mode */
    .reveal-card-wrapper {
      position: relative;
      overflow: visible;
    }
    
    /* Dark overlay covering unrevealed albums */
    .burn-overlay {
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0a0a0a 100%);
      border-radius: 0.5rem;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.6s ease-out;
    }
    
    .burn-overlay::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 0.5rem;
      border: 1px solid #333;
      pointer-events: none;
    }
    
    .burn-overlay .rank-preview {
      font-size: 2rem;
      font-weight: bold;
      color: #444;
      text-shadow: 0 0 10px rgba(0,0,0,0.8);
    }
    
    /* Burn animation - glow border intensifies then overlay fades */
    .burn-overlay.burning {
      animation: burnAway 0.8s ease-out forwards;
    }
    
    .burn-overlay.burning::before {
      animation: glowBorder 0.8s ease-out forwards;
    }
    
    @keyframes burnAway {
      0% { opacity: 1; }
      30% { opacity: 1; }
      100% { opacity: 0; pointer-events: none; }
    }
    
    @keyframes glowBorder {
      0% { border-color: #333; box-shadow: none; }
      20% { border-color: #f97316; box-shadow: 0 0 20px rgba(249, 115, 22, 0.5), inset 0 0 20px rgba(249, 115, 22, 0.1); }
      50% { border-color: #fbbf24; box-shadow: 0 0 40px rgba(251, 191, 36, 0.6), inset 0 0 30px rgba(251, 191, 36, 0.2); }
      100% { border-color: transparent; box-shadow: none; }
    }
    
    /* Special glow colors for top 3 */
    .burn-overlay.burning.bronze::before {
      animation: glowBorderBronze 1s ease-out forwards;
    }
    
    .burn-overlay.burning.silver::before {
      animation: glowBorderSilver 1s ease-out forwards;
    }
    
    .burn-overlay.burning.gold::before {
      animation: glowBorderGold 1.2s ease-out forwards;
    }
    
    /* Intensity level 5 - intro with purple glow */
    @keyframes glowBorderRank5 {
      0% { border-color: #333; box-shadow: none; }
      20% { border-color: #6d28d9; box-shadow: 0 0 20px rgba(109, 40, 217, 0.5), inset 0 0 10px rgba(109, 40, 217, 0.1); }
      40% { border-color: #7c3aed; box-shadow: 0 0 30px rgba(124, 58, 237, 0.6), inset 0 0 15px rgba(124, 58, 237, 0.15); }
      60% { border-color: #8b5cf6; box-shadow: 0 0 35px rgba(139, 92, 246, 0.5), inset 0 0 12px rgba(139, 92, 246, 0.1); }
      100% { border-color: transparent; box-shadow: none; }
    }
    
    .burn-overlay.burning.rank-5::before {
      animation: glowBorderRank5 1s ease-out forwards;
    }
    
    /* Intensity level 4 - building with brighter purple */
    @keyframes glowBorderRank4 {
      0% { border-color: #333; box-shadow: none; }
      15% { border-color: #7c3aed; box-shadow: 0 0 25px rgba(124, 58, 237, 0.5), inset 0 0 12px rgba(124, 58, 237, 0.1); }
      30% { border-color: #8b5cf6; box-shadow: 0 0 35px rgba(139, 92, 246, 0.65), inset 0 0 18px rgba(139, 92, 246, 0.15); }
      50% { border-color: #a78bfa; box-shadow: 0 0 45px rgba(167, 139, 250, 0.75), inset 0 0 25px rgba(167, 139, 250, 0.2); }
      70% { border-color: #c4b5fd; box-shadow: 0 0 50px rgba(196, 181, 253, 0.65), inset 0 0 20px rgba(196, 181, 253, 0.15); }
      100% { border-color: transparent; box-shadow: none; }
    }
    
    .burn-overlay.burning.rank-4::before {
      animation: glowBorderRank4 1.1s ease-out forwards;
    }
    
    /* Intensity level 3 - bronze (intense) */
    @keyframes glowBorderBronze {
      0% { border-color: #333; box-shadow: none; }
      20% { border-color: #b45309; box-shadow: 0 0 30px rgba(180, 83, 9, 0.6), inset 0 0 25px rgba(180, 83, 9, 0.2); }
      40% { border-color: #d97706; box-shadow: 0 0 50px rgba(217, 119, 6, 0.8), inset 0 0 40px rgba(217, 119, 6, 0.3); }
      60% { border-color: #f59e0b; box-shadow: 0 0 60px rgba(245, 158, 11, 0.7), inset 0 0 45px rgba(245, 158, 11, 0.25); }
      100% { border-color: transparent; box-shadow: none; }
    }
    
    .burn-overlay.burning.bronze::before {
      animation: glowBorderBronze 1.1s ease-out forwards;
    }
    
    /* Intensity level 2 - silver (very intense) */
    @keyframes glowBorderSilver {
      0% { border-color: #333; box-shadow: none; }
      15% { border-color: #6b7280; box-shadow: 0 0 25px rgba(156, 163, 175, 0.5); }
      30% { border-color: #9ca3af; box-shadow: 0 0 40px rgba(156, 163, 175, 0.7), inset 0 0 30px rgba(156, 163, 175, 0.2); }
      50% { border-color: #d1d5db; box-shadow: 0 0 70px rgba(209, 213, 219, 1), inset 0 0 50px rgba(209, 213, 219, 0.35); }
      70% { border-color: #e5e7eb; box-shadow: 0 0 80px rgba(229, 231, 235, 1), inset 0 0 55px rgba(229, 231, 235, 0.4); }
      100% { border-color: transparent; box-shadow: none; }
    }
    
    .burn-overlay.burning.silver::before {
      animation: glowBorderSilver 1.3s ease-out forwards;
    }
    
    /* Intensity level 1 - gold (maximum intensity, delayed reveal) */
    @keyframes glowBorderGold {
      0% { border-color: #333; box-shadow: none; }
      10% { border-color: #92400e; box-shadow: 0 0 20px rgba(146, 64, 14, 0.5); }
      25% { border-color: #b45309; box-shadow: 0 0 40px rgba(180, 83, 9, 0.7), inset 0 0 25px rgba(180, 83, 9, 0.2); }
      40% { border-color: #d97706; box-shadow: 0 0 60px rgba(217, 119, 6, 0.85), inset 0 0 40px rgba(217, 119, 6, 0.3); }
      55% { border-color: #f59e0b; box-shadow: 0 0 80px rgba(245, 158, 11, 0.95), inset 0 0 55px rgba(245, 158, 11, 0.4); }
      70% { border-color: #fbbf24; box-shadow: 0 0 100px rgba(251, 191, 36, 1), inset 0 0 70px rgba(251, 191, 36, 0.5); }
      85% { border-color: #fcd34d; box-shadow: 0 0 120px rgba(252, 211, 77, 1), inset 0 0 80px rgba(252, 211, 77, 0.55); }
      100% { border-color: transparent; box-shadow: none; }
    }
    
    .burn-overlay.burning.gold::before {
      animation: glowBorderGold 2s ease-out forwards;
    }
    
    /* Gold overlay has delayed fade for suspense */
    .burn-overlay.burning.gold {
      animation: burnAwayDelayed 2s ease-out forwards;
    }
    
    @keyframes burnAwayDelayed {
      0% { opacity: 1; }
      60% { opacity: 1; }
      100% { opacity: 0; pointer-events: none; }
    }
    
    /* Ember particles */
    .ember-container {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: visible;
      z-index: 11;
    }
    
    .ember {
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #f97316;
      box-shadow: 0 0 6px 2px rgba(249, 115, 22, 0.8);
      opacity: 0;
    }
    
    .ember.active {
      animation: emberFloat 1.2s ease-out forwards;
    }
    
    @keyframes emberFloat {
      0% { opacity: 0; transform: translateY(0) scale(1); }
      10% { opacity: 1; }
      50% { opacity: 0.8; transform: translateY(-30px) scale(0.8); }
      100% { opacity: 0; transform: translateY(-80px) scale(0.3); }
    }
    
    /* Floating reveal button */
    .reveal-button-container {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
    }
    
    .reveal-button {
      padding: 1rem 2rem;
      font-size: 1.125rem;
      font-weight: bold;
      color: white;
      background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
      border: none;
      border-radius: 9999px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5), 0 0 40px rgba(220, 38, 38, 0.3);
      transition: transform 0.2s, box-shadow 0.2s;
      animation: buttonPulse 2s ease-in-out infinite;
    }
    
    .reveal-button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 30px rgba(220, 38, 38, 0.7), 0 0 50px rgba(220, 38, 38, 0.4);
    }
    
    .reveal-button:active {
      transform: scale(0.98);
    }
    
    .reveal-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      animation: none;
    }
    
    @keyframes buttonPulse {
      0%, 100% { box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5), 0 0 40px rgba(220, 38, 38, 0.3); }
      50% { box-shadow: 0 4px 30px rgba(220, 38, 38, 0.7), 0 0 60px rgba(220, 38, 38, 0.5); }
    }
    
    /* Screen flash for #1 reveal */
    .screen-flash {
      position: fixed;
      inset: 0;
      background: radial-gradient(circle at center, rgba(251, 191, 36, 0.6) 0%, rgba(251, 191, 36, 0.2) 40%, transparent 70%);
      pointer-events: none;
      z-index: 50;
      animation: flashFade 1.5s ease-out forwards;
    }
    
    @keyframes flashFade {
      0% { opacity: 0; }
      15% { opacity: 1; }
      30% { opacity: 0.8; }
      100% { opacity: 0; }
    }
    
    /* Fireworks container for #1 */
    .fireworks-container {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 52;
      overflow: hidden;
    }
    
    /* Individual firework burst */
    .firework {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    
    .firework.launching {
      animation: fireworkLaunch var(--launch-duration, 0.8s) ease-out forwards;
    }
    
    .firework.exploding {
      animation: fireworkExplode 0.1s ease-out forwards;
    }
    
    @keyframes fireworkLaunch {
      0% { transform: translateY(0) scale(1); opacity: 1; }
      100% { transform: translateY(var(--launch-height, -300px)) scale(0.5); opacity: 0.8; }
    }
    
    @keyframes fireworkExplode {
      0% { transform: scale(1); }
      100% { transform: scale(2); opacity: 0; }
    }
    
    /* Firework particle (after explosion) */
    .firework-particle {
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      opacity: 0;
    }
    
    .firework-particle.active {
      animation: particleFly var(--particle-duration, 1.2s) ease-out forwards;
    }
    
    @keyframes particleFly {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      50% { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--px), var(--py)) scale(0.3); }
    }
    
    /* Sparkle trail effect */
    .sparkle-trail {
      position: absolute;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 0 6px 2px currentColor;
      opacity: 0;
    }
    
    .sparkle-trail.active {
      animation: sparkleTrail 0.6s ease-out forwards;
    }
    
    @keyframes sparkleTrail {
      0% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(0); }
    }
    
    /* Celebration confetti burst for #1 */
    .celebration-burst {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 53;
    }
    
    .confetti {
      position: absolute;
      width: 12px;
      height: 12px;
      opacity: 0;
    }
    
    .confetti.active {
      animation: confettiBurst 2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
    }
    
    @keyframes confettiBurst {
      0% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
      60% { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--tx), var(--ty)) rotate(1080deg) scale(0.3); }
    }
    
    /* Golden rays radiating from center */
    .golden-rays {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 150vmax;
      height: 150vmax;
      pointer-events: none;
      z-index: 49;
      opacity: 0;
      animation: raysAppear 10s ease-out forwards;
    }
    
    .golden-rays::before {
      content: '';
      position: absolute;
      inset: 0;
      background: conic-gradient(
        from 0deg,
        transparent 0deg,
        rgba(251, 191, 36, 0.4) 3deg,
        rgba(253, 224, 71, 0.2) 6deg,
        transparent 9deg,
        transparent 15deg,
        rgba(251, 191, 36, 0.4) 18deg,
        rgba(253, 224, 71, 0.2) 21deg,
        transparent 24deg,
        transparent 30deg,
        rgba(251, 191, 36, 0.4) 33deg,
        rgba(253, 224, 71, 0.2) 36deg,
        transparent 39deg,
        transparent 45deg,
        rgba(251, 191, 36, 0.4) 48deg,
        rgba(253, 224, 71, 0.2) 51deg,
        transparent 54deg,
        transparent 60deg,
        rgba(251, 191, 36, 0.4) 63deg,
        rgba(253, 224, 71, 0.2) 66deg,
        transparent 69deg,
        transparent 75deg,
        rgba(251, 191, 36, 0.4) 78deg,
        rgba(253, 224, 71, 0.2) 81deg,
        transparent 84deg,
        transparent 90deg
      );
      animation: raysRotate 10s linear forwards;
    }
    
    .golden-rays::after {
      content: '';
      position: absolute;
      inset: 20%;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.3) 0%, transparent 70%);
      animation: raysCenterPulse 2s ease-in-out infinite;
    }
    
    @keyframes raysAppear {
      0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
      10% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      80% { opacity: 0.7; transform: translate(-50%, -50%) scale(1.3); }
      100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
    }
    
    @keyframes raysRotate {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(180deg); }
    }
    
    @keyframes raysCenterPulse {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.1); }
    }
    
    /* Position pulse for #5-#2 */
    @keyframes positionPulse {
      0% { opacity: 0; transform: scale(0.8); }
      30% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(1.2); }
    }
    
    /* Mini burst particles for #3 and #2 */
    @keyframes miniBurstParticle {
      0% { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.3); }
    }
    
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap" rel="stylesheet">
</head>
<body class="bg-black text-gray-200 min-h-screen">
  <div class="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black -z-10"></div>
  
  
  ${headerComponent(user, 'aggregate')}
  
  <!-- Main content -->
  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- Title -->
    <div class="text-center mb-12">
      <h1 class="metal-title text-4xl md:text-5xl font-bold text-red-600">AOTY ${year}</h1>
    </div>
    
    <!-- Content container - populated by JavaScript -->
    <div id="aggregateListContent" class="space-y-4">
      <div class="text-center py-12">
        <i class="fas fa-spinner fa-spin text-4xl text-gray-500 mb-4"></i>
        <p class="text-gray-400">Loading aggregate list...</p>
      </div>
    </div>
    
  </main>
  
  <script>
    const YEAR = ${year};
    const USER_ID = '${user?._id || ''}';
    
    // HTML escape function to prevent XSS
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    
    // Fetch wrapper with error handling
    async function apiFetch(url, options = {}) {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }
      return res.json();
    }
    
    // Format position with ordinal suffix
    function formatPosition(pos) {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = pos % 100;
      return pos + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    
    // Build album card HTML (compact layout)
    function buildAlbumCardHtml(album, index) {
      const positionClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
      const delay = Math.min(index * 50, 500);
      
      const votersHtml = album.voters.map(v => 
        '<span class="voter-chip"><span class="text-gray-300">' + escapeHtml(v.username) + '</span><span class="text-gray-500 ml-0.5">#' + v.position + '</span></span>'
      ).join('');
      
      return '<div class="album-card album-card-compact bg-gray-800/50 rounded-lg p-3 animate-fade-in" data-rank="' + album.rank + '" style="animation-delay: ' + delay + 'ms; opacity: 0;">' +
        '<div class="flex items-center gap-3">' +
          '<div class="position-badge ' + positionClass + ' text-gray-200 shrink-0">' + album.rank + '</div>' +
          '<div class="shrink-0">' +
            (album.coverImage ? 
              '<img src="' + album.coverImage + '" alt="' + escapeHtml(album.album) + '" class="w-14 h-14 md:w-16 md:h-16 rounded-sm object-cover">' :
              '<div class="w-14 h-14 md:w-16 md:h-16 rounded-sm bg-gray-700 flex items-center justify-center"><i class="fas fa-compact-disc text-gray-500 text-xl"></i></div>'
            ) +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="card-header">' +
              '<div class="card-title-area">' +
                '<h3 class="font-bold text-white text-sm md:text-base truncate">' + escapeHtml(album.album || 'Unknown Album') + '</h3>' +
              '</div>' +
              '<div class="card-voters">' + votersHtml + '</div>' +
            '</div>' +
            '<div class="card-stats">' +
              '<span class="text-gray-400 truncate">' + escapeHtml(album.artist || 'Unknown Artist') + '</span>' +
              '<span class="stat-divider">·</span>' +
              '<span class="points">' + album.totalPoints + ' pts</span>' +
              '<span class="stat-divider">·</span>' +
              '<span>avg ' + formatPosition(Math.round(album.averagePosition)) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    
    // Render revealed aggregate list (normal mode)
    function renderAggregateList(data) {
      const container = document.getElementById('aggregateListContent');
      
      if (!data.albums || data.albums.length === 0) {
        container.innerHTML = '<div class="text-center py-12 text-gray-400">No albums in the aggregate list yet.</div>';
        return;
      }
      
      const html = data.albums.map((album, index) => buildAlbumCardHtml(album, index)).join('');
      container.innerHTML = html;
    }
    
    // ============ DRAMATIC BURNING REVEAL ============
    
    // Build album card with burn overlay for reveal mode (compact layout)
    function buildRevealCardHtml(album, index) {
      const positionClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
      
      const votersHtml = album.voters.map(v => 
        '<span class="voter-chip"><span class="text-gray-300">' + escapeHtml(v.username) + '</span><span class="text-gray-500 ml-0.5">#' + v.position + '</span></span>'
      ).join('');
      
      // Card content (compact layout, no fade-in animation)
      const cardContent = '<div class="album-card album-card-compact bg-gray-800/50 rounded-lg p-3" data-rank="' + album.rank + '">' +
        '<div class="flex items-center gap-3">' +
          '<div class="position-badge ' + positionClass + ' text-gray-200 shrink-0">' + album.rank + '</div>' +
          '<div class="shrink-0">' +
            (album.coverImage ? 
              '<img src="' + album.coverImage + '" alt="' + escapeHtml(album.album) + '" class="w-14 h-14 md:w-16 md:h-16 rounded-sm object-cover">' :
              '<div class="w-14 h-14 md:w-16 md:h-16 rounded-sm bg-gray-700 flex items-center justify-center"><i class="fas fa-compact-disc text-gray-500 text-xl"></i></div>'
            ) +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="card-header">' +
              '<div class="card-title-area">' +
                '<h3 class="font-bold text-white text-sm md:text-base truncate">' + escapeHtml(album.album || 'Unknown Album') + '</h3>' +
              '</div>' +
              '<div class="card-voters">' + votersHtml + '</div>' +
            '</div>' +
            '<div class="card-stats">' +
              '<span class="text-gray-400 truncate">' + escapeHtml(album.artist || 'Unknown Artist') + '</span>' +
              '<span class="stat-divider">·</span>' +
              '<span class="points">' + album.totalPoints + ' pts</span>' +
              '<span class="stat-divider">·</span>' +
              '<span>avg ' + formatPosition(Math.round(album.averagePosition)) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
      
      // Wrap with overlay
      return '<div class="reveal-card-wrapper" data-reveal-rank="' + album.rank + '">' +
        cardContent +
        '<div class="burn-overlay" data-rank="' + album.rank + '">' +
          '<span class="rank-preview">#' + album.rank + '</span>' +
          '<div class="ember-container"></div>' +
        '</div>' +
      '</div>';
    }
    
    // Create ember particles for an overlay (intensity 1-5, where 1 is #1 position)
    function spawnEmbers(overlay, intensity) {
      const container = overlay.querySelector('.ember-container');
      if (!container) return;
      
      // More embers for higher intensity (lower rank number)
      const baseCount = 8;
      const emberCount = baseCount + (6 - intensity) * 6; // #5=8, #4=14, #3=20, #2=26, #1=32
      
      // Ember colors get more golden for top positions
      const emberColors = {
        5: ['#7c3aed', '#8b5cf6'], // purple
        4: ['#8b5cf6', '#a78bfa'], // lighter purple
        3: ['#d97706', '#f59e0b'], // bronze/orange
        2: ['#9ca3af', '#d1d5db', '#e5e7eb'], // silver
        1: ['#f59e0b', '#fbbf24', '#fcd34d', '#fef3c7'] // gold
      };
      
      const colors = emberColors[intensity] || ['#f97316'];
      
      for (let i = 0; i < emberCount; i++) {
        const ember = document.createElement('div');
        ember.className = 'ember';
        
        const color = colors[Math.floor(Math.random() * colors.length)];
        ember.style.background = color;
        ember.style.boxShadow = '0 0 6px 2px ' + color;
        
        // Random position along edges
        const edge = Math.floor(Math.random() * 4);
        let left, top;
        
        switch(edge) {
          case 0: // top
            left = Math.random() * 100;
            top = 0;
            break;
          case 1: // right
            left = 100;
            top = Math.random() * 100;
            break;
          case 2: // bottom
            left = Math.random() * 100;
            top = 100;
            break;
          case 3: // left
            left = 0;
            top = Math.random() * 100;
            break;
        }
        
        ember.style.left = left + '%';
        ember.style.top = top + '%';
        
        // Stagger ember spawning more for intense reveals
        const maxDelay = 0.2 + (6 - intensity) * 0.15;
        ember.style.animationDelay = (Math.random() * maxDelay) + 's';
        
        // Longer float duration for top positions
        const floatDuration = 1 + (6 - intensity) * 0.2;
        ember.style.animationDuration = floatDuration + 's';
        
        container.appendChild(ember);
        
        // Trigger animation
        requestAnimationFrame(() => ember.classList.add('active'));
      }
    }
    
    // ============ RETRO SOUND EFFECTS (Web Audio API) ============
    
    let audioCtx = null;
    
    function getAudioContext() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }
    
    // Play a single 8-bit style note
    function playNote(frequency, duration, type, volume, delay) {
      const ctx = getAudioContext();
      const startTime = ctx.currentTime + (delay || 0);
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(frequency, startTime);
      
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume || 0.15, startTime + 0.01);
      gain.gain.linearRampToValueAtTime(volume || 0.15, startTime + duration - 0.02);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    }
    
    // Drum roll sound (building intensity)
    function playDrumRoll(intensity) {
      const baseFreq = 80 + (6 - intensity) * 20; // Higher pitch for higher ranks
      const speed = 0.08 - (6 - intensity) * 0.01; // Faster for higher ranks
      const count = 6 + (6 - intensity) * 2;
      
      for (let i = 0; i < count; i++) {
        playNote(baseFreq + Math.random() * 20, 0.05, 'triangle', 0.1, i * speed);
      }
    }
    
    // Coin/powerup sound for positions 5-2
    function playCoinSound(rank) {
      const baseFreq = 400 + (5 - rank) * 100; // Higher for better ranks
      playNote(baseFreq, 0.1, 'square', 0.12, 0);
      playNote(baseFreq * 1.5, 0.15, 'square', 0.1, 0.08);
    }
    
    // Mario-style fanfare for #1
    function playVictoryFanfare() {
      const notes = [
        // Opening flourish
        { f: 392, d: 0.1, t: 0 },      // G4
        { f: 523, d: 0.1, t: 0.1 },    // C5
        { f: 659, d: 0.1, t: 0.2 },    // E5
        { f: 784, d: 0.15, t: 0.3 },   // G5
        { f: 1047, d: 0.2, t: 0.45 },  // C6
        { f: 988, d: 0.1, t: 0.65 },   // B5
        { f: 1047, d: 0.4, t: 0.75 },  // C6 (held)
        
        // Secondary melody
        { f: 659, d: 0.1, t: 1.2 },    // E5
        { f: 784, d: 0.1, t: 1.3 },    // G5
        { f: 1047, d: 0.1, t: 1.4 },   // C6
        { f: 1175, d: 0.15, t: 1.5 },  // D6
        { f: 1319, d: 0.3, t: 1.65 },  // E6
        
        // Final triumphant notes
        { f: 1047, d: 0.15, t: 2.0 },  // C6
        { f: 1175, d: 0.15, t: 2.15 }, // D6
        { f: 1319, d: 0.5, t: 2.3 },   // E6 (finale)
      ];
      
      notes.forEach(n => {
        playNote(n.f, n.d, 'square', 0.12, n.t);
        // Add harmony
        playNote(n.f * 0.5, n.d, 'triangle', 0.06, n.t);
      });
      
      // Bass drum hits
      [0, 0.45, 1.2, 2.0, 2.3].forEach(t => {
        playNote(60, 0.15, 'triangle', 0.15, t);
      });
      
      // Shimmer effect at end
      for (let i = 0; i < 8; i++) {
        playNote(1319 + i * 50, 0.08, 'sine', 0.04, 2.5 + i * 0.05);
      }
    }
    
    // Firework explosion sound
    function playFireworkSound() {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      
      // White noise burst for explosion
      const bufferSize = ctx.sampleRate * 0.3;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
      }
      
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3000, now);
      filter.frequency.exponentialRampToValueAtTime(200, now + 0.3);
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      noise.start(now);
      noise.stop(now + 0.3);
    }
    
    // Create position-specific screen effects (graduated intensity for #5-#2)
    function triggerPositionEffect(rank) {
      const effectColors = {
        5: { color: 'rgba(124, 58, 237, 0.15)', duration: 400 },  // Subtle purple pulse
        4: { color: 'rgba(139, 92, 246, 0.25)', duration: 500 },  // Purple pulse
        3: { color: 'rgba(217, 119, 6, 0.35)', duration: 600 },   // Bronze pulse
        2: { color: 'rgba(209, 213, 219, 0.4)', duration: 700 }   // Silver pulse
      };
      
      const effect = effectColors[rank];
      if (!effect) return;
      
      // Create screen pulse
      const pulse = document.createElement('div');
      pulse.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:45;' +
        'background:radial-gradient(circle at center, ' + effect.color + ' 0%, transparent 70%);' +
        'animation: positionPulse ' + effect.duration + 'ms ease-out forwards;';
      document.body.appendChild(pulse);
      setTimeout(() => pulse.remove(), effect.duration);
      
      // Add mini firework burst for #3 and #2
      if (rank <= 3) {
        const burstCount = rank === 2 ? 3 : 2;
        for (let i = 0; i < burstCount; i++) {
          setTimeout(() => {
            triggerMiniBurst(rank);
          }, i * 150);
        }
      }
    }
    
    // Mini burst effect for positions 3 and 2
    function triggerMiniBurst(rank) {
      const colors = rank === 2 ? 
        ['#9ca3af', '#d1d5db', '#e5e7eb'] : 
        ['#d97706', '#f59e0b', '#fbbf24'];
      
      const burst = document.createElement('div');
      burst.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:46;';
      
      const particleCount = rank === 2 ? 15 : 10;
      
      for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        const color = colors[Math.floor(Math.random() * colors.length)];
        const angle = (i / particleCount) * Math.PI * 2;
        const distance = 60 + Math.random() * 40;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance;
        
        particle.style.cssText = 'position:absolute;width:6px;height:6px;border-radius:50%;' +
          'background:' + color + ';box-shadow:0 0 8px ' + color + ';' +
          'animation: miniBurstParticle 0.8s ease-out forwards;' +
          '--tx:' + tx + 'px;--ty:' + ty + 'px;';
        
        burst.appendChild(particle);
      }
      
      document.body.appendChild(burst);
      setTimeout(() => burst.remove(), 1000);
    }
    
    // Create spectacular fireworks celebration for #1
    function triggerCelebration() {
      const colors = ['#fbbf24', '#f59e0b', '#dc2626', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
      const goldColors = ['#fbbf24', '#f59e0b', '#fcd34d', '#fef3c7'];
      
      // Golden rays - larger and longer (10 seconds)
      const rays = document.createElement('div');
      rays.className = 'golden-rays';
      document.body.appendChild(rays);
      setTimeout(() => rays.remove(), 10000);
      
      // Multiple screen flashes
      for (let f = 0; f < 3; f++) {
        setTimeout(() => {
          const flash = document.createElement('div');
          flash.className = 'screen-flash';
          flash.style.animationDuration = (1.5 - f * 0.3) + 's';
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 1500);
        }, f * 800);
      }
      
      // Fireworks container
      const fireworksContainer = document.createElement('div');
      fireworksContainer.className = 'fireworks-container';
      document.body.appendChild(fireworksContainer);
      
      // Wave 1: Initial burst - 8 fireworks
      const wave1Positions = [
        { x: 20, y: 100 }, { x: 80, y: 100 },
        { x: 35, y: 100 }, { x: 65, y: 100 },
        { x: 15, y: 100 }, { x: 85, y: 100 },
        { x: 50, y: 100 }, { x: 45, y: 100 }
      ];
      
      for (let i = 0; i < wave1Positions.length; i++) {
        const delay = i * 150 + Math.random() * 100;
        const pos = wave1Positions[i];
        const launchHeight = 280 + Math.random() * 180;
        const explodeY = 100 - (launchHeight / window.innerHeight * 100);
        
        setTimeout(() => {
          launchFirework(fireworksContainer, pos.x, pos.y, explodeY, launchHeight, colors);
          setTimeout(() => playFireworkSound(), 600); // Sound on explosion
        }, delay);
      }
      
      // Wave 2: Second burst at 1.5s - 6 more fireworks
      const wave2Positions = [
        { x: 25, y: 100 }, { x: 75, y: 100 },
        { x: 40, y: 100 }, { x: 60, y: 100 },
        { x: 10, y: 100 }, { x: 90, y: 100 }
      ];
      
      for (let i = 0; i < wave2Positions.length; i++) {
        const delay = 1500 + i * 180 + Math.random() * 120;
        const pos = wave2Positions[i];
        const launchHeight = 300 + Math.random() * 200;
        const explodeY = 100 - (launchHeight / window.innerHeight * 100);
        
        setTimeout(() => {
          launchFirework(fireworksContainer, pos.x, pos.y, explodeY, launchHeight, goldColors);
          setTimeout(() => playFireworkSound(), 600);
        }, delay);
      }
      
      // Wave 3: Final golden burst at 3s - 4 big golden fireworks
      const wave3Positions = [
        { x: 30, y: 100 }, { x: 70, y: 100 },
        { x: 50, y: 100 }, { x: 50, y: 100 }
      ];
      
      for (let i = 0; i < wave3Positions.length; i++) {
        const delay = 3000 + i * 250 + Math.random() * 100;
        const pos = wave3Positions[i];
        const launchHeight = 350 + Math.random() * 150;
        const explodeY = 100 - (launchHeight / window.innerHeight * 100);
        
        setTimeout(() => {
          launchFirework(fireworksContainer, pos.x, pos.y, explodeY, launchHeight, goldColors, true);
          setTimeout(() => {
            playFireworkSound();
            // Extra bass boom for big bursts
            playNote(50, 0.3, 'triangle', 0.2, 0);
          }, 600);
        }, delay);
      }
      
      // Multiple confetti bursts throughout celebration
      for (let burst = 0; burst < 5; burst++) {
        setTimeout(() => {
          triggerConfettiBurst(colors, burst === 4 ? 80 : 50);
        }, burst * 1000);
      }
      
      // Extended gold confetti bursts (lasting until 10 seconds)
      const goldBurstTimes = [3500, 5000, 6500, 8000, 9000];
      goldBurstTimes.forEach((time, i) => {
        setTimeout(() => {
          triggerConfettiBurst(goldColors, 40 + i * 10);
          // Accompanying firework sounds
          playFireworkSound();
          if (i % 2 === 0) {
            playNote(60 + i * 10, 0.2, 'triangle', 0.15, 0);
          }
        }, time);
      });
      
      // Extra finale fireworks at 7s and 9s
      [7000, 9000].forEach((time, idx) => {
        setTimeout(() => {
          const pos = { x: 30 + idx * 40, y: 100 };
          launchFirework(fireworksContainer, pos.x, pos.y, 30, 400, goldColors, true);
          setTimeout(() => {
            playFireworkSound();
            playNote(50, 0.3, 'triangle', 0.2, 0);
          }, 600);
        }, time);
      });
      
      setTimeout(() => fireworksContainer.remove(), 11000);
    }
    
    // Separate confetti burst function for reuse
    function triggerConfettiBurst(colors, count) {
      const burst = document.createElement('div');
      burst.className = 'celebration-burst';
      
      for (let i = 0; i < count; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        
        const angle = (Math.random() * 360) * (Math.PI / 180);
        const distance = 150 + Math.random() * 350;
        const tx = Math.cos(angle) * distance;
        const ty = Math.sin(angle) * distance - 180;
        
        confetti.style.setProperty('--tx', tx + 'px');
        confetti.style.setProperty('--ty', ty + 'px');
        confetti.style.animationDelay = (Math.random() * 0.4) + 's';
        
        burst.appendChild(confetti);
      }
      
      document.body.appendChild(burst);
      
      requestAnimationFrame(() => {
        burst.querySelectorAll('.confetti').forEach(c => c.classList.add('active'));
      });
      
      setTimeout(() => burst.remove(), 2500);
    }
    
    // Launch a single firework (bigBurst = true for finale fireworks)
    function launchFirework(container, startX, startY, explodeY, launchHeight, colors, bigBurst) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      // Create launch trail
      const firework = document.createElement('div');
      firework.className = 'firework';
      firework.style.left = startX + '%';
      firework.style.top = startY + '%';
      firework.style.background = color;
      firework.style.boxShadow = '0 0 ' + (bigBurst ? '12px 5px ' : '8px 3px ') + color;
      firework.style.width = bigBurst ? '8px' : '6px';
      firework.style.height = bigBurst ? '8px' : '6px';
      firework.style.setProperty('--launch-height', '-' + launchHeight + 'px');
      firework.style.setProperty('--launch-duration', (0.6 + Math.random() * 0.3) + 's');
      
      container.appendChild(firework);
      
      // Add sparkle trail during launch
      const trailInterval = setInterval(() => {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle-trail';
        sparkle.style.left = firework.getBoundingClientRect().left + 'px';
        sparkle.style.top = firework.getBoundingClientRect().top + 'px';
        sparkle.style.color = color;
        if (bigBurst) {
          sparkle.style.width = '5px';
          sparkle.style.height = '5px';
        }
        container.appendChild(sparkle);
        requestAnimationFrame(() => sparkle.classList.add('active'));
        setTimeout(() => sparkle.remove(), 600);
      }, bigBurst ? 40 : 50);
      
      requestAnimationFrame(() => firework.classList.add('launching'));
      
      // Explode after launch
      const launchDuration = parseFloat(firework.style.getPropertyValue('--launch-duration')) * 1000;
      setTimeout(() => {
        clearInterval(trailInterval);
        firework.classList.remove('launching');
        firework.classList.add('exploding');
        
        // Create explosion particles (more for big bursts)
        const baseCount = bigBurst ? 35 : 20;
        const particleCount = baseCount + Math.floor(Math.random() * (bigBurst ? 20 : 15));
        const explodeX = startX;
        
        for (let i = 0; i < particleCount; i++) {
          const particle = document.createElement('div');
          particle.className = 'firework-particle';
          particle.style.left = explodeX + '%';
          particle.style.top = explodeY + '%';
          
          // Use multiple colors for big bursts
          const particleColor = bigBurst ? colors[Math.floor(Math.random() * colors.length)] : color;
          particle.style.background = particleColor;
          particle.style.boxShadow = '0 0 ' + (bigBurst ? '10px 4px ' : '6px 2px ') + particleColor;
          
          if (bigBurst) {
            particle.style.width = '6px';
            particle.style.height = '6px';
          }
          
          // Circular explosion pattern (larger for big bursts)
          const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.3;
          const distance = (bigBurst ? 120 : 80) + Math.random() * (bigBurst ? 120 : 80);
          const px = Math.cos(angle) * distance;
          const py = Math.sin(angle) * distance + (bigBurst ? 50 : 30); // Gravity effect
          
          particle.style.setProperty('--px', px + 'px');
          particle.style.setProperty('--py', py + 'px');
          particle.style.setProperty('--particle-duration', (bigBurst ? 1.5 : 1) + Math.random() * (bigBurst ? 0.8 : 0.5) + 's');
          particle.style.animationDelay = (Math.random() * 0.15) + 's';
          
          container.appendChild(particle);
          requestAnimationFrame(() => particle.classList.add('active'));
          
          setTimeout(() => particle.remove(), bigBurst ? 2500 : 1800);
        }
        
        // Secondary explosion ring for big bursts
        if (bigBurst) {
          setTimeout(() => {
            for (let j = 0; j < 20; j++) {
              const particle2 = document.createElement('div');
              particle2.className = 'firework-particle';
              particle2.style.left = explodeX + '%';
              particle2.style.top = explodeY + '%';
              const p2Color = colors[Math.floor(Math.random() * colors.length)];
              particle2.style.background = p2Color;
              particle2.style.boxShadow = '0 0 8px 3px ' + p2Color;
              
              const angle2 = (j / 20) * Math.PI * 2;
              const dist2 = 60 + Math.random() * 60;
              particle2.style.setProperty('--px', Math.cos(angle2) * dist2 + 'px');
              particle2.style.setProperty('--py', Math.sin(angle2) * dist2 + 40 + 'px');
              particle2.style.setProperty('--particle-duration', '1.2s');
              
              container.appendChild(particle2);
              requestAnimationFrame(() => particle2.classList.add('active'));
              setTimeout(() => particle2.remove(), 1500);
            }
          }, 150);
        }
        
        setTimeout(() => firework.remove(), 100);
      }, launchDuration);
    }
    
    // Calculate reveal phases based on POSITIONS (ranks), not indices
    // - Ranks > 40: reveal in groups of 20 (bottom-to-top)
    // - Ranks 6-40: reveal in groups of 5 (bottom-to-top)
    // - Ranks 1-5: individual reveal (all albums sharing that rank together)
    // - Tied albums are NEVER split across bulk groups
    function calculateRevealPhases(albums) {
      const phases = [];
      const totalAlbums = albums.length;
      
      if (totalAlbums === 0) return phases;
      
      const topRanks = [5, 4, 3, 2, 1]; // Positions to reveal individually
      
      // Helper function to create batches from items with a given batch size
      function createBatches(items, batchSize) {
        const batches = [];
        let currentBatch = [];
        
        // Process from bottom (highest index) to top (lowest index)
        for (let i = items.length - 1; i >= 0; i--) {
          const item = items[i];
          currentBatch.push(item.idx);
          
          // Check if we've reached batch size
          if (currentBatch.length >= batchSize) {
            // Before closing batch, check if next item has same rank (tie)
            // If so, include it in this batch to avoid splitting ties
            while (i > 0 && items[i - 1].rank === item.rank) {
              i--;
              currentBatch.push(items[i].idx);
            }
            batches.push([...currentBatch]);
            currentBatch = [];
          }
        }
        
        // Don't forget remaining items
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
        }
        
        return batches;
      }
      
      // Get items by rank category
      const farBulkItems = albums
        .map((a, idx) => ({ album: a, idx, rank: a.rank }))
        .filter(item => item.album.rank > 40); // Groups of 20
      
      const nearBulkItems = albums
        .map((a, idx) => ({ album: a, idx, rank: a.rank }))
        .filter(item => item.album.rank > 5 && item.album.rank <= 40); // Groups of 5
      
      // Create batches for far bulk (ranks > 40) - groups of 20
      const farBatches = createBatches(farBulkItems, 20);
      
      // Create batches for near bulk (ranks 6-40) - groups of 5
      const nearBatches = createBatches(nearBulkItems, 5);
      
      // Add all bulk phases (far first since they're lower positions, then near)
      const allBatches = [...farBatches, ...nearBatches];
      allBatches.forEach((batchIndices, idx) => {
        const label = idx === 0 ? 'Begin Reveal' : 'Continue...';
        phases.push({ indices: batchIndices, label, isBulk: true });
      });
      
      // Individual reveals for positions 5, 4, 3, 2, 1 (all albums sharing that rank)
      for (const rank of topRanks) {
        const albumsWithRank = albums
          .map((a, idx) => ({ album: a, idx }))
          .filter(item => item.album.rank === rank);
        
        if (albumsWithRank.length > 0) {
          const indices = albumsWithRank.map(item => item.idx);
          phases.push({ 
            indices, 
            label: 'Reveal #' + rank + (rank === 1 ? '!' : ''), 
            isBulk: false,
            rank 
          });
        }
      }
      
      return phases;
    }
    
    // Main dramatic reveal renderer
    function renderDramaticReveal(data) {
      const container = document.getElementById('aggregateListContent');
      
      if (!data.albums || data.albums.length === 0) {
        container.innerHTML = '<div class="text-center py-12 text-gray-400">No albums in the aggregate list yet.</div>';
        return;
      }
      
      const albums = data.albums;
      const phases = calculateRevealPhases(albums);
      let currentPhase = 0;
      
      // Build all cards with overlays
      const html = albums.map((album, index) => buildRevealCardHtml(album, index)).join('');
      container.innerHTML = '<div class="space-y-4">' + html + '</div>';
      
      // Create floating reveal button
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'reveal-button-container';
      buttonContainer.innerHTML = '<button class="reveal-button"><i class="fas fa-fire mr-2"></i><span>' + phases[0].label + '</span></button>';
      document.body.appendChild(buttonContainer);
      
      const button = buttonContainer.querySelector('.reveal-button');
      const buttonText = button.querySelector('span');
      
      // Scroll to bottom after a short delay - find last album by highest rank number
      setTimeout(() => {
        const maxRank = Math.max(...albums.map(a => a.rank));
        const lastCards = container.querySelectorAll('[data-reveal-rank="' + maxRank + '"]');
        if (lastCards.length > 0) {
          lastCards[lastCards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
      
      // Reveal function
      function revealPhase() {
        if (currentPhase >= phases.length) return;
        
        const phase = phases[currentPhase];
        button.disabled = true;
        
        // Get overlays by index (more reliable than rank for ties)
        const overlays = [];
        for (const idx of phase.indices) {
          const wrapper = container.querySelectorAll('.reveal-card-wrapper')[idx];
          if (wrapper) {
            const overlay = wrapper.querySelector('.burn-overlay');
            const rank = parseInt(overlay.dataset.rank, 10);
            overlays.push({ overlay, rank, idx });
          }
        }
        
        // Sort overlays to reveal from bottom to top (highest index first)
        overlays.sort((a, b) => b.idx - a.idx);
        
        // Calculate intensity and animation duration based on rank
        function getIntensity(rank) {
          if (rank === 1) return 1;
          if (rank === 2) return 2;
          if (rank === 3) return 3;
          if (rank === 4) return 4;
          if (rank === 5) return 5;
          return 6; // regular albums
        }
        
        function getAnimationDuration(rank) {
          if (rank === 1) return 2800;  // 800ms delay + 2s burnAwayDelayed
          if (rank === 2) return 1300;  // matches glowBorderSilver (1.3s)
          if (rank === 3) return 1100;  // matches glowBorderBronze (1.1s)
          if (rank === 4) return 1100;  // matches glowBorderRank4 (1.1s)
          if (rank === 5) return 1000;  // matches glowBorderRank5 (1s)
          return 800;                   // matches burnAway (0.8s)
        }
        
        // Animate overlays with stagger
        let maxDuration = 0;
        
        overlays.forEach((item, idx) => {
          const delay = idx * 150; // Stagger within group
          const intensity = getIntensity(item.rank);
          const animDuration = getAnimationDuration(item.rank);
          
          maxDuration = Math.max(maxDuration, delay + animDuration);
          
          setTimeout(() => {
            // Scroll to keep visible first
            const wrapper = item.overlay.closest('.reveal-card-wrapper');
            if (wrapper) {
              wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            // Special handling for #1 - trigger celebration FIRST, then reveal
            if (item.rank === 1) {
              // Play victory fanfare!
              playVictoryFanfare();
              
              // Start celebration immediately
              triggerCelebration();
              
              // Spawn embers with max intensity
              spawnEmbers(item.overlay, 1);
              
              // Delay the burn animation so effects play first
              setTimeout(() => {
                item.overlay.classList.add('gold');
                item.overlay.classList.add('burning');
              }, 800); // 800ms of pure celebration before reveal starts
              
            } else {
              // Add intensity class for top 5
              if (item.rank === 5) item.overlay.classList.add('rank-5');
              if (item.rank === 4) item.overlay.classList.add('rank-4');
              if (item.rank === 3) item.overlay.classList.add('bronze');
              if (item.rank === 2) item.overlay.classList.add('silver');
              
              // Play sounds only for top 3 (excluding #1 which has its own fanfare)
              if (item.rank === 3) {
                playDrumRoll(3);
                setTimeout(() => playCoinSound(3), 150);
              } else if (item.rank === 2) {
                playDrumRoll(2);
                setTimeout(() => playCoinSound(2), 150);
              }
              
              // Spawn embers with appropriate intensity
              spawnEmbers(item.overlay, intensity);
              
              // Trigger burn animation
              item.overlay.classList.add('burning');
              
              // Add screen effects for top 5 positions (building intensity)
              if (item.rank <= 5 && item.rank >= 2) {
                triggerPositionEffect(item.rank);
              }
            }
          }, delay);
        });
        
        // Calculate total phase duration
        const phaseDuration = maxDuration + 50; // Minimal buffer
        
        setTimeout(() => {
          currentPhase++;
          
          if (currentPhase < phases.length) {
            // Update button for next phase
            buttonText.textContent = phases[currentPhase].label;
            button.disabled = false;
          } else {
            // All revealed! Remove button and mark as seen
            buttonContainer.style.opacity = '0';
            buttonContainer.style.transition = 'opacity 0.5s';
            setTimeout(() => buttonContainer.remove(), 500);
            
            // Mark as seen
            markRevealAsSeen();
          }
        }, phaseDuration);
      }
      
      // Button click handler
      button.addEventListener('click', revealPhase);
    }
    
    // Mark reveal as seen via API
    async function markRevealAsSeen() {
      try {
        await apiFetch('/api/aggregate-list/' + YEAR + '/mark-seen', { method: 'POST' });
        console.log('Reveal marked as seen');
      } catch (err) {
        console.error('Failed to mark reveal as seen:', err);
      }
    }
    
    // Render pre-reveal status with position placeholders
    function renderPendingReveal(status) {
      const container = document.getElementById('aggregateListContent');
      const totalAlbums = status.totalAlbums || 0;
      const rankDistribution = status.rankDistribution || {};
      
      // Generate position placeholder cards based on actual rank structure
      let placeholdersHtml = '';
      if (totalAlbums > 0 && Object.keys(rankDistribution).length > 0) {
        // Get sorted ranks (convert to numbers and sort)
        const sortedRanks = Object.keys(rankDistribution)
          .map(rank => parseInt(rank, 10))
          .sort((a, b) => a - b);
        
        let cardIndex = 0;
        sortedRanks.forEach(rank => {
          const albumCount = rankDistribution[rank];
          // Generate a placeholder card for each album at this rank
          for (let j = 0; j < albumCount; j++) {
            const positionClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
            const delay = Math.min(cardIndex * 30, 300);
            
            placeholdersHtml += 
              '<div class="album-card bg-gray-800/30 rounded-lg p-4 animate-fade-in" style="animation-delay: ' + delay + 'ms; opacity: 0;">' +
                '<div class="flex items-center gap-4">' +
                  '<div class="position-badge ' + positionClass + ' text-gray-200 shrink-0">' + rank + '</div>' +
                  '<div class="w-16 h-16 md:w-20 md:h-20 rounded-sm bg-gray-700/50 flex items-center justify-center shrink-0">' +
                    '<i class="fas fa-question text-gray-600 text-2xl"></i>' +
                  '</div>' +
                  '<div class="flex-1 min-w-0">' +
                    '<div class="h-5 bg-gray-700/50 rounded-sm w-2/3 mb-2"></div>' +
                    '<div class="h-4 bg-gray-700/30 rounded-sm w-1/2"></div>' +
                  '</div>' +
                  '<div class="shrink-0">' +
                    '<i class="fas fa-lock text-gray-600"></i>' +
                  '</div>' +
                '</div>' +
              '</div>';
            cardIndex++;
          }
        });
      } else if (totalAlbums > 0) {
        // Fallback: if rankDistribution is not available, use sequential generation
        for (let i = 1; i <= totalAlbums; i++) {
          const positionClass = i === 1 ? 'gold' : i === 2 ? 'silver' : i === 3 ? 'bronze' : '';
          const delay = Math.min((i - 1) * 30, 300);
          
          placeholdersHtml += 
            '<div class="album-card bg-gray-800/30 rounded-lg p-4 animate-fade-in" style="animation-delay: ' + delay + 'ms; opacity: 0;">' +
              '<div class="flex items-center gap-4">' +
                '<div class="position-badge ' + positionClass + ' text-gray-200 shrink-0">' + i + '</div>' +
                '<div class="w-16 h-16 md:w-20 md:h-20 rounded-sm bg-gray-700/50 flex items-center justify-center shrink-0">' +
                  '<i class="fas fa-question text-gray-600 text-2xl"></i>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                  '<div class="h-5 bg-gray-700/50 rounded-sm w-2/3 mb-2"></div>' +
                  '<div class="h-4 bg-gray-700/30 rounded-sm w-1/2"></div>' +
                '</div>' +
                '<div class="shrink-0">' +
                  '<i class="fas fa-lock text-gray-600"></i>' +
                '</div>' +
              '</div>' +
            '</div>';
        }
      } else {
        placeholdersHtml = '<div class="text-center py-8 text-gray-500">No main lists submitted yet.</div>';
      }
      
      // Confirmations section for bottom
      const confirmationsHtml = status.confirmations.map(c => 
        '<div class="flex items-center gap-2 text-green-400"><i class="fas fa-check-circle"></i><span>' + c.username + '</span><span class="text-gray-500 text-sm">' + new Date(c.confirmedAt).toLocaleString() + '</span></div>'
      ).join('');
      
      const pendingCount = status.requiredConfirmations - status.confirmationCount;
      const pendingHtml = pendingCount > 0 ? 
        '<div class="flex items-center gap-2 text-gray-500"><i class="far fa-circle"></i><span>Awaiting ' + pendingCount + ' more confirmation' + (pendingCount !== 1 ? 's' : '') + '</span></div>' : '';
      
      container.innerHTML = 
        '<div class="mb-6 text-center">' +
          '<p class="text-gray-400 text-sm"><i class="fas fa-lock mr-2"></i>Awaiting reveal (' + status.confirmationCount + '/' + status.requiredConfirmations + ' confirmations)</p>' +
        '</div>' +
        '<div class="space-y-3">' + placeholdersHtml + '</div>' +
        '<div class="mt-8 pt-6 border-t border-gray-700/50 text-center">' +
          '<div class="inline-block text-left">' +
            '<p class="text-sm text-gray-500 uppercase tracking-wide mb-2">Admin Confirmations</p>' +
            '<div class="space-y-1">' + confirmationsHtml + pendingHtml + '</div>' +
          '</div>' +
        '</div>';
    }
    
    // Main load function
    async function loadAggregateList() {
      try {
        // First check status
        const status = await apiFetch('/api/aggregate-list/' + YEAR + '/status');
        
        if (status.revealed) {
          // Load full data
          const data = await apiFetch('/api/aggregate-list/' + YEAR);
          
          // Check if user has seen the dramatic reveal
          try {
            const seenStatus = await apiFetch('/api/aggregate-list/' + YEAR + '/has-seen');
            
            if (seenStatus.hasSeen) {
              // Already seen - normal render
              renderAggregateList(data.data);
            } else {
              // First time - dramatic burning reveal!
              renderDramaticReveal(data.data);
            }
          } catch (seenErr) {
            // If has-seen check fails, fall back to normal render
            console.warn('Could not check reveal status, using normal render:', seenErr);
            renderAggregateList(data.data);
          }
        } else {
          // Show pending state
          renderPendingReveal(status);
        }
      } catch (err) {
        document.getElementById('aggregateListContent').innerHTML = 
          '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-4xl text-red-500 mb-4"></i><p class="text-gray-400">' + err.message + '</p></div>';
      }
    }
    
    // Initialize
    loadAggregateList();
  </script>
</body>
</html>
`;

// ── Extension Auth Template ──────────────────────────────────────────────────

const extensionAuthTemplate = () => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize SuShe Extension</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 500px;
      padding: 40px;
      text-align: center;
    }
    h1 {
      font-size: 32px;
      margin: 0 0 16px 0;
      color: #dc2626;
    }
    p {
      font-size: 16px;
      line-height: 1.6;
      color: #9ca3af;
      margin: 0 0 24px 0;
    }
    .success {
      padding: 16px;
      background: #065f46;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
      color: #d1fae5;
    }
    .token-box {
      padding: 16px;
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      margin-bottom: 24px;
      word-break: break-all;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #60a5fa;
    }
    button {
      padding: 12px 24px;
      background: #dc2626;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
      margin-bottom: 12px;
    }
    button:hover {
      background: #b91c1c;
    }
    button:disabled {
      background: #374151;
      cursor: not-allowed;
    }
    .info {
      font-size: 14px;
      color: #6b7280;
      margin-top: 24px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #fff;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>&#129320; Authorize Browser Extension</h1>
    <p>Click the button below to authorize the SuShe Online browser extension.</p>

    <div id="status"></div>

    <button id="authorizeBtn" onclick="generateToken()">
      Authorize Extension
    </button>

    <div class="info">
      This will generate a secure token that allows your browser extension to access your SuShe lists.
      You can revoke this access anytime from your settings page.
    </div>
  </div>

  <script>
    async function generateToken() {
      var btn = document.getElementById('authorizeBtn');
      var status = document.getElementById('status');

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Generating token...';
      status.innerHTML = '';

      try {
        var response = await fetch('/api/auth/extension-token', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to generate token');
        }

        var data = await response.json();

        status.innerHTML =
          '<div class="success">' +
          '\\u2713 Authorization successful!<br><br>Connecting to extension...' +
          '</div>';

        btn.innerHTML = 'Authorization Complete';

        // Dispatch custom event for content script to receive token
        window.dispatchEvent(new CustomEvent('sushe-auth-complete', {
          detail: {
            token: data.token,
            expiresAt: data.expiresAt
          }
        }));

        // Give the extension time to pick up the event
        setTimeout(function() {
          status.innerHTML =
            '<div class="success">' +
            '\\u2713 Extension should now be authorized!<br><br>You can close this window.' +
            '</div>';

          // Auto-close after another 2 seconds
          setTimeout(function() {
            window.close();
          }, 2000);
        }, 500);

      } catch (error) {
        console.error('Error generating token:', error);
        status.innerHTML =
          '<div style="padding: 16px; background: #7f1d1d; border-radius: 8px; margin-bottom: 24px; color: #fecaca;">' +
          '\\u2717 Failed to generate token. Please try again.' +
          '</div>';
        btn.disabled = false;
        btn.innerHTML = 'Retry';
      }
    }
  </script>
</body>
</html>
`;

module.exports = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  aggregateListTemplate,
  extensionAuthTemplate,
  headerComponent,
  formatDate,
  formatDateTime,
  asset,
};
