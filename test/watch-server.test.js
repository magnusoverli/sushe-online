const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { watchServer } = require('../scripts/watch-server');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const watcher = new EventEmitter();
  watcher.close = t.mock.fn();
  const processImpl = new EventEmitter();
  processImpl.execPath = '/node';
  const children = [];
  const watchImpl = t.mock.fn(() => watcher);
  const spawnImpl = t.mock.fn(() => {
    const child = new EventEmitter();
    child.kill = t.mock.fn();
    children.push(child);
    return child;
  });
  const server = watchServer({ watchImpl, spawnImpl, processImpl });
  t.after(() => server.stop());
  return { watcher, processImpl, children, watchImpl, spawnImpl, server };
}

test('development reloads poll backend sources and coalesce changes until the old server exits', (t) => {
  const { watcher, children, watchImpl, spawnImpl } = setup(t);
  const [paths, options] = watchImpl.mock.calls[0].arguments;
  assert.ok(paths.includes('routes'));
  assert.ok(!paths.includes('data') && !paths.includes('public'));
  assert.equal(options.usePolling, true);
  watcher.emit('all', 'change', 'routes/api/lists.js');
  t.mock.timers.tick(100);
  watcher.emit('all', 'change', 'services/list-service.js');
  t.mock.timers.tick(150);
  assert.deepEqual(children[0].kill.mock.calls[0].arguments, ['SIGTERM']);
  assert.equal(spawnImpl.mock.calls.length, 1);
  children[0].emit('exit', 0);
  assert.equal(spawnImpl.mock.calls.length, 2);
});

test('development shutdown cancels pending reloads and preserves server failures', (t) => {
  const { watcher, children, processImpl, spawnImpl } = setup(t);
  watcher.emit('all', 'change', 'index.js');
  children[0].emit('exit', 1);
  t.mock.timers.tick(1000);
  assert.equal(spawnImpl.mock.calls.length, 1);
  assert.equal(processImpl.exitCode, 1);
  assert.equal(watcher.close.mock.calls.length, 1);
});

test('development watcher forwards shutdown signals without restarting', (t) => {
  const { watcher, children, processImpl, spawnImpl } = setup(t);
  processImpl.emit('SIGTERM');
  children[0].emit('exit', 0);
  assert.equal(children[0].kill.mock.calls.length, 1);
  assert.equal(watcher.close.mock.calls.length, 1);
  assert.equal(spawnImpl.mock.calls.length, 1);
});
