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
      // Token expiry is checked client-side by auth-state.js before any API operation
      // If expired, auth will be cleared automatically
      await chrome.storage.local.set({
        authToken: token,
        tokenExpiresAt: expiresAt,
      });

      console.log(
        'Token stored successfully, expires at:',
        new Date(expiresAt).toISOString()
      );
    } catch (error) {
      console.error('Error storing token:', error);
    }
  }
});
