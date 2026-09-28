const { escapeHtml } = require('../utils/escape-html');
const extensionAuthTemplate = (csrfToken = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize SuShe Extension</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      max-width: 500px;
      padding: 40px;
      text-align: center;
    }
    h1 {
      font-size: 32px;
      margin: 0 0 16px 0;
      color: #dc2626;
    }
    p {
      font-size: 16px;
      line-height: 1.6;
      color: #9ca3af;
      margin: 0 0 24px 0;
    }
    .success {
      padding: 16px;
      background: #065f46;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 14px;
      color: #d1fae5;
    }
    .token-box {
      padding: 16px;
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      margin-bottom: 24px;
      word-break: break-all;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #60a5fa;
    }
    button {
      padding: 12px 24px;
      background: #dc2626;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      width: 100%;
      margin-bottom: 12px;
    }
    button:hover {
      background: #b91c1c;
    }
    button:disabled {
      background: #374151;
      cursor: not-allowed;
    }
    .info {
      font-size: 14px;
      color: #6b7280;
      margin-top: 24px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #fff;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 0.6s linear infinite;
      margin-right: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>&#129320; Authorize Browser Extension</h1>
    <p>Click the button below to authorize the SuShe Online browser extension.</p>

    <div id="status"></div>

    <button id="authorizeBtn" onclick="generateToken()">
      Authorize Extension
    </button>

    <div class="info">
      This will generate a secure token that allows your browser extension to access your SuShe lists.
      You can revoke this access anytime from your settings page.
    </div>
  </div>

  <script>
    function connectExtension(data) {
      return new Promise(function(resolve, reject) {
        var timeout;
        function complete(event) {
          clearTimeout(timeout);
          window.removeEventListener('sushe-auth-result', complete);
          if (event.detail && event.detail.success) resolve();
          else reject(new Error(event.detail && event.detail.error || 'Extension authorization failed'));
        }
        window.addEventListener('sushe-auth-result', complete);
        timeout = setTimeout(function() {
          window.removeEventListener('sushe-auth-result', complete);
          reject(new Error('No response from the extension. Open its Settings, start login again, and check that it has access to this site.'));
        }, 15000);
        window.dispatchEvent(new CustomEvent('sushe-auth-complete', {
          detail: { token: data.token, expiresAt: data.expiresAt }
        }));
      });
    }

    async function generateToken() {
      var btn = document.getElementById('authorizeBtn');
      var status = document.getElementById('status');

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Generating token...';
      status.innerHTML = '';

      try {
        var response = await fetch('/api/auth/extension-token', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': '${escapeHtml(csrfToken)}',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to generate token');
        }

        var data = await response.json();

        btn.textContent = 'Connecting to extension...';
        await connectExtension(data);
        btn.textContent = 'Authorization Complete';
        status.innerHTML = '<div class="success">\\u2713 Extension authorized! You can close this window.</div>';
        setTimeout(function() { window.close(); }, 2000);

      } catch (error) {
        console.error('Error generating token:', error);
        status.textContent = error.message || 'Authorization failed. Please try again.';
        btn.disabled = false;
        btn.innerHTML = 'Retry';
      }
    }
  </script>
</body>
</html>
`;

module.exports = {
  extensionAuthTemplate,
};
