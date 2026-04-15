export function formatInUserListsTooltip(listNames, escapeHtml) {
  if (!Array.isArray(listNames) || listNames.length === 0) {
    return '';
  }

  const header = listNames.length === 1 ? 'In your list:' : 'In your lists:';
  const items = listNames
    .map((name) => `&bull; ${escapeHtml(name)}`)
    .join('<br>');

  return `<span class="font-semibold text-gray-200">${header}</span><br>${items}`;
}

export function formatInUserListsAriaLabel(listNames) {
  if (!Array.isArray(listNames) || listNames.length === 0) {
    return '';
  }

  const header = listNames.length === 1 ? 'In your list' : 'In your lists';
  return `${header}: ${listNames.join(', ')}`;
}
