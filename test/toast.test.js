/**
 * Tests for toast.js module
 *
 * Tests the pure calculateToastDuration function and the
 * createToastService factory with dependency injection.
 */

const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('toast module', () => {
  let calculateToastDuration;
  let createToastService;
  let showToast;

  beforeEach(async () => {
    const module = await import('../src/js/modules/toast.js');
    calculateToastDuration = module.calculateToastDuration;
    createToastService = module.createToastService;
    showToast = module.showToast;
  });

  it('should export calculateToastDuration function', () => {
    assert.strictEqual(typeof calculateToastDuration, 'function');
  });

  it('should export createToastService function', () => {
    assert.strictEqual(typeof createToastService, 'function');
  });

  it('should export showToast function', () => {
    assert.strictEqual(typeof showToast, 'function');
  });

  describe('calculateToastDuration', () => {
    it('should return 5000ms for success messages containing "successfully"', () => {
      const duration = calculateToastDuration(
        'Album added successfully',
        'success'
      );
      assert.strictEqual(duration, 5000);
    });

    it('should return 5000ms for error type', () => {
      const duration = calculateToastDuration('Something went wrong', 'error');
      assert.strictEqual(duration, 5000);
    });

    it('should return 10000ms for messages containing "..."', () => {
      const duration = calculateToastDuration('Loading...', 'info');
      assert.strictEqual(duration, 10000);
    });

    it('should return 3000ms for all other messages', () => {
      const duration = calculateToastDuration('Hello world', 'info');
      assert.strictEqual(duration, 3000);
    });

    it('should return 3000ms for success messages without "successfully"', () => {
      const duration = calculateToastDuration('Done', 'success');
      assert.strictEqual(duration, 3000);
    });

    it('should prioritize success+successfully over "..." in message', () => {
      const duration = calculateToastDuration(
        'Saved successfully...',
        'success'
      );
      assert.strictEqual(duration, 5000);
    });

    it('should prioritize error type over "..." in message', () => {
      const duration = calculateToastDuration('Error loading...', 'error');
      assert.strictEqual(duration, 5000);
    });
  });

  describe('createToastService', () => {
    it('should return an object with show and calculateDuration methods', () => {
      const service = createToastService({
        getElement: () => null,
      });
      assert.strictEqual(typeof service.show, 'function');
      assert.strictEqual(typeof service.calculateDuration, 'function');
    });

    it('should use provided getElement function', () => {
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(_v) {},
        set className(_v) {},
      };
      const getElement = mock.fn(() => mockElement);
      const service = createToastService({
        getElement,
        setTimeout: mock.fn(),
        clearTimeout: mock.fn(),
      });

      service.show('Test message', 'success');

      assert.strictEqual(getElement.mock.calls.length, 1);
    });

    it('should handle missing toast element gracefully', () => {
      const warnFn = mock.fn();
      const originalWarn = console.warn;
      console.warn = warnFn;

      const service = createToastService({
        getElement: () => null,
        setTimeout: mock.fn(),
        clearTimeout: mock.fn(),
      });

      // Should not throw
      service.show('Test message');

      assert.strictEqual(warnFn.mock.calls.length, 1);
      assert.strictEqual(
        warnFn.mock.calls[0].arguments[0],
        'Toast element not found'
      );

      console.warn = originalWarn;
    });

    it('should clear previous timer when showing new toast', () => {
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(_v) {},
        set className(_v) {},
      };
      const clearTimeoutFn = mock.fn();
      const setTimeoutFn = mock.fn(() => 'timer-id');

      const service = createToastService({
        getElement: () => mockElement,
        setTimeout: setTimeoutFn,
        clearTimeout: clearTimeoutFn,
      });

      // First toast sets a timer
      service.show('First message', 'success');
      // Second toast should clear the previous timer
      service.show('Second message', 'info');

      assert.ok(clearTimeoutFn.mock.calls.length >= 1);
    });

    it('should auto-calculate duration when null', () => {
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(_v) {},
        set className(_v) {},
      };
      const timers = [];
      const setTimeoutFn = mock.fn((_fn, delay) => {
        timers.push(delay);
        return timers.length;
      });

      const service = createToastService({
        getElement: () => mockElement,
        setTimeout: setTimeoutFn,
        clearTimeout: mock.fn(),
      });

      service.show('Something went wrong', 'error');

      // The second setTimeout call should be the hide timer with auto-calculated duration
      // First call is the 10ms show delay, second is the hide timer
      assert.strictEqual(timers[0], 10);
      assert.strictEqual(timers[1], 5000); // error type = 5000ms
    });

    it('should use explicit duration when provided', () => {
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(_v) {},
        set className(_v) {},
      };
      const timers = [];
      const setTimeoutFn = mock.fn((_fn, delay) => {
        timers.push(delay);
        return timers.length;
      });

      const service = createToastService({
        getElement: () => mockElement,
        setTimeout: setTimeoutFn,
        clearTimeout: mock.fn(),
      });

      service.show('Custom duration', 'info', 7500);

      // Second setTimeout should be the hide timer with explicit duration
      assert.strictEqual(timers[1], 7500);
    });

    it('should apply correct CSS class for each type', () => {
      const classNames = [];
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(_v) {},
        set className(v) {
          classNames.push(v);
        },
      };

      const service = createToastService({
        getElement: () => mockElement,
        setTimeout: mock.fn(),
        clearTimeout: mock.fn(),
      });

      service.show('Success', 'success');
      assert.strictEqual(classNames[0], 'toast success');

      service.show('Error', 'error');
      assert.strictEqual(classNames[1], 'toast error');

      service.show('Info', 'info');
      assert.strictEqual(classNames[2], 'toast info');
    });

    it('should set textContent to message', () => {
      const messages = [];
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(v) {
          messages.push(v);
        },
        set className(_v) {},
      };

      const service = createToastService({
        getElement: () => mockElement,
        setTimeout: mock.fn(),
        clearTimeout: mock.fn(),
      });

      service.show('Hello world', 'info');
      assert.strictEqual(messages[0], 'Hello world');
    });

    it('should default type to success when not specified', () => {
      const classNames = [];
      const mockElement = {
        classList: {
          remove: mock.fn(),
          add: mock.fn(),
        },
        set textContent(_v) {},
        set className(v) {
          classNames.push(v);
        },
      };

      const service = createToastService({
        getElement: () => mockElement,
        setTimeout: mock.fn(),
        clearTimeout: mock.fn(),
      });

      service.show('Default type');
      assert.strictEqual(classNames[0], 'toast success');
    });
  });
});
