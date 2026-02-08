/**
 * About Modal Module
 *
 * Renders the app info and changelog in a modal triggered
 * from the header info icon. Changelog data is imported at
 * build time from src/data/changelog.json.
 *
 * @module about-modal
 */

import { escapeHtml } from './html-utils.js';
import changelogData from '../../data/changelog.json';

/**
 * Category display metadata — icon, color, and human label
 * for each changelog entry type.
 */
const CATEGORY_META = {
  feature: {
    icon: 'fa-plus',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
  },
  fix: {
    icon: 'fa-wrench',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
  },
  ui: {
    icon: 'fa-paintbrush',
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
  },
  perf: {
    icon: 'fa-gauge-high',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
  },
  security: {
    icon: 'fa-shield-halved',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
  },
};

/** How many entries to show before the "Show more" fold */
const INITIAL_COUNT = 15;

/**
 * Format an ISO date string into a readable date.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} e.g. "Jan 15, 2026"
 */
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Render a single changelog entry row.
 * @param {Object} entry - { date, category, description }
 * @returns {string} HTML
 */
function renderEntry(entry) {
  const meta = CATEGORY_META[entry.category] || CATEGORY_META.feature;
  const dateLabel = entry.date ? formatDate(entry.date) : '';

  return `
    <div class="flex items-start gap-3 py-2.5 px-1">
      <div class="flex-shrink-0 w-7 h-7 rounded-full ${meta.bg} flex items-center justify-center mt-0.5">
        <i class="fas ${meta.icon} ${meta.color} text-xs"></i>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm text-gray-200 leading-relaxed">${escapeHtml(entry.description)}</p>
      </div>
      ${dateLabel ? `<span class="flex-shrink-0 text-xs text-gray-600 mt-1 tabular-nums">${dateLabel}</span>` : ''}
    </div>`;
}

/**
 * Render the full modal inner content (header + body + footer).
 * @returns {string} HTML
 */
function renderContent() {
  const entries = Array.isArray(changelogData) ? changelogData : [];
  const visible = entries.slice(0, INITIAL_COUNT);
  const hasMore = entries.length > INITIAL_COUNT;

  const entriesHtml =
    visible.length > 0
      ? visible
          .map(renderEntry)
          .join('<div class="border-t border-gray-800/50"></div>')
      : `<div class="text-center py-8">
           <i class="fas fa-clipboard-list text-2xl text-gray-600 mb-2"></i>
           <p class="text-gray-500 text-sm">No updates yet</p>
         </div>`;

  return `
    <!-- Header -->
    <div class="p-5 pb-4 border-b border-gray-800/50 shrink-0">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-white">What's New</h3>
        <button id="aboutModalClose" class="p-2 -m-2 text-gray-500 hover:text-gray-300 transition">
          <i class="fas fa-times text-lg"></i>
        </button>
      </div>
    </div>

    <!-- Changelog -->
    <div class="overflow-y-auto flex-1 min-h-0 overscroll-contain" id="aboutModalScroll">
      <div class="px-4 pt-2 pb-2" id="aboutChangelogList">
        ${entriesHtml}
      </div>
      ${
        hasMore
          ? `<div class="px-4 pb-4">
               <button id="aboutShowMore" class="w-full py-2 text-sm text-gray-500 hover:text-gray-300 transition flex items-center justify-center gap-2 border border-gray-800 rounded-md hover:border-gray-700">
                 <span>Show older</span>
                 <i class="fas fa-chevron-down text-xs"></i>
               </button>
             </div>`
          : ''
      }
    </div>
  `;
}

/**
 * Initialize the about modal. Call once after DOM is ready.
 * Renders content and wires up open/close handlers.
 */
export function initAboutModal() {
  const modal = document.getElementById('aboutModal');
  const content = document.getElementById('aboutModalContent');
  if (!modal || !content) return;

  // Render initial content
  content.innerHTML = renderContent();

  function open() {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    attachHandlers();
  }

  function close() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function attachHandlers() {
    // Close button
    const closeBtn = document.getElementById('aboutModalClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', close, { once: true });
    }

    // Show more
    const showMoreBtn = document.getElementById('aboutShowMore');
    if (showMoreBtn) {
      showMoreBtn.addEventListener(
        'click',
        () => {
          const entries = Array.isArray(changelogData) ? changelogData : [];
          const remaining = entries.slice(INITIAL_COUNT);
          const list = document.getElementById('aboutChangelogList');
          if (list && remaining.length > 0) {
            const extraHtml = remaining
              .map(
                (entry) =>
                  `<div class="border-t border-gray-800/50"></div>${renderEntry(entry)}`
              )
              .join('');
            list.insertAdjacentHTML('beforeend', extraHtml);
          }
          showMoreBtn.remove();
        },
        { once: true }
      );
    }
  }

  // Backdrop click closes
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  // Escape key closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      close();
    }
  });

  // Expose globally for the header button
  window.openAboutModal = open;
}
