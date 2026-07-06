import { getTextareaCaretPoint } from './emoji-autocomplete-position.js';
import {
  renderSuggestions,
  updateHighlight,
} from './emoji-autocomplete-render.js';
import {
  findEmojiTrigger,
  replaceEmojiTrigger,
  shouldRefreshAfterKeyup,
} from './emoji-autocomplete-utils.js';

const PANEL_GAP = 6;
const DEFAULT_LIMIT = 12;
const PANEL_ID = 'emojiAutocompletePanel';

let panelUid = 0;

export function createEmojiAutocomplete(deps = {}) {
  const doc = deps.doc || document;
  const win = deps.win || window;
  const limit = deps.limit || DEFAULT_LIMIT;
  const loadSuggestions =
    deps.loadSuggestions ||
    (async (query) => {
      const dataModule = await import('./emoji-data.js');
      return dataModule.getEmojiSuggestions(query, limit);
    });

  let panel = null;
  let activeTextarea = null;
  let activeTrigger = null;
  let activeSuggestions = [];
  let activeIndex = 0;
  let attachedCount = 0;
  let isComposing = false;
  let requestId = 0;

  function ensurePanel() {
    if (panel) return panel;

    panel = doc.createElement('div');
    panel.id = `${PANEL_ID}-${++panelUid}`;
    panel.className = 'emoji-autocomplete-panel hidden';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Emoji suggestions');
    panel.addEventListener('mousedown', (event) => event.preventDefault());
    panel.addEventListener('click', handlePanelClick);
    doc.body.appendChild(panel);
    return panel;
  }

  function setTextareaExpanded(expanded) {
    if (!activeTextarea) return;

    activeTextarea.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (!expanded) activeTextarea.removeAttribute('aria-activedescendant');
  }

  function close() {
    if (panel) panel.classList.add('hidden');
    setTextareaExpanded(false);
    activeTrigger = null;
    activeSuggestions = [];
    activeIndex = 0;
  }

  function isOpen() {
    return !!panel && !panel.classList.contains('hidden');
  }

  function positionPanel() {
    if (!activeTextarea || !panel || panel.classList.contains('hidden')) return;

    const point = getTextareaCaretPoint(
      activeTextarea,
      activeTextarea.selectionStart,
      doc,
      win
    );
    const panelWidth = panel.offsetWidth || 280;
    const panelHeight = panel.offsetHeight || 220;
    const viewportPadding = 8;
    const maxLeft = win.innerWidth - panelWidth - viewportPadding;
    const left = Math.max(viewportPadding, Math.min(point.left, maxLeft));
    const spaceBelow = win.innerHeight - point.top;
    const top =
      spaceBelow < panelHeight + PANEL_GAP && point.top > panelHeight
        ? point.top - panelHeight - PANEL_GAP
        : point.top + PANEL_GAP;

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(Math.max(viewportPadding, top))}px`;
  }

  async function updateFromTextarea(textarea) {
    if (isComposing) return;

    const trigger = findEmojiTrigger(textarea.value, textarea.selectionStart);
    if (!trigger) {
      requestId += 1;
      close();
      return;
    }

    activeTextarea = textarea;
    activeTrigger = trigger;
    const currentRequest = ++requestId;
    let suggestions;
    try {
      suggestions = await loadSuggestions(trigger.query);
    } catch (_error) {
      if (currentRequest === requestId) close();
      return;
    }
    if (currentRequest !== requestId || activeTextarea !== textarea) return;

    activeSuggestions = Array.isArray(suggestions) ? suggestions : [];
    activeIndex = activeSuggestions.length > 0 ? 0 : -1;
    renderSuggestions(
      doc,
      ensurePanel(),
      trigger.query,
      activeSuggestions,
      activeIndex
    );
    ensurePanel().classList.remove('hidden');
    textarea.setAttribute('aria-controls', ensurePanel().id);
    textarea.setAttribute('aria-autocomplete', 'list');
    setTextareaExpanded(true);
    updateHighlight(panel, activeTextarea, activeIndex);
    positionPanel();
  }

  function insertSuggestion(index = activeIndex) {
    const suggestion = activeSuggestions[index];
    if (!activeTextarea || !activeTrigger || !suggestion) return;

    const result = replaceEmojiTrigger(
      activeTextarea.value,
      activeTrigger,
      suggestion.emoji
    );
    activeTextarea.value = result.value;
    activeTextarea.setSelectionRange(result.caretIndex, result.caretIndex);
    const InputEventConstructor =
      typeof win.Event === 'function' ? win.Event : globalThis.Event;
    if (typeof InputEventConstructor === 'function') {
      activeTextarea.dispatchEvent(
        new InputEventConstructor('input', { bubbles: true })
      );
    }
    close();
    activeTextarea.focus();
  }

  function handlePanelClick(event) {
    const option = event.target.closest?.('.emoji-autocomplete-option');
    if (!option || !panel?.contains(option)) return;

    const index = Number.parseInt(option.dataset.index, 10);
    if (Number.isInteger(index)) insertSuggestion(index);
  }

  function handleTextareaKeydown(event) {
    if (!isOpen()) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activeSuggestions.length > 0) {
        activeIndex = Math.min(activeIndex + 1, activeSuggestions.length - 1);
        updateHighlight(panel, activeTextarea, activeIndex);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activeSuggestions.length > 0) {
        activeIndex = Math.max(activeIndex - 1, 0);
        updateHighlight(panel, activeTextarea, activeIndex);
      }
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      insertSuggestion();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  }

  function scheduleUpdate(textarea) {
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => updateFromTextarea(textarea));
    } else {
      win.setTimeout(() => updateFromTextarea(textarea), 0);
    }
  }

  function attach(textarea) {
    if (!textarea) return () => {};

    attachedCount += 1;
    const handleInput = () => updateFromTextarea(textarea);
    const handleSelection = () => scheduleUpdate(textarea);
    const handleKeyup = (event) => {
      if (shouldRefreshAfterKeyup(event.key, isOpen()))
        scheduleUpdate(textarea);
    };
    const handleBlur = () => win.setTimeout(close, 0);
    const handleCompositionStart = () => {
      isComposing = true;
      close();
    };
    const handleCompositionEnd = () => {
      isComposing = false;
      updateFromTextarea(textarea);
    };

    textarea.addEventListener('input', handleInput);
    textarea.addEventListener('click', handleSelection);
    textarea.addEventListener('keyup', handleKeyup);
    textarea.addEventListener('keydown', handleTextareaKeydown, true);
    textarea.addEventListener('blur', handleBlur);
    textarea.addEventListener('compositionstart', handleCompositionStart);
    textarea.addEventListener('compositionend', handleCompositionEnd);
    win.addEventListener('scroll', positionPanel, true);
    win.addEventListener('resize', positionPanel);

    return () => {
      textarea.removeEventListener('input', handleInput);
      textarea.removeEventListener('click', handleSelection);
      textarea.removeEventListener('keyup', handleKeyup);
      textarea.removeEventListener('keydown', handleTextareaKeydown, true);
      textarea.removeEventListener('blur', handleBlur);
      textarea.removeEventListener('compositionstart', handleCompositionStart);
      textarea.removeEventListener('compositionend', handleCompositionEnd);
      win.removeEventListener('scroll', positionPanel, true);
      win.removeEventListener('resize', positionPanel);

      if (activeTextarea === textarea) {
        close();
        activeTextarea = null;
      }

      attachedCount -= 1;
      if (attachedCount <= 0 && panel) {
        panel.remove();
        panel = null;
        attachedCount = 0;
      }
    };
  }

  return {
    attach,
    close,
    isOpen,
  };
}
