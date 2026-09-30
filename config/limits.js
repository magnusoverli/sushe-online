/** @param {string | number | undefined} value @param {number} fallback @param {string} name @param {number} [maximum] */
function positiveInteger(
  value,
  fallback,
  name,
  maximum = Number.MAX_SAFE_INTEGER
) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  )
    throw new Error(
      `${name} must be a positive integer no greater than ${maximum}`
    );
  return parsed;
}
module.exports = { positiveInteger };
