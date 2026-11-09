const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

test('stable Node and npm baselines stay aligned across package metadata, Docker and CI', () => {
  const node = /^>=(\d+\.\d+\.\d+) </.exec(pkg.engines.node)?.[1];
  const npm = /^npm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager)?.[1];
  assert.ok(node);
  assert.ok(npm);
  assert.ok(pkg.engines.npm.startsWith(`>=${npm} `));
  const root = path.resolve(__dirname, '..');
  const dockerfile = fs
    .readFileSync(path.join(root, 'Dockerfile'), 'utf8')
    .split(/\r?\n/);
  assert.ok(dockerfile.includes(`ARG NODE_VERSION=${node}`));
  assert.ok(dockerfile.includes(`ARG NPM_VERSION=${npm}`));
  for (const name of [
    'docker-build.yml',
    'container-security.yml',
    'recovery-rehearsal.yml',
  ]) {
    const workflow = fs.readFileSync(
      path.join(root, '.github/workflows', name),
      'utf8'
    );
    assert.ok(
      workflow.includes(`NODE_VERSION: '${node}'`),
      `${name} must use the audited Node version`
    );
    if (workflow.includes('NPM_VERSION:'))
      assert.ok(workflow.includes(`NPM_VERSION: '${npm}'`));
  }
});
