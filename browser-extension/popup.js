// Popup script for SuShe Online extension

let SUSHE_API_BASE = 'http://localhost:3000';
let AUTH_TOKEN = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Load API URL and auth token from storage
  const settings = await chrome.storage.local.get(['apiUrl', 'authToken']);
  if (settings.apiUrl) {
    SUSHE_API_BASE = settings.apiUrl;
  }
  if (settings.authToken) {
    AUTH_TOKEN = settings.authToken;
  }

  loadLists();

  document.getElementById('refreshBtn').addEventListener('click', refreshLists);
  document.getElementById('optionsBtn').addEventListener('click', openOptions);
  document.getElementById('loginBtn').addEventListener('click', openLogin);
  document.getElementById('logoutBtn').addEventListener('click', logout);
});

// Listen for storage changes to auto-refresh when auth token changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.authToken) {
    AUTH_TOKEN = changes.authToken?.newValue || null;
    console.log('Auth token changed, reloading lists');
    loadLists();
  }
});

// Get authorization headers for API requests
function getAuthHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  return headers;
}

async function loadLists() {
  const statusEl = document.getElementById('status');
  const listsEl = document.getElementById('lists');
  const listItemsEl = document.getElementById('listItems');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // Show/hide buttons based on auth state
  if (AUTH_TOKEN) {
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'block';
  } else {
    loginBtn.style.display = 'block';
    logoutBtn.style.display = 'none';
  }

  statusEl.innerHTML = '<div class="status info">Loading your lists...</div>';

  try {
    // Use metadata API for faster loading (no album data needed)
    const response = await fetch(`${SUSHE_API_BASE}/api/lists`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Not logged in to SuShe Online');
      }
      throw new Error(`API returned ${response.status}`);
    }

    const listsData = await response.json();
    const listNames = Object.keys(listsData);

    if (listNames.length === 0) {
      statusEl.innerHTML =
        '<div class="status error">No lists found. Create a list in SuShe Online first!</div>';
      return;
    }

    // Display lists with metadata
    listItemsEl.innerHTML = '';
    listNames.forEach((name) => {
      // Use metadata count instead of array length
      const count = listsData[name].count;
      const item = document.createElement('div');
      item.className = 'list-item';
      item.textContent = `${name} (${count} albums)`;
      listItemsEl.appendChild(item);
    });

    listsEl.style.display = 'block';
    statusEl.innerHTML = `<div class="status success">✓ ${listNames.length} list(s) loaded</div>`;
  } catch (error) {
    console.error('Failed to load lists:', error);
    statusEl.innerHTML = `<div class="status error">⚠️ ${error.message}</div>`;
    listsEl.style.display = 'none';
  }
}

async function refreshLists() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';

  // Tell background script to refresh
  chrome.runtime.sendMessage({ action: 'refreshLists' }, (_response) => {
    btn.disabled = false;
    btn.textContent = 'Refresh Lists';
    loadLists();
  });
}

function openOptions() {
  // Open the extension options page
  chrome.runtime.openOptionsPage();
}

function openLogin() {
  // Open login page
  chrome.tabs.create({ url: `${SUSHE_API_BASE}/extension/auth` });

  // The auth page will use chrome.runtime.sendMessage to send the token
  // We listen for storage changes instead (already set up in loadSettings)
}

async function logout() {
  // Clear token from storage
  await chrome.storage.local.remove(['authToken', 'tokenExpiresAt']);
  AUTH_TOKEN = null;

  // Reload the popup to show logged out state
  loadLists();
}
