// Popup script for SuShe Online extension
// Renders background-owned extension state.

const { ACTIONS, STORAGE_KEYS } = globalThis.ExtensionConstants;
const { sendCheckedMessage } = globalThis.SharedUtils;
let stateRequest = 0;

function showError(message) {
  const status = document.createElement('div');
  status.className = 'status error';
  status.textContent = message;
  document.getElementById('status').replaceChildren(status);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load state and update UI
  // NOTE: loadLists() now uses background as single source of truth.
  // It shows cached lists immediately and only refreshes when the cache is stale.
  loadLists();

  // Set up event listeners
  document.getElementById('refreshBtn').addEventListener('click', refreshLists);
  document.getElementById('optionsBtn').addEventListener('click', openOptions);
  document.getElementById('loginBtn').addEventListener('click', openLogin);
  document.getElementById('logoutBtn').addEventListener('click', logout);
});

// Listen for storage changes to auto-refresh when auth token changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (
      changes[STORAGE_KEYS.AUTH_TOKEN] ||
      changes[STORAGE_KEYS.API_URL] ||
      changes[STORAGE_KEYS.TOKEN_EXPIRES_AT] ||
      changes[STORAGE_KEYS.LISTS_LAST_FETCHED]
    ) {
      console.log('Auth state changed, reloading lists');
      loadLists();
    }
  }
});

async function loadLists() {
  const request = ++stateRequest;
  const statusEl = document.getElementById('status');
  const listsEl = document.getElementById('lists');
  const listItemsEl = document.getElementById('listItems');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const response = await sendCheckedMessage(ACTIONS.GET_POPUP_STATE);
    if (request !== stateRequest) return;

    const authState = {
      apiUrl: response.auth?.apiUrl || null,
      isValid: !!response.auth?.isAuthenticated,
      isExpired: !!response.auth?.isExpired,
      token: response.auth?.hasToken ? 'present' : null,
    };

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
    const cacheNotice = response.stale ? ' (cached)' : '';
    statusEl.innerHTML = `<div class="status success">${response.count} list(s) loaded${cacheNotice}</div>`;
  } catch (error) {
    if (request !== stateRequest) return;
    console.error('[Popup] Failed to load lists:', error);
    showError(error.message);
    listsEl.style.display = 'none';
  }
}

async function refreshLists() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="icon">↻</span> Refreshing...';

  try {
    await sendCheckedMessage(ACTIONS.REFRESH_LISTS);
    await loadLists();
  } catch (error) {
    showError(error.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="icon">↻</span> Refresh Lists';
  }
}

function openOptions() {
  // Open the extension options page
  return chrome.runtime
    .openOptionsPage()
    .catch((error) => showError(error.message));
}

async function openLogin() {
  try {
    const authState = await sendCheckedMessage(ACTIONS.GET_API_URL);
    if (!authState?.apiUrl) {
      await openOptions();
      return;
    }
    await sendCheckedMessage(ACTIONS.START_LOGIN);
  } catch (error) {
    showError(error.message);
  }
}

async function logout() {
  try {
    await sendCheckedMessage(ACTIONS.LOGOUT);
    await loadLists();
  } catch (error) {
    showError(error.message);
  }
}
