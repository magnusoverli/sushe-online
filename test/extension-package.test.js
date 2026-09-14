const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const {
  extensionDir,
  extensionPackageFiles,
} = require('./helpers/extension-package');

test('the release package includes every worker, content-script, and extension-page dependency', () => {
  const files = extensionPackageFiles();
  const manifest = JSON.parse(
    readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')
  );
  const worker = readFileSync(
    path.join(extensionDir, manifest.background.service_worker),
    'utf8'
  );
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
