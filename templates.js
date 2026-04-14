const {
  adjustColor,
  colorWithOpacity,
  generateAccentCssVars,
  generateAccentOverrides,
} = require('./utils/color-utils');
const {
  createAssetHelper,
  escapeHtml,
  safeJsonStringify,
  modalShell,
  menuItem,
  formatDate,
  formatDateTime,
} = require('./utils/template-helpers');
const { createAuthTemplates } = require('./templates/auth-templates');
const {
  extensionAuthTemplate,
} = require('./templates/extension-auth-template');

const {
  createAggregateListTemplate,
} = require('./templates/aggregate-list-template');

const { createSpotifyTemplate } = require('./templates/spotify-template');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
// Use a timestamp-based asset version to avoid browser caching issues
const assetVersion = process.env.ASSET_VERSION || Date.now().toString();
const asset = createAssetHelper(assetVersion);

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

// Base HTML template rendered with EJS
const htmlTemplate = (content, title = 'SuShe Auth', user = null) =>
  layoutTemplateFn({
    content,
    title,
    user,
    asset,
    adjustColor,
    colorWithOpacity,
    generateAccentCssVars,
    generateAccentOverrides,
  });

const {
  headerComponent,
  registerTemplate,
  loginTemplate,
  forgotPasswordTemplate,
  resetPasswordTemplate,
  invalidTokenTemplate,
} = createAuthTemplates({
  escapeHtml,
  htmlTemplate,
  loginSnippetFn,
});

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
  
  ${modalShell({
    id: 'importRenameModal',
    title: 'Choose New Name',
    subtitle:
      'Original name: <span id="originalImportName" class="text-gray-300"></span>',
    body: `
        <label class="form-label" for="importNewName">New List Name</label>
        <input type="text" id="importNewName" placeholder="Enter new name..." class="form-input-modal" maxlength="50">
        <p class="text-xs text-gray-500 mt-2">Choose a unique name for the imported list</p>
    `,
    footer: `
        <button id="cancelImportRenameBtn" class="btn-modal-cancel">Cancel</button>
        <button id="confirmImportRenameBtn" class="btn-modal-confirm">Import with New Name</button>
    `,
  })}
`;

// Component: Context Menus
const contextMenusComponent = () => `
  <!-- Context Menu for Lists -->
  <div id="contextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50">
    ${menuItem({ id: 'downloadListOption', icon: 'fa-download', label: 'Download List...', hasSubmenu: true })}
    ${menuItem({ id: 'renameListOption', icon: 'fa-edit', label: 'Edit Details' })}
    ${menuItem({ id: 'toggleMainOption', icon: 'fa-star', label: '<span id="toggleMainText">Set as Main</span>' })}
    ${menuItem({ id: 'updatePlaylistOption', icon: 'fa-paper-plane', label: '<span id="updatePlaylistText">Send to Music Service</span>' })}
    ${menuItem({ id: 'moveListOption', icon: 'fa-folder-open', label: 'Move to Collection', hasSubmenu: true })}
    ${menuItem({ id: 'deleteListOption', icon: 'fa-trash', label: 'Delete List', hoverColor: 'hover:text-red-400' })}
  </div>
  
  <!-- Context Menu for Albums -->
  <div id="albumContextMenu" class="hidden fixed bg-gray-800 border border-gray-700 rounded-md shadow-lg py-1 z-50">
    ${menuItem({ id: 'editAlbumOption', icon: 'fa-edit', label: 'Edit Details' })}
    ${menuItem({ id: 'playAlbumOption', icon: 'fa-play', label: 'Play Album', hasSubmenu: true })}
    ${menuItem({ id: 'moveAlbumOption', icon: 'fa-arrow-right', label: 'Move to List', hasSubmenu: true })}
    ${menuItem({ id: 'copyAlbumOption', icon: 'fa-copy', label: 'Copy to List', hasSubmenu: true })}
    ${menuItem({ id: 'recommendAlbumOption', icon: 'fa-thumbs-up', label: 'Recommend', hoverColor: 'hover:text-blue-400', hidden: true, iconColor: 'text-blue-400' })}
    <!-- Last.fm Discovery Options (shown only when connected) -->
    <div id="lastfmMenuDivider" class="hidden context-menu-divider"></div>
    ${menuItem({ id: 'similarArtistsOption', icon: 'fa-users', label: 'Show Similar Artists', hidden: true, iconColor: 'text-purple-400' })}
    <!-- Admin-only option to re-identify album from MusicBrainz -->
    <div id="adminMenuDivider" class="hidden context-menu-divider"></div>
    ${menuItem({ id: 'reidentifyAlbumOption', icon: 'fa-sync-alt', label: 'Re-identify Album', hoverColor: 'hover:text-yellow-400', hidden: true, iconColor: 'text-yellow-400' })}
    <div class="context-menu-divider"></div>
    ${menuItem({ id: 'removeAlbumOption', icon: 'fa-times', label: 'Remove from List', hoverColor: 'hover:text-red-400' })}
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
    <div class="bg-gray-900 border border-gray-800 lg:rounded-lg shadow-2xl w-full h-full lg:h-auto lg:max-w-4xl lg:max-h-[90vh] flex flex-col pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
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
const confirmationModalComponent = () =>
  modalShell({
    id: 'confirmationModal',
    title: '<span id="confirmationTitle">Confirm Action</span>',
    extraContainerClass: 'transform transition-all',
    body: `
        <p id="confirmationMessage" class="text-gray-300"></p>
        <p id="confirmationSubMessage" class="text-sm text-gray-500 mt-2"></p>
        <div id="confirmationCheckboxContainer" class="hidden mt-4">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" id="confirmationCheckbox" class="mt-1 w-4 h-4 text-red-600 bg-gray-800 border-gray-600 rounded focus:ring-red-500 focus:ring-2" />
            <span id="confirmationCheckboxLabel" class="text-sm text-gray-400 select-none"></span>
          </label>
        </div>
    `,
    footer: `
        <button id="confirmationCancelBtn" class="btn-modal-cancel">Cancel</button>
        <button id="confirmationConfirmBtn" class="btn-modal-confirm">Remove</button>
    `,
  });

// Component: Recommendation Reasoning Modal
const recommendReasoningModalComponent = () =>
  modalShell({
    id: 'recommendReasoningModal',
    title: 'Why do you recommend this album?',
    extraContainerClass: 'transform transition-all',
    body: `
        <div class="flex items-center gap-4 mb-4 p-3 bg-gray-800 rounded-lg">
          <div id="reasoningAlbumCover" class="w-12 h-12 bg-gray-700 rounded-sm flex items-center justify-center">
            <i class="fas fa-compact-disc text-gray-500"></i>
          </div>
          <div class="flex-1 min-w-0">
            <p id="reasoningAlbumTitle" class="text-white font-medium truncate"></p>
            <p id="reasoningArtistName" class="text-gray-400 text-sm truncate"></p>
          </div>
        </div>
        <div>
          <label class="block text-gray-400 text-sm font-medium mb-2" for="reasoningText">
            Your reasoning <span class="text-red-500">*</span>
          </label>
          <textarea id="reasoningText" rows="4" maxlength="500"
            class="form-input-modal rounded-lg resize-none"
            placeholder="Tell others why they should listen to this album..."
          ></textarea>
          <div class="flex justify-between mt-2">
            <p id="reasoningError" class="text-red-400 text-sm hidden">Reasoning is required</p>
            <p class="text-gray-500 text-xs ml-auto"><span id="reasoningCharCount">0</span> / 500</p>
          </div>
        </div>
    `,
    footer: `
        <button id="reasoningCancelBtn" class="btn-modal-cancel">Cancel</button>
        <button id="reasoningSubmitBtn" class="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-sm transition duration-200 font-semibold">Recommend</button>
    `,
  });

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
const serviceSelectModalComponent = () =>
  modalShell({
    id: 'serviceSelectModal',
    maxWidth: 'max-w-sm',
    title: 'Choose Service',
    body: `
      <div class="space-y-3">
        <button id="serviceSpotifyBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200 flex items-center justify-center">
          <i class="fab fa-spotify mr-2"></i>Spotify
        </button>
        <button id="serviceTidalBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200 flex items-center justify-center">
          <i class="fas fa-wave-square mr-2"></i>Tidal
        </button>
        <button id="serviceQobuzBtn" class="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-sm transition duration-200 flex items-center justify-center">
          <i class="fas fa-compact-disc mr-2"></i>Qobuz
        </button>
      </div>
    `,
    footer: `
        <button id="serviceCancelBtn" class="w-full btn-modal-cancel">Cancel</button>
    `,
  });

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

const spotifyTemplate = createSpotifyTemplate({
  asset,
  generateAccentCssVars,
  generateAccentOverrides,
  headerComponent,
  contextMenusComponent,
  settingsDrawerComponent,
  modalPortalComponent,
  safeJsonStringify,
});

const aggregateListTemplate = createAggregateListTemplate({
  asset,
  generateAccentCssVars,
  generateAccentOverrides,
  headerComponent,
});

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
