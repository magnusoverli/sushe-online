// utils/personal-recommendations-prompts.js
// Prompt templates and builder for personal album recommendations

const DEFAULT_SYSTEM_PROMPT = `You are a music recommendation expert. Given a pool of newly released albums and a user's musical taste profile, select the albums that best match this user's preferences. Return ONLY valid JSON.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `From the following pool of albums released this week, select {count} albums that best match this user's musical taste.

## New Releases Pool
{newReleases}

## User's Musical Taste Profile

### Genre Affinity (top genres by preference score)
{genreAffinity}

### Artist Affinity (favorite artists by preference score)
{artistAffinity}

### Country Affinity (preferred countries of origin)
{countryAffinity}

{customPromptSection}

## Exclusion List
The user already owns these albums. Do NOT recommend any of them:
{exclusionList}

## Instructions
1. Select exactly {count} albums from the pool above that best match this user's taste profile
2. Do NOT recommend albums the user already owns (see exclusion list)
3. Prioritize albums from genres and artists similar to the user's preferences
4. Provide a brief reasoning for each recommendation
5. Return ONLY a JSON array with no additional text or markdown

Return format:
[
  {{
    "artist": "Artist Name",
    "album": "Album Title",
    "reasoning": "Brief explanation of why this matches the user's taste"
  }}
]`;

/**
 * Format an affinity array into readable prompt text
 * @param {Array<{name: string, score: number}>} affinityArray - Affinity data
 * @param {number} limit - Maximum entries to include
 * @returns {string} Formatted affinity text
 */
function formatAffinityForPrompt(affinityArray, limit = 15) {
  if (!affinityArray || affinityArray.length === 0) {
    return 'No data available';
  }

  return affinityArray
    .slice(0, limit)
    .map((item, i) => `${i + 1}. ${item.name} (score: ${item.score})`)
    .join('\n');
}

/**
 * Format new releases pool into a numbered list for the prompt
 * @param {Array<Object>} releases - New release objects
 * @returns {string} Formatted releases text
 */
function formatNewReleasesForPrompt(releases) {
  if (!releases || releases.length === 0) {
    return 'No new releases available';
  }

  return releases
    .map((r, i) => {
      const parts = [`${i + 1}. ${r.artist} - ${r.album}`];
      if (r.genre) parts.push(`Genre: ${r.genre}`);
      if (r.release_date) parts.push(`Released: ${r.release_date}`);
      if (r.source) parts.push(`Source: ${r.source}`);
      if (r.verified) parts.push('(verified)');
      return parts.join(' | ');
    })
    .join('\n');
}

/**
 * Build the complete prompt for personal recommendations
 * @param {Object} options - Prompt building options
 * @param {Array} options.newReleases - New releases pool
 * @param {Array} options.genreAffinity - User's genre affinity data [{name, score}]
 * @param {Array} options.artistAffinity - User's artist affinity data [{name, score}]
 * @param {Array} options.countryAffinity - User's country affinity data [{name, score}]
 * @param {Set|Array} options.userAlbumKeys - User's owned album keys for exclusion
 * @param {string} options.customPrompt - User's custom prompt text
 * @param {number} options.count - Number of albums to recommend (default 7)
 * @returns {{systemPrompt: string, userPrompt: string}} Built prompts
 */
function buildPrompt(options = {}) {
  const {
    newReleases = [],
    genreAffinity = [],
    artistAffinity = [],
    countryAffinity = [],
    userAlbumKeys = [],
    customPrompt = '',
    count = 7,
  } = options;

  const systemPrompt = DEFAULT_SYSTEM_PROMPT;

  // Format the custom prompt section
  const customPromptSection = customPrompt
    ? `## PERSONAL PREFERENCES\nThe user has specified these additional preferences:\n${customPrompt}`
    : '';

  // Format exclusion list (truncate to ~200 entries to stay within token limits)
  const albumKeys = Array.isArray(userAlbumKeys)
    ? userAlbumKeys
    : Array.from(userAlbumKeys);
  const truncatedExclusions = albumKeys.slice(0, 200);
  const exclusionText =
    truncatedExclusions.length > 0
      ? truncatedExclusions.join('\n')
      : 'None (new user)';
  const truncationNote =
    albumKeys.length > 200
      ? `\n(... and ${albumKeys.length - 200} more albums not shown)`
      : '';

  // Build the user prompt from template
  const userPrompt = DEFAULT_USER_PROMPT_TEMPLATE.replace(
    /\{count\}/g,
    String(count)
  )
    .replace('{newReleases}', formatNewReleasesForPrompt(newReleases))
    .replace('{genreAffinity}', formatAffinityForPrompt(genreAffinity, 15))
    .replace('{artistAffinity}', formatAffinityForPrompt(artistAffinity, 20))
    .replace('{countryAffinity}', formatAffinityForPrompt(countryAffinity, 10))
    .replace('{customPromptSection}', customPromptSection)
    .replace('{exclusionList}', exclusionText + truncationNote);

  return { systemPrompt, userPrompt };
}

module.exports = {
  buildPrompt,
  formatAffinityForPrompt,
  formatNewReleasesForPrompt,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_USER_PROMPT_TEMPLATE,
};
