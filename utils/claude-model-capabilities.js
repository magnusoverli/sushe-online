// utils/claude-model-capabilities.js
// What a given Claude model will and will not accept.

/**
 * How long a model's capabilities are trusted. Capabilities change only when
 * Anthropic ships a model, so this is about picking up new models without a
 * redeploy rather than about staleness.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Generation at which the newer web_search tool versions become available. */
const DYNAMIC_FILTERING_MIN_GENERATION = 4.6;

/** Model families in the id scheme. */
const FAMILIES = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'];

/** How long to stop asking after the models endpoint fails. */
const UNAVAILABLE_BACKOFF_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;
let unavailableUntil = 0;

/**
 * Parse a model id into family and generation.
 *
 * Handles the shapes ids actually come in: bare (`claude-sonnet-5`), dated
 * (`claude-sonnet-4-5-20250929`), and the cloud-provider decorations
 * (`anthropic.claude-...-v1:0`, `claude-...@20250929`).
 *
 * @param {string} id
 * @returns {{family: string|null, generation: number|null}}
 */
function parseModelId(id) {
  const normalized = String(id || '')
    .replace(/^anthropic\./, '')
    .replace(/-v\d+:\d+$/, '')
    .replace(/[@-]\d{8}$/, '');

  // Split rather than match: the shape is fixed and a linear scan cannot
  // backtrack, which a regex over an alternation plus optional groups can.
  const [prefix, family, major, minor] = normalized.split('-');
  if (prefix !== 'claude') return { family: null, generation: null };
  if (!FAMILIES.includes(family)) return { family: null, generation: null };

  const majorNum = Number(major);
  if (!Number.isInteger(majorNum)) return { family, generation: null };

  const minorNum = Number(minor);
  const hasMinor = minor !== undefined && Number.isInteger(minorNum);

  return {
    family,
    generation: majorNum + (hasMinor ? minorNum / 10 : 0),
  };
}

/**
 * Which web_search tool version this model can use.
 *
 * The versions are capability-keyed rather than model-keyed — all three remain
 * current — but dynamic filtering needs Claude 4.6 or later, so an older model
 * has to be given the basic tool. Sending it the newer one is how choosing an
 * older model from a dropdown would fail on the search tool after we had
 * carefully made the effort parameter conditional.
 *
 * @param {string} modelId
 * @returns {string}
 */
function webSearchToolVersion(modelId) {
  const { family, generation } = parseModelId(modelId);
  if (family === 'fable' || family === 'mythos') return 'web_search_20260318';
  if (generation != null && generation >= DYNAMIC_FILTERING_MIN_GENERATION) {
    return 'web_search_20260318';
  }
  // Unknown ids get the basic tool: it is accepted everywhere, so an
  // unrecognised model degrades rather than erroring.
  return 'web_search_20250305';
}

/**
 * The web_search tool declaration for a given model.
 *
 * `response_inclusion` exists only on web_search_20260318. Sending it alongside
 * the basic tool an older model requires would be a 400 — the same class of
 * failure as sending `effort` to a model that has none, so the option travels
 * with the version rather than being set unconditionally.
 *
 * @param {string} modelId
 * @param {{webSearchToolVersion?: string}|null} [capabilities]
 * @param {number} [maxUses]
 */
function buildWebSearchTool(modelId, capabilities, maxUses = 3) {
  const type =
    capabilities?.webSearchToolVersion || webSearchToolVersion(modelId);

  const tool = { type, name: 'web_search', max_uses: maxUses };

  if (type === 'web_search_20260318') {
    // Nothing is echoed back on a later turn, so search blocks already consumed
    // by a completed filter run are dead weight.
    tool.response_inclusion = 'excluded';
  }

  return tool;
}

/**
 * Fetch the model list, with capabilities, from the API.
 *
 * @param {Object} anthropic - An Anthropic SDK client.
 * @returns {Promise<Array<Object>>}
 */
async function listModels(anthropic) {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  const models = [];
  for await (const model of anthropic.models.list({ limit: 100 })) {
    models.push(model);
  }

  cache = models;
  cachedAt = Date.now();
  return models;
}

/**
 * Describe one model in the terms this app needs.
 *
 * `capabilities` is nullable on the wire, and so are several of its leaves, so
 * every read here is guarded. An unknown or uncapability-reporting model is
 * described as not supporting effort — the safe direction, since sending an
 * unsupported effort is a hard 400 while omitting a supported one merely uses
 * the model's default.
 *
 * @param {Object} model - A ModelInfo from the API.
 */
function describeModel(model) {
  const caps = model?.capabilities ?? null;
  const effort = caps?.effort ?? null;

  const effortLevels = ['low', 'medium', 'high', 'xhigh', 'max'].filter(
    (level) => effort?.[level]?.supported === true
  );

  return {
    id: model.id,
    displayName: model.display_name || model.id,
    // max_tokens is the OUTPUT ceiling; max_input_tokens is the context window.
    maxOutputTokens: model.max_tokens ?? null,
    maxInputTokens: model.max_input_tokens ?? null,
    supportsEffort: effort?.supported === true && effortLevels.length > 0,
    effortLevels,
    thinksByDefault: caps?.thinking?.types?.adaptive?.supported === true,
    webSearchToolVersion: webSearchToolVersion(model.id),
  };
}

/**
 * Capabilities for one model id, or null when it cannot be determined.
 *
 * Never throws: a failure to reach the models endpoint must not stop a summary
 * being generated, so callers treat null as "assume the conservative shape".
 *
 * @param {Object} anthropic
 * @param {string} modelId
 * @param {{warn: Function}} [log]
 */
async function getModelCapabilities(anthropic, modelId, log) {
  if (Date.now() < unavailableUntil) return null;

  try {
    const models = await listModels(anthropic);
    const model = models.find((m) => m.id === modelId);
    return model ? describeModel(model) : null;
  } catch (err) {
    // Remember the failure briefly. Without this, an unreachable models
    // endpoint costs a request and a log line on every single summary, and the
    // real fault drowns in the repetition.
    unavailableUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
    log?.warn?.('Could not read model capabilities', {
      modelId,
      error: err.message,
      retryAfterMs: UNAVAILABLE_BACKOFF_MS,
    });
    return null;
  }
}

/** Drop the cached model list (used by tests and after a config change). */
function resetModelCache() {
  cache = null;
  cachedAt = 0;
  unavailableUntil = 0;
}

module.exports = {
  buildWebSearchTool,
  listModels,
  describeModel,
  getModelCapabilities,
  webSearchToolVersion,
  parseModelId,
  resetModelCache,
};
