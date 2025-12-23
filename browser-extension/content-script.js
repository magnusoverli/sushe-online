// Content script for RateYourMusic pages
// Extracts album data from the page when requested

console.log('SuShe Online content script loaded on RateYourMusic');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.action);

  if (message.action === 'extractAlbumData') {
    try {
      console.log('Extracting album data from page...');

      const albumData = extractAlbumDataFromPage(message);
      console.log('Extracted album data:', albumData);

      // Always send response, even if extraction failed
      sendResponse(albumData);
    } catch (error) {
      console.error('Error in content script:', error);
      sendResponse({ error: error.message });
    }
    return true; // Keep channel open for async response
  }

  // Unknown action
  return false;
});

// Extract album information from RateYourMusic page
function extractAlbumDataFromPage(context) {
  const data = {
    artist: '',
    album: '',
    genre_1: '',
    genre_2: '',
  };

  // Parse from URL - RYM URLs are typically: /release/album/artist_name/album_name/
  if (context.linkUrl || context.pageUrl) {
    const url = context.linkUrl || context.pageUrl;
    const match = url.match(/\/release\/[^/]+\/([^/]+)\/([^/]+)/);

    if (match) {
      // Replace both underscores and hyphens with spaces
      // RYM uses both in URLs: some_artist and some-album
      data.artist = decodeURIComponent(match[1].replace(/[-_]/g, ' '));
      data.album = decodeURIComponent(match[2].replace(/[-_]/g, ' '));

      // Clean up artist and album names
      data.artist = cleanName(data.artist);
      data.album = cleanName(data.album);
    }
  }

  // Fallback: Get from page title if URL parsing fails
  if (!data.artist || !data.album) {
    // RYM page titles are typically: "Album Name by Artist Name"
    const pageTitle = document.title;
    const match = pageTitle.match(/^(.+?)\s+by\s+(.+?)(?:\s+\||$)/i);

    if (match) {
      data.album = match[1].trim();
      data.artist = match[2].trim();
    }
  }

  // Extract genres from RYM page (only available on album detail pages)
  const genres = extractGenresFromPage();
  data.genre_1 = genres.genre_1;
  data.genre_2 = genres.genre_2;

  return data;
}

// Extract genres from RateYourMusic album page
// RYM has primary genres (main classification) and secondary genres (influences/descriptors)
// Logic: Use first 2 primary, or 1 primary + 1 secondary, or first 2 secondary
function extractGenresFromPage() {
  // Extract primary genres from .release_pri_genres .genre elements
  const primaryGenres = Array.from(
    document.querySelectorAll('.release_pri_genres .genre')
  ).map((el) => el.textContent.trim());

  // Extract secondary genres from .release_sec_genres .genre elements
  const secondaryGenres = Array.from(
    document.querySelectorAll('.release_sec_genres .genre')
  ).map((el) => el.textContent.trim());

  let genre_1 = '';
  let genre_2 = '';

  if (primaryGenres.length >= 2) {
    // 2+ primary genres: use first two primary
    genre_1 = primaryGenres[0];
    genre_2 = primaryGenres[1];
  } else if (primaryGenres.length === 1) {
    // 1 primary genre: use it + first secondary (if available)
    genre_1 = primaryGenres[0];
    genre_2 = secondaryGenres[0] || '';
  } else if (secondaryGenres.length > 0) {
    // 0 primary genres: use first two secondary
    genre_1 = secondaryGenres[0];
    genre_2 = secondaryGenres[1] || '';
  }
  // else: no genres found, both stay empty

  console.log('Extracted genres:', {
    genre_1,
    genre_2,
    primaryGenres,
    secondaryGenres,
  });

  return { genre_1, genre_2 };
}

// Clean up name formatting
function cleanName(name) {
  // Decode any URL-encoded characters
  try {
    name = decodeURIComponent(name);
  } catch (_e) {
    // If decode fails, use as-is
    console.warn('Could not decode name:', name);
  }

  // Remove trailing numbers (RYM sometimes adds these)
  name = name.replace(/\s+\d+$/, '');

  // Normalize unicode characters (e.g., combining diacritics)
  if (typeof name.normalize === 'function') {
    name = name.normalize('NFC');
  }

  // Capitalize only if the entire name is lowercase or all uppercase
  // Otherwise preserve the original casing
  const isAllLowercase = name === name.toLowerCase();
  const isAllUppercase = name === name.toUpperCase();

  if (isAllLowercase || isAllUppercase) {
    // Only apply capitalization if name is entirely lowercase or uppercase
    name = name
      .split(' ')
      .map((word) => {
        if (!word) return word;
        // Capitalize first letter, lowercase the rest
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }
  // Otherwise preserve original casing (e.g., "McCartney", "AC/DC")

  return name;
}

// Notify background when RYM page loads to trigger list refresh
// This ensures context menu is always fresh when browsing RateYourMusic
// Small delay to batch rapid navigation and avoid hammering on quick page loads
setTimeout(() => {
  chrome.runtime
    .sendMessage({ action: 'rymPageLoaded' })
    .then(() => {
      console.log('[Content Script] Notified background of RYM page load');
    })
    .catch(() => {
      // Ignore errors - background might not be ready yet
      // This is normal during extension startup
    });
}, 500); // 500ms delay to batch rapid page loads
