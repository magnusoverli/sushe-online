const MAX_QUERY_LENGTH = 40;
const TRIGGER_PREFIX_PATTERN = /^[\s([{<'"`]$/;
const QUERY_PATTERN = /^[a-zA-Z0-9_+-]*$/;
const MENU_CONTROL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'Enter',
  'Tab',
  'Escape',
]);

export function findEmojiTrigger(value, caretIndex) {
  if (!Number.isInteger(caretIndex) || caretIndex < 1) return null;

  const textBeforeCaret = String(value || '').slice(0, caretIndex);
  const colonIndex = textBeforeCaret.lastIndexOf(':');
  if (colonIndex === -1) return null;

  const query = textBeforeCaret.slice(colonIndex + 1);
  if (query.length > MAX_QUERY_LENGTH) return null;
  if (!QUERY_PATTERN.test(query)) return null;

  const charBeforeTrigger =
    colonIndex > 0 ? textBeforeCaret[colonIndex - 1] : '';
  if (charBeforeTrigger && !TRIGGER_PREFIX_PATTERN.test(charBeforeTrigger)) {
    return null;
  }

  return {
    start: colonIndex,
    end: caretIndex,
    query,
  };
}

export function replaceEmojiTrigger(value, trigger, emoji) {
  const before = String(value || '').slice(0, trigger.start);
  const after = String(value || '').slice(trigger.end);
  const nextValue = `${before}${emoji}${after}`;

  return {
    value: nextValue,
    caretIndex: before.length + emoji.length,
  };
}

export function shouldRefreshAfterKeyup(key, menuOpen) {
  return !(menuOpen && MENU_CONTROL_KEYS.has(key));
}
