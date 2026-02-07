/**
 * Link Preview Module
 *
 * Self-contained subsystem for fetching, caching, and rendering
 * URL link previews (unfurl). Uses IntersectionObserver for lazy loading.
 *
 * State (cache, pending requests, observer) is private to the factory closure.
 *
 * @param {Object} deps
 * @param {Function} deps.apiCall - API call function for /api/unfurl endpoint
 * @returns {Object} { attachLinkPreview }
 */
export function createLinkPreview(deps = {}) {
  const { apiCall } = deps;

  // ============ PRIVATE STATE ============

  /** URL → preview data cache (includes null for failed URLs) */
  const linkPreviewCache = new Map();

  /** URL → in-flight Promise for request deduplication */
  const pendingLinkPreviews = new Map();

  /** Shared IntersectionObserver instance (lazy initialized) */
  let linkPreviewObserver = null;

  // ============ INTERNAL FUNCTIONS ============

  /**
   * Initialize the IntersectionObserver for lazy loading link previews.
   * Creates a single shared observer instance.
   * @returns {IntersectionObserver}
   */
  function initLinkPreviewObserver() {
    if (linkPreviewObserver) return linkPreviewObserver;

    linkPreviewObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const url = el.dataset.previewUrl;
            if (url) {
              fetchAndRenderLinkPreview(el, url);
            }
            linkPreviewObserver.unobserve(el);
          }
        });
      },
      {
        rootMargin: '100px', // Pre-load previews 100px before they enter viewport
        threshold: 0,
      }
    );

    return linkPreviewObserver;
  }

  /**
   * Fetch link preview with caching and request deduplication.
   * @param {string} url - URL to unfurl
   * @returns {Promise<Object|null>} Preview data or null
   */
  async function fetchLinkPreviewCached(url) {
    // Check cache first
    if (linkPreviewCache.has(url)) {
      return linkPreviewCache.get(url);
    }

    // Check if there's already a pending request for this URL
    if (pendingLinkPreviews.has(url)) {
      return pendingLinkPreviews.get(url);
    }

    // Create new request and store promise for deduplication
    const promise = apiCall(`/api/unfurl?url=${encodeURIComponent(url)}`)
      .then((data) => {
        linkPreviewCache.set(url, data);
        pendingLinkPreviews.delete(url);
        return data;
      })
      .catch((err) => {
        console.error('Link preview error:', err);
        pendingLinkPreviews.delete(url);
        // Cache null to prevent retrying failed URLs
        linkPreviewCache.set(url, null);
        return null;
      });

    pendingLinkPreviews.set(url, promise);
    return promise;
  }

  /**
   * Render preview HTML into an element.
   * @param {HTMLElement} previewEl - Container element
   * @param {Object} data - Preview data { title, description, image }
   * @param {string} url - Original URL
   */
  function renderPreviewHtml(previewEl, data, url) {
    const img = data.image
      ? `<img src="${data.image}" class="w-12 h-12 object-cover rounded-sm shrink-0" alt="">`
      : '';
    const desc = data.description
      ? `<div class="text-gray-400 truncate">${data.description}</div>`
      : '';
    previewEl.innerHTML = `<a href="${url}" target="_blank" class="flex gap-2 p-2 items-center">${img}<div class="min-w-0"><div class="font-semibold text-gray-100 truncate">${data.title || url}</div>${desc}</div></a>`;
  }

  /**
   * Fetch and render a link preview into an element.
   * Called by IntersectionObserver when element becomes visible.
   * @param {HTMLElement} previewEl - Container element for the preview
   * @param {string} url - URL to unfurl
   */
  async function fetchAndRenderLinkPreview(previewEl, url) {
    const data = await fetchLinkPreviewCached(url);

    if (!data) {
      previewEl.remove();
      return;
    }

    renderPreviewHtml(previewEl, data, url);
  }

  // ============ PUBLIC API ============

  /**
   * Attach a link preview to a container if the comment contains a URL.
   * Uses cached data for instant render, or defers to IntersectionObserver.
   * @param {HTMLElement} container - DOM element to append preview to
   * @param {string} comment - Comment text that may contain URLs
   */
  function attachLinkPreview(container, comment) {
    const urlMatch = comment && comment.match(/https?:\/\/\S+/);
    if (!urlMatch) return;

    const url = urlMatch[0];

    // Check if we already have cached data - render immediately if so
    if (linkPreviewCache.has(url)) {
      const data = linkPreviewCache.get(url);
      if (!data) return; // Previously failed URL

      const previewEl = document.createElement('div');
      previewEl.className = 'mt-2 text-xs bg-gray-800 rounded-sm';
      container.appendChild(previewEl);
      renderPreviewHtml(previewEl, data, url);
      return;
    }

    // Create placeholder element and defer loading via IntersectionObserver
    const previewEl = document.createElement('div');
    previewEl.className = 'mt-2 text-xs bg-gray-800 rounded-sm';
    previewEl.dataset.previewUrl = url;
    previewEl.textContent = 'Loading preview...';
    container.appendChild(previewEl);

    // Initialize and observe with IntersectionObserver
    const observer = initLinkPreviewObserver();
    observer.observe(previewEl);
  }

  return {
    attachLinkPreview,
    // Expose internals for testing
    _cache: linkPreviewCache,
    _pending: pendingLinkPreviews,
    _fetchCached: fetchLinkPreviewCached,
  };
}
