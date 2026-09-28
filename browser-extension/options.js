// Settings and authentication use the background worker as their source of truth.
const { fetchApiWithTimeout, normalizeApiUrl, sendCheckedMessage } =
  globalThis.SharedUtils;
const { ACTIONS, API, STORAGE_KEYS } = globalThis.ExtensionConstants;
let statusTimer;
let authStatusRequest = 0;

async function saveSettings() {
  const input = document.getElementById('apiUrl');
  const { apiUrl } = await sendCheckedMessage(ACTIONS.UPDATE_API_URL, {
    apiUrl: normalizeApiUrl(input.value),
  });
  input.value = apiUrl;
  return apiUrl;
}

document.addEventListener('DOMContentLoaded', async () => {
  document
    .getElementById('settingsForm')
    .addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const apiUrl = await saveSettings();
        showStatus(
          `Settings saved successfully! The extension will now use: ${apiUrl}`,
          'success'
        );
        await updateAuthStatus();
      } catch (error) {
        showStatus(error.message, 'error');
      }
    });
  document.getElementById('testBtn').addEventListener('click', testConnection);
  document.getElementById('loginBtn').addEventListener('click', async () => {
    const button = document.getElementById('loginBtn');
    button.disabled = true;
    try {
      // Persist the visible URL first so login cannot silently use an old server.
      await saveSettings();
      await sendCheckedMessage(ACTIONS.START_LOGIN);
      showStatus(
        'Opening login page. Authorize the extension there, then return here.',
        'info'
      );
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    if (
      !confirm('Are you sure you want to logout? You will need to login again.')
    )
      return;
    try {
      await sendCheckedMessage(ACTIONS.LOGOUT);
      await updateAuthStatus();
      showStatus('Logged out successfully', 'success');
    } catch (error) {
      showStatus(error.message, 'error');
    }
  });
  try {
    const state = await sendCheckedMessage(ACTIONS.GET_API_URL);
    document.getElementById('apiUrl').value = state?.apiUrl || '';
    await updateAuthStatus();
  } catch (error) {
    showStatus(error.message, 'error');
  }
});

async function testConnection() {
  const result = document.getElementById('testResult');
  const button = document.getElementById('testBtn');
  button.disabled = true;
  button.textContent = 'Testing...';
  result.textContent = '';
  try {
    const apiUrl = normalizeApiUrl(document.getElementById('apiUrl').value);
    const response = await fetchApiWithTimeout(
      `${apiUrl}${API.LISTS}`,
      { headers: { Accept: 'application/json' } },
      10000
    );
    if (!response.ok && response.status !== 401) {
      throw new Error(`Server responded with status ${response.status}`);
    }
    // A redirect to an HTML login page is not a successful API response.
    if (response.ok) await response.json();
    result.style.color = '#10b981';
    result.textContent =
      'SuShe Online is reachable. Extension sign-in status is shown under Authentication.';
  } catch (error) {
    result.style.color = '#ef4444';
    result.textContent = `Connection failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Test Connection';
  }
}

function showStatus(message, type) {
  const element = document.getElementById('status');
  clearTimeout(statusTimer);
  element.textContent = message;
  element.className = `status ${type}`;
  // A previous success timer must not hide later errors or login progress.
  element.style.display = 'block';
  if (type === 'success') {
    statusTimer = setTimeout(() => {
      element.style.display = 'none';
    }, 3000);
  }
}

async function updateAuthStatus() {
  const request = ++authStatusRequest;
  const status = document.getElementById('authStatus');
  try {
    const state = await sendCheckedMessage(ACTIONS.GET_POPUP_STATE);
    if (request !== authStatusRequest) return;
    const loggedIn = state.auth?.isAuthenticated;
    status.textContent = loggedIn
      ? `● Logged in (${state.count} list${state.count !== 1 ? 's' : ''})`
      : '○ Not logged in';
    status.style.color = loggedIn ? '#10b981' : '#f59e0b';
    document.getElementById('loginBtn').style.display = loggedIn
      ? 'none'
      : 'inline-block';
    document.getElementById('logoutBtn').style.display = loggedIn
      ? 'inline-block'
      : 'none';
  } catch (error) {
    if (request !== authStatusRequest) return;
    status.textContent = `Unable to check authentication: ${error.message}`;
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === 'local' &&
    [
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRES_AT,
      STORAGE_KEYS.API_URL,
    ].some((key) => changes[key])
  ) {
    updateAuthStatus();
    if (changes[STORAGE_KEYS.AUTH_TOKEN]?.newValue) {
      showStatus('Successfully logged in!', 'success');
    }
  }
});
