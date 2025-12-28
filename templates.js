const { adjustColor, colorWithOpacity } = require('./color-utils');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
// Use a timestamp-based asset version to avoid browser caching issues
const assetVersion = process.env.ASSET_VERSION || Date.now().toString();
const asset = (p) => `${p}?v=${assetVersion}`;

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
    <div class="flex items-center justify-between h-12 lg:h-14 px-3 lg:px-0">
      <!-- Mobile menu button / Desktop logo -->
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
        <a href="/" class="text-xl lg:text-2xl font-bold text-red-600 hover:text-red-500 transition duration-200">SuShe</a>
      </div>
      
      <!-- Current list name (mobile only) -->
      <span id="mobileCurrentListName" class="lg:hidden text-sm text-gray-300 font-medium truncate max-w-[40%] hidden"></span>
      
      <!-- User menu -->
      <div class="flex items-center pr-0.5 lg:pr-1">
        <span class="text-xs lg:text-sm text-gray-400 truncate max-w-[120px] lg:max-w-none">${user?.username || user?.email}</span>
        <a href="/settings" class="flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target ml-4 lg:ml-6" title="Settings">
          <i class="fas fa-cog text-lg"></i>
        </a>
        <a href="/logout" class="flex items-center justify-center text-gray-400 hover:text-white transition duration-200 touch-target ml-3 lg:ml-4" title="Logout">
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
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none transition duration-200"
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none transition duration-200"
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none transition duration-200"
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none transition duration-200"
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
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Create Account
      </button>
    </form>
    
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center flash-message" data-flash="error">${flash.error[0]}</p>` : ''}
    
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
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none transition duration-200"
          name="email" 
          id="email"
          type="email" 
          placeholder="your@email.com" 
          required 
        />
      </div>
      <button 
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset password
      </button>
    </form>
    
    ${flash.info && flash.info.length ? `<p class="text-blue-400 text-sm mt-4 text-center flash-message" data-flash="info">${flash.info[0]}</p>` : ''}
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center flash-message" data-flash="error">${flash.error[0]}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
`;

// Reset password template
const resetPasswordTemplate = (token, csrfToken = '') => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none transition duration-200"
          name="password" 
          id="password"
          type="password" 
          placeholder="••••••••" 
          required 
          minlength="8"
        />
      </div>
      <button 
        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset Password
      </button>
    </form>
  </div>
`;

// Invalid token template
const invalidTokenTemplate = () => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <p class="text-red-500 text-center mb-4">This password reset link has expired or is invalid</p>
    <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request a new reset link</a>
  </div>
`;

// Component: Import Conflict Modal
const importConflictModalComponent = () => `
  <div id="importConflictModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
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
            class="w-full text-left p-4 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 hover:border-red-600 transition-colors group"
          >
            <div class="font-semibold text-white group-hover:text-red-500">Overwrite Existing List</div>
            <div class="text-xs text-gray-400 mt-1">Replace the current list with the imported one</div>
          </button>
          
          <button 
            id="importRenameBtn"
            class="w-full text-left p-4 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 hover:border-red-600 transition-colors group"
          >
            <div class="font-semibold text-white group-hover:text-red-500">Rename Import</div>
            <div class="text-xs text-gray-400 mt-1">Save with a different name</div>
          </button>
          
          <button 
            id="importMergeBtn"
            class="w-full text-left p-4 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 hover:border-red-600 transition-colors group"
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
          class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200"
        >
          Cancel Import
        </button>
      </div>
    </div>
  </div>
  
  <!-- Rename Import Modal -->
  <div id="importRenameModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
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
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
          maxlength="50"
        >
        <p class="text-xs text-gray-500 mt-2">Choose a unique name for the imported list</p>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="cancelImportRenameBtn" 
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmImportRenameBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 font-semibold"
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
  <div id="contextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
    <button id="downloadListOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-download mr-2 w-4 text-center"></i>Download List
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
    <button id="deleteListOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-trash mr-2 w-4 text-center"></i>Delete List
    </button>
  </div>
  
  <!-- Context Menu for Albums -->
  <div id="albumContextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
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
    <!-- Last.fm Discovery Options (shown only when connected) -->
    <div id="lastfmMenuDivider" class="hidden border-t border-gray-700 my-1"></div>
    <button id="similarArtistsOption" class="hidden w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-users mr-2 w-4 text-center text-purple-400"></i>Show Similar Artists
    </button>
    <div class="border-t border-gray-700 my-1"></div>
    <button id="removeAlbumOption" class="w-full block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-times mr-2 w-4 text-center"></i>Remove from List
    </button>
  </div>
  
  <!-- Submenu for Move to List -->
  <div id="albumMoveSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-36">
    <!-- Populated dynamically -->
  </div>
  
  <!-- Submenu for Play Album (Spotify Connect devices) -->
  <div id="playAlbumSubmenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50 max-h-64 overflow-y-auto min-w-44">
    <!-- Populated dynamically with devices -->
  </div>
`;

// Component: Create List Modal
const createListModalComponent = () => `
  <div id="createListModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
            maxlength="50"
          >
          <p class="text-xs text-gray-500 mt-2">Give your list a unique name</p>
        </div>
        
        <div>
          <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newListYear">
            Year <span class="text-red-500">*</span>
          </label>
          <input 
            type="number" 
            id="newListYear" 
            placeholder="e.g. 2025" 
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
            min="1000"
            max="9999"
          >
          <p class="text-xs text-gray-500 mt-2">Year this list represents (e.g. "Best of 2024")</p>
          <p id="createYearError" class="text-xs text-red-500 mt-1 hidden"></p>
        </div>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="cancelCreateBtn" 
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmCreateBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 font-semibold"
        >
          Create List
        </button>
      </div>
    </div>
  </div>
`;

// Component: Edit List Details Modal (formerly Rename List Modal)
const renameListModalComponent = () => `
  <div id="renameListModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
            class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
          class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmRenameBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 font-semibold"
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
    <div class="bg-gray-900 border border-gray-800 lg:rounded-lg shadow-2xl w-full h-full lg:h-auto lg:max-w-4xl lg:max-h-[90vh] flex flex-col">
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
                class="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
            <div class="sticky top-0 bg-gray-900 p-4 lg:p-6 border-b border-gray-800 z-10 backdrop-blur-sm bg-opacity-95">
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition duration-200"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-gray-500 transition duration-200"
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
                    <div id="coverPreview" class="w-20 h-20 lg:w-32 lg:h-32 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700 flex-shrink-0">
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
  <div id="confirmationModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md transform transition-all">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 id="confirmationTitle" class="text-xl font-bold text-white">Confirm Action</h3>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6">
        <p id="confirmationMessage" class="text-gray-300"></p>
        <p id="confirmationSubMessage" class="text-sm text-gray-500 mt-2"></p>
      </div>
      
      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800 flex gap-3 justify-end">
        <button 
          id="confirmationCancelBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition duration-200"
        >
          Cancel
        </button>
        <button 
          id="confirmationConfirmBtn" 
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition duration-200 font-semibold"
        >
          Remove
        </button>
      </div>
    </div>
  </div>
`;

// Component: Service Select Modal
const serviceSelectModalComponent = () => `
  <div id="serviceSelectModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-sm">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-xl font-bold text-white">Choose Service</h3>
      </div>

      <!-- Modal Content -->
      <div class="p-6 space-y-3">
        <button id="serviceSpotifyBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200 flex items-center justify-center">
          <i class="fab fa-spotify mr-2"></i>Spotify
        </button>
        <button id="serviceTidalBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200 flex items-center justify-center">
          <i class="fas fa-wave-square mr-2"></i>Tidal
        </button>
      </div>

      <!-- Modal Footer -->
      <div class="p-6 border-t border-gray-800">
        <button id="serviceCancelBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200">Cancel</button>
      </div>
    </div>
  </div>
`;

// Component: List Setup Wizard Modal
const listSetupWizardComponent = () => `
  <div id="listSetupWizard" class="hidden fixed inset-0 bg-black bg-opacity-70 z-[60] flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-700 flex-shrink-0">
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
      <div class="p-4 border-t border-gray-700 flex-shrink-0 flex gap-3 justify-between">
        <button id="listSetupDismiss" class="px-4 py-2 text-gray-400 hover:text-gray-300 transition text-sm">
          Remind me later
        </button>
        <button id="listSetupSave" class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition font-medium disabled:opacity-50 disabled:cursor-not-allowed" disabled>
          <i class="fas fa-check mr-2"></i>Save Changes
        </button>
      </div>
    </div>
  </div>
`;

// Main Spotify template - Consolidated version
const spotifyTemplate = (user) => `
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
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
  <link href="${asset('/styles/output.css')}" rel="stylesheet">
  <link href="${asset('/styles/spotify-app.css')}" rel="stylesheet">
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
      bottom: calc(1.5rem + env(safe-area-inset-bottom));
    }
    
    #addAlbumFAB:active {
      box-shadow: 0 2px 6px 0 rgba(0, 0, 0, 0.4);
    }
    
    /* Ensure FAB positioning is consistent across all mobile devices */
    @media (max-width: 1023px) {
      #addAlbumFAB {
        bottom: calc(1.5rem + env(safe-area-inset-bottom, 1rem));
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
        padding-top: constant(safe-area-inset-top); /* iOS 11.0-11.2 */
        padding-top: env(safe-area-inset-top); /* iOS 11.2+ */
        /* Bottom safe area handled by individual elements (now-playing bar, FAB) */
      }
      
      /* Full viewport height, accounting only for top safe area */
      .app-layout {
        height: calc(100vh - env(safe-area-inset-top, 0px));
        height: calc(100dvh - env(safe-area-inset-top, 0px));
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
        <h2 class="sidebar-title text-lg font-bold text-white transition-opacity duration-300">Lists</h2>
        <button 
          id="sidebarToggle" 
          class="p-2 hover:bg-gray-800 rounded transition-colors"
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
        
        <div class="mt-4 pt-4 border-t border-gray-800 flex-shrink-0">
          <button id="createListBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 flex items-center">
            <i class="fas fa-plus mr-2"></i><span>Create List</span>
          </button>
          <button id="importBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 mt-2 flex items-center">
            <i class="fas fa-file-import mr-2"></i><span>Import List</span>
          </button>
          <input type="file" id="fileInput" accept=".json" style="display: none;">
        </div>
      </nav>
      
      <!-- Spotify Miniplayer (Desktop only) -->
      <div id="spotifyMiniplayer" class="spotify-miniplayer flex-shrink-0 border-t border-gray-800 p-3 hidden">
        <!-- Not Connected State -->
        <div id="miniplayerNotConnected" class="text-center py-3">
          <a href="/settings" 
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
          <div class="flex items-center gap-3 mb-3">
            <div id="miniplayerArt" class="w-20 h-20 bg-gray-800 rounded flex-shrink-0 overflow-hidden">
              <img src="" alt="" class="w-full h-full object-cover hidden">
            </div>
            <div class="flex-1 min-w-0">
              <p id="miniplayerTrack" class="text-sm font-medium text-white truncate">No track</p>
              <p id="miniplayerArtist" class="text-xs text-gray-400 truncate">—</p>
            </div>
          </div>
          
          <!-- Progress Bar -->
          <div class="mb-3">
            <div id="miniplayerProgress" class="miniplayer-progress h-1 bg-gray-700 rounded-full cursor-pointer group relative">
              <div id="miniplayerProgressFill" class="h-full bg-green-500 rounded-full" style="width: 0%"></div>
              <div id="miniplayerProgressHandle" class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-md" style="left: 0%"></div>
            </div>
            <div class="flex justify-between text-[10px] text-gray-500 mt-1">
              <span id="miniplayerTimeElapsed">0:00</span>
              <span id="miniplayerTimeTotal">0:00</span>
            </div>
          </div>
          
          <!-- Controls Row -->
          <div class="flex items-center justify-between">
            <!-- Playback Controls -->
            <div class="flex items-center gap-3">
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
            
            <!-- Volume Control -->
            <div class="flex items-center gap-1 mr-2">
              <button id="miniplayerMute" class="p-1.5 text-gray-400 hover:text-white transition-colors" title="Mute">
                <i class="fas fa-volume-up text-xs"></i>
              </button>
              <input id="miniplayerVolume" type="range" min="0" max="100" value="50" 
                class="w-20 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer">
            </div>
          </div>
          
          <!-- Current Device Indicator with Device Picker -->
          <div id="miniplayerCurrentDevice" class="mt-2 flex items-center justify-between">
            <!-- Spacer to balance the device button for centering -->
            <div class="w-6"></div>
            <span class="text-[10px] text-gray-500">
              <i class="fas fa-broadcast-tower mr-1 text-green-500"></i>
              <span id="miniplayerDeviceName">Listening on...</span>
            </span>
            <!-- Device Picker -->
            <div class="relative w-6 flex justify-end">
              <button id="miniplayerDeviceBtn" class="p-1 text-green-500 hover:text-green-400 transition-colors" title="Change device">
                <i class="fas fa-desktop text-xs"></i>
              </button>
              
              <!-- Device Dropdown -->
              <div id="miniplayerDeviceDropdown" class="hidden absolute bottom-full right-0 mb-2 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
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
      <div id="tidalWidget" class="tidal-widget flex-shrink-0 border-t border-gray-800 p-3 hidden">
        <!-- Not Connected State -->
        <div id="tidalWidgetNotConnected" class="text-center py-3">
          <a href="/settings" 
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
      <main class="flex-1 overflow-hidden">
        <div class="h-full overflow-y-auto">
          <div id="albumContainer" class="min-h-full">
            <!-- Albums will be displayed here -->
            <div class="text-center text-gray-500 mt-20">
              <p class="text-xl mb-2">No list selected</p>
              <p class="text-sm">Create or import a list to get started</p>
            </div>
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
        <div class="p-4 border-b border-gray-800">
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
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 flex items-center">
            <i class="fas fa-plus mr-2"></i>Create List
          </button>
          <button onclick="document.getElementById('importBtn').click(); toggleMobileMenu();" 
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 flex items-center">
            <i class="fas fa-file-import mr-2"></i>Import List
          </button>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Floating Action Button -->
  <button
    id="addAlbumFAB"
    class="fixed bottom-6 right-6 w-14 h-14 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-lg flex items-center justify-center transform hover:scale-110 active:scale-95 z-[9999]"
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
  ${createListModalComponent()}
  ${renameListModalComponent()}
  ${addAlbumModalComponent()}
  ${importConflictModalComponent()}
  ${serviceSelectModalComponent()}
  ${confirmationModalComponent()}
  ${listSetupWizardComponent()}
  
  <script>
    // Global state - must be set before bundle.js loads
    window.currentUser = ${JSON.stringify(user)};
    window.lastSelectedList = ${JSON.stringify(user.lastSelectedList || null)};
    
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
      window.selectList = async function(listName) {
        await originalSelectList(listName);
        
        // Show/hide FAB
        const fab = document.getElementById('addAlbumFAB');
        if (fab) {
          fab.style.display = listName ? 'flex' : 'none';
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
        if (typeof currentList !== 'undefined' && typeof lists !== 'undefined' && lists[currentList]) {
          displayAlbums(lists[currentList]);
        }
      }
    });
  </script>
</body>
</html>
`;

// Aggregate List template - collaborative album of the year page
const aggregateListTemplate = (user, year, isAdmin = false) => `
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
      padding: 0.25rem 0.5rem;
      background: #374151;
      border-radius: 9999px;
      font-size: 0.75rem;
      margin: 0.125rem;
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
    
    /* ========== FOG REVEAL STYLES ========== */
    
    .fog-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 10;
      background: linear-gradient(
        to bottom,
        rgba(0, 0, 0, 0.95) 0%,
        rgba(17, 24, 39, 0.9) 20%,
        rgba(17, 24, 39, 0.7) 40%,
        rgba(17, 24, 39, 0.3) 70%,
        transparent 100%
      );
      transition: opacity 1s ease-out;
    }
    
    .fog-overlay.cleared {
      opacity: 0;
    }
    
    /* Floating mist particles */
    .fog-particle {
      position: fixed;
      width: 300px;
      height: 300px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(100, 116, 139, 0.15) 0%, transparent 70%);
      pointer-events: none;
      z-index: 11;
      animation: floatMist 8s ease-in-out infinite;
    }
    
    .fog-particle:nth-child(2) {
      animation-delay: -2s;
      animation-duration: 10s;
    }
    
    .fog-particle:nth-child(3) {
      animation-delay: -4s;
      animation-duration: 12s;
    }
    
    @keyframes floatMist {
      0%, 100% { transform: translateY(0) translateX(0) scale(1); opacity: 0.5; }
      50% { transform: translateY(-30px) translateX(20px) scale(1.1); opacity: 0.3; }
    }
    
    /* Album cards in fog mode */
    .album-card.fog-hidden {
      filter: blur(12px);
      opacity: 0.15;
      transform: scale(0.97);
      transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .album-card.fog-revealing {
      filter: blur(4px);
      opacity: 0.5;
      transform: scale(0.99);
      transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .album-card.fog-revealed {
      filter: blur(0);
      opacity: 1;
      transform: scale(1);
      transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    /* Top 3 special glow effects */
    .album-card.fog-revealed.top-3 {
      box-shadow: 0 0 30px var(--accent-shadow), 0 0 60px rgba(251, 191, 36, 0.2);
    }
    
    .album-card.fog-revealed.rank-1 {
      box-shadow: 0 0 40px rgba(251, 191, 36, 0.5), 0 0 80px rgba(251, 191, 36, 0.3);
    }
    
    @keyframes celebrationPulse {
      0%, 100% { box-shadow: 0 0 40px rgba(251, 191, 36, 0.5); }
      50% { box-shadow: 0 0 60px rgba(251, 191, 36, 0.8), 0 0 100px rgba(251, 191, 36, 0.4); }
    }
    
    .album-card.celebration {
      animation: celebrationPulse 1.5s ease-in-out 3;
    }
    
    /* Scroll hint indicator */
    .scroll-hint {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      color: #9ca3af;
      animation: bounceHint 2s ease-in-out infinite;
      transition: opacity 0.5s;
    }
    
    .scroll-hint.hidden {
      opacity: 0;
      pointer-events: none;
    }
    
    @keyframes bounceHint {
      0%, 100% { transform: translateX(-50%) translateY(0); }
      50% { transform: translateX(-50%) translateY(-10px); }
    }
    
    /* Reveal progress bar */
    .reveal-progress {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: #1f2937;
      z-index: 100;
    }
    
    .reveal-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--accent-color), #fbbf24);
      transition: width 0.3s ease-out;
      box-shadow: 0 0 10px var(--accent-shadow);
    }
    
    /* Completion celebration overlay */
    .celebration-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50;
      opacity: 0;
      transition: opacity 0.5s;
    }
    
    .celebration-overlay.active {
      opacity: 1;
      animation: celebrationFlash 1s ease-out;
    }
    
    @keyframes celebrationFlash {
      0% { background: radial-gradient(circle at center top, rgba(251, 191, 36, 0.3) 0%, transparent 50%); }
      100% { background: transparent; }
    }
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap" rel="stylesheet">
</head>
<body class="bg-black text-gray-200 min-h-screen">
  <div class="absolute inset-0 bg-gradient-to-br from-black via-gray-900 to-black -z-10"></div>
  
  <!-- Fog reveal overlay (hidden by default) -->
  <div id="fogOverlay" class="fog-overlay hidden"></div>
  <div id="fogParticle1" class="fog-particle hidden" style="top: 10%; left: 20%;"></div>
  <div id="fogParticle2" class="fog-particle hidden" style="top: 30%; right: 10%;"></div>
  <div id="fogParticle3" class="fog-particle hidden" style="top: 60%; left: 40%;"></div>
  
  <!-- Scroll hint (hidden by default) -->
  <div id="scrollHint" class="scroll-hint hidden">
    <i class="fas fa-chevron-up text-2xl"></i>
    <span class="text-sm">Scroll up to reveal</span>
  </div>
  
  <!-- Reveal progress bar (hidden by default) -->
  <div id="revealProgress" class="reveal-progress hidden">
    <div id="revealProgressBar" class="reveal-progress-bar" style="width: 0%"></div>
  </div>
  
  <!-- Celebration overlay -->
  <div id="celebrationOverlay" class="celebration-overlay"></div>
  
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
    
    <!-- Admin panel (hidden by default, shown via JS if admin) -->
    ${
      isAdmin
        ? `
    <div id="adminPanel" class="mt-12 p-6 confirmation-card rounded-lg hidden">
      <h2 class="text-xl font-bold text-gray-200 mb-4">
        <i class="fas fa-shield-alt mr-2"></i>Admin Controls
      </h2>
      <div id="adminContent">
        <!-- Populated by JavaScript -->
      </div>
    </div>
    `
        : ''
    }
  </main>
  
  <script>
    const YEAR = ${year};
    const IS_ADMIN = ${isAdmin};
    const USER_ID = '${user?._id || ''}';
    
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
    
    // Build album card HTML (shared between normal and fog mode)
    function buildAlbumCardHtml(album, index, fogMode = false) {
      const positionClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
      const delay = fogMode ? 0 : Math.min(index * 50, 500);
      const fogClass = fogMode ? ' fog-hidden' : '';
      const top3Class = index < 3 ? ' top-3' : '';
      const rank1Class = index === 0 ? ' rank-1' : '';
      
      const votersHtml = album.voters.map(v => 
        '<span class="voter-chip"><span class="text-gray-300">' + v.username + '</span><span class="text-gray-500 ml-1">#' + v.position + '</span></span>'
      ).join('');
      
      return '<div class="album-card bg-gray-800/50 rounded-lg p-4' + (fogMode ? fogClass + top3Class + rank1Class : ' animate-fade-in') + '" data-rank="' + album.rank + '" style="' + (fogMode ? '' : 'animation-delay: ' + delay + 'ms; opacity: 0;') + '">' +
        '<div class="flex items-start gap-4">' +
          '<div class="position-badge ' + positionClass + ' text-gray-200 flex-shrink-0">' + album.rank + '</div>' +
          '<div class="flex-shrink-0">' +
            (album.coverImage ? 
              '<img src="' + album.coverImage + '" alt="' + (album.album || '').replace(/"/g, '&quot;') + '" class="w-16 h-16 md:w-20 md:h-20 rounded object-cover">' :
              '<div class="w-16 h-16 md:w-20 md:h-20 rounded bg-gray-700 flex items-center justify-center"><i class="fas fa-compact-disc text-gray-500 text-2xl"></i></div>'
            ) +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<h3 class="font-bold text-white truncate">' + (album.album || 'Unknown Album') + '</h3>' +
            '<p class="text-gray-400 truncate">' + (album.artist || 'Unknown Artist') + '</p>' +
            '<div class="flex items-center gap-4 mt-2 text-sm">' +
              '<span class="text-red-500 font-bold">' + album.totalPoints + ' pts</span>' +
              '<span class="text-gray-500">' + album.voterCount + ' voter' + (album.voterCount !== 1 ? 's' : '') + '</span>' +
              '<span class="text-gray-500">avg: ' + formatPosition(Math.round(album.averagePosition)) + '</span>' +
            '</div>' +
            '<div class="mt-2 flex flex-wrap">' + votersHtml + '</div>' +
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
      
      const html = data.albums.map((album, index) => buildAlbumCardHtml(album, index, false)).join('');
      container.innerHTML = html;
    }
    
    // ========== FOG REVEAL MODE ==========
    
    let fogRevealState = {
      active: false,
      observer: null,
      revealedCount: 0,
      totalAlbums: 0,
      hasMarkedSeen: false
    };
    
    // Render aggregate list in fog mode
    function renderAggregateListFogMode(data) {
      const container = document.getElementById('aggregateListContent');
      
      if (!data.albums || data.albums.length === 0) {
        container.innerHTML = '<div class="text-center py-12 text-gray-400">No albums in the aggregate list yet.</div>';
        return;
      }
      
      fogRevealState.totalAlbums = data.albums.length;
      fogRevealState.active = true;
      
      // Render all albums with fog-hidden class
      const html = data.albums.map((album, index) => buildAlbumCardHtml(album, index, true)).join('');
      container.innerHTML = html;
      
      // Show fog UI elements
      document.getElementById('fogOverlay').classList.remove('hidden');
      document.getElementById('fogParticle1').classList.remove('hidden');
      document.getElementById('fogParticle2').classList.remove('hidden');
      document.getElementById('fogParticle3').classList.remove('hidden');
      document.getElementById('scrollHint').classList.remove('hidden');
      document.getElementById('revealProgress').classList.remove('hidden');
      
      // Scroll to bottom of the list (album #40 or last album)
      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        
        // Initialize Intersection Observer for reveal
        initFogRevealObserver();
      }, 100);
    }
    
    // Initialize Intersection Observer for fog reveal
    function initFogRevealObserver() {
      const options = {
        root: null,
        rootMargin: '-10% 0px -30% 0px', // Reveal zone in middle-upper area
        threshold: [0, 0.25, 0.5, 0.75, 1]
      };
      
      fogRevealState.observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const card = entry.target;
          const rank = parseInt(card.dataset.rank);
          
          if (entry.intersectionRatio >= 0.5) {
            // Fully revealed
            if (card.classList.contains('fog-hidden') || card.classList.contains('fog-revealing')) {
              card.classList.remove('fog-hidden', 'fog-revealing');
              card.classList.add('fog-revealed');
              fogRevealState.revealedCount++;
              updateRevealProgress();
              
              // Check for #1 reveal (celebration!)
              if (rank === 1) {
                triggerCelebration(card);
              }
            }
          } else if (entry.intersectionRatio > 0) {
            // Partially in view - revealing state
            if (card.classList.contains('fog-hidden')) {
              card.classList.remove('fog-hidden');
              card.classList.add('fog-revealing');
            }
          }
        });
      }, options);
      
      // Observe all album cards
      document.querySelectorAll('.album-card').forEach(card => {
        fogRevealState.observer.observe(card);
      });
    }
    
    // Update reveal progress bar
    function updateRevealProgress() {
      const progress = (fogRevealState.revealedCount / fogRevealState.totalAlbums) * 100;
      document.getElementById('revealProgressBar').style.width = progress + '%';
      
      // Hide scroll hint once we've scrolled a bit
      if (fogRevealState.revealedCount > 3) {
        document.getElementById('scrollHint').classList.add('hidden');
      }
    }
    
    // Trigger celebration when #1 is revealed
    async function triggerCelebration(card) {
      // Add celebration animation to #1 card
      card.classList.add('celebration');
      
      // Flash the celebration overlay
      const overlay = document.getElementById('celebrationOverlay');
      overlay.classList.add('active');
      
      // Clear the fog completely
      document.getElementById('fogOverlay').classList.add('cleared');
      document.querySelectorAll('.fog-particle').forEach(p => p.classList.add('hidden'));
      
      // Hide progress bar after a moment
      setTimeout(() => {
        document.getElementById('revealProgress').classList.add('hidden');
      }, 1500);
      
      // Mark as seen in database (only once)
      if (!fogRevealState.hasMarkedSeen) {
        fogRevealState.hasMarkedSeen = true;
        try {
          await apiFetch('/api/aggregate-list/' + YEAR + '/mark-seen', { method: 'POST' });
        } catch (err) {
          console.error('Failed to mark reveal as seen:', err);
        }
      }
      
      // Remove celebration effects after animation
      setTimeout(() => {
        overlay.classList.remove('active');
        card.classList.remove('celebration');
        fogRevealState.active = false;
        
        // Reveal any remaining hidden cards
        document.querySelectorAll('.album-card.fog-hidden, .album-card.fog-revealing').forEach(c => {
          c.classList.remove('fog-hidden', 'fog-revealing');
          c.classList.add('fog-revealed');
        });
      }, 4500);
    }
    
    // Render pre-reveal status with position placeholders
    function renderPendingReveal(status) {
      const container = document.getElementById('aggregateListContent');
      const totalAlbums = status.totalAlbums || 0;
      
      // Generate position placeholder cards
      let placeholdersHtml = '';
      if (totalAlbums > 0) {
        for (let i = 1; i <= totalAlbums; i++) {
          const positionClass = i === 1 ? 'gold' : i === 2 ? 'silver' : i === 3 ? 'bronze' : '';
          const delay = Math.min((i - 1) * 30, 300);
          
          placeholdersHtml += 
            '<div class="album-card bg-gray-800/30 rounded-lg p-4 animate-fade-in" style="animation-delay: ' + delay + 'ms; opacity: 0;">' +
              '<div class="flex items-center gap-4">' +
                '<div class="position-badge ' + positionClass + ' text-gray-200 flex-shrink-0">' + i + '</div>' +
                '<div class="w-16 h-16 md:w-20 md:h-20 rounded bg-gray-700/50 flex items-center justify-center flex-shrink-0">' +
                  '<i class="fas fa-question text-gray-600 text-2xl"></i>' +
                '</div>' +
                '<div class="flex-1 min-w-0">' +
                  '<div class="h-5 bg-gray-700/50 rounded w-2/3 mb-2"></div>' +
                  '<div class="h-4 bg-gray-700/30 rounded w-1/2"></div>' +
                '</div>' +
                '<div class="flex-shrink-0">' +
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
    
    // Render admin panel
    function renderAdminPanel(status, stats) {
      if (!IS_ADMIN) return;
      
      const panel = document.getElementById('adminPanel');
      const content = document.getElementById('adminContent');
      panel.classList.remove('hidden');
      
      const hasConfirmed = status.confirmations.some(c => c.username === '${user?.username || ''}');
      
      let html = '';
      
      if (status.revealed) {
        html = '<p class="text-green-400"><i class="fas fa-check-circle mr-2"></i>Aggregate list has been revealed</p>';
      } else {
        // Stats preview (anonymous)
        if (stats) {
          html += '<div class="mb-6">' +
            '<h3 class="text-sm text-gray-500 uppercase tracking-wide mb-2">Anonymous Stats Preview</h3>' +
            '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">' +
              '<div class="bg-gray-800 rounded p-3"><div class="text-2xl font-bold text-gray-200">' + stats.participantCount + '</div><div class="text-xs text-gray-500">Participants</div></div>' +
              '<div class="bg-gray-800 rounded p-3"><div class="text-2xl font-bold text-gray-200">' + stats.totalAlbums + '</div><div class="text-xs text-gray-500">Total Albums</div></div>' +
              '<div class="bg-gray-800 rounded p-3"><div class="text-2xl font-bold text-gray-200">' + stats.albumsWith3PlusVoters + '</div><div class="text-xs text-gray-500">3+ Voters</div></div>' +
              '<div class="bg-gray-800 rounded p-3"><div class="text-2xl font-bold text-gray-200">' + stats.albumsWith2Voters + '</div><div class="text-xs text-gray-500">2 Voters</div></div>' +
            '</div>' +
          '</div>';
        }
        
        // Confirmation button
        html += '<div class="flex items-center gap-4">' +
          (hasConfirmed ? 
            '<button onclick="revokeConfirmation()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition"><i class="fas fa-times mr-2"></i>Revoke Confirmation</button>' :
            '<button onclick="confirmReveal()" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition"><i class="fas fa-check mr-2"></i>Confirm Reveal</button>'
          ) +
          '<span class="text-gray-500">' + status.confirmationCount + '/' + status.requiredConfirmations + ' confirmations</span>' +
        '</div>';
      }
      
      content.innerHTML = html;
    }
    
    // Admin actions
    async function confirmReveal() {
      try {
        const result = await apiFetch('/api/aggregate-list/' + YEAR + '/confirm', { method: 'POST' });
        if (result.revealed) {
          window.location.reload();
        } else {
          loadAggregateList();
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
    
    async function revokeConfirmation() {
      try {
        await apiFetch('/api/aggregate-list/' + YEAR + '/confirm', { method: 'DELETE' });
        loadAggregateList();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
    
    // Main load function
    async function loadAggregateList() {
      try {
        // First check status
        const status = await apiFetch('/api/aggregate-list/' + YEAR + '/status');
        
        if (status.revealed) {
          // Load full data
          const data = await apiFetch('/api/aggregate-list/' + YEAR);
          
          // Check if user has seen the dramatic reveal before
          const hasSeenRes = await apiFetch('/api/aggregate-list/' + YEAR + '/has-seen');
          
          if (hasSeenRes.hasSeen) {
            // User has seen it before - render normally
            renderAggregateList(data.data);
          } else {
            // First time viewing! Show the dramatic fog reveal
            renderAggregateListFogMode(data.data);
          }
        } else {
          // Show pending state
          renderPendingReveal(status);
        }
        
        // Load admin panel if admin
        if (IS_ADMIN) {
          try {
            const statsRes = await apiFetch('/api/aggregate-list/' + YEAR + '/stats');
            renderAdminPanel(status, statsRes.stats);
          } catch (e) {
            renderAdminPanel(status, null);
          }
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

module.exports = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  aggregateListTemplate,
  headerComponent,
  formatDate,
  formatDateTime,
  asset,
};
