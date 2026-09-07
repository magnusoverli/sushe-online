import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';

// The playcount parts interpolate these fields directly; their display.html is
// formatted count text, not an HTML slot. Keep caller data unmodified.
export function escapePlaycountData(data) {
  return {
    ...data,
    itemId: escapeHtml(String(data.itemId ?? '')),
    playcount: escapeHtml(String(data.playcount ?? '')),
    playcountDisplay: {
      ...data.playcountDisplay,
      html: escapeHtml(String(data.playcountDisplay.html ?? '')),
    },
  };
}
