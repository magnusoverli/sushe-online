const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const {
  createExtensionPackage,
  validateExtensionPackage,
  writeExtensionPackage,
} = require('../scripts/package-extension');
const {
  extensionDir,
  extensionPackageFiles,
} = require('./helpers/extension-package');

test('the release package includes every worker, content-script, and extension-page dependency', () => {
  const { entries, manifest } = validateExtensionPackage(
    createExtensionPackage()
  );
  const files = Object.keys(entries);
  const worker = Buffer.from(
    entries[manifest.background.service_worker]
  ).toString('utf8');
  const imports = worker.match(/importScripts\(([\s\S]*?)\);/)[1];
  const dependencies = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((script) => script.js),
    ...Array.from(imports.matchAll(/'([^']+)'/g), (match) => match[1]),
  ];
  for (const page of [manifest.options_page, manifest.action.default_popup]) {
    dependencies.push(page);
    const html = readFileSync(path.join(extensionDir, page), 'utf8');
    dependencies.push(
      ...Array.from(
        html.matchAll(/<script[^>]+src="([^"]+)"/g),
        (match) => match[1]
      )
    );
  }
  for (const file of dependencies)
    assert.ok(files.includes(file), `Missing packaged dependency: ${file}`);
  for (const file of files)
    assert.ok(
      existsSync(path.join(extensionDir, file)),
      `Missing package source: ${file}`
    );
});

test('the written upload ZIP has an exact root manifest and preserves all packaged file bytes', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sushe-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'extension.zip');
  const result = writeExtensionPackage(output);
  const { entries, manifest } = validateExtensionPackage(readFileSync(output));
  assert.equal(result.destination, output);
  assert.equal(result.version, manifest.version);
  assert.ok(Object.hasOwn(entries, 'manifest.json'));
  assert.deepEqual(Object.keys(entries).sort(), extensionPackageFiles().sort());
  for (const [name, bytes] of Object.entries(entries)) {
    assert.deepEqual(
      Buffer.from(bytes),
      readFileSync(path.join(extensionDir, name)),
      `Corrupted ZIP content: ${name}`
    );
  }
});

for (const prefix of ['./', 'extension/']) {
  test(`rejects ${prefix}manifest.json before extraction can hide the invalid ZIP layout`, () => {
    const archive = zipSync({
      [`${prefix}manifest.json`]: readFileSync(
        path.join(extensionDir, 'manifest.json')
      ),
    });
    assert.throws(
      () => validateExtensionPackage(archive),
      /manifest.json directly at its root/
    );
  });
}

test('rejects noncanonical member paths even when a valid root manifest is present', () => {
  for (const name of [
    './background.js',
    '../background.js',
    '/background.js',
    'icons\\icon128.png',
  ]) {
    const archive = zipSync({
      'manifest.json': readFileSync(path.join(extensionDir, 'manifest.json')),
      [name]: Buffer.from('test'),
    });
    assert.throws(
      () => validateExtensionPackage(archive),
      /Invalid extension ZIP entry/
    );
  }
});

test('rejects an invalid manifest at the ZIP root', () => {
  const archive = zipSync({ 'manifest.json': Buffer.from('{}') });
  assert.throws(() => validateExtensionPackage(archive), /valid Manifest V3/);
});
