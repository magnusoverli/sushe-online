const MAX_TERM_LENGTH = 128;
const MAX_PRIMARY_GENRES = 32;
const MAX_SECONDARY_GENRES = 32;
const MAX_DESCRIPTORS = 128;
const MAX_LANGUAGES = 32;
const MAX_SCENES = 32;
const MAX_MOVEMENTS = 32;
const {
  MAX_LABELS,
  MAX_CREDITS,
  MAX_CREDIT_ROLES,
  normalizeReleaseMetadata,
} = require('./rym-release-metadata');
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_EXTRACTOR_VERSION_LENGTH = 64;
const RYM_HOST = 'rateyourmusic.com';
const RYM_ALBUM_PATH_PREFIX = '/release/album/';

function normalizeTaxonomyText(value) {
  return (
    value
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex -- Extracted page text must lose C0/C1 controls.
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

function normalizeTaxonomyTerm(value, fieldName = 'taxonomy term') {
  if (typeof value !== 'string') {
    throw new TypeError(`${fieldName} must be a string`);
  }

  const normalized = normalizeTaxonomyText(value);
  if ([...normalized].length > MAX_TERM_LENGTH) {
    throw new RangeError(
      `${fieldName} must be at most ${MAX_TERM_LENGTH} characters`
    );
  }
  return normalized;
}

function getSnapshotField(snapshot, camelName, snakeName) {
  if (Object.hasOwn(snapshot, camelName)) return snapshot[camelName];
  if (Object.hasOwn(snapshot, snakeName)) return snapshot[snakeName];
  return undefined;
}

function normalizeTerms(values, fieldName, maxItems) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${fieldName} is required and must be an array`);
  }
  if (values.length > maxItems) {
    throw new RangeError(`${fieldName} must have at most ${maxItems} items`);
  }

  const seen = new Set();
  const normalized = [];
  values.forEach((value, index) => {
    const term = normalizeTaxonomyTerm(value, `${fieldName}[${index}]`);
    const key = term.toLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      normalized.push(term);
    }
  });
  return normalized;
}

function normalizeSourceUrl(value) {
  if (typeof value !== 'string') {
    throw new TypeError('sourceUrl is required and must be a string');
  }
  const sourceUrl = normalizeTaxonomyText(value);
  if (!sourceUrl || sourceUrl.length > MAX_SOURCE_URL_LENGTH) {
    throw new RangeError(
      `sourceUrl must be between 1 and ${MAX_SOURCE_URL_LENGTH} characters`
    );
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new TypeError('sourceUrl must be a valid URL');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isRymHost = hostname === RYM_HOST || hostname.endsWith(`.${RYM_HOST}`);
  const pathMatch = parsed.pathname.match(
    /^\/release\/album\/([^/]+)\/([^/]+)\/?$/i
  );
  if (
    parsed.protocol !== 'https:' ||
    !isRymHost ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !pathMatch
  ) {
    throw new TypeError(
      'sourceUrl must be an HTTPS Rate Your Music release/album URL'
    );
  }
  return `https://${RYM_HOST}${RYM_ALBUM_PATH_PREFIX}${pathMatch[1]}/${pathMatch[2]}/`;
}

function normalizeExtractorVersion(value) {
  if (typeof value !== 'string') {
    throw new TypeError('extractorVersion is required and must be a string');
  }
  const version = normalizeTaxonomyText(value);
  if (!version || [...version].length > MAX_EXTRACTOR_VERSION_LENGTH) {
    throw new RangeError(
      `extractorVersion must be between 1 and ${MAX_EXTRACTOR_VERSION_LENGTH} characters`
    );
  }
  return version;
}

function normalizeCapturedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new TypeError('capturedAt must be an ISO timestamp string');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('capturedAt must be an ISO timestamp string');
  }
  return parsed.toISOString();
}

function normalizeRymSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('RYM snapshot must be an object');
  }
  if (snapshot.complete !== true) {
    throw new TypeError('RYM snapshot must be complete');
  }

  const languages = getSnapshotField(snapshot, 'languages', 'languages');
  const scenes = getSnapshotField(snapshot, 'scenes', 'scenes');
  const movements = getSnapshotField(snapshot, 'movements', 'movements');
  const releaseMetadata = normalizeReleaseMetadata(snapshot, {
    getSnapshotField,
    normalizeTaxonomyTerm,
    normalizeTerms,
  });

  return {
    primary_genres: normalizeTerms(
      getSnapshotField(snapshot, 'primaryGenres', 'primary_genres'),
      'primaryGenres',
      MAX_PRIMARY_GENRES
    ),
    secondary_genres: normalizeTerms(
      getSnapshotField(snapshot, 'secondaryGenres', 'secondary_genres'),
      'secondaryGenres',
      MAX_SECONDARY_GENRES
    ),
    descriptors: normalizeTerms(
      getSnapshotField(snapshot, 'descriptors', 'descriptors'),
      'descriptors',
      MAX_DESCRIPTORS
    ),
    ...(languages === undefined
      ? {}
      : {
          languages: normalizeTerms(languages, 'languages', MAX_LANGUAGES),
        }),
    ...(scenes === undefined
      ? {}
      : { scenes: normalizeTerms(scenes, 'scenes', MAX_SCENES) }),
    ...(movements === undefined
      ? {}
      : {
          movements: normalizeTerms(movements, 'movements', MAX_MOVEMENTS),
        }),
    ...releaseMetadata,
    source_url: normalizeSourceUrl(
      getSnapshotField(snapshot, 'sourceUrl', 'source_url')
    ),
    extractor_version: normalizeExtractorVersion(
      getSnapshotField(snapshot, 'extractorVersion', 'extractor_version')
    ),
    captured_at: normalizeCapturedAt(
      getSnapshotField(snapshot, 'capturedAt', 'captured_at')
    ),
    received_at: new Date().toISOString(),
    complete: true,
  };
}

function deriveGenreProjection(snapshot) {
  const primary = snapshot?.primary_genres || snapshot?.primaryGenres || [];
  const secondary =
    snapshot?.secondary_genres || snapshot?.secondaryGenres || [];

  if (primary.length >= 2) {
    return { genre_1: primary[0], genre_2: primary[1] };
  }
  if (primary.length === 1) {
    return { genre_1: primary[0], genre_2: secondary[0] || '' };
  }
  return { genre_1: secondary[0] || '', genre_2: secondary[1] || '' };
}

function projectTaxonomyForRead(value) {
  if (Array.isArray(value)) {
    return value.map(projectTaxonomyForRead);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'updated_by')
      .map(([key, nestedValue]) => [key, projectTaxonomyForRead(nestedValue)])
  );
}

module.exports = {
  MAX_TERM_LENGTH,
  MAX_PRIMARY_GENRES,
  MAX_SECONDARY_GENRES,
  MAX_DESCRIPTORS,
  MAX_LANGUAGES,
  MAX_SCENES,
  MAX_MOVEMENTS,
  MAX_LABELS,
  MAX_CREDITS,
  MAX_CREDIT_ROLES,
  MAX_SOURCE_URL_LENGTH,
  MAX_EXTRACTOR_VERSION_LENGTH,
  normalizeTaxonomyText,
  normalizeTaxonomyTerm,
  normalizeRymSnapshot,
  deriveGenreProjection,
  projectTaxonomyForRead,
};
