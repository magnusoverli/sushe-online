// Content script that runs on /extension/auth page
// Listens for auth success event and stores token in chrome.storage

console.log('SuShe auth listener loaded');

// Listen for custom event from the page
window.addEventListener('sushe-auth-complete', async (event) => {
  console.log('Auth event received:', event.detail);

  const { token, expiresAt } = event.detail;

  if (token) {
    try {
      // Store token in chrome.storage
      // Note: Token expiry is validated server-side. We store expiresAt for future use,
      // but rely on 401 responses from the API to handle expired tokens.
      await chrome.storage.local.set({
        authToken: token,
        tokenExpiresAt: expiresAt,
      });

      console.log('Token stored successfully');
    } catch (error) {
      console.error('Error storing token:', error);
    }
  }
});
