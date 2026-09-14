const {
  readFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
} = require('node:fs');
const path = require('node:path');

const extensionDir = path.resolve(__dirname, '../../browser-extension');

// Stage exactly the shell packager's inputs, rather than testing a source
// directory that may contain runtime dependencies missing from the release.
function extensionPackageFiles() {
  const script = readFileSync(
    path.join(extensionDir, 'package-for-store.sh'),
    'utf8'
  );
  const command = script.match(
    /zip -q "\$OUTPUT_FILE" \\\r?\n([\s\S]*?)\r?\n\r?\n/
  );
  if (!command) throw new Error('Could not read extension packaging inputs');
  return command[1].split(/\r?\n/).flatMap((line) => {
    const file = line.trim().replace(/\\$/, '').trim();
    if (file === 'icons/*.png') {
      return readdirSync(path.join(extensionDir, 'icons'))
        .filter((name) => name.endsWith('.png'))
        .map((name) => `icons/${name}`);
    }
    return file ? [file] : [];
  });
}

function stageExtensionPackage(destination) {
  for (const file of extensionPackageFiles()) {
    const target = path.join(destination, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(extensionDir, file), target);
  }
  return destination;
}

module.exports = { extensionDir, extensionPackageFiles, stageExtensionPackage };
