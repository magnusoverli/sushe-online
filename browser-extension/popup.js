// Popup script for SuShe Online extension

let SUSHE_API_BASE = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  // Load API URL from storage
  const settings = await chrome.storage.local.get(['apiUrl']);
  if (settings.apiUrl) {
    SUSHE_API_BASE = settings.apiUrl;
  }

  loadLists();

  document.getElementById('refreshBtn').addEventListener('click', refreshLists);
  document.getElementById('loginBtn').addEventListener('click', openSuShe);
});

async function loadLists() {
  const statusEl = document.getElementById('status');
  const listsEl = document.getElementById('lists');
  const listItemsEl = document.getElementById('listItems');

  statusEl.innerHTML = '<div class="status info">Loading your lists...</div>';

  try {
    const response = await fetch(`${SUSHE_API_BASE}/api/lists`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
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

    // Display lists
    listItemsEl.innerHTML = '';
    listNames.forEach((name) => {
      const count = listsData[name].length;
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

function openSuShe() {
  chrome.tabs.create({ url: SUSHE_API_BASE });
}
