// utils/personal-recommendations-engine.js
// Claude API integration for ranking/selecting albums from the weekly pool

const logger = require('./logger');
const { createClaudeClient } = require('./claude-client');
const { buildPrompt } = require('./personal-recommendations-prompts');

/**
 * Create a recommendation engine with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.claudeClient - Shared claude-client instance
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.env - Environment variables
 * @param {Function} deps.normalizeAlbumKey - Album key normalization function
 */
function createRecommendationEngine(deps = {}) {
  const log = deps.logger || logger;
  const env = deps.env || process.env;
  const claudeClient = deps.claudeClient || createClaudeClient({ logger: log });
  const normalizeAlbumKey =
    deps.normalizeAlbumKey || require('./fuzzy-match').normalizeAlbumKey;

  /**
   * Parse Claude's recommendation response text into structured data
   * Handles both raw JSON and markdown-wrapped JSON (```json ... ```)
   * @param {string} responseText - Raw text from Claude response
   * @returns {Array<{artist: string, album: string, reasoning: string}>} Parsed recommendations
   */
  function parseClaudeRecommendations(responseText) {
    if (!responseText || typeof responseText !== 'string') {
      throw new Error('Empty or invalid response text');
    }

    let jsonText = responseText.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    // Try to extract array if there's text before/after
    if (!jsonText.startsWith('[')) {
      const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonText = arrayMatch[0];
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(
        `Failed to parse recommendations JSON: ${err.message}. Response: ${responseText.substring(0, 200)}`,
        { cause: err }
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Expected JSON array, got ${typeof parsed}: ${JSON.stringify(parsed).substring(0, 200)}`
      );
    }

    // Validate each recommendation object
    const valid = [];
    for (const item of parsed) {
      if (!item.artist || !item.album) {
        log.warn('Skipping recommendation with missing fields', {
          item: JSON.stringify(item).substring(0, 200),
        });
        continue;
      }
      valid.push({
        artist: String(item.artist).trim(),
        album: String(item.album).trim(),
        reasoning: item.reasoning ? String(item.reasoning).trim() : '',
      });
    }

    return valid;
  }

  /**
   * Generate personal album recommendations for a user
   * @param {Object} options - Generation options
   * @param {Array} options.newReleases - Pool of new releases for the week
   * @param {Array} options.genreAffinity - User's genre affinity data
   * @param {Array} options.artistAffinity - User's artist affinity data
   * @param {Array} options.countryAffinity - User's country affinity data
   * @param {Set|Array} options.userAlbumKeys - User's owned album keys for exclusion
   * @param {string} options.customPrompt - User's custom prompt text
   * @param {number} options.count - Number of albums to recommend (default from env)
   * @returns {Promise<{recommendations: Array, inputTokens: number, outputTokens: number, promptSnapshot: string}|null>}
   */
  async function generateRecommendations(options = {}) {
    const count = options.count || parseInt(env.PERSONAL_RECS_COUNT || '7', 10);
    const model = env.PERSONAL_RECS_MODEL || 'claude-haiku-4-5';
    const maxTokens = parseInt(env.PERSONAL_RECS_MAX_TOKENS || '1500', 10);

    if (!options.newReleases || options.newReleases.length === 0) {
      log.warn('No new releases available for recommendation generation');
      return null;
    }

    // Build the prompt
    const { systemPrompt, userPrompt } = buildPrompt({
      ...options,
      count,
    });

    // Call Claude API (no web search needed - just ranking from known pool)
    const response = await claudeClient.callClaude({
      model,
      maxTokens,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      metricsLabel: 'personal_recommendations',
    });

    if (!response) {
      log.error('Claude API returned null response for recommendations');
      return null;
    }

    // Extract text from response
    const responseText = claudeClient.extractTextFromContent(response.content);
    if (!responseText) {
      log.error('Claude API returned no text content for recommendations', {
        contentTypes: response.content?.map((c) => c.type),
      });
      return null;
    }

    // Parse recommendations
    const recommendations = parseClaudeRecommendations(responseText);

    // Post-processing: deduplicate
    const seenKeys = new Set();
    const deduped = [];
    for (const rec of recommendations) {
      const key = normalizeAlbumKey(rec.artist, rec.album);
      if (seenKeys.has(key)) {
        log.debug('Filtered duplicate recommendation', {
          artist: rec.artist,
          album: rec.album,
        });
        continue;
      }
      seenKeys.add(key);
      deduped.push(rec);
    }

    // Post-processing: filter out albums user already owns
    const userKeys = options.userAlbumKeys || [];
    const userKeySet = userKeys instanceof Set ? userKeys : new Set(userKeys);
    const filtered = deduped.filter((rec) => {
      const key = normalizeAlbumKey(rec.artist, rec.album);
      if (userKeySet.has(key)) {
        log.debug('Filtered owned album from recommendations', {
          artist: rec.artist,
          album: rec.album,
        });
        return false;
      }
      return true;
    });

    // Cap at requested count
    const final = filtered.slice(0, count);

    log.info('Generated personal recommendations', {
      requested: count,
      claudeReturned: recommendations.length,
      afterDedup: deduped.length,
      afterFilter: filtered.length,
      final: final.length,
      model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    });

    return {
      recommendations: final,
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      promptSnapshot: userPrompt.substring(0, 2000),
    };
  }

  return {
    generateRecommendations,
    parseClaudeRecommendations,
  };
}

// Default instance
const defaultInstance = createRecommendationEngine();

module.exports = {
  createRecommendationEngine,
  generateRecommendations: defaultInstance.generateRecommendations,
  parseClaudeRecommendations: defaultInstance.parseClaudeRecommendations,
};
