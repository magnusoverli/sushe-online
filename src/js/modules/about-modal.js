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
const INITIAL_COUNT = 30;

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
 * Format a commit message body into readable HTML.
 * Preserves bullet points and paragraph breaks.
 * @param {string} msg - Full commit message (subject + body)
 * @returns {string} HTML
 */
function formatCommitMessage(msg) {
  const escaped = escapeHtml(msg);
  const lines = escaped.split('\n');

  // First line is the subject — skip it since description already covers it
  // Body starts after first blank line
  const blankIdx = lines.indexOf('', 1);
  if (blankIdx < 0) return ''; // no body, nothing extra to show

  const bodyLines = lines.slice(blankIdx + 1);
  if (bodyLines.every((l) => l.trim() === '')) return '';

  // Convert lines to HTML: bullet lines stay as-is, blank lines become breaks
  const htmlParts = [];
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      htmlParts.push('<br>');
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      htmlParts.push(
        `<div class="flex gap-1.5 pl-1"><span class="text-gray-600 select-none">&bull;</span><span>${trimmed.slice(2)}</span></div>`
      );
    } else {
      htmlParts.push(`<div>${trimmed}</div>`);
    }
  }

  return htmlParts.join('');
}

/**
 * Render a single changelog entry row (no date — shown by the group header).
 * If the entry has a commitMessage, clicking it toggles an inline expansion.
 * @param {Object} entry - { date, category, description, hash?, commitMessage? }
 * @param {number} idx - unique index for this entry (used for DOM IDs)
 * @returns {string} HTML
 */
function renderEntry(entry, idx) {
  const meta = CATEGORY_META[entry.category] || CATEGORY_META.feature;
  const text = escapeHtml(entry.description);
  const hasDetail = entry.commitMessage && entry.commitMessage.includes('\n\n');
  const cursorClass = hasDetail ? 'cursor-pointer hover:text-white' : '';
  const chevron = hasDetail
    ? `<i class="fas fa-chevron-right text-gray-600 text-[0.5rem] mt-1.5 ml-auto shrink-0 transition-transform duration-150" data-chevron="${idx}"></i>`
    : '';

  const detailHtml = hasDetail
    ? `<div class="hidden pl-8.5 pr-2 pb-2 text-xs text-gray-400 leading-relaxed" data-detail="${idx}">${formatCommitMessage(entry.commitMessage)}</div>`
    : '';

  return `
    <div class="flex items-start gap-2.5 py-1.5 ${cursorClass} transition" ${hasDetail ? `data-toggle="${idx}"` : ''}>
      <div class="flex-shrink-0 w-6 h-6 rounded-full ${meta.bg} flex items-center justify-center mt-0.5">
        <i class="fas ${meta.icon} ${meta.color}" style="font-size: 0.6rem;"></i>
      </div>
      <span class="text-sm text-gray-200 leading-snug pt-0.5">${text}</span>
      ${chevron}
    </div>${detailHtml}`;
}

/**
 * Group a flat array of entries by date, preserving a global index
 * so each entry gets a unique ID for toggle behaviour.
 * @param {Array} entries
 * @param {number} [startIdx=0] - starting index offset
 * @returns {Array<{date: string, entries: Array<{entry: Object, idx: number}>}>}
 */
function groupByDate(entries, startIdx = 0) {
  const groups = [];
  let current = null;

  entries.forEach((entry, i) => {
    if (!current || current.date !== entry.date) {
      current = { date: entry.date, entries: [] };
      groups.push(current);
    }
    current.entries.push({ entry, idx: startIdx + i });
  });

  return groups;
}

/**
 * Render a date group (header + its entries).
 * @param {Object} group - { date, entries: Array<{entry, idx}> }
 * @returns {string} HTML
 */
function renderGroup(group) {
  const dateLabel = group.date ? formatDate(group.date) : '';
  const rows = group.entries
    .map(({ entry, idx }) => renderEntry(entry, idx))
    .join('');

  return `
    <div class="py-2.5 px-1">
      <p class="text-xs font-medium text-gray-400 underline underline-offset-4 decoration-gray-700 mb-1.5">${dateLabel}</p>
      ${rows}
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

  const groups = groupByDate(visible);
  const entriesHtml =
    groups.length > 0
      ? groups
          .map(renderGroup)
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

  /**
   * Toggle inline expansion for a changelog entry.
   * @param {number} idx - entry index
   */
  function toggleDetail(idx) {
    const detail = content.querySelector(`[data-detail="${idx}"]`);
    const chevron = content.querySelector(`[data-chevron="${idx}"]`);
    if (!detail) return;

    const isHidden = detail.classList.contains('hidden');
    detail.classList.toggle('hidden', !isHidden);
    if (chevron) {
      chevron.style.transform = isHidden ? 'rotate(90deg)' : '';
    }
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
            const groups = groupByDate(remaining, INITIAL_COUNT);
            const extraHtml = groups
              .map(
                (group) =>
                  `<div class="border-t border-gray-800/50"></div>${renderGroup(group)}`
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

  // Delegated click for entry expansion toggles
  content.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      toggleDetail(toggle.dataset.toggle);
    }
  });

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
