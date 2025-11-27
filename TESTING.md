# Testing Guide

## Quick Start

```bash
npm test              # Run core tests (~40 tests, 30 seconds)
npm run test:e2e     # Run browser tests (5 scenarios)
```

## What We Test

### Security Tests (17 tests)

**File**: `test/security-middleware.test.js`

Critical security features that protect users:

- CSRF protection
- XSS prevention and input sanitization
- Rate limiting and abuse prevention
- Security headers (CSP, X-Frame-Options, etc.)

### Session Management (12 tests)

**File**: `test/session-management.test.js`

Authentication and session handling:

- Session creation and destruction
- Session regeneration for security
- Authentication persistence
- Concurrent session handling

### Authentication Utilities (6 tests)

**File**: `test/auth-utils.test.js`

Core authentication logic:

- Password hashing and verification
- Token generation and validation
- Authentication helper functions

### Basic Smoke Tests (5 tests)

**File**: `test/basic.test.js`

Ensures the application starts correctly:

- Server initialization
- Core routes respond
- Database connectivity
- Environment configuration

### End-to-End Tests

**File**: `test/e2e/basic.spec.js`

Critical user journeys in real browser:

- User registration flow
- Login/logout process
- Basic list operations
- Security header validation
- Responsive design checks

## What We Don't Unit Test

We consciously skip unit testing these areas (tested via E2E/integration instead):

- **Routes** (`routes/`, `index.js`): Heavy mocks don't reflect Docker reality - E2E tests cover these
- **Mock-heavy integrations**: External APIs (Spotify, Tidal, Deezer) are tested manually in staging
- **Admin operations**: Low-risk, admin-only features verified through manual testing
- **Main server file**: Application wiring is tested by running the app in Docker
- **Simple helpers**: Trivial utilities don't warrant test overhead

## Testing Philosophy

**We deploy with Docker. If it builds and security tests pass, ship it.**

- Docker Compose ensures consistent environments
- Security tests prevent expensive mistakes
- Manual testing catches UX issues better than 100 mocked tests
- Focus on critical paths, not coverage percentages
- Trust the container as the deployment unit

## Running Tests

### Before Pushing

```bash
npm test  # ~30 seconds, all core tests
```

If green, you're good to push. 🚀

### For Debugging

```bash
# Run specific test file
node --test test/security-middleware.test.js

# Run with verbose output
node --test --reporter=spec test/session-management.test.js

# Run in watch mode during development
npm run test:watch
```

### End-to-End Testing

```bash
# Run e2e tests (requires running server)
npm run test:e2e

# Run with interactive UI
npm run test:e2e:ui

# Install browsers if needed
npx playwright install
```

### Coverage Reports

```bash
npm run test:coverage
```

Note: We don't aim for high coverage percentages. We aim for testing what matters.

## Test Quality Indicators

### ✅ When Tests Pass

You can be confident that:

- Security features are working (CSRF, XSS, rate limiting)
- User authentication and sessions are solid
- Core application functionality works
- No obvious regressions in critical paths

### ⚠️ Manual Testing Still Required

Always manually verify:

- Visual appearance and layout
- User experience flows
- External API integrations (Spotify, Tidal, etc.)
- Admin operations
- Email functionality
- Browser compatibility

## Adding New Tests

Only add tests for:

1. **Security-critical features** - Always test anything touching auth or user data
2. **Business-critical paths** - Features that would cause major issues if broken
3. **Bug fixes** - Add a regression test when fixing a bug

Don't add tests for:

- Simple utility functions
- Code that's mostly configuration
- Features easily verified manually
- Low-risk admin-only operations

## Test File Structure

```
test/
├── security-middleware.test.js  # Security features (17 tests)
├── session-management.test.js   # Session handling (12 tests)
├── auth-utils.test.js          # Auth utilities (6 tests)
├── basic.test.js               # Smoke tests (5 tests)
└── e2e/
    └── basic.spec.js           # End-to-end workflows
```

## Troubleshooting

### Tests Failing

1. Check which specific test failed: `npm test`
2. Run that test file individually for more detail
3. Verify environment variables are set correctly
4. Check if database schema changed

### E2E Tests Not Running

1. Install Playwright browsers: `npx playwright install`
2. Ensure server is running (e2e tests need a live server)
3. Check browser dependencies are available

### Performance Issues

These tests should run in ~30 seconds. If slower:

1. Check database connection (might be timing out)
2. Verify no network calls in unit tests
3. Check for slow setup/teardown

---

**Remember**: Quality over quantity. 40 focused tests beat 100 mocked tests. Trust Docker, test what matters, ship with confidence! 🚀
