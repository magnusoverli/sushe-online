const path = require('path');

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.json',
  '.html',
  '.ejs',
  '.css',
]);

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs']);

const DEFAULT_IGNORED_PREFIXES = [
  '.git/',
  'node_modules/',
  'package-lock.json',
  'skills-lock.json',
  'public/js/chunks/',
  'public/js/bundle.js',
  'public/styles/output.css',
  'playwright-report/',
  'test-results/',
  'coverage/',
  'mobile/',
  '.opencode/',
  'plans/',
];

const LEGACY_MARKER_REGEX =
  /\blegacy\b|\bbackward(?:s)?[- ]compat(?:ibility)?\b|\bfallback\b|\bcompatibility\b/gi;

function normalizePath(inputPath) {
  return inputPath.split(path.sep).join('/');
}

function countLines(content) {
  return content.split(/\r?\n/).length;
}

function countRegexMatches(content, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const matches = content.match(matcher);
  return matches ? matches.length : 0;
}

function shouldIncludeFile(filePath, options = {}) {
  const normalizedPath = normalizePath(filePath);
  const extension = path.extname(normalizedPath).toLowerCase();
  const allowedExtensions = options.extensions || SOURCE_EXTENSIONS;
  const ignoredPrefixes = options.ignoredPrefixes || DEFAULT_IGNORED_PREFIXES;

  if (!allowedExtensions.has(extension)) {
    return false;
  }

  return !ignoredPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
}

function buildFileRecord(filePath, content) {
  const normalizedPath = normalizePath(filePath);
  const extension = path.extname(normalizedPath).toLowerCase();
  const isJavascript = JAVASCRIPT_EXTENSIONS.has(extension);
  const isTestFile = normalizedPath.startsWith('test/');
  const pathSegments = normalizedPath.split('/');
  const topLevelDir =
    pathSegments.length > 1 ? pathSegments[0] : normalizedPath;

  return {
    path: normalizedPath,
    extension,
    topLevelDir,
    isJavascript,
    isTestFile,
    isAppJavascript: isJavascript && !isTestFile,
    lines: countLines(content),
    legacyMarkers: isJavascript
      ? countRegexMatches(content, LEGACY_MARKER_REGEX)
      : 0,
  };
}

function sortFilesBySizeDesc(fileRecords, limit = 15) {
  return [...fileRecords]
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((file) => ({ path: file.path, lines: file.lines }));
}

function calculateMaintainabilityMetrics(fileRecords) {
  const byTopDirMap = new Map();

  const totals = fileRecords.reduce(
    (acc, file) => {
      acc.sourceFiles += 1;
      acc.sourceLines += file.lines;

      const current = byTopDirMap.get(file.topLevelDir) || {
        files: 0,
        lines: 0,
      };
      byTopDirMap.set(file.topLevelDir, {
        files: current.files + 1,
        lines: current.lines + file.lines,
      });

      if (file.isJavascript) {
        acc.javascriptFiles += 1;
        acc.javascriptLines += file.lines;
        acc.allJavascriptLegacyMarkers += file.legacyMarkers;

        if (file.lines > 300) acc.javascriptFilesOver300 += 1;
        if (file.lines > 700) acc.javascriptFilesOver700 += 1;
      }

      if (file.isAppJavascript) {
        acc.appJavascriptFiles += 1;
        acc.appJavascriptLines += file.lines;
        acc.appJavascriptLegacyMarkers += file.legacyMarkers;

        if (file.lines > 300) acc.appJavascriptFilesOver300 += 1;
        if (file.lines > 700) acc.appJavascriptFilesOver700 += 1;
      }

      return acc;
    },
    {
      sourceFiles: 0,
      sourceLines: 0,
      javascriptFiles: 0,
      javascriptLines: 0,
      javascriptFilesOver300: 0,
      javascriptFilesOver700: 0,
      allJavascriptLegacyMarkers: 0,
      appJavascriptFiles: 0,
      appJavascriptLines: 0,
      appJavascriptFilesOver300: 0,
      appJavascriptFilesOver700: 0,
      appJavascriptLegacyMarkers: 0,
    }
  );

  const byTopDir = [...byTopDirMap.entries()]
    .map(([dir, stats]) => ({
      dir,
      files: stats.files,
      lines: stats.lines,
    }))
    .sort((a, b) => b.lines - a.lines || a.dir.localeCompare(b.dir));

  const javascriptFiles = fileRecords.filter((file) => file.isJavascript);
  const appJavascriptFiles = fileRecords.filter((file) => file.isAppJavascript);

  return {
    totals,
    byTopDir,
    topSourceFiles: sortFilesBySizeDesc(fileRecords),
    topJavascriptFiles: sortFilesBySizeDesc(javascriptFiles),
    topAppJavascriptFiles: sortFilesBySizeDesc(appJavascriptFiles),
  };
}

function evaluateThresholds(metrics, thresholds = {}) {
  const violations = [];
  const checks = [
    {
      key: 'maxJavascriptFilesOver300',
      actual: metrics.totals.appJavascriptFilesOver300,
      label: 'app JS files over 300 lines',
    },
    {
      key: 'maxJavascriptFilesOver700',
      actual: metrics.totals.appJavascriptFilesOver700,
      label: 'app JS files over 700 lines',
    },
    {
      key: 'maxLegacyMarkers',
      actual: metrics.totals.appJavascriptLegacyMarkers,
      label: 'app legacy compatibility markers',
    },
  ];

  checks.forEach((check) => {
    const threshold = thresholds[check.key];
    if (typeof threshold !== 'number' || Number.isNaN(threshold)) {
      return;
    }

    if (check.actual > threshold) {
      violations.push({
        metric: check.label,
        actual: check.actual,
        maxAllowed: threshold,
      });
    }
  });

  return violations;
}

module.exports = {
  DEFAULT_IGNORED_PREFIXES,
  SOURCE_EXTENSIONS,
  LEGACY_MARKER_REGEX,
  normalizePath,
  shouldIncludeFile,
  buildFileRecord,
  calculateMaintainabilityMetrics,
  evaluateThresholds,
};
