/**
 * Album search (desktop).
 *
 * Header search box that finds albums across ALL of the current user's lists
 * (backend: GET /api/search/albums) and, on selection, switches to the list
 * containing the match and scrolls/flashes that album into view.
 *
 * Resilience notes:
 *   - selectList() re-renders the header, so input handling is DELEGATED from
 *     document rather than bound to the (volatile) input element.
 *   - The results dropdown and the field-options popover are mounted on <body>
 *     (outside the header), so a header re-render never destroys them.
 */

import { escapeHtml } from './html-utils.js';

const DEBOUNCE_MS = 220;
const MIN_CHARS = 2;
const RESULT_LIMIT = 25;
const STORAGE_KEY = 'albumSearch.fields';
const PANEL_GAP = 6;

// Optional field groups (artist + album are always searched server-side). Keys
// must match OPTIONAL_FIELDS in routes/api/search.js.
const OPTIONAL_FIELDS = [
  { key: 'meta', label: 'Year, genre & country' },
  { key: 'notes', label: 'Notes & comments' },
  { key: 'tracks', label: 'Track names' },
];

export function createAlbumSearch(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  const storage =
    deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const logger = deps.logger || console;
  const { apiCall, selectList, getListData } = deps;

  if (!doc || !win || typeof apiCall !== 'function') {
    return { initialize() {} };
  }

  let resultsEl = null;
  let optionsEl = null;
  let debounceTimer = null;
  let abortController = null;
  let requestSeq = 0;
  let currentResults = [];
  let activeIndex = -1;
  let lastQuery = '';
  let repositionScheduled = false;
  let flashSession = null;
  let selectedFields = loadFields();

  // ---- field-selection persistence -----------------------------------------

  function loadFields() {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((key) =>
        OPTIONAL_FIELDS.some((field) => field.key === key)
      );
    } catch {
      return [];
    }
  }

  function saveFields() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(selectedFields));
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  // ---- input element helpers ------------------------------------------------

  function getInput() {
    return doc.getElementById('albumSearchInput');
  }

  function setExpanded(expanded) {
    const input = getInput();
    if (input) input.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function toggleClearButton(visible) {
    const clearBtn = doc.getElementById('albumSearchClear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !visible);
  }

  // ---- results panel --------------------------------------------------------

  function ensureResultsEl() {
    if (resultsEl) return resultsEl;
    resultsEl = doc.createElement('div');
    resultsEl.id = 'albumSearchResults';
    resultsEl.setAttribute('role', 'listbox');
    resultsEl.className = 'album-search-panel hidden';
    doc.body.appendChild(resultsEl);
    return resultsEl;
  }

  function resultRowHtml(result, index) {
    const cover = `/api/albums/${encodeURIComponent(
      result.albumId
    )}/cover?size=thumb`;
    const subParts = [result.artist, result.year].filter(Boolean);
    const sub = subParts.map((part) => escapeHtml(part)).join(' · ');
    return `
      <div class="album-search-result" role="option" id="albumSearchResult-${index}" data-result-index="${index}">
        <img class="album-search-result-cover" src="${escapeHtml(
          cover
        )}" alt="" loading="lazy" onerror="this.classList.add('is-broken')" />
        <span class="album-search-result-meta">
          <span class="album-search-result-title">${escapeHtml(
            result.album || 'Untitled'
          )}</span>
          <span class="album-search-result-sub">${sub}</span>
        </span>
        <span class="album-search-result-list" title="${escapeHtml(
          result.listName || ''
        )}"><i class="fas fa-list-ul"></i>${escapeHtml(
          result.listName || ''
        )}</span>
      </div>`;
  }

  function renderResults(data, query) {
    currentResults = Array.isArray(data?.results) ? data.results : [];
    activeIndex = -1;
    const panel = ensureResultsEl();

    if (currentResults.length === 0) {
      panel.innerHTML = `<div class="album-search-empty">No albums match “${escapeHtml(
        query
      )}”.</div>`;
    } else {
      const rows = currentResults
        .map((result, index) => resultRowHtml(result, index))
        .join('');
      const hint = data.truncated
        ? `<div class="album-search-hint">Showing the first ${currentResults.length} — keep typing to narrow down.</div>`
        : '';
      panel.innerHTML = rows + hint;
    }

    openPanel();
  }

  function renderMessage(message) {
    const panel = ensureResultsEl();
    panel.innerHTML = `<div class="album-search-empty">${escapeHtml(
      message
    )}</div>`;
    openPanel();
  }

  function openPanel() {
    const panel = ensureResultsEl();
    panel.classList.remove('hidden');
    setExpanded(true);
    positionAgainstInput(panel);
  }

  function closePanel() {
    if (resultsEl) resultsEl.classList.add('hidden');
    setExpanded(false);
    setActiveDescendant(null);
    activeIndex = -1;
  }

  function isPanelOpen() {
    return !!resultsEl && !resultsEl.classList.contains('hidden');
  }

  function positionAgainstInput(panel) {
    const container = doc.getElementById('albumSearchContainer');
    const anchor = container || getInput();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.bottom + PANEL_GAP)}px`;
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.width = `${Math.round(rect.width)}px`;
  }

  // ---- keyboard navigation --------------------------------------------------

  function setActiveDescendant(id) {
    const input = getInput();
    if (!input) return;
    if (id) input.setAttribute('aria-activedescendant', id);
    else input.removeAttribute('aria-activedescendant');
  }

  function highlightActive() {
    if (!resultsEl) return;
    const rows = resultsEl.querySelectorAll('.album-search-result');
    rows.forEach((row, index) => {
      const isActive = index === activeIndex;
      row.classList.toggle('is-active', isActive);
      if (isActive) {
        row.scrollIntoView({ block: 'nearest' });
        setActiveDescendant(row.id);
      }
    });
    if (activeIndex < 0) setActiveDescendant(null);
  }

  function moveActive(delta) {
    if (currentResults.length === 0) return;
    const count = currentResults.length;
    if (activeIndex < 0) {
      activeIndex = delta > 0 ? 0 : count - 1;
    } else {
      activeIndex = (activeIndex + delta + count) % count;
    }
    highlightActive();
  }

  // ---- search execution -----------------------------------------------------

  function onInputChange(value) {
    clearTimeout(debounceTimer);
    const query = value.trim();
    toggleClearButton(value.length > 0);

    if (query.length < MIN_CHARS) {
      lastQuery = '';
      cancelInflight();
      closePanel();
      return;
    }

    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  }

  function cancelInflight() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  async function runSearch(query) {
    lastQuery = query;
    cancelInflight();
    abortController = new AbortController();
    const seq = ++requestSeq;

    const params = new URLSearchParams({
      q: query,
      limit: String(RESULT_LIMIT),
    });
    if (selectedFields.length > 0) {
      params.set('fields', selectedFields.join(','));
    }

    try {
      const data = await apiCall(`/api/search/albums?${params.toString()}`, {
        signal: abortController.signal,
      });
      if (seq !== requestSeq) return; // a newer search superseded this one
      renderResults(data, query);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (seq !== requestSeq) return;
      logger.warn('Album search failed:', error);
      renderMessage('Search is unavailable right now. Please try again.');
    }
  }

  function rerunCurrentQuery() {
    const input = getInput();
    const query = (input?.value || '').trim();
    if (query.length >= MIN_CHARS) runSearch(query);
  }

  // ---- selecting a result ---------------------------------------------------

  async function selectResult(index) {
    const result = currentResults[index];
    if (!result) return;

    closePanel();
    const input = getInput();
    if (input) {
      input.blur();
    }

    if (typeof selectList === 'function') {
      try {
        await selectList(result.listId);
      } catch (error) {
        // The list never switched, so the matched row isn't on screen — don't
        // chase a row that doesn't exist (it could even flash the wrong album
        // if the same album also sits in the still-displayed list).
        logger.warn('Failed to open list from search:', error);
        return;
      }
    }

    flashAlbumRow(result.listId, result.albumId);
  }

  function clearFlashSession() {
    const session = flashSession;
    if (!session) return;
    flashSession = null;
    if (session.observer) session.observer.disconnect();
    win.clearTimeout(session.removeTimer);
    if (session.row) {
      session.row.classList.remove('album-search-flash');
      session.row.style.animationDelay = '';
    }
  }

  /**
   * Highlight the matched album row after jumping to its list.
   *
   * The album list re-renders by replacing every row element (displayAlbums ->
   * container.replaceChildren), so a flash class pinned to one element is
   * discarded whenever a rebuild lands right after we apply it — e.g. the
   * deferred full-profile hydrate, or a faster cached-data render that lets a
   * rebuild fire almost immediately. So each flash runs as a short "session":
   * we (re)apply the highlight to the album's CURRENT row, and a MutationObserver
   * re-applies it to the freshly built row whenever the list rebuilds. The
   * animation is resumed at the correct wall-clock point via a negative
   * animation-delay, so re-applying continues the same ~3s fade seamlessly
   * instead of restarting from full brightness.
   */
  function flashAlbumRow(listId, albumId) {
    clearFlashSession();

    const container = doc.getElementById('albumContainer');
    if (!container) return;

    const startedAt = Date.now();
    const session = {
      row: null,
      observer: null,
      removeTimer: null,
      scrolled: false,
    };
    flashSession = session;

    const findRow = () => {
      const data =
        (typeof getListData === 'function' ? getListData(listId) : null) || [];
      const idx = data.findIndex(
        (item) => item && (item.album_id || item.albumId) === albumId
      );
      if (idx < 0) return null;
      return container.querySelector(`[data-index="${idx}"]`);
    };

    const apply = (row) => {
      if (flashSession !== session || !row) return;
      session.row = row;
      if (!session.scrolled) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        session.scrolled = true;
      }
      // Resume the animation at the current point in wall-clock time so a
      // re-apply after a rebuild continues the fade rather than flashing anew,
      // and the highlight always finishes ~3s after the jump.
      const elapsed = (Date.now() - startedAt) / 1000;
      row.classList.remove('album-search-flash');
      row.style.animationDelay = `-${elapsed}s`;
      void row.offsetWidth; // reflow so the animation (re)attaches
      row.classList.add('album-search-flash');
    };

    // Initial application — retry for a few frames until the row is painted.
    const tryInitial = (attempt = 0) => {
      if (flashSession !== session) return;
      const row = findRow();
      if (row) {
        apply(row);
        return;
      }
      if (attempt < 30)
        win.requestAnimationFrame(() => tryInitial(attempt + 1));
    };
    tryInitial();

    // Re-apply to the new row if a rebuild discards ours during the window.
    session.observer = new win.MutationObserver(() => {
      if (flashSession !== session) return;
      if (container.querySelector('.album-search-flash')) return; // ours survives
      const row = findRow();
      if (row) apply(row);
    });
    session.observer.observe(container, { childList: true, subtree: true });

    session.removeTimer = win.setTimeout(clearFlashSession, 3200);
  }

  // ---- field-options popover ------------------------------------------------

  function ensureOptionsEl() {
    if (optionsEl) return optionsEl;
    optionsEl = doc.createElement('div');
    optionsEl.id = 'albumSearchOptions';
    optionsEl.className = 'album-search-options hidden';
    optionsEl.setAttribute('role', 'group');
    optionsEl.setAttribute('aria-label', 'Search fields');
    optionsEl.innerHTML = `
      <div class="album-search-options-title">Search fields</div>
      <div class="album-search-option is-static">
        <i class="fas fa-check"></i><span>Artist &amp; album title</span>
      </div>
      ${OPTIONAL_FIELDS.map(
        (field) => `
        <label class="album-search-option">
          <input type="checkbox" data-search-field="${field.key}" />
          <span>${escapeHtml(field.label)}</span>
        </label>`
      ).join('')}
    `;
    doc.body.appendChild(optionsEl);
    return optionsEl;
  }

  function syncOptionsChecks() {
    if (!optionsEl) return;
    optionsEl
      .querySelectorAll('input[data-search-field]')
      .forEach((checkbox) => {
        checkbox.checked = selectedFields.includes(
          checkbox.getAttribute('data-search-field')
        );
      });
  }

  function isOptionsOpen() {
    return !!optionsEl && !optionsEl.classList.contains('hidden');
  }

  function openOptions() {
    const popover = ensureOptionsEl();
    syncOptionsChecks();
    popover.classList.remove('hidden');
    const btn = doc.getElementById('albumSearchOptionsBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    positionOptions(popover);
  }

  function closeOptions() {
    if (optionsEl) optionsEl.classList.add('hidden');
    const btn = doc.getElementById('albumSearchOptionsBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleOptions() {
    if (isOptionsOpen()) closeOptions();
    else openOptions();
  }

  function positionOptions(popover) {
    const btn = doc.getElementById('albumSearchOptionsBtn');
    const container = doc.getElementById('albumSearchContainer');
    const anchor = btn || container;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Render first (hidden -> measured) to know the popover width.
    const width = popover.offsetWidth || 240;
    let left = Math.round(rect.right - width);
    if (left < 8) left = 8;
    popover.style.top = `${Math.round(rect.bottom + PANEL_GAP)}px`;
    popover.style.left = `${left}px`;
  }

  function onFieldToggle(checkbox) {
    const key = checkbox.getAttribute('data-search-field');
    if (!key) return;
    if (checkbox.checked) {
      if (!selectedFields.includes(key)) selectedFields.push(key);
    } else {
      selectedFields = selectedFields.filter((field) => field !== key);
    }
    saveFields();
    rerunCurrentQuery();
  }

  // ---- repositioning on scroll / resize ------------------------------------

  function scheduleReposition() {
    if (repositionScheduled) return;
    if (!isPanelOpen() && !isOptionsOpen()) return;
    repositionScheduled = true;
    win.requestAnimationFrame(() => {
      repositionScheduled = false;
      if (isPanelOpen()) positionAgainstInput(resultsEl);
      if (isOptionsOpen()) positionOptions(optionsEl);
    });
  }

  // ---- global (delegated) event wiring -------------------------------------

  function handleInput(event) {
    if (event.target?.id !== 'albumSearchInput') return;
    onInputChange(event.target.value || '');
  }

  function handleKeydown(event) {
    if (event.target?.id !== 'albumSearchInput') return;
    switch (event.key) {
      case 'ArrowDown':
        if (isPanelOpen()) {
          event.preventDefault();
          moveActive(1);
        } else if (lastQuery) {
          runSearch(lastQuery);
        }
        break;
      case 'ArrowUp':
        if (isPanelOpen()) {
          event.preventDefault();
          moveActive(-1);
        }
        break;
      case 'Enter':
        if (isPanelOpen() && currentResults.length > 0) {
          event.preventDefault();
          selectResult(activeIndex >= 0 ? activeIndex : 0);
        }
        break;
      case 'Escape':
        if (isPanelOpen()) {
          event.preventDefault();
          closePanel();
        } else if (isOptionsOpen()) {
          event.preventDefault();
          closeOptions();
        }
        break;
      default:
        break;
    }
  }

  function handleClick(event) {
    const target = event.target;

    // Toggle the field-options popover.
    if (target.closest('#albumSearchOptionsBtn')) {
      event.preventDefault();
      toggleOptions();
      return;
    }

    // Clear the query.
    if (target.closest('#albumSearchClear')) {
      event.preventDefault();
      const input = getInput();
      if (input) {
        input.value = '';
        input.focus();
      }
      toggleClearButton(false);
      lastQuery = '';
      clearTimeout(debounceTimer);
      debounceTimer = null;
      cancelInflight();
      closePanel();
      return;
    }

    // Select a result row.
    const row = target.closest('.album-search-result');
    if (row && resultsEl?.contains(row)) {
      const index = Number.parseInt(row.getAttribute('data-result-index'), 10);
      if (Number.isInteger(index)) selectResult(index);
      return;
    }

    // Clicks inside the search box or its surfaces should not dismiss them.
    if (
      target.closest('#albumSearchContainer') ||
      target.closest('#albumSearchResults') ||
      target.closest('#albumSearchOptions')
    ) {
      return;
    }

    // Outside click: dismiss any open surface.
    if (isPanelOpen()) closePanel();
    if (isOptionsOpen()) closeOptions();
  }

  function handleChange(event) {
    const checkbox = event.target;
    if (checkbox?.matches?.('input[data-search-field]')) {
      onFieldToggle(checkbox);
    }
  }

  function initialize() {
    doc.addEventListener('input', handleInput);
    doc.addEventListener('keydown', handleKeydown);
    doc.addEventListener('click', handleClick);
    doc.addEventListener('change', handleChange);
    win.addEventListener('resize', scheduleReposition);
    // Capture phase so scrolling in any nested container repositions the panel.
    win.addEventListener('scroll', scheduleReposition, true);
  }

  return { initialize };
}
