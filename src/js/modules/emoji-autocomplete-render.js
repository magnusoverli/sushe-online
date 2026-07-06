function renderEmpty(doc, panel, query) {
  panel.textContent = '';
  const empty = doc.createElement('div');
  empty.className = 'emoji-autocomplete-empty';
  empty.textContent = query ? 'No emoji found' : 'Type to search emoji';
  panel.appendChild(empty);
}

export function renderSuggestions(doc, panel, query, suggestions, activeIndex) {
  panel.textContent = '';

  if (suggestions.length === 0) {
    renderEmpty(doc, panel, query);
    return;
  }

  suggestions.forEach((suggestion, index) => {
    const option = doc.createElement('div');
    option.id = `${panel.id}-option-${index}`;
    option.className = 'emoji-autocomplete-option';
    option.setAttribute('role', 'option');
    option.setAttribute(
      'aria-selected',
      index === activeIndex ? 'true' : 'false'
    );
    option.dataset.index = String(index);

    const glyph = doc.createElement('span');
    glyph.className = 'emoji-autocomplete-glyph';
    glyph.textContent = suggestion.emoji;

    const label = doc.createElement('span');
    label.className = 'emoji-autocomplete-label';
    label.textContent = `:${suggestion.shortName}:`;

    option.append(glyph, label);
    panel.appendChild(option);
  });
}

export function updateHighlight(panel, activeTextarea, activeIndex) {
  if (!panel) return;

  panel.querySelectorAll('.emoji-autocomplete-option').forEach((option) => {
    const index = Number.parseInt(option.dataset.index, 10);
    const isActive = index === activeIndex;
    option.classList.toggle('is-active', isActive);
    option.setAttribute('aria-selected', isActive ? 'true' : 'false');
    if (isActive) {
      activeTextarea?.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  });
}
