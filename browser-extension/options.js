

document.addEventListener('DOMContentLoaded', async () => {
  
  const settings = await chrome.storage.local.get(['apiUrl']);

  if (settings.apiUrl) {
    document.getElementById('apiUrl').value = settings.apiUrl;
  } else {
    
    document.getElementById('apiUrl').value = 'http://localhost:3000';
  }

  
  document
    .getElementById('settingsForm')
    .addEventListener('submit', async (e) => {
      e.preventDefault();

      const apiUrl = document.getElementById('apiUrl').value.trim();

      
      try {
        new URL(apiUrl);
      } catch (_err) {
        showStatus('Invalid URL format. Please enter a valid URL.', 'error');
        return;
      }

      
      const cleanUrl = apiUrl.replace(/\/$/, '');

      
      await chrome.storage.local.set({ apiUrl: cleanUrl });

      
      chrome.runtime.sendMessage({ action: 'updateApiUrl', apiUrl: cleanUrl });

      showStatus(
        '✓ Settings saved successfully! The extension will now use: ' +
          cleanUrl,
        'success'
      );

      
      await chrome.storage.local.remove(['userLists', 'listsLastFetched']);
    });

  
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

  
  if (type === 'success') {
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 3000);
  }
}
