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
    
    // Configurable summary length preferences
    const targetSentences = parseInt(process.env.CLAUDE_SUMMARY_SENTENCES || '4', 10);
    const targetMaxChars = parseInt(process.env.CLAUDE_SUMMARY_MAX_CHARS || '0', 10); // 0 = no limit

    const startTime = Date.now();

    try {
      await waitForRateLimit();

      // Build prompt with configurable length guidance
      let lengthGuidance = '';
      if (targetMaxChars > 0) {
        lengthGuidance = ` CRITICAL REQUIREMENT: Your response must be under ${targetMaxChars} characters total (including spaces and punctuation). Count characters as you write and stop before reaching ${targetMaxChars}. Be concise and focused - prioritize key information only.`;
      } else if (targetSentences > 0) {
        lengthGuidance = ` Write exactly ${targetSentences} sentences.`;
      }
      
      const prompt = `Write a ${targetSentences > 0 ? `${targetSentences}-sentence` : 'concise'} summary of the album "${album}" by ${artist}.${lengthGuidance} Search online for current information. Include the release date, genre, and what makes this album notable in the artist's discography. Write in a clear, informative style suitable for music fans. Do a proper online search to gather accurate information.`;

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
          
          // Debug logging for short summaries
          if (summary.length < 100) {
            log.debug('Short summary detected - checking text blocks', {
              artist,
              album,
              textBlockCount: textBlocks.length,
              textBlockLengths: textBlocks.map((b) => b.text?.length || 0),
              totalLength: summary.length,
            });
          }
        }
      }

      if (summary) {
        // Validate summary meets requirements (configurable via env vars)
        // Note: We rely on Claude to respect the prompt limits - no truncation is performed
        const sentenceCount = (summary.match(/[.!?]+/g) || []).length;
        const minChars = parseInt(process.env.CLAUDE_SUMMARY_MIN_CHARS || '100', 10);
        const maxChars = parseInt(process.env.CLAUDE_SUMMARY_MAX_CHARS || '0', 10);
        const minSentences = parseInt(process.env.CLAUDE_SUMMARY_MIN_SENTENCES || '2', 10);
        
        if (summary.length < minChars) {
          log.warn('Claude returned summary shorter than configured minimum', {
            artist,
            album,
            summaryLength: summary.length,
            minChars,
            sentenceCount,
          });
          // Still use it, but log warning
        } else if (maxChars > 0 && summary.length > maxChars) {
          log.warn('Claude returned summary longer than configured maximum', {
            artist,
            album,
            summaryLength: summary.length,
            maxChars,
            sentenceCount,
          });
          // Still use it, but log warning - Claude should respect the prompt limit
        } else if (sentenceCount < minSentences) {
          log.warn('Claude returned summary with fewer than configured minimum sentences', {
            artist,
            album,
            summaryLength: summary.length,
            minSentences,
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
