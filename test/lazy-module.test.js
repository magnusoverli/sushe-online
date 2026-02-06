/**
 * Tests for lazy-module.js utility module
 */

const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

let createLazyModule;

describe('lazy-module', async () => {
  const mod = await import('../src/js/utils/lazy-module.js');
  createLazyModule = mod.createLazyModule;

  it('should call factory on first access', () => {
    const factory = mock.fn(() => ({ hello: 'world' }));
    const getter = createLazyModule(factory);
    const result = getter();
    assert.deepStrictEqual(result, { hello: 'world' });
    assert.strictEqual(factory.mock.calls.length, 1);
  });

  it('should cache and return same instance on subsequent calls', () => {
    const factory = mock.fn(() => ({ hello: 'world' }));
    const getter = createLazyModule(factory);
    const first = getter();
    const second = getter();
    const third = getter();
    assert.strictEqual(first, second);
    assert.strictEqual(second, third);
    assert.strictEqual(factory.mock.calls.length, 1);
  });

  it('should not call factory until first access', () => {
    const factory = mock.fn(() => 'value');
    createLazyModule(factory);
    assert.strictEqual(factory.mock.calls.length, 0);
  });

  it('should work with different return types', () => {
    const numGetter = createLazyModule(() => 42);
    assert.strictEqual(numGetter(), 42);

    const arrGetter = createLazyModule(() => [1, 2, 3]);
    assert.deepStrictEqual(arrGetter(), [1, 2, 3]);

    const fnGetter = createLazyModule(() => () => 'fn');
    assert.strictEqual(fnGetter()(), 'fn');
  });

  it('should handle factory returning null without re-invoking', () => {
    const factory = mock.fn(() => null);
    const getter = createLazyModule(factory);
    const first = getter();
    const second = getter();
    assert.strictEqual(first, null);
    assert.strictEqual(second, null);
    assert.strictEqual(factory.mock.calls.length, 1);
  });

  it('should handle factory returning 0 without re-invoking', () => {
    const factory = mock.fn(() => 0);
    const getter = createLazyModule(factory);
    const first = getter();
    const second = getter();
    assert.strictEqual(first, 0);
    assert.strictEqual(second, 0);
    assert.strictEqual(factory.mock.calls.length, 1);
  });

  it('should handle factory returning false without re-invoking', () => {
    const factory = mock.fn(() => false);
    const getter = createLazyModule(factory);
    const first = getter();
    const second = getter();
    assert.strictEqual(first, false);
    assert.strictEqual(second, false);
    assert.strictEqual(factory.mock.calls.length, 1);
  });

  it('should handle factory returning empty string without re-invoking', () => {
    const factory = mock.fn(() => '');
    const getter = createLazyModule(factory);
    const first = getter();
    const second = getter();
    assert.strictEqual(first, '');
    assert.strictEqual(second, '');
    assert.strictEqual(factory.mock.calls.length, 1);
  });
});
