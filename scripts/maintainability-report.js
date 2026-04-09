const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  shouldIncludeFile,
  buildFileRecord,
  calculateMaintainabilityMetrics,
  evaluateThresholds,
} = require('../utils/maintainability-metrics');

function parseArgs(argv) {
  const args = {
    json: false,
    thresholds: {},
  };

  argv.forEach((arg) => {
    if (arg === '--json') {
      args.json = true;
      return;
    }

    if (arg === '--help') {
      args.help = true;
      return;
    }

    const [flag, value] = arg.split('=');
    const parsedValue = Number(value);

    if (flag === '--max-js-files-over-300' && Number.isFinite(parsedValue)) {
      args.thresholds.maxJavascriptFilesOver300 = parsedValue;
      return;
    }

    if (flag === '--max-js-files-over-700' && Number.isFinite(parsedValue)) {
      args.thresholds.maxJavascriptFilesOver700 = parsedValue;
      return;
    }

    if (flag === '--max-legacy-markers' && Number.isFinite(parsedValue)) {
      args.thresholds.maxLegacyMarkers = parsedValue;
    }
  });

  return args;
}

function printHelp() {
  console.log('Maintainability report usage:');
  console.log('  node scripts/maintainability-report.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --json                         Output JSON only');
  console.log(
    '  --max-js-files-over-300=<n>    Fail when JS files over 300 exceed n'
  );
  console.log(
    '  --max-js-files-over-700=<n>    Fail when JS files over 700 exceed n'
  );
  console.log(
    '  --max-legacy-markers=<n>       Fail when legacy markers exceed n'
  );
  console.log('  --help                         Show this help text');
}

function getGitTrackedFiles(rootDir) {
  const stdout = execFileSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectSourceFileRecords(rootDir) {
  const trackedFiles = getGitTrackedFiles(rootDir);
  const fileRecords = [];

  trackedFiles.forEach((relativePath) => {
    if (!shouldIncludeFile(relativePath)) {
      return;
    }

    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    fileRecords.push(buildFileRecord(relativePath, content));
  });

  return fileRecords;
}

function printTextReport(metrics, violations) {
  console.log('Maintainability report');
  console.log('');
  console.log(`Tracked source files: ${metrics.totals.sourceFiles}`);
  console.log(`Tracked source lines: ${metrics.totals.sourceLines}`);
  console.log(`Tracked JS files: ${metrics.totals.javascriptFiles}`);
  console.log(`Tracked JS lines: ${metrics.totals.javascriptLines}`);
  console.log(`Tracked app JS files: ${metrics.totals.appJavascriptFiles}`);
  console.log(`Tracked app JS lines: ${metrics.totals.appJavascriptLines}`);
  console.log(
    `App JS files >300 lines: ${metrics.totals.appJavascriptFilesOver300}`
  );
  console.log(
    `App JS files >700 lines: ${metrics.totals.appJavascriptFilesOver700}`
  );
  console.log(
    `Legacy markers (app JS): ${metrics.totals.appJavascriptLegacyMarkers}`
  );
  console.log('');

  console.log('Top directories by source lines:');
  metrics.byTopDir.slice(0, 10).forEach((entry) => {
    console.log(`- ${entry.dir}: ${entry.lines} lines (${entry.files} files)`);
  });
  console.log('');

  console.log('Largest app JS files:');
  metrics.topAppJavascriptFiles.slice(0, 10).forEach((entry) => {
    console.log(`- ${entry.lines} lines  ${entry.path}`);
  });

  if (violations.length > 0) {
    console.log('');
    console.log('Threshold violations:');
    violations.forEach((violation) => {
      console.log(
        `- ${violation.metric}: ${violation.actual} (max ${violation.maxAllowed})`
      );
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const rootDir = path.resolve(__dirname, '..');
  const fileRecords = collectSourceFileRecords(rootDir);
  const metrics = calculateMaintainabilityMetrics(fileRecords);
  const violations = evaluateThresholds(metrics, args.thresholds);

  if (args.json) {
    console.log(JSON.stringify({ metrics, violations }, null, 2));
  } else {
    printTextReport(metrics, violations);
  }

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

main();
