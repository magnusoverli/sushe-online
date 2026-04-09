const test = require('node:test');
const assert = require('node:assert');
const {
  shouldIncludeFile,
  buildFileRecord,
  calculateMaintainabilityMetrics,
  evaluateThresholds,
} = require('../utils/maintainability-metrics');

test('shouldIncludeFile excludes generated and non-source files', () => {
  assert.strictEqual(
    shouldIncludeFile('public/js/chunks/app-abc12345.js'),
    false
  );
  assert.strictEqual(shouldIncludeFile('public/styles/output.css'), false);
  assert.strictEqual(shouldIncludeFile('package-lock.json'), false);
  assert.strictEqual(shouldIncludeFile('README.md'), false);
  assert.strictEqual(shouldIncludeFile('services/list-service.js'), true);
  assert.strictEqual(shouldIncludeFile('views/layout.ejs'), true);
});

test('buildFileRecord computes path, lines, and legacy marker count', () => {
  const record = buildFileRecord(
    'src/js/modules/example.js',
    [
      '// legacy adapter',
      'function x() { return true; }',
      '// fallback branch',
    ].join('\n')
  );

  assert.strictEqual(record.path, 'src/js/modules/example.js');
  assert.strictEqual(record.topLevelDir, 'src');
  assert.strictEqual(record.lines, 3);
  assert.strictEqual(record.isJavascript, true);
  assert.strictEqual(record.legacyMarkers, 2);
});

test('calculateMaintainabilityMetrics aggregates totals and hot spots', () => {
  const files = [
    buildFileRecord('services/a.js', `function a() {}\n${'x\n'.repeat(301)}`),
    buildFileRecord('services/b.js', `function b() {}\n${'y\n'.repeat(705)}`),
    buildFileRecord('views/layout.ejs', '<div>ok</div>'),
    buildFileRecord('utils/c.js', '// backwards compatibility\nconst z = 1;'),
  ];

  const metrics = calculateMaintainabilityMetrics(files);

  assert.strictEqual(metrics.totals.sourceFiles, 4);
  assert.strictEqual(metrics.totals.javascriptFiles, 3);
  assert.strictEqual(metrics.totals.appJavascriptFiles, 3);
  assert.strictEqual(metrics.totals.javascriptFilesOver300, 2);
  assert.strictEqual(metrics.totals.javascriptFilesOver700, 1);
  assert.strictEqual(metrics.totals.appJavascriptFilesOver300, 2);
  assert.strictEqual(metrics.totals.appJavascriptFilesOver700, 1);
  assert.strictEqual(metrics.totals.appJavascriptLegacyMarkers, 1);

  assert.strictEqual(metrics.byTopDir[0].dir, 'services');
  assert.strictEqual(metrics.topJavascriptFiles[0].path, 'services/b.js');
  assert.strictEqual(metrics.topAppJavascriptFiles[0].path, 'services/b.js');
});

test('evaluateThresholds returns violations when thresholds are exceeded', () => {
  const metrics = {
    totals: {
      appJavascriptFilesOver300: 10,
      appJavascriptFilesOver700: 4,
      appJavascriptLegacyMarkers: 25,
    },
  };

  const violations = evaluateThresholds(metrics, {
    maxJavascriptFilesOver300: 8,
    maxJavascriptFilesOver700: 5,
    maxLegacyMarkers: 20,
  });

  assert.strictEqual(violations.length, 2);
  assert.deepStrictEqual(violations[0], {
    metric: 'app JS files over 300 lines',
    actual: 10,
    maxAllowed: 8,
  });
  assert.deepStrictEqual(violations[1], {
    metric: 'app legacy compatibility markers',
    actual: 25,
    maxAllowed: 20,
  });
});
