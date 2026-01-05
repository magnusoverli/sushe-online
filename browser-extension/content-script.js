// Content script for RateYourMusic pages
// Extracts album data from the page when requested
/* global DOMParser */

console.log('SuShe Online content script loaded on RateYourMusic');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.action);

  if (message.action === 'extractAlbumData') {
    // Handle async extraction
    (async () => {
      try {
        console.log('Extracting album data from page...');

        const albumData = await extractAlbumDataFromPage(message);
        console.log('Extracted album data:', albumData);

        // Always send response, even if extraction failed
        sendResponse(albumData);
      } catch (error) {
        console.error('Error in content script:', error);
        sendResponse({ error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Unknown action
  return false;
});

// Extract album information from RateYourMusic page
async function extractAlbumDataFromPage(context) {
  const data = {
    artist: '',
    album: '',
    genre_1: '',
    genre_2: '',
  };

  // Parse from URL - RYM URLs are typically: /release/album/artist_name/album_name/
  let albumUrl = null;
  if (context.linkUrl || context.pageUrl) {
    const url = context.linkUrl || context.pageUrl;
    const match = url.match(/\/release\/[^/]+\/([^/]+)\/([^/]+)/);

    if (match) {
      // Handle RYM URL encoding: leading underscore represents ellipsis
      // e.g., "_and-oceans" -> "...and oceans"
      let artistSlug = match[1];
      let albumSlug = match[2];

      // Convert leading underscore to ellipsis before replacing other underscores
      if (artistSlug.startsWith('_')) {
        artistSlug = '...' + artistSlug.slice(1);
      }
      if (albumSlug.startsWith('_')) {
        albumSlug = '...' + albumSlug.slice(1);
      }

      // Replace remaining underscores and hyphens with spaces
      // RYM uses both in URLs: some_artist and some-album
      data.artist = decodeURIComponent(artistSlug.replace(/[-_]/g, ' '));
      data.album = decodeURIComponent(albumSlug.replace(/[-_]/g, ' '));

      // Clean up artist and album names
      data.artist = cleanName(data.artist);
      data.album = cleanName(data.album);

      // Store the album URL for potential genre fetching
      albumUrl = url;
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

  // Extract genres - try context-aware extraction first (for chart/list pages),
  // then fall back to page-level extraction (for album detail pages)
  const contextGenres = extractGenresFromContext(context);
  let genres = contextGenres || extractGenresFromPage();

  // If no genres found locally, fetch the album detail page to get accurate genres
  if (!genres.genre_1 && albumUrl) {
    console.log('No genres found locally, fetching album page:', albumUrl);
    genres = await fetchGenresFromAlbumPage(albumUrl);
  }

  data.genre_1 = genres.genre_1;
  data.genre_2 = genres.genre_2;

  return data;
}

// Fetch the album detail page and extract genres from it
async function fetchGenresFromAlbumPage(albumUrl) {
  try {
    const response = await fetch(albumUrl, {
      credentials: 'same-origin',
      headers: {
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      console.warn('Failed to fetch album page:', response.status);
      return { genre_1: '', genre_2: '' };
    }

    const html = await response.text();

    // Parse the HTML to extract genres
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract primary genres
    const primaryGenres = Array.from(
      doc.querySelectorAll('.release_pri_genres .genre')
    ).map((el) => el.textContent.trim());

    // Extract secondary genres
    const secondaryGenres = Array.from(
      doc.querySelectorAll('.release_sec_genres .genre')
    ).map((el) => el.textContent.trim());

    let genre_1 = '';
    let genre_2 = '';

    if (primaryGenres.length >= 2) {
      genre_1 = primaryGenres[0];
      genre_2 = primaryGenres[1];
    } else if (primaryGenres.length === 1) {
      genre_1 = primaryGenres[0];
      genre_2 = secondaryGenres[0] || '';
    } else if (secondaryGenres.length > 0) {
      genre_1 = secondaryGenres[0];
      genre_2 = secondaryGenres[1] || '';
    }

    console.log('Fetched genres from album page:', { genre_1, genre_2 });
    return { genre_1, genre_2 };
  } catch (error) {
    console.error('Error fetching album page for genres:', error);
    return { genre_1: '', genre_2: '' };
  }
}

// Extract genres from the specific album context (for chart pages, list pages, etc.)
// This finds the clicked element and extracts genres from its container
function extractGenresFromContext(context) {
  const linkUrl = context.linkUrl;
  if (!linkUrl) return null;

  // Extract the album path from the URL to find the matching link on the page
  // URL format: https://rateyourmusic.com/release/album/artist/album-name/
  const urlMatch = linkUrl.match(/\/release\/[^/]+\/[^/]+\/[^/]+/);
  if (!urlMatch) return null;

  const albumPath = urlMatch[0];
  console.log('Looking for album link with path:', albumPath);

  // Find the link element that was clicked (or near where user clicked)
  try {
    const albumLink = document.querySelector(`a[href*="${albumPath}"]`);
    if (!albumLink) {
      console.log('Album link not found on page');
      return null;
    }

    // Find the container that holds this album entry
    // Try various container selectors used by RYM on different page types
    const container =
      albumLink.closest('.page_section_charts_item_wrapper') || // Chart pages
      albumLink.closest('.page_charts_section_charts_item_wrapper') || // Alternative chart structure
      albumLink.closest('[class*="chart_item"]') || // Generic chart items
      albumLink.closest('tr') || // Table-based layouts
      albumLink.closest('[class*="release_row"]'); // Release list pages

    if (!container) {
      console.log(
        'No container found for album, falling back to page extraction'
      );
      return null;
    }

    console.log('Found album container:', container.className);

    // Extract genres from this container
    const genreElements = container.querySelectorAll('.genre');
    if (genreElements.length === 0) {
      console.log('No genres found in container');
      return null;
    }

    const allGenres = Array.from(genreElements).map((el) =>
      el.textContent.trim()
    );
    console.log('Genres found in container:', allGenres);

    // Apply the same logic as page extraction:
    // RYM shows primary genres first, then secondary
    // We take the first two genres
    return {
      genre_1: allGenres[0] || '',
      genre_2: allGenres[1] || '',
    };
  } catch (error) {
    console.error('Error finding album link:', error);
    return null;
  }
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

  // Preserve leading punctuation (e.g., ellipsis "...and Oceans")
  const leadingPunctMatch = name.match(/^([^\w\s]+)/);
  const leadingPunct = leadingPunctMatch ? leadingPunctMatch[1] : '';
  const nameWithoutLeadingPunct = leadingPunct
    ? name.slice(leadingPunct.length)
    : name;

  // Capitalize only if the entire name (without leading punct) is lowercase or all uppercase
  // Otherwise preserve the original casing
  const isAllLowercase =
    nameWithoutLeadingPunct === nameWithoutLeadingPunct.toLowerCase();
  const isAllUppercase =
    nameWithoutLeadingPunct === nameWithoutLeadingPunct.toUpperCase();

  if (isAllLowercase || isAllUppercase) {
    // Only apply capitalization if name is entirely lowercase or uppercase
    const capitalized = nameWithoutLeadingPunct
      .split(' ')
      .map((word) => {
        if (!word) return word;
        // Find first letter (skip leading punctuation)
        const firstLetterMatch = word.match(/[a-zA-Z]/);
        if (!firstLetterMatch) {
          // No letters, return as-is (e.g., "...")
          return word;
        }
        const firstLetterIndex = firstLetterMatch.index;
        const beforeLetter = word.slice(0, firstLetterIndex);
        const letter = word[firstLetterIndex];
        const afterLetter = word.slice(firstLetterIndex + 1);
        // Capitalize first letter, lowercase the rest
        return (
          beforeLetter +
          letter.toUpperCase() +
          afterLetter.toLowerCase()
        );
      })
      .join(' ');
    name = leadingPunct + capitalized;
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
