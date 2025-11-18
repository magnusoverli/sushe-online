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

  if (message.action === 'showToast') {
    try {
      console.log('Showing toast:', message.title);
      showToast(message.title, message.message, message.type, message.imageUrl);
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error showing toast:', error);
      sendResponse({ error: error.message });
    }
    return true;
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

// ============ TOAST NOTIFICATION SYSTEM ============

// Show toast notification on the page
function showToast(title, message, type = 'success', imageUrl = null) {
  // Create container if doesn't exist
  let container = document.getElementById('sushe-toast-container');
  if (!container) {
    container = createToastContainer();
  }

  // Create toast element
  const toast = createToastElement(title, message, type, imageUrl);
  container.appendChild(toast);

  // Animate in
  setTimeout(() => toast.classList.add('sushe-toast-show'), 10);

  // Auto-dismiss based on type
  const duration = getDurationForType(type);
  setTimeout(() => {
    toast.classList.remove('sushe-toast-show');
    setTimeout(() => toast.remove(), 300); // Wait for fade-out animation
  }, duration);

  // Limit max toasts (keep only 3 newest)
  limitToasts(container, 3);
}

// Create toast container
function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'sushe-toast-container';
  container.setAttribute('data-sushe', 'true');
  container.style.cssText = `
    position: fixed !important;
    top: 20px !important;
    right: 20px !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  `;
  document.body.appendChild(container);
  return container;
}

// Create individual toast element
function createToastElement(title, message, type, imageUrl) {
  const toast = document.createElement('div');
  toast.className = 'sushe-toast';
  toast.setAttribute('data-sushe', 'true');

  // Determine border color based on type
  const borderColors = {
    success: '#059669',
    error: '#dc2626',
    info: '#3b82f6',
    progress: '#f59e0b',
  };
  const borderColor = borderColors[type] || borderColors.info;

  toast.style.cssText = `
    all: initial !important;
    display: flex !important;
    align-items: flex-start !important;
    gap: 12px !important;
    min-width: 320px !important;
    max-width: 420px !important;
    background: #111827 !important;
    color: #e5e7eb !important;
    padding: 16px !important;
    margin-bottom: 12px !important;
    border-radius: 8px !important;
    border-left: 4px solid ${borderColor} !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    font-size: 14px !important;
    line-height: 1.5 !important;
    pointer-events: auto !important;
    cursor: pointer !important;
    opacity: 0 !important;
    transform: translateX(400px) !important;
    transition: all 0.3s ease-out !important;
  `;

  // Add image if provided
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.cssText = `
      all: initial !important;
      width: 64px !important;
      height: 64px !important;
      border-radius: 4px !important;
      object-fit: cover !important;
      flex-shrink: 0 !important;
    `;
    img.onerror = () => {
      // Hide image if it fails to load
      img.style.display = 'none';
    };
    toast.appendChild(img);
  }

  // Add content
  const content = document.createElement('div');
  content.style.cssText = `
    all: initial !important;
    flex: 1 !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 4px !important;
  `;

  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  titleEl.style.cssText = `
    all: initial !important;
    font-weight: 600 !important;
    font-size: 14px !important;
    color: #e5e7eb !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  `;

  const messageEl = document.createElement('div');
  messageEl.textContent = message;
  messageEl.style.cssText = `
    all: initial !important;
    font-size: 13px !important;
    color: #9ca3af !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    line-height: 1.4 !important;
  `;

  content.appendChild(titleEl);
  content.appendChild(messageEl);
  toast.appendChild(content);

  // Click to dismiss
  toast.addEventListener('click', () => {
    toast.classList.remove('sushe-toast-show');
    setTimeout(() => toast.remove(), 300);
  });

  return toast;
}

// Get duration based on toast type
function getDurationForType(type) {
  switch (type) {
    case 'success':
      return 4000; // 4 seconds
    case 'error':
      return 6000; // 6 seconds (longer for errors)
    case 'progress':
      return 3000; // 3 seconds (short for progress updates)
    case 'info':
    default:
      return 4000; // 4 seconds
  }
}

// Limit number of visible toasts
function limitToasts(container, maxToasts) {
  const toasts = container.querySelectorAll('.sushe-toast');
  if (toasts.length > maxToasts) {
    // Remove oldest toasts (first in DOM)
    const toRemove = toasts.length - maxToasts;
    for (let i = 0; i < toRemove; i++) {
      toasts[i].classList.remove('sushe-toast-show');
      setTimeout(() => toasts[i].remove(), 300);
    }
  }
}

// Add CSS for show animation
const style = document.createElement('style');
style.textContent = `
  .sushe-toast-show {
    opacity: 1 !important;
    transform: translateX(0) !important;
  }
`;
document.head.appendChild(style);
