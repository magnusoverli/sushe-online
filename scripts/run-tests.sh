#!/bin/bash
set -e

# Integration tests create their own DB pools, so they must run serially AFTER
# the parallel unit tests to avoid exhausting PostgreSQL max_connections.
# Add new integration test files here if they create a Pool() connection.
INTEGRATION_TESTS=(
  "test/list-fetch-optimization.test.js"
  "test/recommendations.test.js"
  "test/year-locking.test.js"
)

# Build unit test file list by excluding integration tests
UNIT_TESTS=()
for f in test/*.test.js; do
  skip=false
  for integration in "${INTEGRATION_TESTS[@]}"; do
    if [ "$f" = "$integration" ]; then
      skip=true
      break
    fi
  done
  if [ "$skip" = false ]; then
    UNIT_TESTS+=("$f")
  fi
done

# Phase 1: Run unit tests in parallel (auto-discovered, no manual list)
echo "=== Phase 1: Unit tests (parallel) ==="
node --test "${UNIT_TESTS[@]}"

# Phase 2: Run integration tests one at a time (each creates its own DB pool)
# Run all even if one fails, then report the overall result at the end.
INTEGRATION_EXIT=0
echo "=== Phase 2: Integration tests (serial) ==="
for f in "${INTEGRATION_TESTS[@]}"; do
  if [ -f "$f" ]; then
    echo "--- Running $f ---"
    node --test "$f" || INTEGRATION_EXIT=1
  fi
done

exit $INTEGRATION_EXIT

# Run playwright tests only if not in CI and playwright is available
# (Playwright tests are skipped in CI to avoid browser installation overhead)
# (Playwright is also not available in Docker container)
if [ "$CI" != "true" ] && command -v playwright >/dev/null 2>&1; then
  playwright test
fi
