const { test } = require('node:test');
const assert = require('node:assert/strict');

test('transfer display shows measured percentages and becomes indeterminate without a valid total', async () => {
  const { createTransferProgress } =
    await import('../src/js/modules/transfer-progress.js');
  const bar = {
    removeAttribute(name) {
      delete this[name];
    },
  };
  const text = {};
  const progress = createTransferProgress({
    bar,
    text,
    action: 'Uploading backup',
  });
  progress.update({ loaded: 1024 * 1024, total: 4 * 1024 * 1024 });
  assert.equal(bar.value, 25);
  assert.equal(text.textContent, 'Uploading backup... 25% (1.0 MiB / 4.0 MiB)');
  for (const total of [0, NaN, 1]) {
    progress.update({ loaded: 1024 * 1024, total });
    assert.equal(bar.value, undefined);
    assert.equal(text.textContent, 'Uploading backup... 1.0 MiB');
  }
  progress.complete('Upload sent—waiting for server confirmation...');
  assert.equal(bar.value, 100);
  progress.waiting('Preparing backup...');
  assert.equal(bar.value, undefined);
});
