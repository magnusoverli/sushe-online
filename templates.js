// Base HTML template with Black Metal Spotify-inspired theme
const htmlTemplate = (content, title = 'KVLT Auth') => `
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
    
    .noise::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0.03;
      z-index: 1;
      pointer-events: none;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.5'/%3E%3C/svg%3E");
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

// Registration form template
const registerTemplate = (req) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">JOIN THE KVLT</h1>
      <p class="text-gray-400 text-sm">Forge your identity in digital darkness</p>
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
      <button 
        class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Create Account
      </button>
    </form>
    
    ${req.flash('error').length ? `<p class="text-red-500 text-sm mt-4 text-center">${req.flash('error')}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        Already initiated? 
        <a href="/login" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Sign in</a>
      </p>
    </div>
  </div>
`;

// Login form template
const loginTemplate = (req) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-4xl font-bold text-red-600 glow-red mb-2">ENTER THE VOID</h1>
      <p class="text-gray-400 text-sm">Return to the darkness</p>
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
      
      <div class="flex items-center justify-between">
        <label class="flex items-center">
          <input type="checkbox" class="bg-gray-800 border-gray-700 text-red-600 rounded focus:ring-red-600 focus:ring-offset-0">
          <span class="ml-2 text-sm text-gray-400">Remember me</span>
        </label>
        <a href="/forgot" class="text-sm text-gray-400 hover:text-red-500 transition duration-200">Forgot password?</a>
      </div>
      
      <button 
        class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded transition duration-200 transform hover:scale-105 uppercase tracking-wider"
        type="submit"
      >
        Sign In
      </button>
    </form>
    
    ${req.flash('error').length ? `<p class="text-red-500 text-sm mt-4 text-center">${req.flash('error')}</p>` : ''}
    ${req.flash('success').length ? `<p class="text-green-500 text-sm mt-4 text-center">${req.flash('success')}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        New to the darkness? 
        <a href="/register" class="text-red-500 hover:text-red-400 font-semibold transition duration-200">Join the kvlt</a>
      </p>
    </div>
  </div>
`;

// Forgot password template
const forgotPasswordTemplate = (req) => `
  <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
    <div class="text-center mb-8">
      <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">LOST IN THE ABYSS?</h1>
      <p class="text-gray-400 text-sm">We'll guide you back to the darkness</p>
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
        Send Recovery Rune
      </button>
    </form>
    
    ${req.flash('info').length ? `<p class="text-blue-400 text-sm mt-4 text-center">${req.flash('info')}</p>` : ''}
    
    <div class="mt-8 pt-6 border-t border-gray-800">
      <p class="text-center text-gray-500 text-sm">
        Found your way? 
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

// Home page (Spotify-like interface) template
const spotifyTemplate = (req) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KVLT Collections</title>
  <link href="/styles/output.css" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600;700&display=swap');
    
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    
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
    
    /* Enhanced album row styles */
    #albumContainer {
      min-height: 100vh;
      position: relative;
    }
    
    #albumContainer.drag-active {
      background-color: rgba(220, 38, 38, 0.03);
    }
    
    .album-row {
      transition: all 0.2s ease;
      position: relative;
      background-color: transparent;
      user-select: none;
    }
    
    .album-row:hover:not(.dragging) {
      background-color: rgba(31, 41, 55, 0.3);
      transform: translateX(2px);
    }
    
    .album-row.dragging {
      opacity: 0.2;
      cursor: grabbing;
    }
    
    .album-row.drag-placeholder {
      background-color: rgba(220, 38, 38, 0.1);
      border: 2px dashed #dc2626;
      opacity: 0.8;
      min-height: 64px;
    }
    
    /* Grid layout with specific column sizes */
    .grid-cols-\\[50px_60px_1fr_1fr_1\\.5fr_80px\\] {
      grid-template-columns: 50px 60px 1fr 1fr 1.5fr 80px;
    }
    
    /* Ensure the table takes full height */
    .album-rows-container {
      min-height: calc(100vh - 200px);
    }
    
    /* Make sure text doesn't overflow */
    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    /* Flex utilities */
    .flex-col {
      flex-direction: column;
    }
    
    .space-y-1 > * + * {
      margin-top: 0.25rem;
    }
    
    .min-w-0 {
      min-width: 0;
    }
    
    .col-span-full {
      grid-column: 1 / -1;
    }

    /* Genre dropdown styles */
    .genre-cell select {
    font-family: inherit;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
    background-position: right 0.5rem center;
    background-repeat: no-repeat;
    background-size: 1.5em 1.5em;
    padding-right: 2.5rem;
    }

    /* Prevent drag when editing */
    .album-row:has(select) {
    cursor: default;
    }

    /* Loading states */
    .loading {
      opacity: 0.5;
      pointer-events: none;
    }
    
    /* Toast notifications */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background-color: #1f2937;
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      transform: translateY(100%);
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 50;
    }
    
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    
    .toast.error {
      background-color: #dc2626;
    }
    
    .toast.success {
      background-color: #059669;
    }

    /* Line clamp for comments */
    .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;

    /* Comment editing styles */
    .comment-cell {
    position: relative;
    }

    .comment-cell textarea {
    font-family: inherit;
    }

    /* Prevent drag when editing */
    .album-row:has(textarea) {
    cursor: default;
    }
    
    }
  </style>
</head>
<body class="bg-black text-gray-200">
  <div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div class="p-6 border-b border-gray-800">
        <h1 class="metal-title text-2xl font-bold text-red-600 glow-red">KVLT</h1>
        <p class="text-gray-400 text-sm mt-1">Collections</p>
      </div>
      
      <nav class="flex-1 overflow-y-auto p-4">
        <h3 class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Lists</h3>
        <ul id="listNav" class="space-y-1">
          <!-- Lists will be populated here -->
        </ul>
        
        <div class="mt-6 pt-6 border-t border-gray-800">
          <button id="importBtn" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200">
            + Import List
          </button>
          <input type="file" id="fileInput" accept=".json" style="display: none;">
          <button id="clearBtn" class="w-full bg-gray-800 hover:bg-red-700 text-gray-300 py-2 px-4 rounded text-sm transition duration-200 mt-2">
            Clear All Lists
          </button>
          <div id="storageInfo" class="text-xs text-gray-500 mt-2 text-center"></div>
        </div>
      </nav>
      
      <div class="p-4 border-t border-gray-800">
        <div class="flex items-center justify-between text-sm">
          <span class="text-gray-400">${req.user.email}</span>
          <a href="/logout" class="text-red-500 hover:text-red-400 transition duration-200">Logout</a>
        </div>
      </div>
    </div>
    
    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 p-6">
        <h2 id="listTitle" class="text-3xl font-bold">Select a list to begin</h2>
        <p id="listInfo" class="text-gray-400 mt-1"></p>
      </div>
      
      <!-- Album List -->
      <div class="flex-1 overflow-y-auto">
        <div id="dropZone" class="drop-zone min-h-full p-6">
          <div id="albumContainer">
            <!-- Albums will be displayed here -->
            <div class="text-center text-gray-500 mt-20">
              <p class="text-xl mb-2">No list selected</p>
              <p class="text-sm">Import a JSON file to get started</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Toast container -->
  <div id="toast" class="toast"></div>
  
  <script src="/js/app.js"></script>
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
  spotifyTemplate
};