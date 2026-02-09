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
# These require PostgreSQL and the app server to be running.
# Skip gracefully in CI or when infrastructure is not available.
INTEGRATION_EXIT=0
echo "=== Phase 2: Integration tests (serial) ==="

# Check if PostgreSQL is reachable (integration tests need it)
if [ -n "$DATABASE_URL" ] && node -e "
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); }).catch(() => { pool.end(); process.exit(1); });
" 2>/dev/null; then
  for f in "${INTEGRATION_TESTS[@]}"; do
    if [ -f "$f" ]; then
      echo "--- Running $f ---"
      node --test "$f" || INTEGRATION_EXIT=1
    fi
  done
else
  echo "Skipping integration tests (no database connection available)"
fi

# Run playwright tests only if not in CI and playwright is available
# (In CI, Playwright runs as a separate job — see .github/workflows/docker-build.yml)
# (Playwright is also not available in Docker container)
if [ "$CI" != "true" ] && command -v npx >/dev/null 2>&1 && npx playwright --version >/dev/null 2>&1; then
  echo "=== Phase 3: Playwright e2e tests ==="
  PLAYWRIGHT_SKIP_SERVER=1 npx playwright test || INTEGRATION_EXIT=1
fi

exit $INTEGRATION_EXIT
