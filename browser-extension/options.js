// Options page script for SuShe Online extension

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings on page load
  const settings = await chrome.storage.local.get(['apiUrl']);
  
  if (settings.apiUrl) {
    document.getElementById('apiUrl').value = settings.apiUrl;
  } else {
    // Default to localhost for development
    document.getElementById('apiUrl').value = 'http://localhost:3000';
  }

  // Handle form submission
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const statusEl = document.getElementById('status');
    
    // Validate URL
    try {
      new URL(apiUrl);
    } catch (err) {
      showStatus('Invalid URL format. Please enter a valid URL.', 'error');
      return;
    }
    
    // Remove trailing slash if present
    const cleanUrl = apiUrl.replace(/\/$/, '');
    
    // Save to storage
    await chrome.storage.local.set({ apiUrl: cleanUrl });
    
    // Notify background script to update
    chrome.runtime.sendMessage({ action: 'updateApiUrl', apiUrl: cleanUrl });
    
    showStatus('✓ Settings saved successfully! The extension will now use: ' + cleanUrl, 'success');
    
    // Clear lists cache to force refresh with new URL
    await chrome.storage.local.remove(['userLists', 'listsLastFetched']);
  });

  // Test connection button
  document.getElementById('testBtn').addEventListener('click', async () => {
    const apiUrl = document.getElementById('apiUrl').value.trim().replace(/\/$/, '');
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
          'Accept': 'application/json'
        }
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
