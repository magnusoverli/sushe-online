// Options page script for SuShe Online extension

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings on page load
  const settings = await chrome.storage.local.get(['apiUrl', 'authToken']);

  const apiUrl = settings.apiUrl || 'http://localhost:3000';
  document.getElementById('apiUrl').value = apiUrl;

  // Update authentication status
  await updateAuthStatus(apiUrl, settings.authToken);

  // Handle form submission
  document
    .getElementById('settingsForm')
    .addEventListener('submit', async (e) => {
      e.preventDefault();

      const apiUrl = document.getElementById('apiUrl').value.trim();

      // Validate URL
      try {
        new URL(apiUrl);
      } catch (_err) {
        showStatus('Invalid URL format. Please enter a valid URL.', 'error');
        return;
      }

      // Remove trailing slash if present
      const cleanUrl = apiUrl.replace(/\/$/, '');

      // Save to storage
      await chrome.storage.local.set({ apiUrl: cleanUrl });

      // Notify background script to update
      await chrome.runtime.sendMessage({
        action: 'updateApiUrl',
        apiUrl: cleanUrl,
      });

      showStatus(
        '✓ Settings saved successfully! The extension will now use: ' +
          cleanUrl,
        'success'
      );

      // Clear lists cache to force refresh with new URL
      await chrome.storage.local.remove(['userLists', 'listsLastFetched']);
    });

  // Test connection button
  document.getElementById('testBtn').addEventListener('click', async () => {
    const apiUrl = document
      .getElementById('apiUrl')
      .value.trim()
      .replace(/\/$/, '');
    const resultEl = document.getElementById('testResult');
    const btn = document.getElementById('testBtn');

    btn.disabled = true;
    btn.textContent = 'Testing...';
    resultEl.innerHTML = '';

    try {
      // Try to fetch from the API
      const response = await fetch(`${apiUrl}/api/lists`, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const listCount = Object.keys(data).length;
        resultEl.innerHTML = `<span style="color: #10b981;">✓ Connected successfully! Found ${listCount} list(s).</span>`;
      } else if (response.status === 401) {
        resultEl.innerHTML = `<span style="color: #f59e0b;">⚠ Connected to SuShe Online, but you're not logged in. Please login at: <a href="${apiUrl}" target="_blank" style="color: #60a5fa;">${apiUrl}</a></span>`;
      } else {
        resultEl.innerHTML = `<span style="color: #ef4444;">✗ Server responded with status ${response.status}</span>`;
      }
    } catch (error) {
      resultEl.innerHTML = `<span style="color: #ef4444;">✗ Connection failed: ${error.message}<br><small>Make sure SuShe Online is running and accessible.</small></span>`;
    }

    btn.disabled = false;
    btn.textContent = 'Test Connection to SuShe Online';
  });
});

function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 3000);
  }
}

// Update authentication status display
async function updateAuthStatus(apiUrl, authToken) {
  const authStatusEl = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (!authToken) {
    authStatusEl.innerHTML =
      '<span style="color: #f59e0b;">⚠ Not logged in</span>';
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    return;
  }

  // Verify token is valid by checking with API
  try {
    const response = await fetch(`${apiUrl}/api/lists`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      const listCount = Object.keys(data).length;
      authStatusEl.innerHTML = `<span style="color: #10b981;">✓ Logged in</span> <span style="color: #6b7280;">(${listCount} list${listCount !== 1 ? 's' : ''})</span>`;
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
    } else {
      authStatusEl.innerHTML =
        '<span style="color: #f59e0b;">⚠ Session expired</span>';
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
    }
  } catch (error) {
    authStatusEl.innerHTML = `<span style="color: #6b7280;">Unable to verify (${error.message})</span>`;
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
  }
}

// Login button handler
document.getElementById('loginBtn').addEventListener('click', async () => {
  const apiUrl = document
    .getElementById('apiUrl')
    .value.trim()
    .replace(/\/$/, '');
  const loginUrl = `${apiUrl}/extension/auth`;

  // Open login page in new tab
  chrome.tabs.create({ url: loginUrl });

  // Show message
  showStatus(
    'Opening login page... Close this tab and return here after logging in.',
    'success'
  );

  // Poll for auth token changes
  const checkAuth = setInterval(async () => {
    const settings = await chrome.storage.local.get(['authToken']);
    if (settings.authToken) {
      clearInterval(checkAuth);
      await updateAuthStatus(apiUrl, settings.authToken);
      showStatus('✓ Successfully logged in!', 'success');
    }
  }, 1000);

  // Stop checking after 5 minutes
  setTimeout(() => clearInterval(checkAuth), 300000);
});

// Logout button handler
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (
    confirm('Are you sure you want to logout? You will need to login again.')
  ) {
    await chrome.storage.local.remove(['authToken', 'userLists']);
    const apiUrl = document
      .getElementById('apiUrl')
      .value.trim()
      .replace(/\/$/, '');
    await updateAuthStatus(apiUrl, null);
    showStatus('✓ Logged out successfully', 'success');

    // Notify background script to refresh
    chrome.runtime.sendMessage({ action: 'refreshLists' });
  }
});
