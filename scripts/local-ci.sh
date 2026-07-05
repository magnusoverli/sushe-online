#!/bin/bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.local.yml}"
APP_SERVICE="${APP_SERVICE:-app}"

run_in_app_container() {
  docker compose -f "$COMPOSE_FILE" exec -e CI=true "$APP_SERVICE" "$@"
}

echo "=== Local CI: build ==="
npm run build

echo "=== Local CI: lint ==="
npm run lint

echo "=== Local CI: structure baseline ==="
npm run lint:structure:baseline

echo "=== Local CI: strict lint ==="
npm run lint:strict

echo "=== Local CI: unit + integration tests (Docker, CI=true) ==="
run_in_app_container bash scripts/run-tests.sh

if [ "${RUN_E2E:-0}" = "1" ]; then
  echo "=== Local CI: Playwright e2e tests ==="
  PLAYWRIGHT_SKIP_SERVER=1 npx playwright test
else
  echo "Skipping Playwright e2e tests (set RUN_E2E=1 to run them)."
fi
