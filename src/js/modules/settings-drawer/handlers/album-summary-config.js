/**
 * Album summary model configuration.
 *
 * The model and its parameters used to live only in the environment, where a
 * stale host-side compose file could pin an old model with nothing in the UI to
 * reveal it. These controls are the source of truth instead.
 *
 * The effort control follows the selected model's own declared capabilities:
 * several models reject the effort parameter outright, so offering it for them
 * would only produce a request the API refuses.
 */

const CONFIG_URL = '/api/admin/album-summaries/config';
const MODELS_URL = '/api/admin/album-summaries/models';

export function createSummaryConfigActions(deps = {}) {
  const doc =
    deps.doc || (typeof document !== 'undefined' ? document : undefined);
  const { apiCall, showToast, categoryData } = deps;

  let models = [];
  let config = null;

  function el(id) {
    return doc?.getElementById(id) || null;
  }

  function selectedModel() {
    const id = el('summaryModelSelect')?.value;
    return models.find((m) => m.id === id) || null;
  }

  /**
   * Offer only the effort levels the chosen model accepts, and say so when it
   * accepts none. A disabled control with a reason beats a control that looks
   * usable and produces a 400.
   */
  function syncEffortControl() {
    const effortSelect = el('summaryEffortSelect');
    const note = el('summaryEffortNote');
    const model = selectedModel();
    if (!effortSelect) return;

    // Unknown model (list unavailable): leave the control as rendered rather
    // than guessing it away.
    const levels = model ? model.effortLevels || [] : null;

    if (levels && levels.length === 0) {
      effortSelect.disabled = true;
      if (note) {
        note.textContent = `${model.displayName} does not support the effort setting`;
        note.classList.remove('hidden');
      }
      return;
    }

    effortSelect.disabled = false;
    if (note) note.classList.add('hidden');

    if (levels) {
      const current = effortSelect.value;
      effortSelect.innerHTML = levels
        .map(
          (level) =>
            `<option value="${level}"${level === current ? ' selected' : ''}>${level}</option>`
        )
        .join('');
      // The stored level may not exist on this model; fall back to its middle.
      if (!levels.includes(current)) {
        effortSelect.value = levels.includes('medium') ? 'medium' : levels[0];
      }
    }
  }

  function renderModelOptions() {
    const select = el('summaryModelSelect');
    if (!select) return;

    if (models.length === 0) {
      // Keep the configured model visible even when the list cannot be
      // fetched, so the panel still reports what is in force.
      select.innerHTML = `<option value="${config?.model || ''}" selected>${config?.model || 'unavailable'}</option>`;
      return;
    }

    select.innerHTML = models
      .map(
        (m) =>
          `<option value="${m.id}"${m.id === config?.model ? ' selected' : ''}>${m.displayName}</option>`
      )
      .join('');
  }

  function applyConfig() {
    renderModelOptions();

    const effortSelect = el('summaryEffortSelect');
    if (effortSelect && config?.effort) effortSelect.value = config.effort;

    const maxTokens = el('summaryMaxTokensInput');
    if (maxTokens && config?.maxTokens)
      maxTokens.value = String(config.maxTokens);

    const source = el('summaryConfigSource');
    if (source) {
      source.textContent =
        config?.source === 'stored'
          ? 'Saved in the database'
          : 'From environment defaults — save to store it';
    }

    syncEffortControl();
  }

  async function loadSummaryConfig() {
    if (!el('summaryModelSelect')) return;

    try {
      const response = await apiCall(MODELS_URL);
      models = response?.models || [];
      config = response?.config || null;
      if (response?.error) {
        showToast?.(`Could not list models: ${response.error}`, 'error');
      }
      applyConfig();
    } catch (error) {
      showToast?.(error?.message || 'Failed to load summary settings', 'error');
    }
  }

  async function handleSaveSummaryConfig() {
    const button = el('saveSummaryConfigBtn');
    const model = el('summaryModelSelect')?.value;
    const effortSelect = el('summaryEffortSelect');
    const maxTokensRaw = el('summaryMaxTokensInput')?.value;

    if (!model) {
      showToast?.('Choose a model first', 'error');
      return;
    }

    const maxTokens = parseInt(maxTokensRaw || '', 10);
    const chosen = selectedModel();
    if (chosen?.maxOutputTokens && maxTokens > chosen.maxOutputTokens) {
      showToast?.(
        `${chosen.displayName} accepts at most ${chosen.maxOutputTokens} output tokens`,
        'error'
      );
      return;
    }

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Saving...';
      }

      const response = await apiCall(CONFIG_URL, {
        method: 'POST',
        body: JSON.stringify({
          model,
          // Omitted when the model has no effort setting, so nothing
          // unsupported is ever stored against it.
          effort: effortSelect?.disabled ? null : effortSelect?.value,
          maxTokens: Number.isFinite(maxTokens) ? maxTokens : null,
        }),
      });

      config = response?.config || config;
      if (categoryData?.admin) categoryData.admin.summaryConfig = config;
      applyConfig();
      showToast?.('Summary settings saved', 'success');
    } catch (error) {
      showToast?.(error?.message || 'Failed to save summary settings', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Save';
      }
    }
  }

  return {
    loadSummaryConfig,
    handleSaveSummaryConfig,
    syncEffortControl,
  };
}
