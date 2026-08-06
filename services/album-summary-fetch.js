// services/album-summary-fetch.js
// The Claude-facing half of producing one album summary.

const { fetchClaudeSummary } = require('../utils/claude-summary');

// Summary sources
const SUMMARY_SOURCES = {
  CLAUDE: 'claude',
};

/**
 * Fetch album summary from Claude API
 *
 * @param {string} artist - Artist name
 * @param {string} album - Album name
 * @returns {Promise<{summary: string|null, source: string|null, found: boolean,
 *   reason?: string, reasonDetail?: string}>}
 */
async function fetchAlbumSummary(artist, album, overrides, onProgress) {
  if (!artist || !album) {
    return {
      summary: null,
      source: null,
      found: false,
    };
  }

  // Use Claude API as the sole source
  const claudeResult = await fetchClaudeSummary(
    artist,
    album,
    overrides,
    onProgress
  );

  if (claudeResult.summary) {
    return {
      summary: claudeResult.summary,
      source: SUMMARY_SOURCES.CLAUDE,
      found: true,
    };
  }

  // The reason matters: a service that was never reachable must not be
  // reported as an album nobody has written about.
  return {
    summary: null,
    source: null,
    found: false,
    reason: claudeResult.reason || 'no_results',
    reasonDetail: claudeResult.reasonDetail,
  };
}

module.exports = { fetchAlbumSummary, SUMMARY_SOURCES };
