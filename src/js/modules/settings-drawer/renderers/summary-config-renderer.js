/**
 * Album summary model controls.
 *
 * Kept out of admin-renderer.js deliberately: that file is within ~20 lines of
 * the CI file-size ceiling, and this block would not fit.
 *
 * Rendered empty and populated after the model list arrives, so the panel never
 * shows a hardcoded model list that could disagree with the API.
 */
export function renderSummaryConfig() {
  return `
    <div class="settings-row">
      <div class="settings-row-label">
        <label class="settings-label" for="summaryModelSelect">Summary Model</label>
        <p class="settings-description">
          Model used to write album summaries.
          <span id="summaryConfigSource" class="text-gray-500"></span>
        </p>
      </div>
      <div class="settings-row-control">
        <select id="summaryModelSelect" class="settings-select">
          <option value="">Loading...</option>
        </select>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row-label">
        <label class="settings-label" for="summaryEffortSelect">Effort</label>
        <p class="settings-description">
          Higher effort reasons longer and reaches for web search more readily.
          <span id="summaryEffortNote" class="hidden text-yellow-500"></span>
        </p>
      </div>
      <div class="settings-row-control">
        <select id="summaryEffortSelect" class="settings-select">
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="xhigh">xhigh</option>
          <option value="max">max</option>
        </select>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row-label">
        <label class="settings-label" for="summaryMaxTokensInput">Max Tokens</label>
        <p class="settings-description">Response budget. On thinking models this is shared with the reasoning, so leave room for both.</p>
      </div>
      <div class="settings-row-control flex gap-2">
        <input id="summaryMaxTokensInput" type="number" min="256" step="256"
               class="settings-input w-28" value="4096">
        <button id="saveSummaryConfigBtn" class="settings-button">Save</button>
      </div>
    </div>
  `;
}
