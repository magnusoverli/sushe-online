/**
 * Shared Read-Only Album List Renderer
 *
 * Extracts the visual rendering patterns from album-display.js into a clean,
 * configurable, read-only renderer for recommendation-style views.
 *
 * Desktop: CSS Grid rows matching album-display.js visual style (album-grid class).
 * Mobile: Flexbox cards matching album-display.js card structure.
 *
 * Consumers configure which columns to show via a column ID array.
 * All interaction (context menus, action sheets, etc.) stays in the consumer module.
 *
 * @module album-list-renderer
 */

// 1x1 transparent GIF placeholder for lazy loading (same as album-display.js)
const PLACEHOLDER_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Lazy loading observer (module-level singleton)
let coverImageObserver = null;

/**
 * Initialize the IntersectionObserver for lazy loading cover images.
 * Images with data-lazy-src will have their src swapped when visible.
 */
function initCoverImageObserver() {
  if (coverImageObserver) return;

  coverImageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const lazySrc = img.dataset.lazySrc;
          if (lazySrc) {
            img.src = lazySrc;
            delete img.dataset.lazySrc;
          }
          coverImageObserver.unobserve(img);
        }
      });
    },
    {
      rootMargin: '200px',
      threshold: 0,
    }
  );
}

/**
 * Observe all lazy-load images in the container.
 * @param {HTMLElement} container - Container with album items
 */
function observeLazyImages(container) {
  if (!coverImageObserver) {
    initCoverImageObserver();
  }
  const lazyImages = container.querySelectorAll('img[data-lazy-src]');
  lazyImages.forEach((img) => {
    coverImageObserver.observe(img);
  });
}

// ============ COLUMN DEFINITIONS ============

/**
 * Column registry. Each column defines how to render in desktop grid cells
 * and mobile card rows.
 *
 * renderDesktop(data, escapeHtml) => HTML string for a grid cell's innerHTML
 * renderMobile(data, escapeHtml) => HTML string for a mobile info row, or null to skip
 */
const COLUMN_DEFS = {
  cover: {
    header: '',
    gridSize: '80px',
    renderDesktop(data, escapeHtml) {
      const coverSrc = data.coverUrl;
      if (coverSrc) {
        return `<div class="w-10 h-10 bg-gray-700 rounded overflow-hidden relative">
          <img src="${PLACEHOLDER_GIF}" data-lazy-src="${coverSrc}"
               alt="${escapeHtml(data.album)}"
               class="w-full h-full object-cover"
               onerror="this.parentElement.innerHTML='<div class=\\'flex items-center justify-center w-full h-full text-gray-500\\'><i class=\\'fas fa-compact-disc\\'></i></div>'">
        </div>`;
      }
      return `<div class="w-10 h-10 bg-gray-700 rounded overflow-hidden flex items-center justify-center text-gray-500">
        <i class="fas fa-compact-disc"></i>
      </div>`;
    },
    // Mobile cover is handled separately in the card layout, not as an info row
    renderMobile() {
      return null;
    },
  },

  albumName: {
    header: 'Album',
    gridSize: '0.75fr',
    renderDesktop(data, escapeHtml) {
      const releaseDate = data.releaseDate
        ? `<span class="text-xs text-gray-500">${escapeHtml(data.releaseDate)}</span>`
        : '';
      return `<div class="flex flex-col min-w-0">
        <span class="text-gray-300 truncate">${escapeHtml(data.album)}</span>
        ${releaseDate}
      </div>`;
    },
    renderMobile(data, escapeHtml) {
      return `<h3 class="font-semibold text-gray-200 text-sm leading-tight truncate">
        <i class="fas fa-compact-disc fa-xs mr-2"></i>${escapeHtml(data.album)}
      </h3>`;
    },
  },

  releaseDate: {
    header: 'Released',
    gridSize: '0.4fr',
    renderDesktop(data, escapeHtml) {
      return `<span class="text-gray-400 text-sm truncate">${escapeHtml(data.releaseDate)}</span>`;
    },
    renderMobile(data, escapeHtml) {
      if (!data.releaseDate) return null;
      return `<p class="text-[13px] text-gray-500 truncate">
        <i class="fas fa-calendar fa-xs mr-2"></i>${escapeHtml(data.releaseDate)}
      </p>`;
    },
  },

  artist: {
    header: 'Artist',
    gridSize: '0.65fr',
    renderDesktop(data, escapeHtml) {
      return `<span class="text-white truncate">${escapeHtml(data.artist)}</span>`;
    },
    renderMobile(data, escapeHtml) {
      return `<p class="text-[13px] text-gray-500 truncate">
        <i class="fas fa-user fa-xs mr-2"></i>
        <span>${escapeHtml(data.artist)}</span>
      </p>`;
    },
  },

  country: {
    header: 'Country',
    gridSize: '0.55fr',
    renderDesktop(data, escapeHtml) {
      return `<span class="text-gray-400 text-sm truncate">${escapeHtml(data.country)}</span>`;
    },
    renderMobile(data, escapeHtml) {
      if (!data.country) return null;
      return `<p class="text-[13px] text-gray-500 truncate">
        <i class="fas fa-globe fa-xs mr-2"></i>${escapeHtml(data.country)}
      </p>`;
    },
  },

  genre: {
    header: 'Genre',
    gridSize: '0.6fr',
    renderDesktop(data, escapeHtml) {
      return `<span class="text-gray-400 text-sm truncate">${escapeHtml(data.genreDisplay)}</span>`;
    },
    renderMobile(data, escapeHtml) {
      if (!data.genreDisplay) return null;
      return `<p class="text-[13px] text-gray-400 truncate">
        <i class="fas fa-tag fa-xs mr-2"></i>${escapeHtml(data.genreDisplay)}
      </p>`;
    },
  },

  reasoning: {
    header: 'AI Reasoning',
    gridSize: '1fr',
    renderDesktop(data, escapeHtml) {
      if (!data.reasoning) {
        return '<span class="text-gray-600 text-sm italic">No reasoning</span>';
      }
      return `<span class="flex items-center gap-1 min-w-0">
        <i class="fas fa-robot text-purple-400 text-xs shrink-0"></i>
        <span class="truncate text-gray-500 text-sm">${escapeHtml(data.reasoning)}</span>
        <button class="view-reasoning-btn text-gray-500 hover:text-purple-400 p-1 transition-colors shrink-0" title="View full reasoning">
          <i class="fas fa-expand-alt text-xs"></i>
        </button>
      </span>`;
    },
    renderMobile(data, escapeHtml) {
      if (!data.reasoning) return null;
      return `<p class="text-gray-500 text-xs mt-0.5 line-clamp-2">
        <i class="fas fa-robot text-purple-400 mr-1"></i>${escapeHtml(data.reasoning)}
      </p>`;
    },
  },

  recommendedBy: {
    header: 'Recommended By',
    gridSize: '0.6fr',
    renderDesktop(data, escapeHtml) {
      const hasReasoning = data.reasoning && data.reasoning.trim().length > 0;
      return `<span class="flex items-center gap-1 text-blue-400 truncate">
        ${escapeHtml(data.recommendedBy)}
        ${hasReasoning ? '<button class="view-reasoning-btn text-gray-500 hover:text-blue-400 p-1 transition-colors" title="View reasoning"><i class="fas fa-comment-alt text-xs"></i></button>' : ''}
      </span>`;
    },
    renderMobile(data, escapeHtml) {
      return `<p class="text-[13px] text-blue-400 truncate">
        <i class="fas fa-thumbs-up fa-xs mr-2"></i>${escapeHtml(data.recommendedBy)}
      </p>`;
    },
  },

  dateAdded: {
    header: 'Date Added',
    gridSize: '0.5fr',
    renderDesktop(data) {
      return `<span class="text-gray-500 text-sm">${data.formattedDate}</span>`;
    },
    // Mobile: date is shown below the cover image, not as an info row
    renderMobile() {
      return null;
    },
  },
};

// ============ DATA NORMALIZATION ============

/**
 * Normalize an item's fields into a consistent display-ready object.
 * Handles field name variations across different data sources.
 *
 * @param {Object} item - Raw item from API
 * @returns {Object} Normalized display data
 */
function normalizeItemData(item) {
  const albumId = item.album_id || '';
  const artist = item.artist || 'Unknown Artist';
  const album = item.album || 'Unknown Album';
  const country = item.country || '';
  const reasoning = item.reasoning || '';
  const recommendedBy = item.recommended_by || '';

  // Genre display: combine genre_1 and genre_2
  const g1 = item.genre_1 || '';
  const g2 = item.genre_2 || '';
  const genreDisplay = g1 && g2 ? `${g1}, ${g2}` : g1 || g2;

  // Cover URL
  const coverUrl = albumId
    ? `/api/albums/${encodeURIComponent(albumId)}/cover`
    : '';

  // Release date
  const releaseDate = item.release_date
    ? new Date(item.release_date).getFullYear().toString()
    : '';

  // Formatted date (for dateAdded column)
  let formattedDate = '';
  if (item.created_at) {
    const date = new Date(item.created_at);
    formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return {
    albumId,
    artist,
    album,
    country,
    reasoning,
    recommendedBy,
    genreDisplay,
    coverUrl,
    releaseDate,
    formattedDate,
    _raw: item,
  };
}

// ============ DESKTOP RENDERING ============

/**
 * Build the grid-template-columns string from selected column definitions.
 * @param {Array<string>} columns - Column IDs
 * @returns {string} CSS grid-template-columns value
 */
function buildGridTemplate(columns) {
  return columns.map((colId) => COLUMN_DEFS[colId].gridSize).join(' ');
}

/**
 * Create a desktop header row.
 * @param {Array<string>} columns - Column IDs
 * @param {string} gridTemplate - CSS grid-template-columns value
 * @returns {HTMLElement}
 */
function createDesktopHeader(columns, gridTemplate) {
  const header = document.createElement('div');
  header.className =
    'readonly-album-grid gap-4 py-3 text-gray-400 text-xs uppercase tracking-wider border-b border-gray-700';
  header.style.gridTemplateColumns = gridTemplate;

  columns.forEach((colId) => {
    const cell = document.createElement('div');
    cell.textContent = COLUMN_DEFS[colId].header;
    header.appendChild(cell);
  });

  return header;
}

/**
 * Create a desktop grid row for an item.
 * @param {Object} data - Normalized item data
 * @param {number} index - Row index
 * @param {Array<string>} columns - Column IDs
 * @param {string} gridTemplate - CSS grid-template-columns value
 * @param {Function} escapeHtml - HTML escape function
 * @param {Object} callbacks - Event callbacks
 * @returns {HTMLElement}
 */
function createDesktopRow(
  data,
  index,
  columns,
  gridTemplate,
  escapeHtml,
  callbacks
) {
  const row = document.createElement('div');
  row.className =
    'readonly-album-grid gap-4 py-2 hover:bg-gray-800/50 border-b border-gray-800 cursor-pointer';
  row.style.gridTemplateColumns = gridTemplate;
  row.dataset.albumId = data.albumId;
  row.dataset.index = index;

  columns.forEach((colId) => {
    const cell = document.createElement('div');
    cell.className = 'min-w-0';
    cell.innerHTML = COLUMN_DEFS[colId].renderDesktop(data, escapeHtml);
    row.appendChild(cell);
  });

  // Context menu handler
  if (callbacks.onContextMenu) {
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      callbacks.onContextMenu(e, data._raw, index);
    });
  }

  // Reasoning button handler
  if (callbacks.onReasoningClick) {
    const reasoningBtn = row.querySelector('.view-reasoning-btn');
    if (reasoningBtn) {
      reasoningBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onReasoningClick(data._raw, index);
      });
    }
  }

  return row;
}

/**
 * Render the desktop view (header + grid rows).
 * @param {HTMLElement} container - Target container
 * @param {Array<Object>} items - Raw items
 * @param {Array<string>} columns - Column IDs
 * @param {Function} escapeHtml - HTML escape function
 * @param {Object} callbacks - Event callbacks
 */
function renderDesktop(container, items, columns, escapeHtml, callbacks) {
  const gridTemplate = buildGridTemplate(columns);

  // Header
  const header = createDesktopHeader(columns, gridTemplate);
  container.appendChild(header);

  // Rows
  items.forEach((item, index) => {
    const data = normalizeItemData(item);
    const row = createDesktopRow(
      data,
      index,
      columns,
      gridTemplate,
      escapeHtml,
      callbacks
    );
    container.appendChild(row);
  });

  // Activate lazy loading
  observeLazyImages(container);
}

// ============ MOBILE RENDERING ============

/**
 * Create a mobile card for an item.
 * Layout: [cover section 88px] [info section flex-1] [menu section 25px]
 *
 * @param {Object} data - Normalized item data
 * @param {number} index - Card index
 * @param {Array<string>} columns - Column IDs (cover handled separately)
 * @param {Function} escapeHtml - HTML escape function
 * @param {Object} callbacks - Event callbacks
 * @param {Object} options - Rendering options
 * @returns {HTMLElement}
 */
function createMobileCard(
  data,
  index,
  columns,
  escapeHtml,
  callbacks,
  options
) {
  const cardHeight = options.mobileCardHeight || 150;
  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'album-card-wrapper';
  cardWrapper.style.height = `${cardHeight}px`;

  const card = document.createElement('div');
  card.className = 'album-card relative bg-gray-900';
  card.style.height = `${cardHeight}px`;
  card.dataset.albumId = data.albumId;
  card.dataset.rendererIndex = index;

  // Build cover section
  const coverHtml = data.coverUrl
    ? `<img src="${PLACEHOLDER_GIF}" data-lazy-src="${data.coverUrl}"
           alt="${escapeHtml(data.album)}"
           class="album-cover-blur w-[75px] h-[75px] rounded-lg object-cover"
           onerror="this.parentElement.innerHTML='<div class=\\'w-[75px] h-[75px] rounded-lg bg-gray-800 flex items-center justify-center\\'><i class=\\'fas fa-compact-disc text-xl text-gray-600\\'></i></div>'">`
    : `<div class="w-[75px] h-[75px] rounded-lg bg-gray-800 flex items-center justify-center">
        <i class="fas fa-compact-disc text-xl text-gray-600"></i>
      </div>`;

  // Date below cover (for dateAdded column or release date)
  const hasDateAdded = columns.includes('dateAdded');
  const dateText = hasDateAdded ? data.formattedDate : data.releaseDate;
  const dateLine = dateText
    ? `<span class="text-xs whitespace-nowrap text-gray-500">${escapeHtml(dateText)}</span>`
    : '';

  // Build info rows from non-cover columns
  const infoColumns = columns.filter((c) => c !== 'cover' && c !== 'dateAdded');
  const infoRows = infoColumns
    .map((colId) => COLUMN_DEFS[colId].renderMobile(data, escapeHtml))
    .filter(Boolean);

  const infoHeight = cardHeight - 8; // account for py-1 padding

  card.innerHTML = `
    <div class="flex items-stretch h-full">
      <div class="shrink-0 w-[88px] flex flex-col items-center pt-2 pl-1">
        <div class="mobile-album-cover relative w-20 h-20 flex items-center justify-center bg-gray-800 rounded-lg">
          ${coverHtml}
        </div>
        <div class="flex-1 flex items-center mt-1">
          ${dateLine}
        </div>
      </div>
      <div class="flex-1 min-w-0 py-1 pl-2 pr-1 flex flex-col justify-center gap-0.5" style="max-height: ${infoHeight}px;">
        ${infoRows.join('\n')}
      </div>
      <div class="shrink-0 w-[25px] border-l border-gray-800/50" style="display: flex; align-items: center; justify-content: center;">
        <button data-renderer-menu-btn class="no-drag text-gray-400 active:text-gray-200" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; transform: translateX(7px);">
          <i class="fas fa-ellipsis-v fa-fw"></i>
        </button>
      </div>
    </div>
  `;

  // Position badge
  if (options.showPosition) {
    const colors =
      index < 3
        ? ['bg-yellow-500', 'bg-gray-300', 'bg-amber-600'][index]
        : 'bg-gray-600';
    const badge = document.createElement('div');
    badge.className = `absolute top-1 left-1 ${colors} text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center`;
    badge.textContent = index + 1;
    card.querySelector('.flex.items-stretch').prepend(badge);
  }

  // Menu button handler
  if (callbacks.onMenuClick) {
    const menuBtn = card.querySelector('[data-renderer-menu-btn]');
    if (menuBtn) {
      menuBtn.addEventListener(
        'touchstart',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );
      menuBtn.addEventListener(
        'touchend',
        (e) => {
          e.stopPropagation();
        },
        { passive: true }
      );
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        callbacks.onMenuClick(data._raw, index);
      });
    }
  }

  cardWrapper.appendChild(card);
  return cardWrapper;
}

/**
 * Render the mobile view (card list).
 * @param {HTMLElement} container - Target container
 * @param {Array<Object>} items - Raw items
 * @param {Array<string>} columns - Column IDs
 * @param {Function} escapeHtml - HTML escape function
 * @param {Object} callbacks - Event callbacks
 * @param {Object} options - Rendering options
 */
function renderMobile(
  container,
  items,
  columns,
  escapeHtml,
  callbacks,
  options
) {
  const cardContainer = document.createElement('div');
  cardContainer.className = 'mobile-album-list';

  items.forEach((item, index) => {
    const data = normalizeItemData(item);
    const card = createMobileCard(
      data,
      index,
      columns,
      escapeHtml,
      callbacks,
      options
    );
    cardContainer.appendChild(card);
  });

  container.appendChild(cardContainer);

  // Activate lazy loading
  observeLazyImages(cardContainer);
}

// ============ MAIN EXPORT ============

/**
 * Render an album list into a container.
 *
 * @param {Object} config
 * @param {HTMLElement} config.container - DOM element to render into
 * @param {Array<Object>} config.items - Array of album/recommendation items
 * @param {Array<string>} config.columns - Array of column IDs from COLUMN_DEFS
 * @param {Function} config.escapeHtml - HTML escape function (injected)
 * @param {Object} [config.emptyState] - Empty state config { icon, title, subtitle }
 * @param {Function} [config.onContextMenu] - (e, item, index) desktop right-click
 * @param {Function} [config.onMenuClick] - (item, index) mobile three-dot menu
 * @param {Function} [config.onReasoningClick] - (item, index) reasoning expand button
 * @param {boolean} [config.showPosition=false] - Show position badges on mobile
 * @param {number} [config.mobileCardHeight=150] - Mobile card height in px
 */
export function renderAlbumList(config) {
  const {
    container,
    items,
    columns,
    escapeHtml,
    emptyState,
    onContextMenu,
    onMenuClick,
    onReasoningClick,
    showPosition = false,
    mobileCardHeight = 150,
  } = config;

  if (!container || !columns || !escapeHtml) return;

  const isMobile = window.innerWidth < 1024;

  // Empty state
  if (!items || items.length === 0) {
    if (emptyState) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'text-center text-gray-500 mt-20 px-4';
      emptyDiv.innerHTML = `
        <i class="${emptyState.icon || 'fas fa-list'} text-4xl mb-4 block opacity-50"></i>
        <p class="text-xl mb-2">${emptyState.title || 'No items'}</p>
        ${emptyState.subtitle ? `<p class="text-sm">${emptyState.subtitle}</p>` : ''}
      `;
      container.appendChild(emptyDiv);
    }
    return;
  }

  const callbacks = { onContextMenu, onMenuClick, onReasoningClick };
  const options = { showPosition, mobileCardHeight };

  if (isMobile) {
    renderMobile(container, items, columns, escapeHtml, callbacks, options);
  } else {
    renderDesktop(container, items, columns, escapeHtml, callbacks);
  }
}
