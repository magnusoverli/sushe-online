import { escapeHtmlAttr as escapeHtml } from '../html-utils.js';

function taxonomyTerms(values) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === 'string' && value.trim());
}

function validatedRymUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;

  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const validHost =
      hostname === 'rateyourmusic.com' ||
      hostname.endsWith('.rateyourmusic.com');
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !validHost ||
      !parsed.pathname.startsWith('/release/')
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function renderTerms(values) {
  const terms = taxonomyTerms(values);
  return terms.length ? terms.map(escapeHtml).join(', ') : 'None';
}

function renderTaxonomyRow(label, values) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${renderTerms(values)}</dd></div>`;
}

/** Render compact, read-only Rate Your Music taxonomy details. */
export function renderTaxonomyContent(taxonomy) {
  const rym = taxonomy?.rym;
  if (!rym || typeof rym !== 'object' || Array.isArray(rym)) return '';

  const primary = taxonomyTerms(rym.primary_genres);
  const secondary = taxonomyTerms(rym.secondary_genres);
  const descriptors = taxonomyTerms(rym.descriptors);
  const languages = taxonomyTerms(rym.languages);
  const scenes = taxonomyTerms(rym.scenes);
  const movements = taxonomyTerms(rym.movements);
  const sourceUrl = validatedRymUrl(rym.source_url);
  if (
    primary.length === 0 &&
    secondary.length === 0 &&
    descriptors.length === 0 &&
    languages.length === 0 &&
    scenes.length === 0 &&
    movements.length === 0 &&
    !rym.source_url
  ) {
    return '';
  }

  const sourceHtml = sourceUrl
    ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml('RateYourMusic')}</a>`
    : `<span>${escapeHtml('Unavailable')}</span>`;
  const optionalRows = [
    ['Languages', languages, 'languages'],
    ['Scenes', scenes, 'scenes'],
    ['Movements', movements, 'movements'],
  ]
    .filter(([, , field]) => Object.hasOwn(rym, field))
    .map(([label, values]) => renderTaxonomyRow(label, values))
    .join('');

  return `<dl class="album-taxonomy-panel">
    ${renderTaxonomyRow('Primary', primary)}
    ${renderTaxonomyRow('Secondary', secondary)}
    ${renderTaxonomyRow('Descriptors', descriptors)}
    ${optionalRows}
    <div><dt>Source</dt><dd>${sourceHtml}</dd></div>
  </dl>`;
}

export function renderTaxonomyTrigger(
  taxonomy,
  { mobile = false, albumName = '', artist = '' } = {}
) {
  if (!renderTaxonomyContent(taxonomy)) return '';
  const mobileClass = mobile ? ' taxonomy-trigger-mobile' : '';
  const label = `Show taxonomy for ${albumName || 'album'}`;
  const payload = JSON.stringify({ rym: taxonomy.rym });

  return `<button type="button" class="taxonomy-trigger${mobileClass}"
    data-taxonomy="${escapeHtml(payload)}"
    data-album-name="${escapeHtml(albumName)}"
    data-artist="${escapeHtml(artist)}"
    aria-label="${escapeHtml(label)}">
    <i class="fas fa-tags" aria-hidden="true"></i>
  </button>`;
}
