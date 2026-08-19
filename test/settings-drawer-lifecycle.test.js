const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('settings drawer lifecycle', () => {
  it('removes the closed drawer from rendering after its transition', async () => {
    const originalDocument = global.document;
    const originalWindow = global.window;
    const classes = new Set();
    const attributes = new Map();
    const timers = new Map();
    let nextTimer = 1;
    let layoutReads = 0;

    const drawer = {
      hidden: true,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getBoundingClientRect: () => {
        layoutReads += 1;
        return {};
      },
    };

    global.document = {
      body: { style: {} },
      getElementById: (id) => (id === 'settingsDrawer' ? drawer : null),
    };
    global.window = { currentUser: { role: 'user' } };

    try {
      const { createSettingsDrawer } =
        await import('../src/js/modules/settings-drawer.js');
      const settingsDrawer = createSettingsDrawer({
        setTimeout: (callback) => {
          const id = nextTimer++;
          timers.set(id, callback);
          return id;
        },
        clearTimeout: (id) => timers.delete(id),
      });

      settingsDrawer.openDrawer();

      assert.strictEqual(drawer.hidden, false);
      assert.strictEqual(attributes.get('aria-hidden'), 'false');
      assert.ok(classes.has('open'));
      assert.strictEqual(layoutReads, 1);

      settingsDrawer.closeDrawer();

      assert.strictEqual(drawer.hidden, false);
      assert.strictEqual(attributes.get('aria-hidden'), 'true');
      assert.ok(!classes.has('open'));
      assert.strictEqual(timers.size, 1);

      timers.values().next().value();
      assert.strictEqual(drawer.hidden, true);
    } finally {
      global.document = originalDocument;
      global.window = originalWindow;
    }
  });
});
