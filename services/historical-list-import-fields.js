const { validateOptionalString } = require('../utils/validators');

const LOCAL_FIELDS = /** @type {Array<[string, number]>} */ ([
  ['comments', 10000],
  ['comments_2', 10000],
  ['primary_track', 1000],
  ['secondary_track', 1000],
]);

function normalizeLocalFields(item, label, errors) {
  const fields = {};
  for (const [field, maxLength] of LOCAL_FIELDS) {
    const result = validateOptionalString(item[field], `${label} ${field}`, {
      maxLength,
    });
    if (!result.valid) errors.push(result.error);
    fields[field] = result.valid ? result.value : null;
  }
  if (fields.primary_track && fields.primary_track === fields.secondary_track) {
    errors.push(`${label} primary and secondary tracks must differ`);
  }
  return fields;
}

function normalizeDisqualification(item, label, errors) {
  if (
    Object.hasOwn(item, 'is_disqualified') &&
    typeof item.is_disqualified !== 'boolean'
  ) {
    errors.push(`${label} is_disqualified must be a boolean`);
  }
  const isDisqualified = item.is_disqualified === true;
  const reasonResult = validateOptionalString(
    item.disqualification_reason,
    `${label} disqualification_reason`,
    { maxLength: 1000 }
  );
  if (!reasonResult.valid) errors.push(reasonResult.error);
  if (!isDisqualified && reasonResult.value) {
    errors.push(
      `${label} disqualification_reason requires is_disqualified to be true`
    );
  }
  return {
    is_disqualified: isDisqualified,
    disqualification_reason:
      isDisqualified && reasonResult.valid ? reasonResult.value : null,
  };
}

function isValidPartialIsoDate(value) {
  const parts = value.split('-');
  if (parts.length < 1 || parts.length > 3) return false;
  if (parts[0].length !== 4 || !Number.isInteger(Number(parts[0]))) {
    return false;
  }
  if (parts.length >= 2) {
    const month = Number(parts[1]);
    if (parts[1].length !== 2 || month < 1 || month > 12) return false;
  }
  if (parts.length === 3) {
    const day = Number(parts[2]);
    if (parts[2].length !== 2 || day < 1 || day > 31) return false;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.getUTCDate() !== day) return false;
  }
  return true;
}

function normalizeCanonicalMetadata(item, label, errors) {
  const releaseDate = validateOptionalString(
    item.release_date,
    `${label} release_date`,
    { maxLength: 10 }
  );
  if (!releaseDate.valid) errors.push(releaseDate.error);
  if (releaseDate.value && !isValidPartialIsoDate(releaseDate.value)) {
    errors.push(`${label} release_date must use YYYY, YYYY-MM, or YYYY-MM-DD`);
  }
  const genre1 = validateOptionalString(item.genre_1, `${label} genre_1`, {
    maxLength: 200,
  });
  const genre2 = validateOptionalString(item.genre_2, `${label} genre_2`, {
    maxLength: 200,
  });
  const country = validateOptionalString(item.country, `${label} country`, {
    maxLength: 200,
  });
  if (!genre1.valid) errors.push(genre1.error);
  if (!genre2.valid) errors.push(genre2.error);
  if (!country.valid) errors.push(country.error);
  return {
    release_date: releaseDate.valid ? releaseDate.value : null,
    country: country.valid ? country.value : null,
    genre_1: genre1.valid ? genre1.value : null,
    genre_2: genre2.valid ? genre2.value : null,
  };
}

module.exports = {
  normalizeLocalFields,
  normalizeDisqualification,
  normalizeCanonicalMetadata,
};
