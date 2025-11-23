// Popup script for SuShe Online extension
// Uses shared auth-state.js and shared-utils.js (loaded via popup.html)

// Access shared modules from globalThis
const { fetchWithTimeout } = globalThis.SharedUtils;
const { getAuthState } = globalThis.AuthState;

document.addEventListener('DOMContentLoaded', async () => {
  // Load state and update UI
  await loadLists();

  // Also trigger a background refresh of context menu lists
  // This keeps lists fresh when user interacts with the extension
  chrome.runtime.sendMessage({ action: 'refreshLists' }).catch(() => {
    // Ignore errors - background script might not be ready
  });

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
    // Use metadata API for faster loading (no album data needed)
    const response = await fetchWithTimeout(
      `${authState.apiUrl}/api/lists`,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authState.token}`,
        },
      },
      10000 // 10 second timeout
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Token is invalid - trigger centralized logout
        await chrome.runtime.sendMessage({ action: 'logout' });
        statusEl.innerHTML =
          '<div class="status error">Session expired. Please login again.</div>';
        loginBtn.style.display = 'block';
        logoutBtn.style.display = 'none';
        listsEl.style.display = 'none';
        return;
      }
      throw new Error(`API returned ${response.status}`);
    }

    const listsData = await response.json();
    const listNames = Object.keys(listsData);

    if (listNames.length === 0) {
      statusEl.innerHTML =
        '<div class="status error">No lists found. Create a list in SuShe Online first!</div>';
      listsEl.style.display = 'none';
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
    statusEl.innerHTML = `<div class="status success">${listNames.length} list(s) loaded</div>`;
  } catch (error) {
    console.error('Failed to load lists:', error);
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
