import compactEmoji from 'emojibase-data/en/compact.json';
import githubShortcodes from 'emojibase-data/en/shortcodes/github.json';

const DEFAULT_LIMIT = 12;
const SKIN_TONE_PATTERN = /skin_tone|tone[1-5]/i;
const POPULAR_SHORT_NAMES = [
  'joy',
  'heart',
  'fire',
  'thumbsup',
  '+1',
  'sob',
  'skull',
  'eyes',
  'thinking',
  'pray',
  'clap',
  'tada',
  '100',
  'smile',
  'heart_eyes',
  'wave',
];

let emojiIndex = null;
let popularEmoji = null;

function unifiedToEmoji(unified) {
  if (!unified) return '';

  return unified
    .split('-')
    .map((part) => String.fromCodePoint(Number.parseInt(part, 16)))
    .join('');
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function slugifyShortName(value) {
  return normalizeSearchText(value)
    .replace(/[^a-z0-9_+-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^:+|:+$/g, '')
    .replace(/\s+/g, '_');
}

function collectTerms(entry) {
  return [
    ...entry.shortNames,
    entry.name,
    entry.category,
    entry.subcategory,
    ...(Array.isArray(entry.texts) ? entry.texts : []),
    entry.text,
  ]
    .filter(Boolean)
    .map(normalizeSearchText);
}

function normalizeEntry(raw) {
  const emoji = raw.unicode || unifiedToEmoji(raw.hexcode);
  const shortNames = [
    ...toArray(githubShortcodes[raw.hexcode]),
    slugifyShortName(raw.label),
  ].filter(Boolean);
  const uniqueShortNames = Array.from(new Set(shortNames));

  if (!emoji || uniqueShortNames.length === 0) return null;

  const entry = {
    emoji,
    shortName: uniqueShortNames[0],
    shortNames: uniqueShortNames,
    name: raw.label || uniqueShortNames[0],
    category: String(raw.group ?? ''),
    subcategory: '',
    sortOrder: raw.order || 0,
    hasSkinTone: uniqueShortNames.some((name) => SKIN_TONE_PATTERN.test(name)),
    text: raw.text,
    texts: raw.tags,
  };

  entry.terms = collectTerms(entry);
  return entry;
}

function expandEntry(raw) {
  const entries = [normalizeEntry(raw)];
  if (Array.isArray(raw.skins)) {
    raw.skins.forEach((skin) => {
      entries.push(
        normalizeEntry({
          ...skin,
          tags: raw.tags,
          group: skin.group ?? raw.group,
        })
      );
    });
  }
  return entries.filter(Boolean);
}

function getEmojiIndex() {
  if (!emojiIndex) {
    emojiIndex = compactEmoji.flatMap(expandEntry);
  }
  return emojiIndex;
}

function getPopularEmoji() {
  if (popularEmoji) return popularEmoji;

  const byShortName = new Map();
  for (const entry of getEmojiIndex()) {
    for (const shortName of entry.shortNames) {
      if (!byShortName.has(shortName)) byShortName.set(shortName, entry);
    }
  }

  popularEmoji = POPULAR_SHORT_NAMES.map((name) =>
    byShortName.get(name)
  ).filter(Boolean);
  return popularEmoji;
}

function scoreTerm(term, query) {
  if (term === query) return 0;
  if (term.startsWith(query)) return 4;
  if (term.includes(query)) return 12;
  return null;
}

function scoreEmoji(entry, query) {
  let bestScore = null;

  entry.terms.forEach((term, index) => {
    const score = scoreTerm(term, query);
    if (score === null) return;

    const weightedScore = score + (index >= entry.shortNames.length ? 6 : 0);
    bestScore =
      bestScore === null ? weightedScore : Math.min(bestScore, weightedScore);
  });

  if (bestScore === null) return null;
  return bestScore + (entry.hasSkinTone ? 40 : 0);
}

export function getEmojiSuggestions(query, limit = DEFAULT_LIMIT) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return getPopularEmoji().slice(0, limit);

  return getEmojiIndex()
    .map((entry) => ({ entry, score: scoreEmoji(entry, normalizedQuery) }))
    .filter((result) => result.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.entry.sortOrder - b.entry.sortOrder;
    })
    .slice(0, limit)
    .map((result) => result.entry);
}

export const emojiDataInternals = {
  normalizeSearchText,
  unifiedToEmoji,
};
