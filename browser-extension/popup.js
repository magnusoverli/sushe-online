// Popup script for SuShe Online extension
// Uses shared auth-state.js and shared-utils.js (loaded via popup.html)

// Access shared modules from globalThis
const { getAuthState } = globalThis.AuthState;

document.addEventListener('DOMContentLoaded', async () => {
  // Load state and update UI
  // NOTE: loadLists() now uses background as single source of truth
  // This automatically refreshes both popup AND context menu with forceRefresh: true
  await loadLists();

  // Set up event listeners
  document.getElementById('refreshBtn').addEventListener('click', refreshLists);
  document.getElementById('optionsBtn').addEventListener('click', openOptions);
  document.getElementById('loginBtn').addEventListener('click', openLogin);
  document.getElementById('logoutBtn').addEventListener('click', logout);
});

// Listen for storage changes to auto-refresh when auth token changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.authToken || changes.tokenExpiresAt) {
      console.log('Auth state changed, reloading lists');
      loadLists();
    }
  }
});

async function loadLists() {
  const statusEl = document.getElementById('status');
  const listsEl = document.getElementById('lists');
  const listItemsEl = document.getElementById('listItems');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // Get auth state from shared module (always reads from storage)
  const authState = await getAuthState();

  // Show/hide buttons based on auth state (fixes Issue #5 - consistent validation)
  if (authState.isValid) {
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'block';
  } else {
    loginBtn.style.display = 'block';
    logoutBtn.style.display = 'none';

    // If token existed but is expired, show appropriate message
    if (authState.token && authState.isExpired) {
      statusEl.innerHTML =
        '<div class="status error">Session expired. Please login again.</div>';
      listsEl.style.display = 'none';
      return;
    }
  }

  // Check if URL is configured
  if (!authState.apiUrl) {
    statusEl.innerHTML =
      '<div class="status error">Not configured. Click Settings to set your SuShe Online URL.</div>';
    listsEl.style.display = 'none';
    return;
  }

  // Check if authenticated
  if (!authState.isValid) {
    statusEl.innerHTML =
      '<div class="status error">Not logged in. Click Login to authenticate.</div>';
    listsEl.style.display = 'none';
    return;
  }

  statusEl.innerHTML = '<div class="status info">Loading your lists...</div>';

  try {
    // Get lists from background (single source of truth)
    // This ensures popup and context menu always show the same data
    // forceRefresh: true ensures we get fresh data when opening popup
    console.log('[Popup] Requesting lists from background...');
    const response = await chrome.runtime.sendMessage({
      action: 'getLists',
      forceRefresh: true,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get lists from background');
    }

    console.log('[Popup] Received', response.count, 'lists from background');

    if (response.count === 0) {
      statusEl.innerHTML =
        '<div class="status error">No lists found. Create a list in SuShe Online first!</div>';
      listsEl.style.display = 'none';
      return;
    }

    // Display lists with metadata (using background's cached data)
    listItemsEl.innerHTML = '';

    // Get years sorted: numeric years descending, then 'Uncategorized' at the end
    const years = Object.keys(response.lists).sort((a, b) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return parseInt(b) - parseInt(a);
    });

    years.forEach((year) => {
      const lists = response.lists[year];
      lists.forEach((list) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.textContent = `${list.name} (${list.count} albums)`;
        listItemsEl.appendChild(item);
      });
    });

    listsEl.style.display = 'block';
    statusEl.innerHTML = `<div class="status success">${response.count} list(s) loaded</div>`;
  } catch (error) {
    console.error('[Popup] Failed to load lists:', error);

    // Handle specific error cases
    if (error.message && error.message.includes('401')) {
      // Token is invalid - trigger centralized logout
      await chrome.runtime.sendMessage({ action: 'logout' });
      statusEl.innerHTML =
        '<div class="status error">Session expired. Please login again.</div>';
      loginBtn.style.display = 'block';
      logoutBtn.style.display = 'none';
      listsEl.style.display = 'none';
      return;
    }

    statusEl.innerHTML = `<div class="status error">${error.message}</div>`;
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

async function openLogin() {
  const authState = await getAuthState();

  if (!authState.apiUrl) {
    alert('Please configure your SuShe Online URL in Settings first.');
    openOptions();
    return;
  }
  // Open login page
  chrome.tabs.create({ url: `${authState.apiUrl}/extension/auth` });
}

async function logout() {
  // Use centralized logout in background script (fixes Issue #6)
  await chrome.runtime.sendMessage({ action: 'logout' });

  // UI will update via storage.onChanged listener, but also refresh immediately
  await loadLists();
}
