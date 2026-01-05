const logger = require('../../../utils/logger');

/**
 * Migration to fix artist names that lost their leading ellipsis
 *
 * When artist names starting with "..." (ellipsis) were added via the browser extension,
 * the leading underscore in RYM URLs was converted to a space, causing the ellipsis to be lost
 * and the name to be incorrectly capitalized (e.g., "...and Oceans" -> "And Oceans").
 *
 * This migration fixes known cases and provides a pattern-based fix for similar cases.
 */

async function up(pool) {
  logger.info('Fixing artist names that lost their leading ellipsis...');

  // Fix known cases: "And Oceans" -> "...and Oceans"
  const knownFixes = [
    { from: 'And Oceans', to: '...and Oceans' },
    // Add more known cases here as they are discovered
  ];

  let totalFixed = 0;

  for (const fix of knownFixes) {
    const result = await pool.query(
      `UPDATE list_items 
       SET artist = $1, updated_at = NOW()
       WHERE artist = $2`,
      [fix.to, fix.from]
    );
    const count = result.rowCount;
    if (count > 0) {
      logger.info(`Fixed ${count} occurrences of "${fix.from}" -> "${fix.to}"`);
      totalFixed += count;
    }
  }

  // Pattern-based fix: Find artist names starting with "And " (capital A)
  // that should likely start with "...and " (ellipsis)
  // This catches cases like "And Oceans", "And You Will Know Us...", etc.
  // We're conservative: only fix if the second word starts with a capital letter
  // and the name doesn't already exist with ellipsis (to avoid duplicates)
  const patternResult = await pool.query(
    `UPDATE list_items 
     SET artist = '...and ' || SUBSTRING(artist FROM 5), updated_at = NOW()
     WHERE artist ~ '^And [A-Z]' 
       AND artist NOT LIKE '...and %'
       AND NOT EXISTS (
         SELECT 1 FROM list_items li2 
         WHERE li2.artist = '...and ' || SUBSTRING(list_items.artist FROM 5)
           AND li2.list_id = list_items.list_id
       )`
  );

  const patternFixed = patternResult.rowCount;
  if (patternFixed > 0) {
    logger.info(
      `Fixed ${patternFixed} artist names using pattern-based matching`
    );
    totalFixed += patternFixed;
  }

  logger.info(`Migration completed: fixed ${totalFixed} artist names total`);
}

async function down(pool) {
  logger.info('Reverting ellipsis artist name fixes...');

  // Revert known fixes
  const knownFixes = [
    { from: '...and Oceans', to: 'And Oceans' },
  ];

  let totalReverted = 0;

  for (const fix of knownFixes) {
    const result = await pool.query(
      `UPDATE list_items 
       SET artist = $1, updated_at = NOW()
       WHERE artist = $2`,
      [fix.to, fix.from]
    );
    const count = result.rowCount;
    if (count > 0) {
      logger.info(`Reverted ${count} occurrences of "${fix.from}" -> "${fix.to}"`);
      totalReverted += count;
    }
  }

  // Revert pattern-based fixes
  const patternResult = await pool.query(
    `UPDATE list_items 
     SET artist = 'And ' || SUBSTRING(artist FROM 8), updated_at = NOW()
     WHERE artist ~ '^\.\.\.and [A-Z]'`
  );

  const patternReverted = patternResult.rowCount;
  if (patternReverted > 0) {
    logger.info(
      `Reverted ${patternReverted} artist names using pattern-based matching`
    );
    totalReverted += patternReverted;
  }

  logger.info(`Reverted: ${totalReverted} artist names total`);
}

module.exports = { up, down };
