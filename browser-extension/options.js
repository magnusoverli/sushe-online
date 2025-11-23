// Options page script for SuShe Online extension
// Uses shared auth-state.js and shared-utils.js (loaded via options.html)

// Access shared modules from globalThis
const { fetchWithTimeout } = globalThis.SharedUtils;
const { getAuthState } = globalThis.AuthState;

// Store interval reference for cleanup
let authCheckInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings on page load
  const authState = await getAuthState();

  // No default - force user to configure
  const apiUrl = authState.apiUrl || '';
  document.getElementById('apiUrl').value = apiUrl;

  // Update authentication status
  await updateAuthStatus();

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
        'Settings saved successfully! The extension will now use: ' + cleanUrl,
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
      const response = await fetchWithTimeout(
        `${apiUrl}/api/lists`,
        {
          headers: {
            Accept: 'application/json',
          },
        },
        10000 // 10 second timeout
      );

      if (response.ok) {
        const data = await response.json();
        const listCount = Object.keys(data).length;
        resultEl.innerHTML = `<span style="color: #10b981;">Connected successfully! Found ${listCount} list(s).</span>`;
      } else if (response.status === 401) {
        resultEl.innerHTML = `<span style="color: #f59e0b;">Connected to SuShe Online, but you're not logged in. Please login at: <a href="${apiUrl}" target="_blank" style="color: #60a5fa;">${apiUrl}</a></span>`;
      } else {
        resultEl.innerHTML = `<span style="color: #ef4444;">Server responded with status ${response.status}</span>`;
      }
    } catch (error) {
      resultEl.innerHTML = `<span style="color: #ef4444;">Connection failed: ${error.message}<br><small>Make sure SuShe Online is running and accessible.</small></span>`;
    }

    btn.disabled = false;
    btn.textContent = 'Test Connection to SuShe Online';
  });

  // Login button handler
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const apiUrl = document
      .getElementById('apiUrl')
      .value.trim()
      .replace(/\/$/, '');

    if (!apiUrl) {
      showStatus('Please enter your SuShe Online URL first.', 'error');
      return;
    }

    const loginUrl = `${apiUrl}/extension/auth`;

    // Open login page in new tab
    chrome.tabs.create({ url: loginUrl });

    // Show message
    showStatus(
      'Opening login page... Close this tab and return here after logging in.',
      'success'
    );

    // Clear any existing interval
    if (authCheckInterval) {
      clearInterval(authCheckInterval);
      authCheckInterval = null;
    }

    // Poll for auth token changes
    authCheckInterval = setInterval(async () => {
      const authState = await getAuthState();
      if (authState.isValid) {
        clearInterval(authCheckInterval);
        authCheckInterval = null;
        await updateAuthStatus();
        showStatus('Successfully logged in!', 'success');
      }
    }, 1000);

    // Stop checking after 5 minutes
    setTimeout(() => {
      if (authCheckInterval) {
        clearInterval(authCheckInterval);
        authCheckInterval = null;
      }
    }, 300000);
  });

  // Logout button handler
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    if (
      confirm('Are you sure you want to logout? You will need to login again.')
    ) {
      // Use centralized logout in background script (fixes Issue #6)
      await chrome.runtime.sendMessage({ action: 'logout' });

      await updateAuthStatus();
      showStatus('Logged out successfully', 'success');
    }
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
// Uses shared auth state module for consistent validation (fixes Issue #5)
async function updateAuthStatus() {
  const authStatusEl = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // Get auth state from shared module
  const authState = await getAuthState();

  // Check if token is expired (client-side check - fixes Issue #3)
  if (authState.token && authState.isExpired) {
    authStatusEl.innerHTML =
      '<span style="color: #f59e0b;">Session expired - please login again</span>';
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';

    // Trigger cleanup via centralized logout
    await chrome.runtime.sendMessage({ action: 'logout' });
    return;
  }

  if (!authState.token) {
    authStatusEl.innerHTML =
      '<span style="color: #f59e0b;">Not logged in</span>';
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    return;
  }

  if (!authState.apiUrl) {
    authStatusEl.innerHTML =
      '<span style="color: #6b7280;">Configure URL above first</span>';
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'none';
    return;
  }

  // Verify token is valid by checking with API (for options page, we do full validation)
  try {
    const response = await fetchWithTimeout(
      `${authState.apiUrl}/api/lists`,
      {
        headers: {
          Authorization: `Bearer ${authState.token}`,
          Accept: 'application/json',
        },
      },
      10000 // 10 second timeout
    );

    if (response.ok) {
      const data = await response.json();
      const listCount = Object.keys(data).length;
      authStatusEl.innerHTML = `<span style="color: #10b981;">Logged in</span> <span style="color: #6b7280;">(${listCount} list${listCount !== 1 ? 's' : ''})</span>`;
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-block';
    } else if (response.status === 401) {
      authStatusEl.innerHTML =
        '<span style="color: #f59e0b;">Session expired</span>';
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';

      // Trigger cleanup via centralized logout
      await chrome.runtime.sendMessage({ action: 'logout' });
    } else {
      authStatusEl.innerHTML = `<span style="color: #6b7280;">Unable to verify (HTTP ${response.status})</span>`;
      loginBtn.style.display = 'inline-block';
      logoutBtn.style.display = 'none';
    }
  } catch (error) {
    authStatusEl.innerHTML = `<span style="color: #6b7280;">Unable to verify (${error.message})</span>`;
    // On network error, show both buttons - user might need to login or might already be logged in
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
  }
}

// Listen for storage changes to update UI
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.authToken || changes.tokenExpiresAt) {
      updateAuthStatus();
    }
  }
});

// Cleanup on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (authCheckInterval) {
    clearInterval(authCheckInterval);
    authCheckInterval = null;
  }
});
