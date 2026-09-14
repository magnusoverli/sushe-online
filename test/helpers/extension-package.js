const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const {
  extensionDir,
  extensionPackageFiles,
  writeExtensionPackage,
  validateExtensionPackage,
} = require('../../scripts/package-extension');

function stageExtensionPackage(destination) {
  mkdirSync(destination, { recursive: true });
  const archivePath = `${destination}.zip`;
  writeExtensionPackage(archivePath);
  const { entries } = validateExtensionPackage(readFileSync(archivePath));
  // Browser checks must run the extracted upload artifact, not copied sources.
  for (const [file, contents] of Object.entries(entries)) {
    const target = path.join(destination, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return destination;
}

module.exports = { extensionDir, extensionPackageFiles, stageExtensionPackage };
