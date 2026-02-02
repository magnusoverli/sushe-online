#!/bin/bash
set -e

# List of test files
TEST_FILES="test/security-middleware.test.js test/session-management.test.js test/auth-utils.test.js test/validators.test.js test/color-utils.test.js test/logger.test.js test/error-handler.test.js test/spotify-auth.test.js test/retry-wrapper.test.js test/templates.test.js test/basic.test.js test/rate-limit.test.js test/response-cache.test.js test/forgot-email.test.js test/request-queue.test.js test/deduplication.test.js test/auth-middleware.test.js test/auth-routes.test.js test/remember-me.test.js test/settings-routes.test.js test/extension-token-routes.test.js test/admin-routes.test.js test/password-change.test.js test/lastfm-auth.test.js test/user-preferences-migration.test.js test/user-preferences.test.js test/preference-sync.test.js test/preferences-routes.test.js test/musicbrainz.test.js test/claude-summary.test.js"

# Run unit tests
node --test $TEST_FILES

# Run playwright tests only if not in CI and playwright is available
# (Playwright tests are skipped in CI to avoid browser installation overhead)
# (Playwright is also not available in Docker container)
if [ "$CI" != "true" ] && command -v playwright >/dev/null 2>&1; then
  playwright test
fi
