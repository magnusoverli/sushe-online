const test = require('node:test');
const assert = require('node:assert');

// Since logger.js only exports the instance, we need to test it differently
// Let's create a simple test for the logger functionality

test('logger should be an object with logging methods', () => {
  const logger = require('../utils/logger.js');

  assert.ok(typeof logger === 'object');
  assert.ok(typeof logger.error === 'function');
  assert.ok(typeof logger.warn === 'function');
  assert.ok(typeof logger.info === 'function');
  assert.ok(typeof logger.debug === 'function');
});

test('logger methods should not throw errors', () => {
  const logger = require('../utils/logger.js');

  // These should not throw
  assert.doesNotThrow(() => logger.error('Test error'));
  assert.doesNotThrow(() => logger.warn('Test warning'));
  assert.doesNotThrow(() => logger.info('Test info'));
  assert.doesNotThrow(() => logger.debug('Test debug'));
});

test('logger should handle metadata objects', () => {
  const logger = require('../utils/logger.js');

  // These should not throw with metadata
  assert.doesNotThrow(() => logger.info('Test with meta', { userId: 123 }));
  assert.doesNotThrow(() =>
    logger.error('Test error with meta', { error: 'details' })
  );
});
