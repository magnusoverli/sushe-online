require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Datastore = require('@seald-io/nedb');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Initialize NeDB
const users = new Datastore({ filename: 'users.db', autoload: true });

// Passport configuration
passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  users.findOne({ email }, (err, user) => {
    if (err) return done(err);
    if (!user) return done(null, false, { message: 'Unknown email' });
    bcrypt.compare(password, user.hash, (err, isMatch) => {
      if (err) return done(err);
      if (!isMatch) return done(null, false, { message: 'Bad password' });
      return done(null, user);
    });
  });
}));

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser((id, done) => users.findOne({ _id: id }, done));

const app = express();
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// Middleware to protect routes
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// HTML template with Black Metal Spotify-inspired theme
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

// Registration form
app.get('/register', (req, res) => {
  const content = `
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
  res.send(htmlTemplate(content, 'Join the KVLT - Black Metal Auth'));
});

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      req.flash('error', 'Email and password are required');
      return res.redirect('/register');
    }
    
    if (password.length < 8) {
      req.flash('error', 'Password must be at least 8 characters');
      return res.redirect('/register');
    }
    
    users.findOne({ email }, async (err, existing) => {
      if (err) {
        console.error('Database error:', err);
        req.flash('error', 'Registration error');
        return res.redirect('/register');
      }
      
      if (existing) {
        req.flash('error', 'Email already registered');
        return res.redirect('/register');
      }
      
      try {
        const hash = await bcrypt.hash(password, 12);
        users.insert({ email, hash }, (err) => {
          if (err) {
            console.error('Insert error:', err);
            req.flash('error', 'Registration error');
            return res.redirect('/register');
          }
          req.flash('success', 'Registration successful! Please login.');
          res.redirect('/login');
        });
      } catch (hashErr) {
        console.error('Hashing error:', hashErr);
        req.flash('error', 'Registration error');
        res.redirect('/register');
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    req.flash('error', 'Registration error');
    res.redirect('/register');
  }
});

// Login form
app.get('/login', (req, res) => {
  const content = `
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
  res.send(htmlTemplate(content, 'Enter the Void - Black Metal Auth'));
});

app.post('/login',
  passport.authenticate('local', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/')
);

// Home (protected) - Spotify-like interface
app.get('/', ensureAuth, (req, res) => {
  const spotifyTemplate = `
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
    
    /* Improved drag and drop styles */
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
      background-color: black;
      user-select: none;
    }
    
    .album-row:hover:not(.dragging) {
      background-color: rgba(31, 41, 55, 0.5);
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
      min-height: 60px;
    }
    
    /* Ensure the table takes full height */
    .album-rows-container {
      min-height: calc(100vh - 200px);
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
  
  <script>
    // Global variables
    let currentList = null;
    let lists = {};
    let db = null;
    
    // Drag and drop variables
    let draggedElement = null;
    let draggedIndex = null;
    let placeholder = null;
    let lastValidDropIndex = null;
    
    // Toast notification
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast ' + type;
      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }
    
    // Initialize IndexedDB
    async function initDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('KvltDB', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          db = request.result;
          resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
          db = event.target.result;
          if (!db.objectStoreNames.contains('lists')) {
            db.createObjectStore('lists', { keyPath: 'name' });
          }
        };
      });
    }
    
    // Load lists from IndexedDB
    async function loadLists() {
      if (!db) await initDB();
      
      const transaction = db.transaction(['lists'], 'readonly');
      const store = transaction.objectStore('lists');
      const request = store.getAll();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const allLists = request.result;
          lists = {};
          allLists.forEach(list => {
            lists[list.name] = list.data;
          });
          updateListNav();
          updateStorageInfo();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }
    
    // Save list to IndexedDB
    async function saveList(name, data) {
      if (!db) await initDB();
      
      const transaction = db.transaction(['lists'], 'readwrite');
      const store = transaction.objectStore('lists');
      const request = store.put({ name, data });
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          lists[name] = data;
          updateStorageInfo();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }
    
    // Delete all lists from IndexedDB
    async function clearAllLists() {
      if (!db) await initDB();
      
      const transaction = db.transaction(['lists'], 'readwrite');
      const store = transaction.objectStore('lists');
      const request = store.clear();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          lists = {};
          updateStorageInfo();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    }
    
    // Update storage info
    async function updateStorageInfo() {
      const storageInfo = document.getElementById('storageInfo');
      if (storageInfo && navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          const usedMB = (estimate.usage / 1024 / 1024).toFixed(2);
          const quotaMB = (estimate.quota / 1024 / 1024).toFixed(0);
          storageInfo.textContent = \`Storage: \${usedMB} MB / \${quotaMB} MB\`;
        } catch (e) {
          storageInfo.textContent = '';
        }
      }
    }
    
    // Update sidebar navigation
    function updateListNav() {
      const nav = document.getElementById('listNav');
      nav.innerHTML = '';
      
      Object.keys(lists).forEach(listName => {
        const li = document.createElement('li');
        li.innerHTML = \`
          <button class="w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-800 transition duration-200 \${currentList === listName ? 'bg-gray-800 text-red-500' : 'text-gray-300'}">
            \${listName}
          </button>
        \`;
        li.querySelector('button').onclick = () => selectList(listName);
        nav.appendChild(li);
      });
    }
    
    // Select and display a list
    function selectList(listName) {
      currentList = listName;
      const list = lists[listName];
      
      document.getElementById('listTitle').textContent = listName;
      document.getElementById('listInfo').textContent = \`\${list.length} albums\`;
      
      displayAlbums(list);
      updateListNav();
    }
    
    // Initialize drag and drop for container
    function initializeDragAndDrop() {
      const container = document.getElementById('albumContainer');
      
      // Make the entire container a drop zone
      container.addEventListener('dragover', handleContainerDragOver);
      container.addEventListener('drop', handleContainerDrop);
      container.addEventListener('dragleave', handleContainerDragLeave);
    }
    
    // Drag handlers
    function handleDragStart(e) {
      draggedElement = this;
      draggedIndex = parseInt(this.dataset.index);
      
      // Create placeholder
      placeholder = document.createElement('div');
      placeholder.className = 'album-row drag-placeholder grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800';
      placeholder.style.height = this.offsetHeight + 'px';
      placeholder.innerHTML = '<div class="col-span-12 text-center text-gray-500">Drop here</div>';
      
      this.classList.add('dragging');
      
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', this.innerHTML);
      
      // Hide original after drag image is captured
      requestAnimationFrame(() => {
        this.style.display = 'none';
        this.parentNode.insertBefore(placeholder, this.nextSibling);
      });
    }
    
    function handleContainerDragOver(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      const rowsContainer = this.querySelector('.album-rows-container') || this;
      const afterElement = getDragAfterElement(rowsContainer, e.clientY);
      
      if (!placeholder || !placeholder.parentNode) return;
      
      if (afterElement == null) {
        // Drop at the end
        rowsContainer.appendChild(placeholder);
        lastValidDropIndex = rowsContainer.children.length - 1;
      } else {
        // Insert before the found element
        rowsContainer.insertBefore(placeholder, afterElement);
        const allElements = Array.from(rowsContainer.children);
        lastValidDropIndex = allElements.indexOf(placeholder);
      }
      
      // Add visual feedback to the container
      this.classList.add('drag-active');
    }
    
    function handleContainerDragLeave(e) {
      // Only remove the class if we're actually leaving the container
      const rect = this.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || 
          e.clientY < rect.top || e.clientY > rect.bottom) {
        this.classList.remove('drag-active');
      }
    }
    
    function getDragAfterElement(container, y) {
      const draggableElements = [...container.querySelectorAll('.album-row:not(.dragging):not(.drag-placeholder)')];
      
      return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    function handleDragEnd(e) {
      // Clean up
      if (draggedElement) {
        draggedElement.style.display = '';
        draggedElement.classList.remove('dragging');
      }
      
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }
      
      // Remove container feedback
      document.getElementById('albumContainer').classList.remove('drag-active');
      
      // Reset variables
      draggedElement = null;
      draggedIndex = null;
      placeholder = null;
      lastValidDropIndex = null;
    }
    
    async function handleContainerDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      
      this.classList.remove('drag-active');
      
      if (!draggedElement || lastValidDropIndex === null) return;
      
      // Calculate the actual drop index
      const rowsContainer = this.querySelector('.album-rows-container') || this;
      const allRows = Array.from(rowsContainer.querySelectorAll('.album-row:not(.drag-placeholder)'));
      
      let dropIndex = lastValidDropIndex;
      // Adjust for the removed dragged element
      if (draggedIndex < dropIndex) {
        dropIndex--;
      }
      
      if (dropIndex !== draggedIndex) {
        try {
          const list = lists[currentList];
          
          // Reorder the array
          const [movedItem] = list.splice(draggedIndex, 1);
          list.splice(dropIndex, 0, movedItem);
          
          // Update ranks
          list.forEach((album, index) => {
            album.rank = index + 1;
          });
          
          // Save and refresh
          await saveList(currentList, list);
          displayAlbums(list);
          showToast('Reordered successfully');
        } catch (error) {
          console.error('Error saving reorder:', error);
          showToast('Error saving changes', 'error');
        }
      }
    }
    
    // Display albums in the main view
    function displayAlbums(albums) {
      const container = document.getElementById('albumContainer');
      container.innerHTML = '';
      
      if (!albums || albums.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 mt-20">No albums in this list</p>';
        return;
      }
      
      // Create table
      const table = document.createElement('div');
      table.className = 'w-full relative';
      
      // Table header
      const header = document.createElement('div');
      header.className = 'grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-800 sticky top-0 bg-black z-10';
      header.innerHTML = \`
        <div class="col-span-1">#</div>
        <div class="col-span-1"></div>
        <div class="col-span-4">Album</div>
        <div class="col-span-2">Artist</div>
        <div class="col-span-2">Genre</div>
        <div class="col-span-1">Rating</div>
        <div class="col-span-1">Points</div>
      \`;
      table.appendChild(header);
      
      // Album rows container
      const rowsContainer = document.createElement('div');
      rowsContainer.className = 'album-rows-container relative';
      
      // Album rows
      albums.forEach((album, index) => {
        const row = document.createElement('div');
        row.className = 'album-row grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 cursor-move';
        row.draggable = true;
        row.dataset.index = index;
        
        // Safely get values with defaults
        const rank = album.rank || index + 1;
        const albumName = album.album || 'Unknown Album';
        const artist = album.artist || 'Unknown Artist';
        const genre = album.genre_1 || album.genre || 'Unknown';
        const rating = album.rating || '-';
        const points = album.points || '-';
        const releaseDate = album.release_date || '';
        const coverImage = album.cover_image || '';
        const imageFormat = album.cover_image_format || 'PNG';
        
        row.innerHTML = \`
          <div class="col-span-1 text-gray-400">\${rank}</div>
          <div class="col-span-1">
            \${coverImage ? \`
              <img src="data:image/\${imageFormat};base64,\${coverImage}" 
                   alt="\${albumName}" 
                   class="w-10 h-10 rounded"
                   loading="lazy"
                   onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMUYyOTM3Ii8+CjxwYXRoIGQ9Ik0yMCAxMEMyMCAxMCAyNSAxNSAyNSAyMEMyNSAyNSAyMCAzMCAyMCAzMEMyMCAzMCAxNSAyNSAxNSAyMEMxNSAxNSAyMCAxMCAyMCAxMFoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+'"
              >
            \` : \`
              <div class="w-10 h-10 rounded bg-gray-800 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-600">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
              </div>
            \`}
          </div>
          <div class="col-span-4">
            <div class="font-medium">\${albumName}</div>
            <div class="text-xs text-gray-400">\${releaseDate}</div>
          </div>
          <div class="col-span-2 text-gray-300">\${artist}</div>
          <div class="col-span-2 text-sm text-gray-400">\${genre}</div>
          <div class="col-span-1 text-red-500 font-semibold">\${rating}</div>
          <div class="col-span-1 text-gray-300">\${points}</div>
        \`;
        
        // Attach drag events
        row.addEventListener('dragstart', handleDragStart);
        row.addEventListener('dragend', handleDragEnd);
        
        rowsContainer.appendChild(row);
      });
      
      table.appendChild(rowsContainer);
      container.appendChild(table);
      
      // Initialize container-level drag and drop
      initializeDragAndDrop();
    }
    
    // File import
    document.getElementById('importBtn').onclick = () => {
      document.getElementById('fileInput').click();
    };
    
    document.getElementById('fileInput').onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const content = e.target.result;
            const data = JSON.parse(content);
            
            // Validate that it's an array
            if (!Array.isArray(data)) {
              throw new Error('JSON must be an array of albums');
            }
            
            // Validate album structure
            if (data.length > 0) {
              const requiredFields = ['artist', 'album'];
              const missingFields = requiredFields.filter(field => !data[0].hasOwnProperty(field));
              if (missingFields.length > 0) {
                throw new Error('Missing required fields: ' + missingFields.join(', '));
              }
            }
            
            const listName = file.name.replace('.json', '');
            
            // Save to IndexedDB
            await saveList(listName, data);
            
            updateListNav();
            selectList(listName);
            
            showToast(\`Successfully imported \${data.length} albums\`);
          } catch (err) {
            console.error('Import error:', err);
            showToast('Error importing file: ' + err.message, 'error');
          }
        };
        
        reader.onerror = (err) => {
          console.error('File read error:', err);
          showToast('Error reading file', 'error');
        };
        
        reader.readAsText(file, 'UTF-8');
      }
      // Reset file input
      e.target.value = '';
    };
    
    // Clear all lists
    document.getElementById('clearBtn').onclick = async () => {
      if (confirm('Are you sure you want to delete all lists? This cannot be undone.')) {
        try {
          await clearAllLists();
          currentList = null;
          updateListNav();
          document.getElementById('listTitle').textContent = 'Select a list to begin';
          document.getElementById('listInfo').textContent = '';
          document.getElementById('albumContainer').innerHTML = \`
            <div class="text-center text-gray-500 mt-20">
              <p class="text-xl mb-2">No list selected</p>
              <p class="text-sm">Import a JSON file to get started</p>
            </div>
          \`;
          showToast('All lists cleared');
        } catch (error) {
          console.error('Error clearing lists:', error);
          showToast('Error clearing lists', 'error');
        }
      }
    };
    
    // Initialize on load
    initDB().then(() => {
      loadLists();
    }).catch(err => {
      console.error('Failed to initialize database:', err);
      showToast('Failed to initialize database', 'error');
    });
  </script>
</body>
</html>
  `;
  
  res.send(spotifyTemplate);
});

// Logout
app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// Forgot password request
app.get('/forgot', (req, res) => {
  const content = `
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
  res.send(htmlTemplate(content, 'Password Recovery - Black Metal Auth'));
});

app.post('/forgot', (req, res) => {
  const { email } = req.body;
  users.findOne({ email }, (err, user) => {
    req.flash('info', 'If that email exists, you will receive a reset link');
    if (!user) return res.redirect('/forgot');

    // Generate reset token
    const token = crypto.randomBytes(20).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour
    users.update({ _id: user._id }, { $set: { resetToken: token, resetExpires: expires } }, {}, () => {
      // Configure email transport
      if (process.env.SENDGRID_API_KEY) {
        const transporter = nodemailer.createTransport({
          host: 'smtp.sendgrid.net',
          port: 587,
          auth: {
            user: 'apikey',
            pass: process.env.SENDGRID_API_KEY
          }
        });
        
        const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset/${token}`;
        transporter.sendMail({
          to: user.email,
          from: process.env.EMAIL_FROM || 'noreply@kvltauth.com',
          subject: 'Password Reset - Return to the Darkness',
          text: `A password reset has been requested for your account.
        
Click here to reset your password: ${resetUrl}

If you did not request this, ignore this email and your password will remain unchanged.

Stay kvlt,
The Inner Circle`
        });
      }
      res.redirect('/forgot');
    });
  });
});

// Reset password form
app.get('/reset/:token', (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, (err, user) => {
    if (!user) {
      const content = `
        <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
          <p class="text-red-500 text-center mb-4">This recovery rune has expired or been corrupted</p>
          <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request new recovery rune</a>
        </div>
      `;
      return res.send(htmlTemplate(content, 'Invalid Token - Black Metal Auth'));
    }
    const content = `
      <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
        <div class="text-center mb-8">
          <h1 class="metal-title text-3xl font-bold text-red-600 mb-2">FORGE NEW DARKNESS</h1>
          <p class="text-gray-400 text-sm">Create a new password to secure your soul</p>
        </div>
        
        <form method="post" action="/reset/${req.params.token}" class="space-y-6">
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
    res.send(htmlTemplate(content, 'Reset Password - Black Metal Auth'));
  });
});

// Handle password reset
app.post('/reset/:token', async (req, res) => {
  users.findOne({ resetToken: req.params.token, resetExpires: { $gt: Date.now() } }, async (err, user) => {
    if (!user) {
      const content = `
        <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-8 shadow-2xl">
          <p class="text-red-500 text-center mb-4">This recovery rune has expired or been corrupted</p>
          <a href="/forgot" class="block text-center text-red-500 hover:text-red-400 font-semibold">Request new recovery rune</a>
        </div>
      `;
      return res.send(htmlTemplate(content, 'Invalid Token - Black Metal Auth'));
    }
    
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      users.update({ _id: user._id }, { $set: { hash }, $unset: { resetToken: true, resetExpires: true } }, {}, () => {
        res.redirect('/login');
      });
    } catch (error) {
      console.error('Password reset error:', error);
      res.redirect('/reset/' + req.params.token);
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error:', err);
  res.status(500).send('Something went wrong!');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔥 Server burning at http://localhost:${PORT} 🔥`);
  console.log(`🔥 Environment: ${process.env.NODE_ENV || 'development'} 🔥`);
});