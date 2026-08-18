const MAX_LABELS = 64;
const MAX_CREDITS = 256;
const MAX_CREDIT_ROLES = 32;

function normalizeReleaseMetadata(
  snapshot,
  { getSnapshotField, normalizeTaxonomyTerm, normalizeTerms }
) {
  function normalizeOptionalTerm(source, camelName, snakeName, fieldName) {
    const value = getSnapshotField(source, camelName, snakeName);
    if (value === undefined) return undefined;
    const normalized = normalizeTaxonomyTerm(value, fieldName);
    if (!normalized) throw new RangeError(`${fieldName} must not be empty`);
    return normalized;
  }

  function normalizeLabels(values) {
    if (!Array.isArray(values)) {
      throw new TypeError('labels is required and must be an array');
    }
    if (values.length > MAX_LABELS) {
      throw new RangeError(`labels must have at most ${MAX_LABELS} items`);
    }

    const seen = new Set();
    return values.reduce((labels, value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`labels[${index}] must be an object`);
      }
      const name = normalizeTaxonomyTerm(value.name, `labels[${index}].name`);
      if (!name)
        throw new RangeError(`labels[${index}].name must not be empty`);
      const catalogNumber = normalizeOptionalTerm(
        value,
        'catalogNumber',
        'catalog_number',
        `labels[${index}].catalogNumber`
      );
      const key = `${name.toLowerCase()}|${catalogNumber?.toLowerCase() || ''}`;
      if (seen.has(key)) return labels;
      seen.add(key);
      labels.push({
        name,
        ...(catalogNumber === undefined
          ? {}
          : { catalog_number: catalogNumber }),
      });
      return labels;
    }, []);
  }

  function normalizeCredits(values) {
    if (!Array.isArray(values)) {
      throw new TypeError('credits is required and must be an array');
    }
    if (values.length > MAX_CREDITS) {
      throw new RangeError(`credits must have at most ${MAX_CREDITS} items`);
    }

    const creditsByName = new Map();
    values.forEach((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`credits[${index}] must be an object`);
      }
      const name = normalizeTaxonomyTerm(value.name, `credits[${index}].name`);
      if (!name)
        throw new RangeError(`credits[${index}].name must not be empty`);
      const roles = normalizeTerms(
        value.roles,
        `credits[${index}].roles`,
        MAX_CREDIT_ROLES
      );
      const key = name.toLowerCase();
      const current = creditsByName.get(key);
      if (!current) {
        creditsByName.set(key, { name, roles });
        return;
      }
      current.roles = normalizeTerms(
        [...current.roles, ...roles],
        `credits[${index}].roles`,
        MAX_CREDIT_ROLES
      );
    });
    return [...creditsByName.values()];
  }

  const releaseType = normalizeOptionalTerm(
    snapshot,
    'releaseType',
    'release_type',
    'releaseType'
  );
  const labels = getSnapshotField(snapshot, 'labels', 'labels');
  const credits = getSnapshotField(snapshot, 'credits', 'credits');

  return {
    ...(releaseType === undefined ? {} : { release_type: releaseType }),
    ...(labels === undefined ? {} : { labels: normalizeLabels(labels) }),
    ...(credits === undefined ? {} : { credits: normalizeCredits(credits) }),
  };
}

module.exports = {
  MAX_LABELS,
  MAX_CREDITS,
  MAX_CREDIT_ROLES,
  normalizeReleaseMetadata,
};
