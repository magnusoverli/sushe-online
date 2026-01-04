// utils/claude-summary.js
// Album summary fetching from Claude API with web search

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');
const { observeExternalApiCall, recordExternalApiError } = require('./metrics');

// Summary source constant
const SUMMARY_SOURCE = 'claude';

// Rate limiter: 1 request per second (conservative for Claude API)
const RATE_LIMIT_MS = parseInt(process.env.CLAUDE_RATE_LIMIT_MS || '1000', 10);
let lastRequestTime = 0;

/**
 * Wait for rate limit
 */
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await new Promise((r) =>
      setTimeout(r, RATE_LIMIT_MS - timeSinceLastRequest)
    );
  }
  lastRequestTime = Date.now();
}

/**
 * Create Claude summary service with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.logger - Logger instance
 * @param {Object} deps.anthropicClient - Anthropic client instance (for testing)
 */
function createClaudeSummaryService(deps = {}) {
  const log = deps.logger || logger;

  // Lazy-initialized client - created on first use, not at module load time
  // This ensures environment variables are available in Docker containers
  let anthropicClient = deps.anthropicClient || null;

  function getClient() {
    if (anthropicClient) return anthropicClient;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return null;
    }

    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  }

  /**
   * Fetch album summary from Claude API with web search
   * @param {string} artist - Artist name
   * @param {string} album - Album name
   * @returns {Promise<{summary: string|null, source: string, found: boolean}>}
   */
  async function fetchClaudeSummary(artist, album) {
    if (!artist || !album) {
      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }

    const anthropic = getClient();
    if (!anthropic) {
      log.error('Claude API client not available (missing API key)');
      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }

    // Read config at call time, not module load time
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
    const maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '1024', 10);

    const startTime = Date.now();

    try {
      await waitForRateLimit();

      const prompt = `Write a 4-6 sentence description/summary of the album "${album}" by ${artist}. Search online for current information about this album, including its release date, genre, critical reception, and notable tracks or themes. Write in a clear, informative style suitable for music fans. The summary must be at least 2 sentences long, and should include some insight into both the album and the artist. For example the albums number in the artists discography or what makes this album stand out from the rest of the dsicography or if there is anything specal/nerdy/dogmatic about this release. Do a proper online search to gather the info needed about the album.`;

      log.debug('Calling Claude API for album summary', {
        artist,
        album,
        model,
      });

      const message = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5,
          },
        ],
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const duration = Date.now() - startTime;

      // Extract text content from Claude's response
      // Concatenate all text blocks (in case there are multiple)
      let summary = null;
      if (message.content && Array.isArray(message.content)) {
        const textBlocks = message.content.filter(
          (block) => block.type === 'text'
        );
        if (textBlocks.length > 0) {
          // Join all text blocks with spaces
          summary = textBlocks
            .map((block) => block.text)
            .join(' ')
            .trim();
        }
      }

      if (summary) {
        // Validate summary meets requirements (at least 2 sentences, 4-6 preferred)
        const sentenceCount = (summary.match(/[.!?]+/g) || []).length;
        if (summary.length < 100) {
          log.warn('Claude returned very short summary', {
            artist,
            album,
            summaryLength: summary.length,
            sentenceCount,
          });
          // Still use it, but log warning
        } else if (sentenceCount < 2) {
          log.warn('Claude returned summary with fewer than 2 sentences', {
            artist,
            album,
            summaryLength: summary.length,
            sentenceCount,
          });
          // Still use it, but log warning
        }

        log.info('Claude API returned album summary', {
          artist,
          album,
          summaryLength: summary.length,
          duration_ms: duration,
        });

        observeExternalApiCall('claude', 'messages.create', duration, 200);
        return {
          summary,
          source: SUMMARY_SOURCE,
          found: true,
        };
      } else {
        log.warn('Claude API returned no text content', {
          artist,
          album,
          content: message.content,
          contentTypes: message.content?.map((c) => c.type),
          usage: message.usage,
        });
        observeExternalApiCall('claude', 'messages.create', duration, 200);
        return { summary: null, source: SUMMARY_SOURCE, found: false };
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      recordExternalApiError('claude', 'api_error');

      // Handle different error types
      if (err.status === 429) {
        log.warn('Claude API rate limit exceeded', {
          artist,
          album,
          error: err.message,
          status: err.status,
          retryAfter: err.headers?.['retry-after'] || err.retryAfter,
        });
        observeExternalApiCall('claude', 'messages.create', duration, 429);
      } else if (err.status >= 500) {
        log.error('Claude API server error', {
          artist,
          album,
          status: err.status,
          error: err.message,
          stack: err.stack,
          type: err.type,
        });
        observeExternalApiCall(
          'claude',
          'messages.create',
          duration,
          err.status || 500
        );
      } else if (err.status === 401 || err.status === 403) {
        log.error('Claude API authentication error', {
          artist,
          album,
          status: err.status,
          error: err.message,
          type: err.type,
        });
        observeExternalApiCall(
          'claude',
          'messages.create',
          duration,
          err.status || 401
        );
      } else {
        log.error('Claude API error', {
          artist,
          album,
          status: err.status,
          error: err.message,
          stack: err.stack,
          type: err.type,
          cause: err.cause?.message,
        });
        observeExternalApiCall(
          'claude',
          'messages.create',
          duration,
          err.status || 400
        );
      }

      return { summary: null, source: SUMMARY_SOURCE, found: false };
    }
  }

  return {
    fetchClaudeSummary,
    SUMMARY_SOURCE,
  };
}

// Default instance
const defaultInstance = createClaudeSummaryService();

module.exports = {
  createClaudeSummaryService,
  fetchClaudeSummary: defaultInstance.fetchClaudeSummary,
  SUMMARY_SOURCE,
};
