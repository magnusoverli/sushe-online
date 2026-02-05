#!/bin/bash
set -e

# Run all unit tests (auto-discovers test files, no manual list to maintain)
node --test test/*.test.js

# Run playwright tests only if not in CI and playwright is available
# (Playwright tests are skipped in CI to avoid browser installation overhead)
# (Playwright is also not available in Docker container)
if [ "$CI" != "true" ] && command -v playwright >/dev/null 2>&1; then
  playwright test
fi
