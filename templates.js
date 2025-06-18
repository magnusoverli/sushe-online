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
    hour12
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
const headerComponent = (user, activeSection = 'home', currentListName = '') => `
  <header class="sticky top-0 bg-gray-900 border-b border-gray-800 z-50">
    <!-- Desktop Header -->
    <div class="hidden lg:flex items-center justify-between py-4 px-6">
      <div class="flex items-center gap-8">
        <a href="/" class="text-2xl font-bold text-red-600 hover:text-red-500 transition duration-200">SuShe</a>
        <nav class="flex gap-6">
          <a href="/" class="${activeSection === 'home' ? 'text-red-600' : 'text-gray-300 hover:text-white'} transition duration-200">
            <i class="fas fa-home mr-2"></i>Home
          </a>
        </nav>
      </div>
      
      <div class="flex items-center gap-6">
        <span class="text-sm text-gray-400">${user?.email}</span>
        <a href="/logout" class="text-gray-400 hover:text-white transition duration-200" title="Logout">
          <i class="fas fa-sign-out-alt text-lg"></i>
        </a>
        <a href="/settings" class="text-gray-400 hover:text-white transition duration-200" title="Settings">
          <i class="fas fa-cog text-lg"></i>
        </a>
      </div>
    </div>
    
    <!-- Mobile Header -->
    <div class="lg:hidden flex items-center justify-between p-3 gap-2">
      <div class="flex items-center gap-2 min-w-0">
        ${activeSection === 'home' ? `
          <button onclick="toggleMobileLists()" class="p-2 -m-2 text-gray-400 active:text-white">
            <i class="fas fa-bars text-lg"></i>
          </button>
        ` : `
          <a href="/" class="p-2 -m-2 text-gray-400 active:text-white">
            <i class="fas fa-arrow-left text-lg"></i>
          </a>
        `}
        <a href="/" class="text-xl font-bold text-red-600 flex-shrink-0 ml-2">SuShe</a>
        ${currentListName && activeSection === 'home' ? `
          <span class="text-gray-600 flex-shrink-0">/</span>
          <span class="text-sm text-yellow-500 font-medium truncate">${currentListName}</span>
        ` : ''}
      </div>
      
      <div class="flex items-center gap-1 flex-shrink-0">
        ${activeSection !== 'settings' ? `
          <a href="/settings" class="p-2 text-gray-400 active:text-white" title="Settings">
            <i class="fas fa-cog text-lg"></i>
          </a>
        ` : ''}
        <a href="/logout" class="p-2 text-gray-400 active:text-white" title="Logout">
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
    colorWithOpacity
  });

// Registration form template - Updated with flash parameter
const registerTemplate = (req, flash) => htmlTemplate(`
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
        class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Create Account
      </button>
    </form>
    
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center">${flash.error[0]}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        Already have an account? 
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
`, 'Join SuShe Online', null);

// Login form template rendered with EJS
const loginTemplate = (req, flash) =>
  loginSnippetFn({ req, flash });

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
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
          name="email" 
          id="email"
          type="email" 
          placeholder="your@email.com" 
          required 
        />
      </div>
      <button 
        class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Reset password
      </button>
    </form>
    
    ${flash.info && flash.info.length ? `<p class="text-blue-400 text-sm mt-4 text-center">${flash.info[0]}</p>` : ''}
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center">${flash.error[0]}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Return to login</a>
      </p>
    </div>
  </div>
`;

// Reset password template
const resetPasswordTemplate = (token) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">FORGE NEW DARKNESS</h1>
      <p class="text-gray-400 text-sm">Create a new password to secure your soul</p>
    </div>
    
    <form method="post" action="/reset/${token}" class="space-y-6">
      <input type="hidden" name="_csrf" value="${req.csrfToken()}" />
      <div>
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="password">
          New Password
        </label>
        <input 
          class="spotify-input w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
          name="password" 
          id="password"
          type="password" 
          placeholder="••••••••" 
          required 
          minlength="8"
        />
      </div>
      <button 
        class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Seal the Pact
      </button>
    </form>
  </div>
`;

// Invalid token template
const invalidTokenTemplate = () => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <p class="text-red-500 text-center mb-4">This recovery rune has expired or been corrupted</p>
    <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request new recovery rune</a>
  </div>
`;


// Component: Sidebar - Updated with clickable account link
const sidebarComponent = (req) => `
  <div class="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
    <nav class="flex-1 overflow-y-auto p-4 flex flex-col">
      <div class="flex-1">
        <h3 class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Your Lists</h3>
        <ul id="listNav" class="space-y-1">
          <!-- Lists will be populated here -->
        </ul>
      </div>
      
      <div class="mt-6 pt-6 border-t border-gray-800">
        <button id="createListBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200">
          <i class="fas fa-plus mr-2"></i>Create List
        </button>
        <button id="importBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 mt-2">
          <i class="fas fa-file-import mr-2"></i>Import List
        </button>
        <input type="file" id="fileInput" accept=".json" style="display: none;">
      </div>
    </nav>
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
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
          class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition duration-200 font-semibold"
        >
          Import with New Name
        </button>
      </div>
    </div>
  </div>
`;

// Component: Main Content Area
const mainContentComponent = () => `
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Album List (removed the header section) -->
    <div class="flex-1 overflow-y-auto">
      <div id="dropZone" class="drop-zone min-h-full">
        <div id="albumContainer">
          <!-- Albums will be displayed here -->
          <div class="text-center text-gray-500 mt-20">
            <p class="text-xl mb-2">No list selected</p>
            <p class="text-sm">Create or import a list to get started</p>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

// Component: Context Menus
const contextMenusComponent = () => `
  <!-- Context Menu for Lists -->
  <div id="contextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
    <button id="downloadListOption" class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-download mr-2 w-4 text-center"></i>Download List
    </button>
    <button id="renameListOption" class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-edit mr-2 w-4 text-center"></i>Rename List
    </button>
    <button id="deleteListOption" class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-trash mr-2 w-4 text-center"></i>Delete List
    </button>
  </div>
  
  <!-- Context Menu for Albums -->
  <div id="albumContextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
    <button id="editAlbumOption" class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-edit mr-2 w-4 text-center"></i>Edit Details
    </button>
    <button id="playAlbumOption" class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors whitespace-nowrap">
      <i class="fas fa-play mr-2 w-4 text-center"></i>Play Album
    </button>
    <button id="removeAlbumOption" class="block text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-red-400 transition-colors whitespace-nowrap">
      <i class="fas fa-times mr-2 w-4 text-center"></i>Remove from List
    </button>
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
      <div class="p-6">
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newListName">
          List Name
        </label>
        <input 
          type="text" 
          id="newListName" 
          placeholder="Enter list name..." 
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
          maxlength="50"
        >
        <p class="text-xs text-gray-500 mt-2">Give your list a unique name</p>
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
          class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition duration-200 font-semibold"
        >
          Create List
        </button>
      </div>
    </div>
  </div>
`;

// Component: Rename List Modal
const renameListModalComponent = () => `
  <div id="renameListModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-md">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800">
        <h3 class="text-2xl font-bold text-white">Rename List</h3>
        <p class="text-sm text-gray-400 mt-1">Current name: <span id="currentListName" class="text-gray-300"></span></p>
      </div>
      
      <!-- Modal Content -->
      <div class="p-6">
        <label class="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2" for="newListNameInput">
          New List Name
        </label>
        <input 
          type="text" 
          id="newListNameInput" 
          placeholder="Enter new name..." 
          class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
          maxlength="50"
        >
        <p class="text-xs text-gray-500 mt-2">Enter a new unique name for this list</p>
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
          class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition duration-200 font-semibold"
        >
          Rename List
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
                class="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
              >
              <button 
                id="searchArtistBtn" 
                class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg transition duration-200 font-semibold whitespace-nowrap"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
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
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-red-600 transition duration-200"
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
                    class="flex-1 lg:flex-none px-6 lg:px-8 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition duration-200 font-semibold"
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
          class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition duration-200 font-semibold"
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

// Main Spotify template - Consolidated version
const spotifyTemplate = (user) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
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
    
    /* Responsive layout system */
    .app-layout {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
      height: calc(var(--vh, 1vh) * 100);
    }
    
    .main-content {
      display: grid;
      grid-template-columns: 0 1fr; /* Mobile: no sidebar */
      overflow: hidden;
    }
    
    @media (min-width: 1024px) {
      .main-content {
        grid-template-columns: 16rem 1fr; /* Desktop: 256px sidebar */
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
      transition: none;
    }
    
    @media (min-width: 1024px) {
      .sidebar {
        width: 16rem;
        overflow: visible;
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
    
    /* Album container responsive padding */
    #albumContainer {
      padding-bottom: calc(1rem + env(safe-area-inset-bottom));
    }

    @media (max-width: 1023px) {
      #albumContainer {
        padding-bottom: calc(5rem + env(safe-area-inset-bottom)); /* Space for FAB on mobile */
      }
    }
    
    /* Safe areas for iOS */
    .safe-area-bottom {
      padding-bottom: env(safe-area-inset-bottom);
    }
    
    /* Sortable enhancements */
    .sortable-ghost {
      opacity: 0.4;
    }
    
    .sortable-drag {
      opacity: 0.9 !important;
      transform: rotate(1deg) scale(1.02);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);
      z-index: 9999;
    }
    
    .sortable-chosen {
      background-color: rgba(55, 65, 81, 0.6);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3) inset;
    }
    
    /* Touch optimization */
    @media (max-width: 1023px) {
      .touch-target {
        min-height: 44px;
      }
      
      body {
        overscroll-behavior: contain;
        -webkit-user-select: none;
        user-select: none;
      }
    }
  </style>
</head>
<body class="bg-black text-gray-200">
  <div class="app-layout">
    <!-- Unified Header -->
    <header class="bg-gray-900 border-b border-gray-800 z-50">
      <div class="flex items-center justify-between py-3 lg:py-4 px-3 lg:px-6">
        <!-- Mobile menu button / Desktop logo -->
        <div class="flex items-center gap-2 lg:gap-8">
          <button onclick="toggleMobileMenu()" class="lg:hidden p-2 -m-2 text-gray-400 active:text-white touch-target">
            <i class="fas fa-bars text-lg"></i>
          </button>
          <a href="/" class="text-xl lg:text-2xl font-bold text-red-600 hover:text-red-500 transition duration-200">SuShe</a>
          
          <!-- Desktop navigation -->
          <nav class="hidden lg:flex gap-6">
            <a href="/" class="text-red-600 transition duration-200">
              <i class="fas fa-home mr-2"></i>Home
            </a>
          </nav>
        </div>
        
        <!-- Current list name (mobile only) -->
        <div class="mobile-only flex items-center gap-2 min-w-0 flex-1 mx-2">
          <span id="headerListName" class="text-sm text-yellow-500 font-medium truncate ${user.lastSelectedList ? '' : 'hidden'}">
            ${user.lastSelectedList || ''}
          </span>
        </div>
        
        <!-- User menu -->
        <div class="flex items-center gap-2 lg:gap-6">
          <span class="hidden lg:inline text-sm text-gray-400">${user?.email}</span>
          <a href="/settings" class="p-2 lg:p-0 text-gray-400 hover:text-white transition duration-200 touch-target" title="Settings">
            <i class="fas fa-cog text-lg"></i>
          </a>
          <a href="/logout" class="p-2 lg:p-0 text-gray-400 hover:text-white transition duration-200 touch-target" title="Logout">
            <i class="fas fa-sign-out-alt text-lg"></i>
          </a>
        </div>
      </div>
    </header>
    
    <!-- Main Content Area -->
    <div class="main-content">
    <!-- Sidebar (responsive) -->
    <aside id="sidebar" class="sidebar bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-300">
      <!-- Sidebar Toggle Button -->
      <div class="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 class="sidebar-title text-lg font-bold text-white transition-opacity duration-300">Lists</h2>
        <button 
          id="sidebarToggle" 
          class="p-2 hover:bg-gray-800 rounded transition-colors"
          title="Toggle sidebar"
        >
          <i class="fas fa-chevron-left text-gray-400 transition-transform duration-300"></i>
        </button>
      </div>
      
      <nav class="flex-1 overflow-y-auto p-4 flex flex-col">
        <div class="flex-1">
          <h3 class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Your Lists</h3>
          <ul id="listNav" class="space-y-1">
            <!-- Lists will be populated here -->
          </ul>
        </div>
        
        <div class="mt-6 pt-6 border-t border-gray-800">
          <button id="createListBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 flex items-center">
            <i class="fas fa-plus mr-2"></i><span>Create List</span>
          </button>
          <button id="importBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 mt-2 flex items-center">
            <i class="fas fa-file-import mr-2"></i><span>Import List</span>
          </button>
          <input type="file" id="fileInput" accept=".json" style="display: none;">
        </div>
      </nav>
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
    <div id="mobileMenu" class="mobile-only fixed inset-0 z-50 hidden">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black bg-opacity-50" onclick="toggleMobileMenu()"></div>
      
      <!-- Drawer -->
      <div class="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-gray-900 border-r border-gray-800 overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="p-4 border-b border-gray-800">
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-bold text-white">Your Lists</h2>
            <button onclick="toggleMobileMenu()" class="p-2 -m-2 text-gray-400 hover:text-white">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>
        
        <!-- Quick Actions -->
        <div class="p-4 border-b border-gray-800 space-y-2">
          <button onclick="document.getElementById('importBtn').click(); toggleMobileMenu();" 
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 text-left">
            <i class="fas fa-file-import mr-2"></i>Import List
          </button>
          <button onclick="document.getElementById('createListBtn').click(); toggleMobileMenu();" 
                  class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 text-left">
            <i class="fas fa-plus mr-2"></i>Create New List
          </button>
        </div>
        
        <!-- Lists -->
        <div class="flex-1 overflow-y-auto p-4">
          <ul id="mobileListNav" class="space-y-1">
            <!-- Mobile list items will be populated here -->
          </ul>
        </div>
        
        <!-- Footer Actions -->
        <div class="p-4 border-t border-gray-800 safe-area-bottom"></div>
      </div>
    </div>
  </div>
  
  <!-- Floating Action Button -->
  <button
    id="addAlbumFAB"
    class="fixed bottom-6 right-6 w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 transform hover:scale-110 active:scale-95 z-40"
    style="display: none; bottom: calc(1.5rem + env(safe-area-inset-bottom));"
    onclick="if(window.openAddAlbumModal) window.openAddAlbumModal()"
  >
    <i class="fas fa-plus text-xl"></i>
  </button>
  
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
  
  <script type="module" src="${asset('/js/bundle.js')}"></script>

  <script>
    // Global state
    window.currentUser = ${JSON.stringify(user)};
    window.lastSelectedList = ${JSON.stringify(user.lastSelectedList || null)};

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
      menu.classList.toggle('hidden');
    }

    // Backwards compatibility for old toggle handler
    function toggleMobileLists() {
      toggleMobileMenu();
    }
    
    // Initialize the app
    document.addEventListener('DOMContentLoaded', () => {
      // Update the list navigation to include mobile
      const originalUpdateListNav = window.updateListNav;
      window.updateListNav = function() {
        if (originalUpdateListNav) originalUpdateListNav();
        
        // Update mobile navigation
        const mobileNav = document.getElementById('mobileListNav');
        if (mobileNav) {
          mobileNav.innerHTML = '';
          
          Object.keys(lists).forEach(listName => {
            const li = document.createElement('li');
            const isActive = currentList === listName;
            
            li.innerHTML = \`
              <div class="flex items-center group">
                <button 
                  onclick="selectList('\${listName}'); toggleMobileMenu();"
                  class="flex-1 text-left px-3 py-3 rounded text-sm hover:bg-gray-800 transition duration-200 \${isActive ? 'bg-gray-800 text-red-500' : 'text-gray-300'}"
                >
                  \${listName}
                </button>
                <button
                  onclick="event.stopPropagation(); showListMenu('\${listName}');"
                  class="p-3 text-gray-400 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                >
                  <i class="fas fa-ellipsis-v"></i>
                </button>
              </div>
            \`;
            
            mobileNav.appendChild(li);
          });
        }
      };
      
      // Override selectList to handle responsive behavior
      const originalSelectList = window.selectList;
      window.selectList = async function(listName) {
        await originalSelectList(listName);
        
        // Update mobile header
        const headerListName = document.getElementById('headerListName');
        if (headerListName) {
          headerListName.textContent = listName || '';
          headerListName.classList.toggle('hidden', !listName);
        }
        
        // Show/hide FAB
        const fab = document.getElementById('addAlbumFAB');
        if (fab) {
          fab.style.display = listName ? 'flex' : 'none';
        }
      };
      
      // Mobile list menu (unified for both mobile and desktop)
      window.showListMenu = function(listName) {
        const isMobile = window.innerWidth < 1024;
        
        if (isMobile) {
          // Mobile action sheet
          const actionSheet = document.createElement('div');
          actionSheet.className = 'fixed inset-0 z-[60]';
          actionSheet.innerHTML = \`
            <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
            <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
              <div class="p-4">
                <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
                <h3 class="font-semibold text-white mb-4">\${listName}</h3>
                
                <button onclick="downloadListAsJSON('\${listName}'); this.closest('.fixed').remove();" 
                        class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
                  <i class="fas fa-download mr-3 text-gray-400"></i>Download List
                </button>
                
                <button onclick="openRenameModal('\${listName}'); this.closest('.fixed').remove();" 
                        class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
                  <i class="fas fa-edit mr-3 text-gray-400"></i>Rename List
                </button>
                
                <button onclick="if(confirm('Delete this list?')) { document.getElementById('deleteListOption').click(); currentContextList='\${listName}'; } this.closest('.fixed').remove();" 
                        class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded text-red-500">
                  <i class="fas fa-trash mr-3"></i>Delete List
                </button>
                
                <button onclick="this.closest('.fixed').remove()" 
                        class="w-full text-center py-3 px-4 mt-2 bg-gray-800 rounded">
                  Cancel
                </button>
              </div>
            </div>
          \`;
          document.body.appendChild(actionSheet);
        } else {
          // Desktop context menu
          currentContextList = listName;
          const contextMenu = document.getElementById('contextMenu');
          const rect = event.currentTarget.getBoundingClientRect();
          
          contextMenu.style.left = rect.right + 'px';
          contextMenu.style.top = rect.top + 'px';
          contextMenu.classList.remove('hidden');
          
          // Adjust position if menu goes off screen
          setTimeout(() => {
            const menuRect = contextMenu.getBoundingClientRect();
            if (menuRect.right > window.innerWidth) {
              contextMenu.style.left = (rect.left - menuRect.width) + 'px';
            }
            if (menuRect.bottom > window.innerHeight) {
              contextMenu.style.top = (window.innerHeight - menuRect.height - 10) + 'px';
            }
          }, 0);
        }
      };
      
      // Handle right-click on desktop list items
      if (window.innerWidth >= 1024) {
        document.addEventListener('contextmenu', (e) => {
          const listButton = e.target.closest('#listNav button');
          if (listButton) {
            e.preventDefault();
            const listName = listButton.textContent.trim();
            currentContextList = listName;
            
            const contextMenu = document.getElementById('contextMenu');
            contextMenu.style.left = e.clientX + 'px';
            contextMenu.style.top = e.clientY + 'px';
            contextMenu.classList.remove('hidden');
            
            // Adjust position if menu goes off screen
            setTimeout(() => {
              const rect = contextMenu.getBoundingClientRect();
              if (rect.right > window.innerWidth) {
                contextMenu.style.left = (e.clientX - rect.width) + 'px';
              }
              if (rect.bottom > window.innerHeight) {
                contextMenu.style.top = (e.clientY - rect.height) + 'px';
              }
            }, 0);
          }
        });
      }
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

module.exports = {
  htmlTemplate,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
  spotifyTemplate,
  headerComponent,
  formatDate,
  formatDateTime,
  asset,
  assetVersion
};
