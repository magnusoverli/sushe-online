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

  return data;
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
