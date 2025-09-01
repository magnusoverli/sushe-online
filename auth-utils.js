// auth-utils.js
// Helper to validate OAuth tokens

function isTokenValid(token) {
  if (!token || !token.access_token) return false;
  if (token.expires_at && token.expires_at <= Date.now()) return false;
  return true;
}

// Refresh Spotify access token using refresh token
async function refreshSpotifyToken(refreshToken) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing required parameters for token refresh');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json();

    // Calculate expiration time
    if (data.expires_in) {
      data.expires_at = Date.now() + data.expires_in * 1000;
    }

    // Keep the refresh token if not returned (Spotify sometimes doesn't return it)
    if (!data.refresh_token) {
      data.refresh_token = refreshToken;
    }

    return data;
  } catch (error) {
    console.error('Spotify token refresh error:', error);
    throw error;
  }
}

module.exports = { isTokenValid, refreshSpotifyToken };
