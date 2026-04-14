/* eslint-disable max-lines-per-function */

function createSpotifyTemplate(deps) {
  const {
    asset,
    generateAccentCssVars,
    generateAccentOverrides,
    headerComponent,
    contextMenusComponent,
    settingsDrawerComponent,
    modalPortalComponent,
    safeJsonStringify,
  } = deps;

  return (user, csrfToken = '') => `
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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0">
  <link href="${asset('/styles/output.css')}" rel="stylesheet">
  <link href="${asset('/styles/app.css')}" rel="stylesheet">
  <script defer src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
  <style>
    /* CSS Custom Properties for theming */
    :root {
      ${generateAccentCssVars(user)}
      --sidebar-transition-duration: 200ms;
    }
    
    /* Apply accent color to text and borders only, not buttons */
    ${generateAccentOverrides()}
    
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
        grid-template-columns: 14.5rem 1fr; /* Desktop: 232px sidebar */
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
        width: 15rem;
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
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    }

    @media (max-width: 1023px) {
      #albumContainer {
        padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px)); /* Space for FAB + safe area on mobile */
      }
    }
    
    /* Safe areas for iOS */
    .safe-area-bottom {
      padding-bottom: env(safe-area-inset-bottom, 0px);
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
        padding-top: env(safe-area-inset-top, 0px);
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
  <script>
    // Apply sidebar collapsed state before first paint to prevent flash of expanded sidebar.
    // This runs synchronously in <head>, before the browser renders <body>.
    try {
      if (localStorage.getItem('sidebarCollapsed') === 'true') {
        document.documentElement.classList.add('sidebar-is-collapsed');
      }
    } catch (e) {}
  </script>
  <style>
    /* When collapsed state is known before paint, apply immediately without transitions */
    .sidebar-is-collapsed .sidebar { width: 3rem !important; }
    .sidebar-is-collapsed .main-content { grid-template-columns: 3rem 1fr !important; }
    .sidebar-is-collapsed .sidebar nav { opacity: 0; visibility: hidden; }
    .sidebar-is-collapsed .sidebar .sidebar-action-btn { opacity: 0; visibility: hidden; width: 0; padding: 0; }
    .sidebar-is-collapsed .sidebar .sidebar-actions-container { padding: 0; border-color: transparent; }
    .sidebar-is-collapsed .sidebar #sidebarToggle i { transform: rotate(180deg); }
    .sidebar-is-collapsed .sidebar .spotify-miniplayer { opacity: 0; max-height: 0; padding: 0; border-color: transparent; }
    .sidebar-is-collapsed .sidebar .tidal-widget { opacity: 0; max-height: 0; padding: 0; border-color: transparent; }
  </style>
</head>
<body class="bg-gray-900 text-gray-200">
  <div class="app-layout">
    ${headerComponent(user, 'home')}
    
    <!-- Main Content Area -->
    <div class="main-content">
    <!-- Sidebar (responsive) -->
    <aside id="sidebar" class="sidebar border-r border-gray-800 flex flex-col transition-all duration-300" style="background: linear-gradient(to bottom, #2B3147 10%, #090D17 70%)">
      <!-- Sidebar Toggle Button -->
      <div class="flex items-center px-2" style="padding-top: 2px">
        <button 
          id="sidebarToggle" 
          class="p-2 hover:bg-gray-800 rounded-sm transition-colors"
          title="Toggle sidebar"
        >
          <i class="fas fa-chevron-left text-gray-400 transition-transform duration-300"></i>
        </button>
      </div>
      
      <nav class="flex-1 overflow-y-auto p-2 flex flex-col min-h-0">
        <div class="flex-1 overflow-y-auto">
          <ul id="listNav" class="space-y-0.5 pr-2">
            <!-- Lists will be populated here -->
          </ul>
        </div>
        
      </nav>
      
      <!-- Sidebar action buttons -->
      <div class="sidebar-actions-container shrink-0 border-t border-gray-800 py-1 pr-2 flex justify-evenly" style="background: linear-gradient(90deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.01) 100%)">
        <button id="createListBtn" class="sidebar-action-btn w-8 h-8 text-gray-300 rounded-sm text-sm transition duration-200 flex items-center justify-center" style="background-color: rgba(32, 227, 104, 0.15)" title="Create List">
          <span class="material-symbols-outlined" style="font-size: 25px">playlist_add</span>
        </button>
        <button id="createCollectionBtn" class="sidebar-action-btn w-8 h-8 text-gray-300 rounded-sm text-sm transition duration-200 flex items-center justify-center" style="background-color: rgba(32, 227, 104, 0.15)" title="Create Collection">
          <span class="material-symbols-outlined" style="font-size: 25px">create_new_folder</span>
        </button>
        <button id="importBtn" class="sidebar-action-btn w-8 h-8 text-gray-300 rounded-sm text-sm transition duration-200 flex items-center justify-center" style="background-color: rgba(32, 227, 104, 0.15)" title="Import List">
          <span class="material-symbols-outlined" style="font-size: 25px">file_open</span>
        </button>
      </div>
      <input type="file" id="fileInput" accept=".json" style="display: none;">
      
      <!-- Spotify Miniplayer (Desktop only) -->
      <div id="spotifyMiniplayer" class="spotify-miniplayer shrink-0 border-t border-gray-800 p-3 pt-2 hidden">
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
          <div class="flex items-center gap-2 mb-0.5" style="margin-left: -5px">
            <div id="miniplayerArt" class="w-[76px] h-[76px] bg-gray-800 rounded-md shrink-0 overflow-hidden">
              <img src="" alt="" class="w-full h-full object-cover hidden">
            </div>
            <div class="flex-1 min-w-0">
              <p id="miniplayerTrack" class="text-sm font-medium text-white truncate">No track</p>
              <p id="miniplayerArtist" class="text-xs text-gray-400 truncate">—</p>
            </div>
          </div>
          
          <!-- Progress Bar -->
          <div style="margin-left: -3px; margin-right: -3px; padding-right: 6px;">
            <input id="miniplayerProgress" type="range" min="0" max="1000" value="0"
              class="miniplayer-progress w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer">
            <div class="flex justify-between text-[10px] text-gray-300 mt-0.5">
              <span id="miniplayerTimeElapsed">0:00</span>
              <span id="miniplayerTimeTotal">0:00</span>
            </div>
          </div>
          
          <!-- Controls Row -->
          <div class="flex items-center justify-center" style="margin-left: -3px;">
            <!-- Playback Controls -->
<div class="flex items-center justify-between w-[200px]">
              <button id="miniplayerPrev" class="px-2 py-1.5 text-gray-400 hover:text-white transition-colors" title="Previous">
                <i class="fas fa-step-backward text-sm"></i>
              </button>
              <button id="miniplayerPlayPause" class="w-9 h-9 flex items-center justify-center bg-white text-gray-900 rounded-full hover:scale-105 transition-transform" title="Play/Pause">
                <i class="fas fa-play text-sm"></i>
              </button>
              <button id="miniplayerNext" class="px-2 py-1.5 text-gray-400 hover:text-white transition-colors" title="Next">
                <i class="fas fa-step-forward text-sm"></i>
              </button>
            </div>
          </div>
          
          <!-- Volume Control Row -->
          <div id="miniplayerVolumeRow" class="flex items-center mb-0 gap-2" style="margin-top: 0px; margin-left: -9px; margin-right: -7px; padding-left: 3px; padding-right: 12px;">
              <button id="miniplayerMute" class="p-1.5 text-gray-400 hover:text-white transition-colors shrink-0" title="Mute">
                <i class="fas fa-volume-up text-xs"></i>
              </button>
              <input id="miniplayerVolume" type="range" min="0" max="100" value="50" 
                class="flex-1 min-w-0 h-1 bg-gray-700 rounded-full appearance-none cursor-pointer">
          </div>
          
          <!-- Current Device Indicator with Device Picker -->
          <div id="miniplayerCurrentDevice" style="margin-top: 6px" class="pt-4 border-t-2 border-gray-700/50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)] flex items-center justify-center">
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
      <div id="mobileMenuDrawer" class="absolute left-0 top-0 bottom-0 w-72 max-w-[80vw] border-r border-gray-800 overflow-hidden flex flex-col transition-transform" style="background: linear-gradient(to bottom, #2B3147 10%, #090D17 70%); transition-duration: var(--sidebar-transition-duration); transform: translateX(-100%);">
        <!-- Header (close button only, no title — matches desktop which removed "Lists" heading) -->
        <div class="px-3 py-1.5 border-b border-gray-800 flex justify-end" style="padding-top: calc(0.375rem + env(safe-area-inset-top, 0px))">
          <button onclick="toggleMobileMenu()" class="p-2 -m-2 text-gray-400 active:text-white touch-target">
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>
        
        <!-- Lists -->
        <div class="flex-1 overflow-y-auto p-2">
          <ul id="mobileListNav" class="space-y-0.5">
            <!-- Mobile list items will be populated here -->
          </ul>
        </div>
        
        <!-- Footer Actions -->
        <div class="py-2 px-3 border-t border-gray-800 flex justify-evenly" style="padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px)); background: linear-gradient(90deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.01) 100%)">
          <button onclick="document.getElementById('createListBtn').click(); toggleMobileMenu();" 
                  class="mobile-action-btn w-14 h-11 text-gray-300 rounded-sm transition duration-200 flex flex-col items-center justify-center gap-0.5" style="background-color: rgba(32, 227, 104, 0.15)" title="Create List">
            <span class="material-symbols-outlined" style="font-size: 24px">playlist_add</span>
            <span class="text-[10px] text-gray-400 leading-tight">List</span>
          </button>
          <button onclick="document.getElementById('createCollectionBtn').click(); toggleMobileMenu();" 
                  class="mobile-action-btn w-14 h-11 text-gray-300 rounded-sm transition duration-200 flex flex-col items-center justify-center gap-0.5" style="background-color: rgba(32, 227, 104, 0.15)" title="Create Collection">
            <span class="material-symbols-outlined" style="font-size: 24px">create_new_folder</span>
            <span class="text-[10px] text-gray-400 leading-tight">Collection</span>
          </button>
          <button onclick="document.getElementById('importBtn').click(); toggleMobileMenu();" 
                  class="mobile-action-btn w-14 h-11 text-gray-300 rounded-sm transition duration-200 flex flex-col items-center justify-center gap-0.5" style="background-color: rgba(32, 227, 104, 0.15)" title="Import List">
            <span class="material-symbols-outlined" style="font-size: 24px">file_open</span>
            <span class="text-[10px] text-gray-400 leading-tight">Import</span>
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
    
    // Prevent background scroll when touching the sidebar backdrop on mobile
    function preventBackdropScroll(e) {
      e.preventDefault();
    }

    // Mobile menu toggle
    function toggleMobileMenu() {
      const menu = document.getElementById('mobileMenu');
      const backdrop = document.getElementById('mobileMenuBackdrop');
      const drawer = document.getElementById('mobileMenuDrawer');
      const fab = document.getElementById('addAlbumFAB');
      const nowPlaying = document.getElementById('mobileNowPlaying');
      const albumContainer = document.getElementById('albumContainer');
      const isOpen = menu.dataset.open === 'true';
      
      if (isOpen) {
        // Closing
        menu.dataset.open = 'false';
        backdrop.style.opacity = '0';
        drawer.style.transform = 'translateX(-100%)';
        document.body.style.overflow = '';
        if (albumContainer) {
          albumContainer.style.overflow = '';
          albumContainer.style.touchAction = '';
        }
        backdrop.removeEventListener('touchmove', preventBackdropScroll);
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
        document.body.style.overflow = 'hidden';
        if (albumContainer) {
          albumContainer.style.overflow = 'hidden';
          albumContainer.style.touchAction = 'none';
        }
        // Block touch-scroll on the backdrop so album list behind can't scroll
        backdrop.addEventListener('touchmove', preventBackdropScroll, { passive: false });
        // Collapse all groups except the active list's group
        if (window.collapseGroupsForActiveList) window.collapseGroupsForActiveList();
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

    // Swipe-to-close gesture for mobile drawer
    (function initMobileDrawerSwipe() {
      const drawer = document.getElementById('mobileMenuDrawer');
      const backdrop = document.getElementById('mobileMenuBackdrop');
      const menu = document.getElementById('mobileMenu');
      if (!drawer) return;

      let startX = 0;
      let currentX = 0;
      let isDragging = false;
      const CLOSE_THRESHOLD = 80; // px to swipe before closing

      drawer.addEventListener('touchstart', function(e) {
        if (menu.dataset.open !== 'true') return;
        if (window._sidebarDragActive) return;
        startX = e.touches[0].clientX;
        currentX = startX;
        isDragging = true;
        drawer.style.transitionDuration = '0ms';
        if (backdrop) backdrop.style.transitionDuration = '0ms';
      }, { passive: true });

      drawer.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        const deltaX = currentX - startX;
        // Only allow swiping left (closing direction)
        if (deltaX < 0) {
          drawer.style.transform = 'translateX(' + deltaX + 'px)';
          // Fade backdrop proportionally
          const drawerWidth = drawer.offsetWidth;
          const progress = Math.min(Math.abs(deltaX) / drawerWidth, 1);
          if (backdrop) backdrop.style.opacity = String(0.5 * (1 - progress));
        }
      }, { passive: true });

      drawer.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        const deltaX = currentX - startX;
        // Restore transition duration
        drawer.style.transitionDuration = '';
        if (backdrop) backdrop.style.transitionDuration = '';

        if (deltaX < -CLOSE_THRESHOLD) {
          // Swipe far enough — close the drawer
          toggleMobileMenu();
        } else {
          // Snap back open
          drawer.style.transform = 'translateX(0)';
          if (backdrop) backdrop.style.opacity = '0.5';
        }
      }, { passive: true });
    })();
    
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
}

module.exports = {
  createSpotifyTemplate,
};
