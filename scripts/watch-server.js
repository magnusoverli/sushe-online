const { spawn } = require('node:child_process');
const { watch } = require('chokidar');

const SERVER_PATHS = [
  'index.js',
  'templates.js',
  'package.json',
  'config',
  'db',
  'middleware',
  'routes',
  'services',
  'templates',
  'utils',
  'views',
];

// Polling is required for edits made on the Windows side of Docker bind mounts.
function watchServer({
  watchImpl = watch,
  spawnImpl = spawn,
  processImpl = process,
  delay = 150,
} = {}) {
  let child;
  let restarting = false;
  let stopping = false;
  let timer;
  const watcher = watchImpl(SERVER_PATHS, {
    ignoreInitial: true,
    usePolling: true,
    interval: 500,
  });

  function start() {
    restarting = false;
    child = spawnImpl(processImpl.execPath, ['index.js'], { stdio: 'inherit' });
    child.once('error', () => stop(1));
    child.once('exit', (code) => {
      child = null;
      if (stopping) return;
      if (restarting) start();
      else stop(code || 0);
    });
  }

  function restart() {
    if (stopping || restarting) return;
    restarting = true;
    if (child) child.kill('SIGTERM');
    else start();
  }

  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    processImpl.exitCode = code;
    watcher.close();
    child?.kill('SIGTERM');
    processImpl.removeListener('SIGINT', onSignal);
    processImpl.removeListener('SIGTERM', onSignal);
  }

  function onSignal() {
    stop();
  }

  watcher.on('all', () => {
    clearTimeout(timer);
    timer = setTimeout(restart, delay);
  });
  watcher.on('error', () => stop(1));
  processImpl.once('SIGINT', onSignal);
  processImpl.once('SIGTERM', onSignal);
  start();
  return { stop };
}

if (require.main === module) watchServer();
module.exports = { watchServer };
