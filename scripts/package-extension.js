const fs = require('node:fs');
const path = require('node:path');
const { zipSync, unzipSync } = require('fflate');

const extensionDir = path.resolve(__dirname, '../browser-extension');
const PACKAGE_FILES = [
  'manifest.json',
  'extension-constants.js',
  'album-identity-service.js',
  'rym-album-extractor.js',
  'background.js',
  'context-menu-service.js',
  'album-presence-service.js',
  'sushe-tab-navigation.js',
  'album-api-service.js',
  'album-add-enrichment.js',
  'album-add-service.js',
  'rym-presence-badges.js',
  'content-script.js',
  'auth-listener.js',
  'auth-state.js',
  'login-flow.js',
  'shared-utils.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'store-icon-128.png',
];

function extensionPackageFiles(sourceDir = extensionDir) {
  const icons = fs
    .readdirSync(path.join(sourceDir, 'icons'))
    .filter((name) => name.endsWith('.png'))
    .sort()
    .map((name) => `icons/${name}`);
  return [...PACKAGE_FILES, ...icons];
}

function validateExtensionPackage(archive) {
  const entries = unzipSync(archive);
  // Inspect literal ZIP names before extraction can normalize ./ or a wrapper
  // directory. The store looks for precisely "manifest.json" at the root.
  if (!Object.hasOwn(entries, 'manifest.json')) {
    throw new Error('The ZIP must contain manifest.json directly at its root');
  }
  for (const name of Object.keys(entries)) {
    if (
      name.includes('\\') ||
      name.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error(`Invalid extension ZIP entry: ${name}`);
    }
  }
  const manifest = JSON.parse(
    Buffer.from(entries['manifest.json']).toString('utf8')
  );
  if (manifest.manifest_version !== 3 || typeof manifest.version !== 'string') {
    throw new Error('The ZIP must contain a valid Manifest V3 extension');
  }
  return { entries, manifest };
}

function createExtensionPackage(sourceDir = extensionDir) {
  const files = Object.fromEntries(
    extensionPackageFiles(sourceDir).map((name) => [
      name,
      fs.readFileSync(path.join(sourceDir, name)),
    ])
  );
  const archive = zipSync(files);
  validateExtensionPackage(archive);
  return archive;
}

function writeExtensionPackage(outputFile) {
  const archive = createExtensionPackage();
  const { entries, manifest } = validateExtensionPackage(archive);
  const destination = path.resolve(
    outputFile ||
      path.join(extensionDir, `sushe-online-extension-${manifest.version}.zip`)
  );
  fs.writeFileSync(destination, archive);
  // Validate the actual file offered for upload, not just its source inputs.
  validateExtensionPackage(fs.readFileSync(destination));
  return {
    destination,
    version: manifest.version,
    fileCount: Object.keys(entries).length,
    bytes: archive.length,
  };
}

if (require.main === module) {
  try {
    const result = writeExtensionPackage(process.argv[2]);
    console.log(`Created ${result.destination}`);
    console.log(
      `Verified extension ${result.version}: ${result.fileCount} files, ${result.bytes} bytes, root manifest.json`
    );
  } catch (error) {
    console.error(`Extension packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  extensionDir,
  extensionPackageFiles,
  validateExtensionPackage,
  createExtensionPackage,
  writeExtensionPackage,
};
