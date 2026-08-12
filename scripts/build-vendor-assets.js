const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.dirname(
  require.resolve('@fortawesome/fontawesome-free/package.json')
);
const outputRoot = path.join(
  __dirname,
  '..',
  'public',
  'vendor',
  'fontawesome'
);

fs.rmSync(outputRoot, { force: true, recursive: true });
fs.mkdirSync(path.join(outputRoot, 'css'), { recursive: true });
fs.copyFileSync(
  path.join(packageRoot, 'css', 'all.min.css'),
  path.join(outputRoot, 'css', 'all.min.css')
);
fs.cpSync(
  path.join(packageRoot, 'webfonts'),
  path.join(outputRoot, 'webfonts'),
  {
    recursive: true,
  }
);
