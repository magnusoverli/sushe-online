// Shared header component
const headerComponent = (user, currentPage = 'home', options = {}) => {
  const isAdmin = user.role === 'admin';
  
  // Default options
  const {
    showHomeLink = currentPage !== 'home',
    showSettingsLink = currentPage !== 'settings',
    showAccountLink = currentPage !== 'account'
  } = options;
  
  // Determine the page title and breadcrumb
  let pageTitle = '';
  switch (currentPage) {
    case 'home':
      pageTitle = 'My Lists';
      break;
    case 'settings':
      pageTitle = 'Settings';
      break;
    case 'admin':
      pageTitle = 'Admin Dashboard';
      break;
    default:
      pageTitle = currentPage;
  }
  
  return `
    <header class="bg-gray-900 border-b border-gray-800 shadow-lg">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-4">
            <a href="/" class="text-xl font-bold text-red-600 hover:text-red-500">SuShe</a>
            ${currentPage === 'home' ? `
              <span id="headerSeparator" class="text-gray-500 hidden">/</span>
              <h1 id="headerListName" class="text-xl font-semibold hidden"></h1>
            ` : pageTitle ? `
              <span class="text-gray-500">/</span>
              <h1 class="text-xl font-semibold">${pageTitle}</h1>
            ` : ''}
          </div>
          <div class="flex items-center space-x-4">
            <span class="text-sm text-gray-400">
              ${isAdmin ? '<i class="fas fa-crown text-yellow-500 mr-2"></i>' : ''}
              ${user.email}
            </span>
            ${showHomeLink ? `
              <a href="/" class="text-gray-400 hover:text-white" title="Home">
                <i class="fas fa-home text-xl"></i>
              </a>
            ` : ''}
            ${showSettingsLink ? `
              <a href="/settings" class="text-gray-400 hover:text-white" title="Settings">
                <i class="fas fa-cog text-xl"></i>
              </a>
            ` : ''}
            <a href="/logout" class="text-gray-400 hover:text-red-500" title="Logout">
              <i class="fas fa-sign-out-alt text-xl"></i>
            </a>
          </div>
        </div>
      </div>
    </header>
  `;
};

// Base HTML template with Black Metal Spotify-inspired theme
const htmlTemplate = (content, title = 'SuShe Auth') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="/styles/output.css" rel="stylesheet">
  <style>
    /* Custom black metal inspired fonts and effects */
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600;700&display=swap');
    
    .metal-title {
      font-family: 'Cinzel', serif;
      text-shadow: 0 0 20px rgba(220, 38, 38, 0.5);
    }
    
    .glow-red {
      animation: glow 2s ease-in-out infinite alternate;
    }
    
    @keyframes glow {
      from { text-shadow: 0 0 10px #dc2626, 0 0 20px #dc2626, 0 0 30px #dc2626; }
      to { text-shadow: 0 0 20px #dc2626, 0 0 30px #dc2626, 0 0 40px #dc2626; }
    }
    
    .spotify-input:focus {
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.4);
    }
    
    /* Custom scrollbar */
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
  </style>
</head>
<body class="bg-black text-gray-200 min-h-screen flex items-center justify-center relative overflow-hidden">
  <!-- Atmospheric background -->
  <div class="absolute inset-0 bg-gradient-to-br from-black via-gray-900 to-black"></div>
  <div class="noise absolute inset-0"></div>
  
  <!-- Subtle red accent glow -->
  <div class="absolute top-0 left-1/4 w-96 h-96 bg-red-900 rounded-full filter blur-3xl opacity-10 animate-pulse"></div>
  <div class="absolute bottom-0 right-1/4 w-96 h-96 bg-red-800 rounded-full filter blur-3xl opacity-10 animate-pulse"></div>
  
  <div class="relative z-10 max-w-md w-full px-4">
    ${content}
  </div>
</body>
</html>
`;

// Registration form template - Updated with flash parameter
const registerTemplate = (req, flash) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">Join SuShe Online</h1>
    </div>
    
    <form method="post" action="/register" class="space-y-6">
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
`;

// Login form template - Updated with flash parameter
const loginTemplate = (req, flash) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">LOG IN</h1>
    </div>
    
    <form method="post" action="/login" class="space-y-6">
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
          autocomplete="current-password"
        />
      </div>
      
      <div class="text-right">
        <a href="/forgot" class="text-sm text-gray-400 hover:text-red-500 transition duration-200">Forgot password?</a>
      </div>
      
      <button 
        class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Sign In
      </button>
    </form>
    
    ${flash.error && flash.error.length ? `<p class="text-red-500 text-sm mt-4 text-center">${flash.error[0]}</p>` : ''}
    ${flash.success && flash.success.length ? `<p class="text-green-500 text-sm mt-4 text-center">${flash.success[0]}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        No account? 
        <a href="/register" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">REGISTER</a>
      </p>
    </div>
  </div>
`;

// Forgot password template - Updated with flash parameter
const forgotPasswordTemplate = (req, flash) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">Forgot password</h1>
    </div>
    
    <form method="post" action="/forgot" class="space-y-6">
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
        <button id="clearBtn" class="w-full bg-gray-800 hover:bg-red-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 mt-2">
          <i class="fas fa-trash-alt mr-2"></i>Delete All Lists
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
      <div id="dropZone" class="drop-zone min-h-full p-6">
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

// Component: Add Album Modal
const addAlbumModalComponent = () => `
  <div id="addAlbumModal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
      <!-- Modal Header -->
      <div class="p-6 border-b border-gray-800 flex items-center justify-between">
        <h3 class="text-2xl font-bold text-white">Add Album to List</h3>
        <button id="closeModalBtn" class="text-gray-400 hover:text-gray-200 transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      
      <!-- Modal Content -->
      <div class="flex-1 overflow-hidden flex flex-col">
        <!-- Search Section -->
        <div id="searchSection" class="p-6 border-b border-gray-800">
          <div class="flex gap-4">
            <input 
              type="text" 
              id="artistSearchInput" 
              placeholder="Search for an artist..." 
              class="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
            >
            <button 
              id="searchArtistBtn" 
              class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded transition duration-200 font-semibold"
            >
              Search
            </button>
          </div>
          <!-- Manual Entry Link -->
          <div class="mt-3 text-center">
            <button id="manualEntryBtn" class="text-gray-400 hover:text-red-500 text-sm transition-colors">
              Can't find your album? Add it manually →
            </button>
          </div>
        </div>
        
        <!-- Results Section -->
        <div class="flex-1 overflow-y-auto p-6">
          <!-- Artist Results -->
          <div id="artistResults" class="hidden">
            <h4 class="text-lg font-semibold text-gray-300 mb-4">Select an Artist</h4>
            <div id="artistList" class="space-y-2">
              <!-- Artist results will be populated here -->
            </div>
          </div>
          
          <!-- Album Results -->
          <div id="albumResults" class="hidden">
            <button id="backToArtists" class="text-gray-400 hover:text-white mb-4 flex items-center gap-2 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              Back to artists
            </button>
            
            <h4 class="text-lg font-semibold text-gray-300 mb-4">Select an Album</h4>
            <div id="albumList" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <!-- Album results will be populated here -->
            </div>
          </div>
          
          <!-- Manual Entry Form -->
          <div id="manualEntryForm" class="hidden">
            <button id="backToSearch" class="text-gray-400 hover:text-white mb-4 flex items-center gap-2 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              Back to search
            </button>
            
            <h4 class="text-lg font-semibold text-gray-300 mb-4">Add Album Manually</h4>
            
            <form id="manualAlbumForm" class="space-y-4 max-w-2xl">
              <!-- Artist Name -->
              <div>
                <label class="block text-gray-400 text-sm mb-1" for="manualArtist">
                  Artist Name <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  id="manualArtist" 
                  name="artist"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                  required
                >
              </div>
              
              <!-- Album Title -->
              <div>
                <label class="block text-gray-400 text-sm mb-1" for="manualAlbum">
                  Album Title <span class="text-red-500">*</span>
                </label>
                <input 
                  type="text" 
                  id="manualAlbum" 
                  name="album"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                  required
                >
              </div>
              
              <!-- Release Date -->
              <div>
                <label class="block text-gray-400 text-sm mb-1" for="manualReleaseDate">
                  Release Date
                </label>
                <input 
                  type="date" 
                  id="manualReleaseDate" 
                  name="release_date"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white placeholder-gray-500 focus:outline-none focus:border-red-600 transition duration-200"
                >
              </div>
              
              <!-- Country -->
              <div>
                <label class="block text-gray-400 text-sm mb-1" for="manualCountry">
                  Country
                </label>
                <select 
                  id="manualCountry" 
                  name="country"
                  class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-red-600 transition duration-200"
                >
                  <option value="">Select a country...</option>
                </select>
              </div>
              
              <!-- Cover Art Upload -->
              <div>
                <label class="block text-gray-400 text-sm mb-1">
                  Cover Art
                </label>
                <div class="flex items-center gap-4">
                  <div id="coverPreview" class="w-24 h-24 bg-gray-800 rounded flex items-center justify-center border border-gray-700">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-gray-600">
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
                      class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200"
                    >
                      Choose Image
                    </button>
                    <p class="text-xs text-gray-500 mt-1">JPG, PNG or GIF (max. 5MB)</p>
                  </div>
                </div>
              </div>
              
              <!-- Submit Buttons -->
              <div class="flex gap-3 pt-4">
                <button 
                  type="button"
                  id="cancelManualEntry" 
                  class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition duration-200"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition duration-200 font-semibold"
                >
                  Add Album
                </button>
              </div>
            </form>
          </div>
          
          <!-- Loading State -->
          <div id="searchLoading" class="hidden text-center py-12">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
            <p class="text-gray-400 mt-4">Searching...</p>
          </div>
          
          <!-- Empty State -->
          <div id="searchEmpty" class="text-center py-12 text-gray-500">
            <p>Search for an artist to add albums</p>
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

// Main Spotify template - Updated to use shared header
const spotifyTemplate = (req) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <title>SuShe Online</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link href="/styles/output.css" rel="stylesheet">
  <link href="/styles/spotify-app.css" rel="stylesheet">
  <style>
    @media (max-width: 1023px) {
      body {
        overscroll-behavior: contain;
        -webkit-user-select: none;
        user-select: none;
      }
      
      /* Prevent horizontal scrolling */
      #mobileAlbumContainer {
        width: 100%;
        overflow-x: hidden;
      }
      
      /* Ensure cards don't overflow */
      #mobileAlbumContainer > div {
        max-width: 100%;
        overflow-x: hidden;
      }
      
      /* Fix for iOS momentum scrolling */
      .overflow-y-auto {
        -webkit-overflow-scrolling: touch;
      }
      
      /* Ensure proper height calculation with bottom nav */
      .pb-20 {
        padding-bottom: 5rem !important; /* Account for bottom nav + safe area */
      }
      
      /* Ensure modals work on mobile */
      .modal-content {
        max-height: calc(100vh - 2rem);
        margin: 1rem;
      }
    }
  </style>
</head>
<body class="bg-black text-gray-200">
  <div class="flex flex-col h-screen">
    ${headerComponent(req.user, 'home')}
    
    <!-- Desktop Layout (hidden on mobile) -->
    <div class="hidden lg:flex flex-1 overflow-hidden">
      ${sidebarComponent(req)}
      ${mainContentComponent()}
    </div>
    
    <!-- Mobile Layout (hidden on desktop) -->
    <div class="lg:hidden flex flex-col flex-1 overflow-hidden">
      <div class="flex-1 overflow-y-auto pb-20">
        <div id="mobileAlbumContainer" class="min-h-full">
          <!-- Albums will be displayed here -->
          <div class="text-center text-gray-500 mt-20 px-4">
            <p class="text-xl mb-2">No list selected</p>
            <p class="text-sm">Select a list from the menu</p>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Mobile Bottom Navigation -->
    <nav class="lg:hidden fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-40 safe-area-bottom">
      <div class="flex justify-around items-center">
        <button onclick="toggleMobileLists()" class="flex-1 py-3 px-3 flex flex-col items-center">
          <i class="fas fa-list text-lg"></i>
          <span class="text-xs mt-1">Lists</span>
        </button>
        <button onclick="document.getElementById('fileInput').click()" class="flex-1 py-3 px-3 flex flex-col items-center">
          <i class="fas fa-file-import text-lg"></i>
          <span class="text-xs mt-1">Import</span>
        </button>
        <button id="mobileAddAlbumBtn" class="flex-1 py-3 px-3 flex flex-col items-center">
          <i class="fas fa-plus-circle text-lg text-red-600"></i>
          <span class="text-xs mt-1">Add</span>
        </button>
      </div>
    </nav>
    
    <!-- Mobile Lists Drawer -->
    <div id="mobileListsDrawer" class="lg:hidden fixed inset-0 z-50 hidden">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black bg-opacity-50" onclick="toggleMobileLists()"></div>
      
      <!-- Drawer -->
      <div class="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-gray-900 border-r border-gray-800 overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="p-4 border-b border-gray-800">
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-bold text-white">Your Lists</h2>
            <button onclick="toggleMobileLists()" class="p-2 -m-2 text-gray-400 hover:text-white">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>
        
        <!-- Lists -->
        <div class="flex-1 overflow-y-auto p-4">
          <ul id="mobileListNav" class="space-y-1">
            <!-- Lists will be populated here -->
          </ul>
        </div>
        
        <!-- Actions -->
        <div class="p-4 border-t border-gray-800 space-y-2 safe-area-bottom">
          <button id="mobileCreateListBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 px-4 rounded text-sm transition duration-200">
            <i class="fas fa-plus mr-2"></i>Create List
          </button>
          <button id="mobileClearBtn" class="w-full bg-gray-800 hover:bg-red-700 text-gray-300 py-3 px-4 rounded text-sm transition duration-200">
            <i class="fas fa-trash-alt mr-2"></i>Delete All Lists
          </button>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Toast container -->
  <div id="toast" class="toast"></div>
  
  ${contextMenusComponent()}
  ${createListModalComponent()}
  ${renameListModalComponent()}
  ${addAlbumModalComponent()}
  ${importConflictModalComponent()}
  ${confirmationModalComponent()}
  
  <script src="/js/drag-drop.js"></script>
  <script src="/js/musicbrainz.js"></script>
  <script src="/js/app.js"></script>
  
  <script>
    // Mobile-specific functions
    function toggleMobileLists() {
      const drawer = document.getElementById('mobileListsDrawer');
      drawer.classList.toggle('hidden');
    }
    
    // Initialize mobile buttons
    document.addEventListener('DOMContentLoaded', () => {
      // Mobile add album button
      const mobileAddBtn = document.getElementById('mobileAddAlbumBtn');
      if (mobileAddBtn) {
        mobileAddBtn.onclick = () => {
          if (!currentList) {
            showToast('Please select a list first', 'error');
            return;
          }
          if (window.openAddAlbumModal) {
            window.openAddAlbumModal();
          }
        };
      }
      // Mobile create list button
      const mobileCreateBtn = document.getElementById('mobileCreateListBtn');
      if (mobileCreateBtn) {
        mobileCreateBtn.onclick = () => {
          toggleMobileLists();
          document.getElementById('createListBtn').click();
        };
      }
      
      // Mobile clear button
      const mobileClearBtn = document.getElementById('mobileClearBtn');
      if (mobileClearBtn) {
        mobileClearBtn.onclick = () => {
          toggleMobileLists();
          document.getElementById('clearBtn').click();
        };
      }
      
      // Update list nav to include mobile
      const originalUpdateListNav = window.updateListNav;
      window.updateListNav = function() {
        originalUpdateListNav();
        updateMobileListNav();
      };
      
      // Initialize mobile nav
      updateMobileListNav();
    });
    
    function updateMobileListNav() {
      const mobileNav = document.getElementById('mobileListNav');
      if (!mobileNav) return;
      
      mobileNav.innerHTML = '';
      
      Object.keys(lists).forEach(listName => {
        const li = document.createElement('li');
        const isActive = currentList === listName;
        
        const listButton = document.createElement('button');
        listButton.className = 'flex-1 text-left px-3 py-3 rounded text-sm hover:bg-gray-800 transition duration-200 ' + 
                              (isActive ? 'bg-gray-800 text-red-500' : 'text-gray-300');
        listButton.textContent = listName;
        listButton.onclick = () => {
          // Close the drawer first for better UX
          toggleMobileLists();
          // Then select the list with a small delay to ensure DOM is ready
          setTimeout(() => {
            selectList(listName);
          }, 150); // Wait for drawer animation to complete
        };
        
        const menuButton = document.createElement('button');
        menuButton.className = 'p-3 text-gray-400 hover:text-white';
        menuButton.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
        menuButton.onclick = (e) => {
          e.stopPropagation();
          showMobileListMenu(listName);
        };
        
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center';
        wrapper.appendChild(listButton);
        wrapper.appendChild(menuButton);
        
        li.appendChild(wrapper);
        mobileNav.appendChild(li);
      });
    }
    
    // Mobile list menu (action sheet)
    function showMobileListMenu(listName) {
      const actionSheet = document.createElement('div');
      actionSheet.className = 'fixed inset-0 z-[60] lg:hidden';
      actionSheet.innerHTML = \`
        <div class="absolute inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
        <div class="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl safe-area-bottom">
          <div class="p-4">
            <div class="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
            <h3 class="font-semibold text-white mb-4">\${listName}</h3>
            
            <button onclick="downloadList('\${listName}'); this.closest('.fixed').remove();" 
                    class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
              <i class="fas fa-download mr-3 text-gray-400"></i>Download List
            </button>
            
            <button onclick="openRenameModal('\${listName}'); this.closest('.fixed').remove(); toggleMobileLists();" 
                    class="w-full text-left py-3 px-4 hover:bg-gray-800 rounded">
              <i class="fas fa-edit mr-3 text-gray-400"></i>Rename List
            </button>
            
            <button onclick="if(confirm('Delete this list?')) { deleteList('\${listName}'); this.closest('.fixed').remove(); toggleMobileLists(); }" 
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
    }
    
    // Helper functions for mobile actions
    function downloadList(listName) {
      // Trigger the existing download functionality
      window.currentContextList = listName;
      document.getElementById('downloadListOption').click();
    }
    
    async function deleteList(listName) {
      try {
        await apiCall(\`/api/lists/\${encodeURIComponent(listName)}\`, {
          method: 'DELETE'
        });
        
        delete lists[listName];
        
        if (currentList === listName) {
          currentList = null;
          // Update both containers
          const desktopContainer = document.getElementById('albumContainer');
          const mobileContainer = document.getElementById('mobileAlbumContainer');
          const emptyHTML = \`
            <div class="text-center text-gray-500 mt-20 px-4">
              <p class="text-xl mb-2">No list selected</p>
              <p class="text-sm">Select a list from the menu</p>
            </div>
          \`;
          
          if (desktopContainer) desktopContainer.innerHTML = emptyHTML;
          if (mobileContainer) mobileContainer.innerHTML = emptyHTML;
        }
        
        updateListNav();
        showToast(\`List "\${listName}" deleted\`);
      } catch (error) {
        console.error('Error deleting list:', error);
        showToast('Error deleting list', 'error');
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
  headerComponent
};