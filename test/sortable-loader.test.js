const { test } = require('node:test');
const assert = require('node:assert/strict');

test('SortableJS loads a stable version once and reuses its constructor', async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const scripts = [];
  global.window = {};
  global.document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild: (script) => scripts.push(script) },
  };
  try {
    const { loadSortable } =
      await import('../src/js/modules/sortable-loader.js');
    const pending = loadSortable();
    assert.equal(loadSortable(), pending);
    assert.equal(scripts.length, 1);
    assert.match(
      scripts[0].src,
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/sortablejs@\d+\.\d+\.\d+\/Sortable\.min\.js$/
    );
    const constructor = () => {};
    global.window.Sortable = constructor;
    scripts[0].onload();
    assert.equal(await pending, constructor);
    assert.equal(await loadSortable(), constructor);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});
